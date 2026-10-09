import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WIDGET_KEY, createChannelView, finishedMembers, formatNote, readChannelNotes, registerChannelView, rosterLine } from "./channel-view";
import { isTerminalYield, registerStopBridge } from "./stop-bridge";
import { registerWorkerReport } from "./worker-report";
import { expect, test } from "bun:test";

const CHAN = "repo@main/lead-abc";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "chan-view-"));
	const run = join(root, ".atlas", ".run");
	mkdirSync(join(run, "board"), { recursive: true });
	let seq = 0;
	const note = (owner: string, to: string, text: string, channel = CHAN) => {
		seq++;
		appendFileSync(join(run, "board", `${owner}.jsonl`), `${JSON.stringify({ ts: seq, seq, owner, to, item: null, text, channel })}\n`);
	};
	const finish = (names: string[]) =>
		writeFileSync(join(run, "channels.json"), JSON.stringify({ version: 1, channels: { [CHAN]: { members: names.map(name => ({ name, ended_at: 1 })) } } }));
	return { root, note, finish };
}

/** Stub ui, manual timers and clock: nothing real ticks, the test drives them. */
function harness(env: Record<string, string | undefined> = {}) {
	const calls: Array<string[] | undefined> = [];
	const ui = { setWidget: (_k: string, c: string[] | undefined) => void calls.push(c) };
	const timers = { iv: undefined as (() => void) | undefined, to: undefined as (() => void) | undefined, clock: 0 };
	const deps = {
		env,
		now: () => timers.clock,
		setInterval: (fn: () => void) => ((timers.iv = fn), "iv"),
		clearInterval: () => void (timers.iv = undefined),
		setTimeout: (fn: () => void) => ((timers.to = fn), "to"),
		clearTimeout: () => void (timers.to = undefined),
	};
	return { calls, ui, timers, deps, view: createChannelView(deps) };
}

test("formatNote: `from -> to: text`, one line, truncated", () => {
	expect(formatNote({ owner: "A", to: "B", text: "hi\n  there" })).toBe("A -> B: hi there");
	const long = formatNote({ owner: "A", to: "all", text: "x".repeat(300) });
	expect(long.length).toBe(110);
	expect(long.endsWith("…")).toBe(true);
	expect(long).not.toContain("\n");
});

test("rosterLine counts working vs finished", () => {
	expect(rosterLine(["A", "B", "C"], new Set(["B"]))).toBe("members: 2 working, 1 finished");
});

test("readChannelNotes: only this channel, last N by seq, torn lines skipped, missing board is []", () => {
	const f = fixture();
	for (let i = 1; i <= 12; i++) f.note(i % 2 ? "A" : "B", "all", `n${i}`);
	f.note("C", "all", "other channel", "other@main");
	appendFileSync(join(f.root, ".atlas", ".run", "board", "A.jsonl"), "{not json\n");
	expect(readChannelNotes(f.root, CHAN).map(n => n.text)).toEqual(["n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12"]);
	expect(readChannelNotes(join(f.root, "nope"), CHAN)).toEqual([]);
});

test("task returns first (async spawn): widget keeps polling, shows late notes, lingers and clears only after members end", () => {
	const f = fixture();
	const { calls, ui, timers, view } = harness();
	f.note("lead-abc", "A", "scope: do the thing");
	view.open(ui, { channel: CHAN, members: ["A", "B"], cwd: f.root }); // the task tool call itself returns right after this
	expect(calls[0]?.[0]).toContain(CHAN);
	expect(calls[0]).toContain("lead-abc -> A: scope: do the thing");
	expect(calls[0]?.at(-1)).toBe("members: 2 working, 0 finished");
	expect(timers.iv).toBeDefined();

	// no member has posted yet; many polls later (minutes) the view is still up and still polling
	for (let i = 0; i < 20; i++) timers.iv?.();
	expect(timers.iv).toBeDefined();
	expect(timers.to).toBeUndefined();

	f.note("A", "B", "touching shared.ts"); // child <-> child, written after the tool ended
	f.note("B", "lead-abc", "start: reading it"); // child -> lead
	timers.iv?.();
	expect(calls.at(-1)).toContain("A -> B: touching shared.ts");
	expect(calls.at(-1)).toContain("B -> lead-abc: start: reading it");

	f.finish(["A"]);
	for (let i = 0; i < 5; i++) timers.iv?.();
	expect(calls.at(-1)?.at(-1)).toBe("members: 1 working, 1 finished");
	expect(timers.iv).toBeDefined(); // B still working

	f.finish(["A", "B"]);
	timers.iv?.(); // quiet poll 1
	expect(calls.at(-1)?.at(-1)).toBe("members: 0 working, 2 finished");
	timers.iv?.(); // quiet poll 2
	expect(timers.iv).toBeDefined();
	timers.iv?.(); // quiet poll 3
	expect(timers.iv).toBeUndefined(); // polling stopped
	expect(timers.to).toBeDefined(); // linger scheduled, widget still showing
	expect(calls.at(-1)).toBeDefined();
	timers.to?.(); // linger elapsed
	expect(calls.at(-1)).toBeUndefined();
	expect(calls.every(c => c === undefined || c.length <= 10)).toBe(true);
});

test("a note arriving after everyone finished resets the quiet window", () => {
	const f = fixture();
	const { ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["A"], cwd: f.root });
	f.finish(["A"]);
	timers.iv?.();
	timers.iv?.();
	f.note("A", "lead-abc", "result: done");
	timers.iv?.(); // new note: window restarts
	timers.iv?.();
	timers.iv?.();
	expect(timers.iv).toBeDefined();
	timers.iv?.();
	expect(timers.iv).toBeUndefined();
});

test("hard cap: members never marked finished still end the view after MAX_MS", () => {
	const f = fixture();
	const { calls, ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["A"], cwd: f.root });
	timers.clock = 29 * 60_000;
	timers.iv?.();
	expect(timers.iv).toBeDefined();
	timers.clock = 30 * 60_000;
	timers.iv?.();
	expect(timers.iv).toBeUndefined();
	expect(timers.to).toBeDefined();
	timers.to?.();
	expect(calls.at(-1)).toBeUndefined();
});

test("a new dispatch during the linger keeps the widget and merges the roster", () => {
	const f = fixture();
	const { calls, ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["A"], cwd: f.root });
	f.finish(["A"]);
	for (let i = 0; i < 4; i++) timers.iv?.();
	expect(timers.to).toBeDefined();
	view.open(ui, { channel: CHAN, members: ["B"], cwd: f.root }); // second wave, same channel
	expect(timers.to).toBeUndefined();
	expect(timers.iv).toBeDefined();
	expect(calls.at(-1)?.at(-1)).toBe("members: 1 working, 1 finished");
});

test("ATLAS_CHANNELS=off: no widget, no timers", () => {
	const f = fixture();
	const { calls, ui, timers, view } = harness({ ATLAS_CHANNELS: "off" });
	view.open(ui, { channel: CHAN, members: ["A"], cwd: f.root });
	expect(calls).toHaveLength(0);
	expect(timers.iv).toBeUndefined();
});

test("a missing board still renders title + roster and never throws", () => {
	const { calls, ui, view } = harness();
	view.open(ui, { channel: CHAN, members: ["A"], cwd: join(tmpdir(), "no-such-repo-xyz") });
	expect(calls[0]).toEqual([`atlas channel ${CHAN}`, "members: 1 working, 0 finished"]);
	view.stop();
	expect(calls.at(-1)).toBeUndefined();
});

test("wiring: a task dispatch opens the view; session_shutdown clears it", () => {
	const f = fixture();
	const { calls, ui, timers, deps } = harness();
	type Handler = (e: Record<string, unknown>, c: Record<string, unknown>) => unknown;
	const handlers: Record<string, Handler[]> = {};
	const pi = { on: (name: string, h: Handler) => void (handlers[name] ??= []).push(h) } as unknown as Parameters<typeof registerChannelView>[0];
	const view = registerChannelView(pi, deps);
	const channelRun = (argv: string[]) => (argv.includes("channel-open") ? JSON.stringify({ channel: { name: CHAN }, briefs: { A: "CHANNEL: x" } }) : "");
	registerWorkerReport(pi, { env: { ATLAS_WORKER_SCHEMA: "off" }, channelRun, onChannelOpen: view.open });
	const ctx = { cwd: f.root, ui, agent: { kind: "main" }, sessionManager: { getSessionId: () => "abc123" } };
	handlers.tool_call[0]({ toolName: "task", input: { tasks: [{ agent: "task", name: "A", task: "t" }] } }, ctx);
	expect(calls.at(-1)?.[0]).toContain(CHAN);
	expect(timers.iv).toBeDefined();
	handlers.session_shutdown[0]({}, ctx);
	expect(calls.at(-1)).toBeUndefined();
	expect(timers.iv).toBeUndefined();
	expect(WIDGET_KEY).toBe("atlas-channel");
});

test("a sub's terminal yield marks its member finished in channels.json (real atlas_todo.py), which the view reads", async () => {
	process.env.ATLAS_HOME ??= mkdtempSync(join(tmpdir(), "chan-view-home-"));
	const repo = realpathSync(mkdtempSync(join(tmpdir(), "chan-view-repo-")));
	Bun.spawnSync(["git", "-C", repo, "init", "-q", "-b", "main"]);
	const script = join(import.meta.dir, "..", "scripts", "atlas_todo.py");
	const open = JSON.parse(Bun.spawnSync(["python3", script, "channel-open", "--root", repo, "--lead", "lead-abc", "--members", "Alpha,Beta"], { env: process.env }).stdout.toString());
	const chan = open.channel.name as string;
	type Handler = (e: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown> | unknown;
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, h: Handler) => void (handlers[name] ??= []).push(h) } as unknown as Parameters<typeof registerStopBridge>[0], { env: {} });
	// omp registry ids are `<n>-<name>` (types.ts ExtensionAgentIdentity.id, e.g. "0-Explore"); member-finish maps it back to the member
	const sub = { cwd: repo, agent: { kind: "sub", id: "0-Alpha" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "" } };
	await handlers.tool_execution_end[0]({ toolName: "bash", isError: false }, sub); // not a yield: ignored
	expect(finishedMembers(repo, chan).size).toBe(0);
	await handlers.tool_execution_end[0]({ toolName: "yield", isError: false }, { ...sub, agent: { kind: "main", id: "Alpha" } }); // lead's yield: ignored
	expect(finishedMembers(repo, chan).size).toBe(0);
	await handlers.tool_execution_end[0]({ toolName: "yield", isError: true }, sub); // failed yield: not finished
	expect(finishedMembers(repo, chan).size).toBe(0);
	// incremental section yield (omp #isTerminalYieldToolResult: details.status "success" + non-empty string[] type): still working
	const section = { toolName: "yield", isError: false, result: { details: { status: "success", type: ["findings"] } } };
	await handlers.tool_execution_end[0](section, sub);
	expect(finishedMembers(repo, chan).size).toBe(0);
	expect(isTerminalYield(section)).toBe(false);
	// terminal shapes: no details, details without the section marker, an empty type list
	for (const result of [undefined, {}, { details: {} }, { details: { status: "success", type: [] } }, { details: { status: "error", type: ["x"] } }]) {
		expect(isTerminalYield({ toolName: "yield", isError: false, result })).toBe(true);
	}
	await handlers.tool_execution_end[0]({ toolName: "yield", isError: false, result: { details: { status: "success" } } }, sub);
	expect([...finishedMembers(repo, chan)]).toEqual(["Alpha"]);
});
