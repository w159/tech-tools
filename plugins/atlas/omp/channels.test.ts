import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { defaultRun, leadName, reviseForChannel, sanitizeName } from "./channels";
import { registerWorkerReport } from "./worker-report";

process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), "channels-test-home-"));
const SCRIPT = join(import.meta.dir, "..", "scripts", "atlas_todo.py");

function repo(branch = "feature/x"): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "chan-repo-")));
	Bun.spawnSync(["git", "-C", dir, "init", "-q", "-b", branch]);
	return dir;
}

function todo(...args: string[]): Record<string, any> {
	const r = Bun.spawnSync(["python3", SCRIPT, ...args], { env: { ...process.env, ATLAS_CHANNEL: "" } });
	return JSON.parse(r.stdout.toString());
}

test("leadName: env wins, else lead-<session short id>, sanitised", () => {
	expect(leadName("abcdef123", {})).toBe("lead-abcdef");
	expect(leadName(undefined, {})).toBe("lead");
	expect(leadName("x", { ATLAS_LEAD_NAME: "My Lead" })).toBe("My_Lead");
	expect(sanitizeName("a b/c")).toBe("a_b_c");
});

test("an item that already carries a CHANNEL block (model copied a prior brief) still opens the live view", () => {
	const cwd = repo();
	const opened: string[][] = [];
	const input = { tasks: [{ agent: "task", name: "Beta", task: "do\n\nCHANNEL: stale" }] };
	const revised = reviseForChannel(input, { cwd, sessionId: "sess123456", env: {}, onOpen: i => opened.push(i.members) });
	expect(revised).toBeUndefined();
	expect(opened).toEqual([["Beta"]]);
});

test("dispatch opens <main>/<lead>, registers members, injects the CHANNEL block per item", () => {
	const cwd = repo();
	const main = `${basename(cwd)}@feature/x`;
	const input = { context: "ctx", tasks: [{ agent: "implementer", name: "Alpha", task: "do a" }, { agent: "task", task: "do b" }] };
	const revised = reviseForChannel(input, { cwd, sessionId: "sess123456", env: {} });
	const tasks = revised?.tasks as Record<string, string>[];
	expect(tasks[0].task).toContain(`CHANNEL: ${main}/lead-sess12`);
	expect(tasks[0].task).toContain("--owner Alpha");
	expect(tasks[0].task).toContain("atlas_todo.py");
	expect(tasks[1].name).toMatch(/^task-[0-9a-f]+$/);
	expect(tasks[1].task).toContain(`--owner ${tasks[1].name}`);
	// the input is not mutated, a second pass is a no-op
	expect((input.tasks[0] as Record<string, string>).task).toBe("do a");
	expect(reviseForChannel(revised as Record<string, unknown>, { cwd, sessionId: "sess123456", env: {} })).toBeUndefined();

	const tree = todo("channels", "--root", cwd);
	expect(tree.main).toBe(main);
	const sub = tree.channels[0].children[0];
	expect(sub.name).toBe(`${main}/lead-sess12`);
	expect(sub.members.map((m: { name: string; parent: string | null }) => [m.name, m.parent])).toEqual([
		["lead-sess12", null],
		["Alpha", "lead-sess12"],
		[tasks[1].name, "lead-sess12"],
	]);

	// C4: the atlas:* dispatch owns a todo (owner Alpha); the generic `task` agent creates none
	const items = todo("list", "--root", cwd).items as { owner?: string; channel?: string }[];
	const owned = items.filter((i) => i.owner === "Alpha");
	expect(owned).toHaveLength(1);
	expect(owned[0].channel).toBe(`${main}/lead-sess12`);
	expect(items.some((i) => i.owner === tasks[1].name)).toBe(false);
});

test("ATLAS_CHANNELS=off and a failing board leave the dispatch untouched", () => {
	const cwd = repo();
	expect(reviseForChannel({ tasks: [{ agent: "task", task: "x" }] }, { cwd, env: { ATLAS_CHANNELS: "off" } })).toBeUndefined();
	expect(reviseForChannel({ tasks: [{ agent: "task", task: "x" }] }, { cwd, env: {}, run: () => undefined })).toBeUndefined();
});

test("the tool_call handler injects the CHANNEL block for a main lead, not for a subagent", () => {
	const cwd = repo();
	type H = (e: { toolName: string; input: Record<string, unknown> }, c: unknown) => { input?: Record<string, any> } | undefined;
	let h: H | undefined;
	registerWorkerReport({ on: (_n: string, f: unknown) => { h = f as H; } } as unknown as Pick<ExtensionAPI, "on">, { env: {} });
	const ctx = (kind: string) => ({ cwd, agent: { kind }, sessionManager: { getSessionId: () => "zzzzzz9999" } });
	const out = h!({ toolName: "task", input: { agent: "implementer", name: "Bee", task: "t" } }, ctx("main"));
	expect(out?.input?.task).toContain("CHANNEL:");
	expect(out?.input?.outputSchema).toBeDefined(); // report schema survives alongside the channel block
	expect(h!({ toolName: "task", input: { agent: "task", name: "Sub", task: "t" } }, ctx("sub"))).toBeUndefined();
});

test("detached HEAD and non-git projects name the main channel @<sha> / folder only", () => {
	const cwd = repo();
	Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i"]);
	Bun.spawnSync(["git", "-C", cwd, "checkout", "-q", "--detach"]);
	const sha = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
	reviseForChannel({ tasks: [{ agent: "task", name: "A", task: "t" }] }, { cwd, sessionId: "sess123456", env: {} });
	expect(todo("channels", "--root", cwd).channels[0].children[0].name).toBe(`${basename(cwd)}@${sha}/lead-sess12`);

	const plain = realpathSync(mkdtempSync(join(tmpdir(), "chan-plain-")));
	mkdirSync(join(plain, "docs"));
	reviseForChannel({ tasks: [{ agent: "task", name: "A", task: "t" }] }, { cwd: plain, sessionId: "sess123456", env: {} });
	expect(todo("channels", "--root", plain).channels[0].children[0].name).toBe(`${basename(plain)}/lead-sess12`);
});

test("a dispatch from a subdirectory registers in the project registry, once per name", () => {
	const cwd = repo();
	const sub = join(cwd, "pkg", "deep");
	mkdirSync(sub, { recursive: true });
	const input = { tasks: [{ agent: "task", name: "A", task: "t" }, { agent: "task", name: "B", task: "t" }] };
	reviseForChannel(input, { cwd: sub, sessionId: "sess123456", env: {} });
	reviseForChannel(input, { cwd: sub, sessionId: "sess123456", env: {} }); // repeat dispatch: no duplicates
	const subchan = todo("channels", "--root", cwd).channels[0].children[0];
	expect(subchan.name).toBe(`${basename(cwd)}@feature/x/lead-sess12`);
	expect(subchan.members.map((m: { name: string }) => m.name)).toEqual(["lead-sess12", "A", "B"]);
});

test("a failing board records a fault and leaves the dispatch untouched (no throw)", () => {
	const cwd = repo();
	const faults = join(process.env.ATLAS_HOME as string, "hook-faults.jsonl");
	const before = existsSync(faults) ? readFileSync(faults, "utf8").length : 0;
	expect(reviseForChannel({ tasks: [{ agent: "task", task: "x" }] }, { cwd, env: {}, run: () => undefined })).toBeUndefined();
	expect(readFileSync(faults, "utf8").slice(before)).toContain('"hook":"channels"');
});

test("a missing atlas_todo.py records ONE actionable stale-install fault across 3 dispatches", () => {
	const cwd = repo();
	const faults = join(process.env.ATLAS_HOME as string, "hook-faults.jsonl");
	const before = existsSync(faults) ? readFileSync(faults, "utf8").length : 0;
	let ran = 0;
	const opts = { cwd, env: {}, script: join(cwd, "nope", "atlas_todo.py"), run: () => (ran++, undefined) };
	for (let i = 0; i < 3; i++) expect(reviseForChannel({ tasks: [{ agent: "task", task: "x" }] }, opts)).toBeUndefined();
	const added = readFileSync(faults, "utf8").slice(before).trim().split("\n");
	expect(added.length).toBe(1);
	expect(added[0]).toContain("atlas omp install is stale");
	expect(added[0]).toContain("omp plugin upgrade atlas");
  expect(added[0]).toContain("restart omp sessions started before the upgrade");
	expect(ran).toBe(0);
});

test("identical channel-open failures dedupe per session", () => {
	const cwd = repo();
	const faults = join(process.env.ATLAS_HOME as string, "hook-faults.jsonl");
	const before = existsSync(faults) ? readFileSync(faults, "utf8").length : 0;
	for (let i = 0; i < 3; i++) reviseForChannel({ tasks: [{ agent: "task", task: "x" }] }, { cwd, env: {}, run: () => undefined });
	expect(readFileSync(faults, "utf8").slice(before).trim().split("\n").length).toBe(1);
});

test("defaultRun: real channel-open succeeds in a fresh repo", () => {
	const dir = repo();
	const out = defaultRun(["python3", SCRIPT, "channel-open", "--root", dir, "--lead", "lead-t1", "--members", "a-1"], dir);
	expect(JSON.parse(out as string).channel.name).toContain("lead-t1");
});

test("defaultRun failure: fault carries exit code and stderr head", () => {
	const dir = repo();
	const faults = join(process.env.ATLAS_HOME as string, "hook-faults.jsonl");
	const out = reviseForChannel(
		{ tasks: [{ agent: "x", task: "t" }] },
		{ cwd: dir, env: {}, run: (_a, cwd) => defaultRun(["sh", "-c", "echo boom-cause >&2; exit 3"], cwd) },
	);
	expect(out).toBeUndefined();
	const last = readFileSync(faults, "utf8").trim().split("\n").pop() as string;
	expect(last).toContain("exit 3");
	expect(last).toContain("boom-cause");
});
