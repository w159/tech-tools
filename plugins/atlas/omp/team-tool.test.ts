import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTeamTool, teamArgv } from "./team-tool";

const ROOT = "/p/atlas";

function fakePi() {
	const tools: any[] = [];
	const Type = new Proxy({}, { get: () => () => ({}) });
	return { tools, pi: { registerTool: (t: any) => void tools.push(t), typebox: { Type } } as any };
}

test("spawn argv carries class, effort, task, paths and the omp harness", () => {
	expect(teamArgv({ action: "spawn", class: "audit", effort: "medium", task: "t", paths: ["a", "b"] }, ROOT)).toEqual([
		"python3", "/p/atlas/scripts/atlas_mux.py", "spawn-team", "--json", "--class", "audit", "--effort", "medium", "--task", "t", "--harness", "omp", "--paths", "a,b",
	]);
});

test("spawn argv passes an explicit harness and rejects unknown ones", () => {
	const spawn = { action: "spawn" as const, class: "audit", effort: "low", task: "t" };
	expect(teamArgv({ ...spawn, harness: "codex" }, ROOT)).toContain("codex");
	expect(() => teamArgv({ ...spawn, harness: "bogus" as unknown as "omp" }, ROOT)).toThrow("harness");
});

test("spawn argv passes --name only when given", () => {
	const spawn = { action: "spawn" as const, class: "audit", effort: "low", task: "t" };
	const argv = teamArgv({ ...spawn, name: "tui-review" }, ROOT);
	expect(argv[argv.indexOf("--name") + 1]).toBe("tui-review");
	expect(teamArgv(spawn, ROOT)).not.toContain("--name");
});

test("spawn argv passes the lead session id when known and omits --session otherwise", () => {
	const spawn = { action: "spawn" as const, class: "audit", effort: "medium", task: "t" };
	expect(teamArgv(spawn, ROOT, "sess-lead").slice(-2)).toEqual(["--session", "sess-lead"]);
	expect(teamArgv(spawn, ROOT)).not.toContain("--session");
	expect(teamArgv(spawn, ROOT, "")).not.toContain("--session");
});

test("execute passes ctx session id to spawn-team", async () => {
	const seen: string[][] = [];
	let def: any;
	const pi = { registerTool: (d: unknown) => (def = d), typebox: { Type: new Proxy({}, { get: () => () => ({}) }) } };
	registerTeamTool(pi as any, ROOT, async argv => (seen.push(argv), { code: 0, stdout: '{"ok": true}' }), {});
	await def.execute("i", { action: "spawn", class: "audit", effort: "low", task: "t" }, undefined, undefined, { cwd: "/tmp", sessionManager: { getSessionId: () => "sess-lead" } });
	await def.execute("i", { action: "spawn", class: "audit", effort: "low", task: "t" }, undefined, undefined, { cwd: "/tmp" });
	expect(seen[0].slice(-2)).toEqual(["--session", "sess-lead"]);
	expect(seen[1]).not.toContain("--session");
});

test("wait and reap argv", () => {
	expect(teamArgv({ action: "wait", team: "t1", timeout: 5 }, ROOT).slice(2)).toEqual(["wait", "--team", "t1", "--timeout", "5"]);
	expect(teamArgv({ action: "reap", team: "t1" }, ROOT).slice(2)).toEqual(["reap", "--team", "t1"]);
});

test("missing required field throws", () => {
	expect(() => teamArgv({ action: "wait" }, ROOT)).toThrow("team is required");
});

test("tool shells out through the injected runner and returns its JSON", async () => {
	const { tools, pi } = fakePi();
	const calls: string[][] = [];
	expect(registerTeamTool(pi, ROOT, async argv => (calls.push(argv), { code: 0, stdout: '{"ok": true}\n' }), {})).toBe(true);
	const res = await tools[0].execute("id", { action: "reap", team: "t1" }, undefined, undefined, { cwd: "/w" });
	expect(res.content[0].text).toBe('{"ok": true}');
	expect(calls[0].slice(2)).toEqual(["reap", "--team", "t1"]);
});

test("spawn mounts the channel widget with the team's channel and members; wait re-mounts from the team record before blocking", async () => {
	const root = mkdtempSync(join(tmpdir(), "team-tool-"));
	mkdirSync(join(root, ".atlas", ".run", "teams"), { recursive: true });
	writeFileSync(join(root, ".atlas", ".run", "teams", "t1.json"), JSON.stringify({ team_id: "t1", channel: "c@main/lead", members: [{ name: "audit-1" }, { name: "audit-2" }] }));
	const { tools, pi } = fakePi();
	const opened: any[] = [];
	const order: string[] = [];
	const ui = { setWidget: () => {} };
	const spawnOut = '{"ok": true, "team_id": "t1", "channel": "c@main/lead", "members": [{"name": "audit-1", "ok": true}, {"name": "audit-2", "ok": true}]}\n';
	const run = async (argv: string[]) => (order.push(argv[2]), { code: 0, stdout: argv[2] === "spawn-team" ? spawnOut : '{"ok": true}' });
	registerTeamTool(pi, ROOT, run, {}, (u, info) => (order.push("open"), opened.push({ u, info })));
	const call = (params: object) => tools[0].execute("id", params, undefined, undefined, { cwd: root, ui });

	await call({ action: "spawn", class: "audit", effort: "medium", task: "t" });
	expect(opened[0].u).toBe(ui);
	expect(opened[0].info).toMatchObject({ channel: "c@main/lead", members: ["audit-1", "audit-2"], cwd: root });
	order.length = 0;
	await call({ action: "wait", team: "t1" });
	expect(order).toEqual(["open", "wait"]);
	expect(opened[1].info).toMatchObject({ channel: "c@main/lead", members: ["audit-1", "audit-2"] });
	order.length = 0;
	await call({ action: "reap", team: "t1" });
	expect(order).toEqual(["reap"]);
	await call({ action: "wait", team: "../x" }); // bad id: no open, no throw
	expect(opened).toHaveLength(2);
});

test("reap re-mounts the widget from the archived team record, flagged reaped, so the idle panel shows", async () => {
	const root = mkdtempSync(join(tmpdir(), "team-tool-"));
	const arch = join(root, ".atlas", ".run", "teams", "archive");
	mkdirSync(arch, { recursive: true });
	const { tools, pi } = fakePi();
	const opened: any[] = [];
	const order: string[] = [];
	const run = async (argv: string[]) => {
		order.push(argv[2]);
		writeFileSync(join(arch, "t1.json"), JSON.stringify({ team_id: "t1", channel: "c@main/lead", members: [{ name: "audit-1" }, { name: "audit-2" }] })); // reap archives
		return { code: 0, stdout: '{"ok": true}' };
	};
	registerTeamTool(pi, ROOT, run, {}, (_u, info) => (order.push("open"), opened.push(info)));
	await tools[0].execute("id", { action: "reap", team: "t1" }, undefined, undefined, { cwd: root, ui: { setWidget: () => {} } });
	expect(order).toEqual(["reap", "open"]);
	expect(opened[0]).toMatchObject({ channel: "c@main/lead", members: ["audit-1", "audit-2"], reaped: true });
});

/** Registers the tool with a recording runner and widget; returns helpers. */
function rig(opts: { env?: Record<string, string | undefined>; stdout?: string; root?: string } = {}) {
	const root = opts.root ?? mkdtempSync(join(tmpdir(), "team-tool-"));
	mkdirSync(join(root, ".atlas", ".run", "teams", "archive"), { recursive: true });
	const { tools, pi } = fakePi();
	const runs: Array<{ argv: string[]; cwd: string; ms: number }> = [];
	const opened: any[] = [];
	registerTeamTool(pi, ROOT, async (argv, cwd, ms) => (runs.push({ argv, cwd, ms }), { code: 0, stdout: opts.stdout ?? '{"ok": true}' }), opts.env ?? {}, (u, info) => void opened.push({ u, info }));
	const ui = { setWidget: () => {} };
	const call = (params: object, ctx: object = { cwd: root, ui }) => tools[0].execute("id", params, undefined, undefined, ctx);
	const record = (sub: string, id: string, rec: object) => writeFileSync(join(root, ".atlas", ".run", "teams", sub, `${id}.json`), JSON.stringify(rec));
	return { root, tools, runs, opened, call, record, ui };
}

test("--timeout is passed for wait only, including a 0 timeout, and never for reap or when unset", () => {
	expect(teamArgv({ action: "wait", team: "t1" }, ROOT).slice(2)).toEqual(["wait", "--team", "t1"]);
	expect(teamArgv({ action: "wait", team: "t1", timeout: 0 }, ROOT).slice(2)).toEqual(["wait", "--team", "t1", "--timeout", "0"]);
	expect(teamArgv({ action: "reap", team: "t1", timeout: 9 }, ROOT).slice(2)).toEqual(["reap", "--team", "t1"]);
});

test("spawn argv omits --paths for an empty list and requires class, effort and task by name", () => {
	const spawn = { action: "spawn" as const, class: "audit", effort: "low", task: "t" };
	expect(teamArgv({ ...spawn, paths: [] }, ROOT)).not.toContain("--paths");
	expect(() => teamArgv({ ...spawn, class: undefined }, ROOT)).toThrow("atlas_team: class is required");
	expect(() => teamArgv({ ...spawn, effort: undefined }, ROOT)).toThrow("atlas_team: effort is required");
	expect(() => teamArgv({ ...spawn, task: "" }, ROOT)).toThrow("atlas_team: task is required");
});

test("child timeout: wait gets its own timeout (default 600s) plus a 30s margin; spawn and reap get 90s; cwd is the session cwd", async () => {
	const r = rig();
	await r.call({ action: "wait", team: "t1" });
	await r.call({ action: "wait", team: "t1", timeout: 5 });
	await r.call({ action: "spawn", class: "audit", effort: "low", task: "t" });
	await r.call({ action: "reap", team: "t1" });
	expect(r.runs.map(x => x.ms)).toEqual([630_000, 35_000, 90_000, 90_000]);
	expect(r.runs.every(x => x.cwd === r.root)).toBe(true);
});

test("empty runner output becomes an explicit no-output error JSON", async () => {
	const r = rig({ stdout: "  \n" });
	const res = await r.call({ action: "reap", team: "t1" });
	expect(JSON.parse(res.content[0].text)).toEqual({ ok: false, error: "no output" });
	expect(res.content[0].type).toBe("text");
});

test("a missing required field rejects the call before any process runs", async () => {
	const r = rig();
	await expect(r.call({ action: "wait" })).rejects.toThrow("team is required");
	expect(r.runs).toHaveLength(0);
});

test("spawn widget lists only members that started; a failed or nameless member is left out", async () => {
	const out = JSON.stringify({ ok: true, channel: "c@main/lead", members: [{ name: "a", ok: true }, { name: "b", ok: false }, { name: "c" }, { ok: true }, { name: 7, ok: true }] });
	const r = rig({ stdout: `noise line\n${out}\n` });
	await r.call({ action: "spawn", class: "audit", effort: "low", task: "t" });
	expect(r.opened).toHaveLength(1);
	expect(r.opened[0].info.members).toEqual(["a", "c"]);
	expect(r.opened[0].info.channel).toBe("c@main/lead");
	expect(r.opened[0].info).not.toHaveProperty("reaped"); // only reap flags the idle panel
});

test("spawn opens nothing when no member started, the channel is missing, the output is not JSON, or there is no ui", async () => {
	for (const stdout of [
		JSON.stringify({ channel: "c", members: [{ name: "a", ok: false }] }),
		JSON.stringify({ members: [{ name: "a", ok: true }] }),
		JSON.stringify({ channel: 5, members: [{ name: "a", ok: true }] }),
		JSON.stringify({ channel: "c", members: "nope" }),
		"not json",
		"",
	]) {
		const r = rig({ stdout });
		await r.call({ action: "spawn", class: "audit", effort: "low", task: "t" });
		expect(r.opened).toHaveLength(0);
	}
	const noUi = rig({ stdout: JSON.stringify({ channel: "c", members: [{ name: "a", ok: true }] }) });
	await noUi.call({ action: "spawn", class: "audit", effort: "low", task: "t" }, { cwd: noUi.root });
	expect(noUi.opened).toHaveLength(0);
});

test("a throwing onOpen never breaks the tool result", async () => {
	const { tools, pi } = fakePi();
	registerTeamTool(pi, ROOT, async () => ({ code: 0, stdout: JSON.stringify({ channel: "c", members: [{ name: "a" }] }) }), {}, () => {
		throw new Error("ui gone");
	});
	const res = await tools[0].execute("id", { action: "spawn", class: "audit", effort: "low", task: "t" }, undefined, undefined, { cwd: "/w", ui: {} });
	expect(JSON.parse(res.content[0].text).channel).toBe("c");
});

test("wait re-mount carries cwd and session id and no reaped flag; an unsafe or absent team id never reads a file", async () => {
	const r = rig();
	r.record("", "t1", { channel: "c1", members: [{ name: "m1" }] });
	r.record("", "x", { channel: "stolen", members: [{ name: "evil" }] }); // reachable only through a "../x" traversal from teams/archive
	r.record("", "undefined", { channel: "undef", members: [{ name: "u" }] }); // what a missing team id would stringify to
	await r.call({ action: "wait", team: "t1" }, { cwd: r.root, ui: r.ui, sessionManager: { getSessionId: () => "sess-9" } });
	expect(r.opened).toHaveLength(1);
	expect(r.opened[0].info).toEqual({ channel: "c1", members: ["m1"], cwd: r.root, sessionId: "sess-9" });
	await r.call({ action: "wait", team: "../x" });
	await r.call({ action: "wait", team: "a/b" });
	await r.call({ action: "wait", team: "x".repeat(65) });
	await expect(r.call({ action: "wait" })).rejects.toThrow("team is required");
	await r.call({ action: "reap", team: "../x" });
	expect(r.opened).toHaveLength(1);
});

test("a team record that is corrupt or names no started member opens nothing", async () => {
	const r = rig();
	writeFileSync(join(r.root, ".atlas", ".run", "teams", "bad.json"), "{not json");
	r.record("", "empty", { channel: "c", members: [] });
	await r.call({ action: "wait", team: "bad" });
	await r.call({ action: "wait", team: "empty" });
	await r.call({ action: "wait", team: "missing" });
	expect(r.opened).toHaveLength(0);
});

test("ATLAS_PROJECT_ROOT, when set, locates the team records instead of the session cwd", async () => {
	const proj = mkdtempSync(join(tmpdir(), "team-proj-"));
	const r = rig({ env: { ATLAS_PROJECT_ROOT: proj } });
	mkdirSync(join(proj, ".atlas", ".run", "teams"), { recursive: true });
	writeFileSync(join(proj, ".atlas", ".run", "teams", "t1.json"), JSON.stringify({ channel: "proj-chan", members: [{ name: "m" }] }));
	r.record("", "t1", { channel: "cwd-chan", members: [{ name: "m" }] });
	await r.call({ action: "wait", team: "t1" });
	expect(r.opened[0].info.channel).toBe("proj-chan");
	expect(r.opened[0].info.cwd).toBe(r.root); // the widget still reports the session cwd
});

test("a non-string session id is dropped rather than forwarded", async () => {
	const r = rig();
	await r.call({ action: "spawn", class: "audit", effort: "low", task: "t" }, { cwd: r.root, sessionManager: { getSessionId: () => 42 } });
	expect(r.runs[0].argv).not.toContain("--session");
});

test("the registered tool is named atlas_team and its description documents all three actions", () => {
	const { tools, pi } = fakePi();
	registerTeamTool(pi, ROOT, undefined, {});
	expect(tools[0].name).toBe("atlas_team");
	expect(typeof tools[0].description).toBe("string");
	for (const word of ["action=spawn", "action=wait", "action=reap"]) expect(tools[0].description).toContain(word);
});

test("registration is refused without registerTool or typebox, and a blank worker name still registers", () => {
	expect(registerTeamTool({ typebox: { Type: {} } }, ROOT, undefined, {})).toBe(false);
	expect(registerTeamTool({ registerTool: () => {} }, ROOT, undefined, {})).toBe(false);
	const { tools, pi } = fakePi();
	expect(registerTeamTool(pi, ROOT, undefined, { ATLAS_WORKER_NAME: "  " })).toBe(true);
	expect(tools).toHaveLength(1);
});

test("hidden from worker sessions", () => {
	const { tools, pi } = fakePi();
	expect(registerTeamTool(pi, ROOT, undefined, { ATLAS_WORKER_NAME: "w1" })).toBe(false);
	expect(tools).toHaveLength(0);
});
