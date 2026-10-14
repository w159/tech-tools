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
		"python3", "/p/atlas/scripts/atlas_mux.py", "spawn-team", "--class", "audit", "--effort", "medium", "--task", "t", "--harness", "omp", "--paths", "a,b",
	]);
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

test("hidden from worker sessions", () => {
	const { tools, pi } = fakePi();
	expect(registerTeamTool(pi, ROOT, undefined, { ATLAS_WORKER_NAME: "w1" })).toBe(false);
	expect(tools).toHaveLength(0);
});
