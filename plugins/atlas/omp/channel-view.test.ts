import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WIDGET_KEY, boardRoot, createChannelView, sessionTodos, laneCalls, laneTool, sparkBuckets, liveWorkers, registerLaneToolRecorder, spinFrame, todoSummary, railPhase, finishedMembers, formatNote, readChannelNotes, registerChannelView } from "./channel-view";
import { createGatesCache, renderPanel, visibleWidth, type PanelModel } from "./mission-panel";
import { isTerminalYield, registerStopBridge } from "./stop-bridge";
import { registerWorkerReport } from "./worker-report";
import { readFileSync } from "node:fs";
import { spin } from "../mod/theme";
import { planCounts, planPhase } from "../mod/data/todos";
import { expect, test } from "bun:test";

const CHAN = "repo@main/lead-abc";
const plain = (ls?: string[]) => (ls ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
/** A lane row: state chip, glyph, then the worker name. */
/** A worker row: its status mark (spinner, hollow dot, tick or cross) then the name. */
const lane = (name: string) => new RegExp(`[\u25d0\u25d3\u25d1\u25d2\u25c7\u25c9\u25a0\u25cf] ${name}\\s`);

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
	expect(formatNote({ owner: "A", to: "B", text: "hi\n  there" })).toBe("A > B: hi there");
	const long = formatNote({ owner: "A", to: "all", text: "x".repeat(300) });
	expect(long.length).toBe(110);
	expect(long.endsWith("…")).toBe(true);
	expect(long).not.toContain("\n");
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
	expect(plain(calls[0])).toContain("lead-abc to A   scope: do the thing");
	expect(plain(calls[0])).toMatch(lane("A"));
	expect(timers.iv).toBeDefined();

	// no member has posted yet; many polls later (minutes) the view is still up and still polling
	for (let i = 0; i < 20; i++) timers.iv?.();
	expect(timers.iv).toBeDefined();
	expect(timers.to).toBeUndefined();

	f.note("A", "B", "touching shared.ts"); // child <-> child, written after the tool ended
	f.note("B", "lead-abc", "start: reading it"); // child -> lead
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("B to lead-abc   start: reading it"); // one message row: the newest
	expect(plain(calls.at(-1))).not.toContain("touching shared.ts");

	f.finish(["A"]);
	for (let i = 0; i < 5; i++) timers.iv?.();
	expect(plain(calls.at(-1))).toMatch(lane("B"));
	expect(plain(calls.at(-1))).not.toMatch(lane("A"));
	expect(timers.iv).toBeDefined(); // B still working

	f.finish(["A", "B"]);
	timers.iv?.(); // quiet poll 1
	expect(plain(calls.at(-1))).toContain("last run  2 workers");
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
	expect(plain(calls.at(-1))).toMatch(lane("B"));
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
	expect(plain([calls[0]![0]!])).toContain("ATLAS");
	expect(plain(calls[0])).toMatch(lane("A"));
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
	expect(plain(calls.at(-1))).toMatch(lane("A"));
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

test("a sub's agent_end (omp parks a finished task worker; yield may never fire) marks its member finished", async () => {
	process.env.ATLAS_HOME ??= mkdtempSync(join(tmpdir(), "chan-view-home-"));
	const repo = realpathSync(mkdtempSync(join(tmpdir(), "chan-view-repo-")));
	Bun.spawnSync(["git", "-C", repo, "init", "-q", "-b", "main"]);
	const script = join(import.meta.dir, "..", "scripts", "atlas_todo.py");
	const open = JSON.parse(Bun.spawnSync(["python3", script, "channel-open", "--root", repo, "--lead", "lead-abc", "--members", "Alpha,Beta"], { env: process.env }).stdout.toString());
	const chan = open.channel.name as string;
	type Handler = (e: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown> | unknown;
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, h: Handler) => void (handlers[name] ??= []).push(h) } as unknown as Parameters<typeof registerStopBridge>[0], { env: {} });
	// omp 18.10 ids are `<Name>-<n>` (live: "ProbeFin-5"), not only `<n>-<Name>`; the python resolver strips neither the "-n" suffix
	const sub = { cwd: repo, agent: { kind: "sub", id: "Alpha-5" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "" } };
	await handlers.agent_end[0]({}, { ...sub, agent: { kind: "main", id: "Main" } }); // lead's agent_end: ignored
	expect(finishedMembers(repo, chan).size).toBe(0);
	await handlers.agent_end[0]({}, sub);
	expect([...finishedMembers(repo, chan)]).toEqual(["Alpha"]);
});

function atlasFixture(members: Array<Record<string, unknown>>, todos: Array<Record<string, unknown>>) {
	const f = fixture();
	const run = join(f.root, ".atlas", ".run");
	writeFileSync(join(run, "channels.json"), JSON.stringify({ version: 1, channels: { [CHAN]: { members } } }));
	writeFileSync(join(run, "todos.json"), JSON.stringify({ version: 1, items: todos }));
	return f.root;
}

test("todo summary: this session's progress and phase; finished members are not live", () => {
	const root = atlasFixture(
		[{ name: "lead-abc", role: "lead", joined: 1 }, { name: "w1", joined: 1 }, { name: "w2", joined: 1, exit_code: 0 }, { name: "w3", joined: 1, ended_at: 2 }],
		[{ status: "completed" }, { status: "in_progress", phase: "implement" }, { status: "pending" }],
	);
	expect(liveWorkers(root, CHAN).map(w => w.name)).toEqual(["w1"]);
	expect(todoSummary(root)).toEqual({ done: 1, total: 3, phase: "implement" });
});

test("todo summary counts only this session's todos (not the historic board) and ignores advisor rows", () => {
	const root = atlasFixture(
		[{ name: "lead-abc", role: "lead", joined: 1 }],
		[
			{ status: "pending", phase: "research", session_id: "old" },
			{ status: "completed", session_id: "old" },
			{ status: "pending", phase: "research", session_id: "s1", origin: "advisor" },
			{ status: "completed", session_id: "s1" },
			{ status: "in_progress", phase: "verify", session_id: "s1" },
		],
	);
	expect(todoSummary(root, "s1")).toEqual({ done: 1, total: 2, phase: "verify" });
});

test("spinner differs between consecutive polls and matches mod/theme.ts frames", () => {
	for (const ph of ["research", "theory", "test", "implement", "verify", "done"]) for (let i = 0; i < 12; i++) expect(spinFrame(i, ph)).toBe(spin(i, ph));
});

test("a linked-worktree cwd reads the MAIN repo board, where atlas_todo.py writes channels.json", () => {
	const main = atlasFixture([{ name: "w1", joined: 1 }], [{ status: "pending", phase: "verify" }]);
	mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
	writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
	const wt = mkdtempSync(join(tmpdir(), "chan-view-wt-"));
	mkdirSync(join(wt, ".atlas"), { recursive: true }); // a stray .atlas in the worktree must not win
	writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
	const { calls, ui, view } = harness();
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: wt });
	expect(plain(calls[0])).toMatch(lane("w1"));
	view.stop();
});

test("widget never exceeds omp's 10-line cap with 6 workers and 8 notes; the header is first, the newest message last", () => {
	const names = Array.from({ length: 6 }, (_, i) => `w${i}`);
	const root = atlasFixture(names.map(name => ({ name, joined: 1 })), [{ status: "pending", phase: "verify" }]);
	for (let i = 0; i < 8; i++) appendFileSync(join(root, ".atlas", ".run", "board", "a.jsonl"), `${JSON.stringify({ ts: i, seq: i + 1, owner: "a", to: "all", text: `n${i}`, channel: CHAN })}\n`);
	const { calls, ui, view } = harness({ ATLAS_PROJECT_ROOT: root });
	view.open(ui, { channel: CHAN, members: names, cwd: root });
	expect(calls[0]!.length).toBeLessThanOrEqual(10);
	expect(plain([calls[0]![0]!])).toContain("ATLAS");
	expect(plain([calls[0]![0]!])).toContain("of 1");
	expect(plain([calls[0]!.at(-1)!])).toContain("a to all   n7"); // no checks reported yet: the message row closes the panel
	view.stop();
});

test("widget paints the band first and repaints a poll only when the picture changed", () => {
	const root = atlasFixture([{ name: "w1", joined: 1 }], [{ status: "pending", phase: "verify" }]);
	const { calls, ui, timers, view } = harness({ ATLAS_PROJECT_ROOT: root });
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
	timers.iv?.();
	expect(plain([calls[0]![0]!])).toContain("ATLAS");
	expect(calls.length).toBe(1); // a starting worker draws no spinner, so nothing moves between polls
	view.stop();
});

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 120, maxLines: 10, phase: "implement", spin: "⣾", laneSpin: "⠋", tick: 1, done: 5, total: 9,
	workers: [
		{ name: "explorer-a324", secs: 72, tool: { tool: "ctx_search", target: "dispatch_tripwire.py", active: true }, spark: [1, 3, 5, 2, 6, 7, 4, 2, 5, 6, 3, 1] },
		{ name: "implementer-band", secs: 48, role: "implementer", tool: { tool: "Edit", target: "mod/band.tsx", active: false } },
		{ name: "verifier-ui", secs: 12 },
	],
	notes: [{ from: "explorer-a324", to: "implementer-band", text: "found 3 call sites" }, { from: "implementer-band", to: "all", text: "band.tsx compiles" }],
	gates: [{ id: "completion", title: "c", lines: [] }, { id: "tripwire", title: "t", lines: [] }, { id: "routing", title: "r", lines: [{ id: "a", label: "a", ok: false }] }],
	channel: "tech-tools@main/lead-a47cc5", team: "audit/medium", elapsedSecs: 161,
	...over,
});
const ESCAPE_OK = /^(?:\x1b\[[0-9;]*m|[^\x1b])*$/; // every ESC starts a complete SGR sequence

test("panel: the band, workers in words, the newest message and the checks footer", () => {
	const lines = renderPanel(model());
	const p = lines.map(l => plain([l]));
	expect(p[0]).toMatch(/^◖ ◆ ATLAS ◗ {2}implement · phase 4\/6 {3}todo █████▌░░░░ 5 of 9 {3}◓ 2 running {3}◇ 1 queued +$/);
	expect(p[1]).toBe(" ".repeat(120)); // breathing row under the band; the spinner frame is spinnerGlyph(tick 1)
	expect(p[2]).toMatch(/^ ◓ explorer-a324 {5}explorer {5}ctx_search {2}dispatch_tripwire\.py +1m12s $/);
	expect(p[3]).toMatch(/^ ◓ implementer-band {2}implementer {2}thinking {3}last Edit mod\/band\.tsx +48s $/);
	expect(p[4]).toMatch(/^ ◇ verifier-ui {7}verifier {5}starting +12s $/);
	expect(p[5]).toBe(" ".repeat(120));
	expect(p[6]).toMatch(/^ implementer-band to all {3}band\.tsx compiles +$/);
	expect(p[7]).toBe(" checks  ■ routing".padEnd(120)); // groups with no lines yet are not shown
	expect(lines).toHaveLength(8);
	expect(lines[7]).toContain("38;2;243;139;168"); // bad

});

test("panel: <= maxLines, visible width exactly `width` at 60..200, no broken escapes, whatever the load", () => {
	for (let width = 60; width <= 200; width += 7) for (const n of [0, 1, 4, 6, 9]) for (const maxLines of [5, 7, 10]) {
		const workers = Array.from({ length: n }, (_, i) => ({ name: `worker-number-${i}-${"é".repeat(30)}`, secs: 500, tool: { tool: "x".repeat(40), target: "y".repeat(90), active: i % 2 === 0 } }));
		const lines = renderPanel(model({ width, maxLines, workers, notes: [{ from: "a", to: "b", text: "z".repeat(300) }] }));
		expect(lines.length).toBeLessThanOrEqual(maxLines);
		for (const l of lines) {
			expect(visibleWidth(l)).toBe(width);
			expect(l).toMatch(ESCAPE_OK);
		}
	}
});

test("panel with 6 workers: all fit 10 lines; a tighter budget folds workers into `+N more`, the message gives way last-but-one, the footer last", () => {
	const six = Array.from({ length: 6 }, (_, i) => ({ name: `w${i}`, secs: 5 }));
	const full = renderPanel(model({ workers: six }));
	expect(full).toHaveLength(10);
	expect(plain(full)).not.toContain("more");
	expect(plain(full)).toContain("implementer-band to all");
	const eight = plain(renderPanel(model({ workers: six, maxLines: 7 })));
	expect(eight).toContain("+3 more");
	expect(eight).toMatch(lane("w2"));
	expect(eight).toContain("checks");
	const five = plain(renderPanel(model({ workers: six, maxLines: 4 })));
	expect(five).not.toContain("implementer-band to all"); // the message is the first row to go
	expect(five).toContain("checks");
});

test("panel idle: the band reads idle and the last run follows, the whole thing is two rows", () => {
	const idle = renderPanel(model({ workers: [], phase: "done", idle: { workers: 3, secs: 70, failed: 0 }, gates: [], elapsedSecs: undefined }));
	expect(idle).toHaveLength(2);
	expect(plain([idle[0]!])).toMatch(/^◖ ◆ ATLAS ◗ {2}idle · phase 6\/6 {3}todo █████▌░░░░ 5 of 9 +$/);
	expect(plain([idle[1]!])).toMatch(/^ last run {2}3 workers · 1m10s · all ok +$/);
	const failed = plain(renderPanel(model({ workers: [], idle: { workers: 2, secs: 9, failed: 1 }, gates: [] })));
	expect(failed).toContain("last run  2 workers · 9s · 1 failed");
});

test("long worker names and roles are cut with an ellipsis in their columns, never run together", () => {
	const workers = [{ name: "completeness-critic-f08e", role: "completeness-critic", secs: 24, tool: { tool: "write", target: "x", active: false } }];
	const out = plain(renderPanel(model({ workers, width: 160 })));
	expect(out).toMatch(/completeness-cri\.\.\. completen\.\.\. thinking {3}last write x/);
});

test("panel at 60 columns is the band alone", () => {
	const p = renderPanel(model({ width: 60 })).map(l => plain([l]));
	expect(p).toHaveLength(1);
	expect(p[0]!.trim()).toBe("◖ ◆ ATLAS ◗ ph 4/6 · todo 5/9 · ◓2");
});

test("worker marks: a running worker's spinner follows the tick, thinking has a grey one, starting is a hollow diamond; no faces", () => {
	const lane = (tick: number, tool?: { tool: string; target: string; active: boolean }) =>
		plain([renderPanel(model({ tick, workers: [{ name: "explorer-a324", secs: 5, tool }] }))[2]!]);
	const run = { tool: "ctx_search", target: "x", active: true };
	expect(lane(0, run)).toMatch(/^ ◐ explorer-a324 +explorer +ctx_search {2}x/);
	expect(lane(1, run)).toMatch(/^ ◓ explorer-a324/);
	expect(lane(0, { ...run, active: false })).toMatch(/^ ◐ explorer-a324 +explorer +thinking {3}last ctx_search x/);
	expect(lane(0)).toMatch(/^ ◇ explorer-a324 +explorer +starting/);
	expect(lane(0, run)).not.toMatch(/[◔•◉]/);
});

test("sparkBuckets: tool calls per 10s bucket over the last 2 minutes, oldest first", () => {
	expect(sparkBuckets([100, 105, 115, 1, 121, -500], 120)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]); // future and stale calls drop
});

test("gates cache runs the command at most once per 10s across 20 paints and never blocks", async () => {
	let clock = 0;
	const argvs: string[][] = [];
	const cache = createGatesCache(async argv => (argvs.push(argv), JSON.stringify({ groups: [{ id: "completion", title: "c", lines: [{ id: "a", label: "a", ok: true }] }] })), () => clock, "/x/atlas_gates.py");
	expect(cache.read()).toBeNull();
	for (let i = 0; i < 20; i++) {
		cache.refresh("sid", "/root");
		clock += 400; // 8s total
	}
	expect(argvs.length).toBe(1);
	expect(argvs[0]).toEqual(["python3", "/x/atlas_gates.py", "--session", "sid", "--root", "/root", "--json"]);
	await new Promise(r => setTimeout(r, 0));
	expect(cache.read()?.[0]?.id).toBe("completion");
	clock = 10_001;
	cache.refresh("sid", "/root");
	expect(argvs.length).toBe(2);
});

test("gates cache: a failing command becomes an error group and still throttles", async () => {
	let calls = 0;
	const cache = createGatesCache(async () => { calls++; throw new Error("boom"); }, () => 0, "/x");
	cache.refresh("s", "/r");
	cache.refresh("s", "/r");
	await new Promise(r => setTimeout(r, 0));
	expect(calls).toBe(1);
	expect(cache.read()?.[0]?.error).toBe("boom");
});

// ---- lanes: tmux team workers and task subs with their live tool + target ----

const FIXTURE_LOG = join(import.meta.dir, "..", "scripts", "fixtures", "claude_stream.jsonl");
const live = (root: string, names: string[], ended: string[] = []) =>
	writeFileSync(
		join(root, ".atlas", ".run", "channels.json"),
		JSON.stringify({ version: 1, channels: { [CHAN]: { members: [{ name: "lead-abc", role: "lead" }, ...names.map(name => (ended.includes(name) ? { name, ended_at: 1, exit_code: 0 } : { name }))] } } }),
	);
const toolUse = (id: string, name: string, input: Record<string, unknown>) =>
	`${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } })}\n`;
const toolResult = (id: string) => `${JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } })}\n`;
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("team lanes: last tool_use from each worker's stream-json log, mcp prefix stripped, dimmed between calls; finished workers drop", () => {
	const f = fixture();
	const logs = join(f.root, ".atlas", ".run", "logs");
	mkdirSync(logs, { recursive: true });
	writeFileSync(join(logs, "audit-1.log"), readFileSync(FIXTURE_LOG)); // real claude worker log: last call `Bash echo hi`, already answered
	writeFileSync(join(logs, "audit-2.log"), `garbage torn line\n${toolUse("t1", "mcp__plugin_context-mode_context-mode__ctx_search", { query: "where is the widget mounted from the team spawn path today" })}`);
	writeFileSync(join(logs, "audit-3.log"), toolUse("t2", "Read", { file_path: "/x/y/shared.ts" }) + toolResult("t2") + toolUse("t3", "Edit", { file_path: "/x/y/mission-panel.ts" }));
	live(f.root, ["audit-1", "audit-2", "audit-3"]);
	const { calls, ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["audit-1", "audit-2", "audit-3"], cwd: f.root });
	const out = plain(calls.at(-1));
	expect(out).toMatch(/audit-1 .*thinking {3}last Bash echo hi/); // answered: between calls
	expect(out).toMatch(/ctx_search\s+where is the widget/);
	expect(out).not.toContain("mcp__");
	expect(out).toMatch(/◐ audit-3 .*Edit {2}mission-panel\.ts/); // in flight
	const widths = (calls.at(-1) ?? []).map(l => [...stripAnsi(l)].length);
	expect(new Set(widths).size).toBe(1); // ANSI in a lane never skews the frame

	live(f.root, ["audit-1", "audit-2", "audit-3"], ["audit-2"]); // audit-2 posted its exit
	timers.iv?.();
	expect(plain(calls.at(-1))).not.toContain("audit-2");
	expect(plain(calls.at(-1))).toMatch(lane("audit-3"));

	live(f.root, ["audit-1", "audit-2", "audit-3"], ["audit-1", "audit-2", "audit-3"]);
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("last run  3 workers");
	writeFileSync(join(f.root, ".atlas", ".run", "channels.json"), JSON.stringify({ version: 1, channels: {} })); // atlas_team reap drops the channel
	timers.iv?.();
	expect(plain(calls.at(-1))).not.toMatch(lane("audit-\\d")); // finished stays finished: lanes never resurrect
});

test("a team reaped between polls (channel gone after it was seen) ends every lane", () => {
	const f = fixture();
	live(f.root, ["w1", "w2"]);
	const { calls, ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["w1", "w2"], cwd: f.root });
	expect(plain(calls.at(-1))).toMatch(lane("w1"));
	writeFileSync(join(f.root, ".atlas", ".run", "channels.json"), JSON.stringify({ version: 1, channels: {} }));
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("last run  2 workers");
});

test("reap after the view cleared re-mounts the idle panel with the last wave, which lingers then clears", () => {
	const f = fixture();
	const run = join(f.root, ".atlas", ".run");
	const reg = (members: object[]) => writeFileSync(join(run, "channels.json"), JSON.stringify({ version: 1, channels: { [CHAN]: { members } } }));
	const { calls, ui, timers, view } = harness();
	timers.clock = 100_000;
	reg([{ name: "lead-abc", role: "lead" }, { name: "w1", joined: 100 }, { name: "w2", joined: 100 }]);
	view.open(ui, { channel: CHAN, members: ["w1", "w2"], cwd: f.root });
	reg([{ name: "lead-abc", role: "lead" }, { name: "w1", joined: 100, ended_at: 150, exit_code: 0 }, { name: "w2", joined: 100, ended_at: 170, exit_code: 1 }]);
	timers.clock = 171_000;
	for (let i = 0; i < 4; i++) timers.iv?.();
	timers.to?.(); // linger elapsed before the lead got to reap
	expect(calls.at(-1)).toBeUndefined();

	writeFileSync(join(run, "channels.json"), JSON.stringify({ version: 1, channels: {} })); // reap closed the channel
	view.open(ui, { channel: CHAN, members: ["w1", "w2"], cwd: f.root, reaped: true });
	const out = plain(calls.at(-1));
	expect(calls.at(-1)).toHaveLength(2);
		expect(out).toContain("last run  2 workers · 1m10s · 1 failed");
	expect(out).not.toMatch(lane("w\\d"));
	for (let i = 0; i < 3; i++) timers.iv?.();
	expect(timers.to).toBeDefined(); // linger window, panel still up
	expect(calls.at(-1)).toBeDefined();
	timers.to?.();
	expect(calls.at(-1)).toBeUndefined();
});

test("rail phase: active todo phase, else the latest ATLAS header phase of the current turn, else research", () => {
	const root = atlasFixture([{ name: "w1", joined: 1 }], [{ status: "in_progress", content: "omp todo, no contract phase" }]);
	const { calls, ui, deps } = harness({ ATLAS_PROJECT_ROOT: root });
	type Handler = (e: Record<string, unknown>, c: Record<string, unknown>) => unknown;
	const handlers: Record<string, Handler[]> = {};
	const pi = { on: (name: string, h: Handler) => void (handlers[name] ??= []).push(h) } as unknown as Parameters<typeof registerChannelView>[0];
	const view = registerChannelView(pi, deps);
	const main = { cwd: root, agent: { kind: "main" } };
	const say = (text: string, ctx: Record<string, unknown> = main) =>
		handlers.message_end?.forEach(h => h({ message: { role: "assistant", content: [{ type: "text", text }] } }, ctx));
	const railOf = () => plain([calls.at(-1)![0]!]);
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
	expect(railOf()).toMatch(/ATLAS ◗ {2}research · phase/);
	say("ATLAS | ⛭ implement 1/3 | running the team\nbody");
	say("no header on this follow-up message");
	say("ATLAS | x verify | sub", { cwd: root, agent: { kind: "sub" } }); // a sub's header never moves the lead's rail
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
	expect(railOf()).toMatch(/ATLAS ◗ {2}implement · phase/);
	handlers.before_agent_start?.forEach(h => h({}, main)); // next turn: the old header no longer counts
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
	expect(railOf()).toMatch(/ATLAS ◗ {2}research · phase/);
	writeFileSync(join(root, ".atlas", ".run", "todos.json"), JSON.stringify({ version: 1, items: [{ status: "in_progress", phase: "test" }] }));
	say("ATLAS | ⛭ verify | x");
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
	expect(railOf()).toMatch(/ATLAS ◗ {2}test · phase/); // the active todo outranks the header
	view.stop();
});

test("lane tool chip and target come from one event: an omp `write xd://<mcp tool>` is that tool with its query", () => {
	const f = fixture();
	type H = (e: unknown, c: unknown) => unknown;
	const w: Record<string, H> = {};
	registerLaneToolRecorder({ on: (ev: string, h: H) => void (w[ev] = h) } as never, { ATLAS_WORKER_NAME: "explorer-1903" });
	const main = { cwd: f.root, agent: { kind: "main" } };
	const input = { path: "xd://mcp__claude_mem_mcp_search_search", content: JSON.stringify({ query: "atlas team peer-sync" }) };
	w.tool_call?.({ toolName: "write", input }, main);
	expect(laneTool(f.root, "explorer-1903")).toEqual({ tool: "search", target: "atlas team peer-sync", active: true });
	w.tool_result?.({ toolName: "write", input }, main);
	expect(laneTool(f.root, "explorer-1903")).toEqual({ tool: "search", target: "atlas team peer-sync", active: false });
	w.tool_call?.({ toolName: "mcp__claude_mem_mcp_search_search", input: { query: "peer sync" } }, main); // omp mints mcp__<server>_<tool>
	expect(laneTool(f.root, "explorer-1903")).toEqual({ tool: "search", target: "peer sync", active: true });
	w.tool_call?.({ toolName: "write", input: { path: "/x/notes.md", content: "{}" } }, main); // a real file write stays `write`
	expect(laneTool(f.root, "explorer-1903")).toEqual({ tool: "write", target: "notes.md", active: true });
});

test("omp workers and task subs record their own tool: worker env name or sub id, active on call, dim after result", () => {
	const f = fixture();
	type H = (e: unknown, c: unknown) => unknown;
	const worker: Record<string, H> = {};
	registerLaneToolRecorder({ on: (ev: string, h: H) => void (worker[ev] = h) } as never, { ATLAS_WORKER_NAME: "audit-1" });
	const main = { cwd: f.root, agent: { kind: "main", id: "Main", name: "main" } };
	worker.tool_call?.({ toolName: "bash", toolCallId: "c1", input: { command: "sleep 5" } }, main);
	expect(laneTool(f.root, "audit-1")).toEqual({ tool: "bash", target: "sleep 5", active: true });
	worker.tool_result?.({ toolName: "bash", toolCallId: "c1", input: { command: "sleep 5" } }, main);
	expect(laneTool(f.root, "audit-1")).toEqual({ tool: "bash", target: "sleep 5", active: false });
	worker.tool_call?.({ toolName: "read", toolCallId: "c1b", input: { path: "/a" } }, main);
	const calls = laneCalls(f.root, "audit-1"); // sparkline history: one timestamp per call, results add none
	expect(calls).toHaveLength(2);
	expect(Math.abs(calls[1]! - Date.now() / 1000)).toBeLessThan(5);
	expect(laneCalls(f.root, "../evil")).toEqual([]);

	const lead: Record<string, H> = {};
	registerLaneToolRecorder({ on: (ev: string, h: H) => void (lead[ev] = h) } as never, {});
	lead.tool_call?.({ toolName: "read", toolCallId: "c2", input: { path: "/a/b/c.ts" } }, main); // the lead itself: no lane
	expect(laneTool(f.root, "Main")).toBeUndefined();
	lead.tool_call?.({ toolName: "read", toolCallId: "c3", input: { path: "/a/b/c.ts" } }, { cwd: f.root, agent: { kind: "sub", id: "Probe-3", name: "explore" } });
	expect(laneTool(f.root, "Probe")).toEqual({ tool: "read", target: "c.ts", active: true });
	lead.tool_call?.({ toolName: "read", toolCallId: "c4", input: { path: "x" } }, { cwd: f.root, agent: { kind: "sub", id: "../evil", name: "x" } });
	expect(laneTool(f.root, "../evil")).toBeUndefined();
});

test("team lanes take class/effort and roles from the live team record; channels.json's generic 'subagent' never shows", () => {
	const root = atlasFixture([{ name: "lead-abc", role: "lead" }, { name: "explorer-127a", role: "subagent", joined: 1 }], [{ status: "pending", phase: "research" }]);
	mkdirSync(join(root, ".atlas", ".run", "teams"), { recursive: true });
	writeFileSync(join(root, ".atlas", ".run", "teams", "t1.json"), JSON.stringify({ channel: CHAN, class: "audit", effort: "medium", members: [{ name: "explorer-127a", role: "scout" }] }));
	const { calls, ui, view } = harness({ ATLAS_PROJECT_ROOT: root });
	view.open(ui, { channel: CHAN, members: ["explorer-127a"], cwd: root });
	const out = plain(calls.at(-1));
		expect(out).toMatch(/explorer-127a +scout /);
	expect(out).not.toContain("subagent");
	view.stop();
});

test("claude team lane: role + tool from the stream log; panefeed's calls-only <name>.tool.json adds no graph", () => {
	const root = atlasFixture([{ name: "lead-abc", role: "lead" }, { name: "explorer-127a", role: "subagent", joined: 1 }], [{ status: "pending", phase: "research" }]);
	mkdirSync(join(root, ".atlas", ".run", "teams"), { recursive: true });
	writeFileSync(join(root, ".atlas", ".run", "teams", "t1.json"), JSON.stringify({ channel: CHAN, class: "audit", effort: "medium", members: [{ name: "explorer-127a", role: "scout" }] }));
	const logs = join(root, ".atlas", ".run", "logs");
	mkdirSync(logs, { recursive: true });
	const use = { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/a/b/dispatch.py" } }] } };
	writeFileSync(join(logs, "explorer-127a.log"), `${JSON.stringify(use)}\n`);
	const nowS = Date.now() / 1000;
	writeFileSync(join(logs, "explorer-127a.tool.json"), JSON.stringify({ calls: [nowS - 2, nowS - 3, nowS - 40] })); // no `tool`: the log tail supplies it
	const { calls, ui, timers, view } = harness({ ATLAS_PROJECT_ROOT: root });
	timers.clock = nowS * 1000; // the harness clock starts at 0, which would age every call out of the window
	view.open(ui, { channel: CHAN, members: ["explorer-127a"], cwd: root });
	const lane = plain(calls.at(-1)).split("\n").find(l => l.includes("explorer-127a")) ?? "";
	expect(lane).toMatch(/◐ explorer-127a +scout +Read {2}dispatch\.py/);
	expect(lane).not.toMatch(/[▁▂▃▄▅▆▇█]/); // the tool-call history is kept but no graph is drawn
	view.stop();
});

test("D2 age rolls over to hours and days", async () => {
	const { age } = await import("./mission-panel");
	expect([age(5), age(61), age(3599), age(3600), age(86399), age(540092)]).toEqual(["5s", "1m01s", "59m59s", "1h00m", "23h59m", "6d06h"]);
});
test("D3 a 6-day lane fits the width and never grows past the time column", () => {
	const plainOf = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "");
	const workers = [{ name: "a-1", secs: 540092 }, ...[1, 2, 3].map(i => ({ name: `explorer-t${i}`, secs: 500, tool: { tool: "Edit", target: "x.ts", active: false } }))];
	const lines = renderPanel(model({ workers, width: 100, maxLines: 14 }));
	for (const l of lines) expect(visibleWidth(l)).toBeLessThanOrEqual(100);
	expect(lines.map(plainOf).some(l => /a-1 .*150h1m $/.test(l))).toBe(true);
	expect(lines.map(plainOf).filter(l => /starting|thinking/.test(l)).join("\n")).not.toMatch(/[█▏▎▍▌▋▊▉]/); // no bars
});
test("D4 roleOf of a plain name is task", async () => {
	const { roleOf } = await import("./mission-panel");
	expect([roleOf("PonytailReview2"), roleOf("explorer-a324")]).toEqual(["task", "explorer"]);
});
test("D6 omp phase names map to rail phases", async () => {
	const { phaseFromName, railPhase } = await import("./channel-view");
	expect(["Setup", "Audit", "Deliver", "implement", "Tasks"].map(phaseFromName)).toEqual(["research", "implement", "done", "implement", undefined]);
	expect(railPhase("Setup", undefined)).toBe("research");
	expect(railPhase("Audit", undefined)).toBe("implement");
	expect(railPhase("Deliver", undefined)).toBe("done");
});

// ---- hardening: width, tool-name shortening, registry loss, wave clock, gates plumbing, linger cleanup, recorder cap ----

function widthOf(f: { root: string }, deps: Record<string, unknown>) {
	const h = harness();
	const view = createChannelView({ ...h.deps, ...deps } as never);
	view.open(h.ui, { channel: CHAN, members: ["A"], cwd: f.root });
	return Math.max(...(h.calls.at(-1) ?? []).map(l => visibleWidth(l)));
}

test("panel width is the terminal width less the Text padding, never under 40, 120 when the terminal is unknown", () => {
	const f = fixture();
	const stdout = process.stdout as { columns?: number };
	const saved = stdout.columns;
	try {
		expect(widthOf(f, { columns: () => 100 })).toBe(98);
		expect(widthOf(f, { columns: () => 42 })).toBe(40);
		expect(widthOf(f, { columns: () => 30 })).toBe(40);
		stdout.columns = 90;
		expect(widthOf(f, {})).toBe(88); // no override: the real terminal
		expect(widthOf(f, { columns: () => undefined })).toBe(88);
		expect(widthOf(f, { columns: () => 150 })).toBe(148); // the override wins over the terminal
		stdout.columns = undefined;
		expect(widthOf(f, { columns: () => undefined })).toBe(120);
	} finally {
		stdout.columns = saved;
	}
});

test("spinFrame: wraps, mirrors negatives and fractions, and falls back to the plain spinner for non-finite counters", () => {
	expect(spinFrame(0)).toBe("⠋");
	expect(spinFrame(10)).toBe("⠋");
	expect(spinFrame(11)).toBe("⠙");
	expect(spinFrame(-1)).toBe("⠙");
	expect(spinFrame(1.9)).toBe("⠙");
	expect(spinFrame(0, "test")).toBe("⠁");
	expect(spinFrame(7, "implement")).toBe("⣽");
	expect(spinFrame(3, "unknown-phase")).toBe("⠸");
	expect(spinFrame(Number.NaN)).toBe("⠋");
	expect(spinFrame(Number.NaN, "verify")).toBe("⠋");
	expect(spinFrame(Number.POSITIVE_INFINITY, "verify")).toBe("⠋");
});

test("lane tool names: Claude mcp prefix dropped, omp's ambiguous split takes the last word, plain tools untouched", () => {
	const f = fixture();
	const logs = join(f.root, ".atlas", ".run", "logs");
	mkdirSync(logs, { recursive: true });
	const toolOf = (name: string) => {
		writeFileSync(join(logs, "w.log"), toolUse("t", name, {}));
		return laneTool(f.root, "w")?.tool;
	};
	expect(toolOf("mcp__server__do_thing")).toBe("do_thing");
	expect(toolOf("mcp__plugin_context-mode_context-mode__ctx_search")).toBe("ctx_search");
	expect(toolOf("mcp__claude_mem_mcp_search_search")).toBe("search"); // omp: one underscore joins server and tool
	expect(toolOf("mcp____a_b")).toBe("a_b"); // empty server name: the "__" right after the prefix still splits
	expect(toolOf("mcp__")).toBe("mcp__"); // nothing after the prefix: keep the name
	expect(toolOf("Read")).toBe("Read");
	expect(toolOf("my_mcp__x")).toBe("my_mcp__x");
});

test("a registry that becomes unreadable after the channel was seen does not end the lanes", () => {
	const f = fixture();
	live(f.root, ["w1", "w2"]);
	const { calls, ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["w1", "w2"], cwd: f.root });
	expect(plain(calls.at(-1))).toMatch(lane("w1"));
	writeFileSync(join(f.root, ".atlas", ".run", "channels.json"), "{ torn write");
	timers.iv?.();
	expect(plain(calls.at(-1))).toMatch(lane("w1")); // unreadable is not proof of a reap
	expect(plain(calls.at(-1))).toMatch(lane("w2"));
	expect(plain(calls.at(-1))).not.toContain("last run");
	rmSync(join(f.root, ".atlas", ".run", "channels.json"));
	timers.iv?.();
	expect(plain(calls.at(-1))).toMatch(lane("w1"));
});

test("the last-wave summary counts from epoch-second registry clocks and shows nothing failed when no row ever existed", () => {
	const f = fixture();
	const run = join(f.root, ".atlas", ".run");
	const J = 1_700_000_000;
	const reg = (members: object[]) => writeFileSync(join(run, "channels.json"), JSON.stringify({ version: 1, channels: { [CHAN]: { members } } }));
	const { calls, ui, timers, view } = harness();
	timers.clock = (J + 90) * 1000;
	reg([{ name: "w1", joined: J }, { name: "w2", joined: J + 10 }]); // both still running at the first paint
	view.open(ui, { channel: CHAN, members: ["w1", "w2"], cwd: f.root });
	writeFileSync(join(run, "channels.json"), JSON.stringify({ version: 1, channels: {} })); // reaped before anyone's ended_at was read
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("last run  2 workers · 1m30s");
	expect(plain(calls.at(-1))).not.toContain("failed");

	const bare = fixture(); // reaped mount with no registry rows at all: just the roster size
	const h = harness();
	h.view.open(h.ui, { channel: CHAN, members: ["a", "b", "c"], cwd: bare.root, reaped: true });
	expect(plain(h.calls.at(-1))).toContain("last run  3 workers");
	expect(plain(h.calls.at(-1))).not.toContain("failed");
});

test("gates: the session id (or '-') reaches the cache; reported groups become the checks footer, none reported shows no footer", () => {
	const f = fixture();
	writeFileSync(join(f.root, ".atlas", ".run", "findings.json"), JSON.stringify([{ id: "F1", status: "verified", title: "t" }]));
	const refreshes: Array<[string, string]> = [];
	const group = (ok: boolean) => ({ id: "completion", title: "Completion", lines: [{ id: "l", label: "x", ok }] });
	let read: unknown = null;
	const gates = { read: () => read, refresh: (s: string, r: string) => void refreshes.push([s, r]) };
	const open = (sessionId?: string) => {
		const h = harness();
		const view = createChannelView({ ...h.deps, gates } as never);
		view.open(h.ui, { channel: CHAN, members: ["A"], cwd: f.root, sessionId });
		return plain(h.calls.at(-1));
	};
	expect(open("sess-9")).not.toContain("checks"); // nothing read yet: no footer, the panel still renders
	expect(open("sess-9")).toContain("ATLAS");
	expect(refreshes.at(-1)).toEqual(["sess-9", f.root]);
	open();
	expect(refreshes.at(-1)).toEqual(["-", f.root]);
	read = [group(false), group(true)];
	expect(open("sess-9")).toMatch(/checks {2}■ completion/);
	read = [group(true)];
	expect(open("sess-9")).toMatch(/checks {2}● completion/);
});

test("stopping while a linger is pending cancels it; stopping an idle view cancels nothing", () => {
	const f = fixture();
	const cleared: unknown[] = [];
	let n = 0;
	const mk = () => {
		const h = harness();
		const deps = { ...h.deps, setTimeout: (fn: () => void) => ((h.timers.to = fn), `T${++n}`), clearTimeout: (t: unknown) => void cleared.push(t) };
		return { ...h, view: createChannelView(deps as never) };
	};
	const idle = mk();
	idle.view.open(idle.ui, { channel: CHAN, members: ["A"], cwd: f.root });
	idle.view.stop();
	expect(cleared).toEqual([]);
	expect(idle.calls.at(-1)).toBeUndefined();
	const h = mk();
	h.view.open(h.ui, { channel: CHAN, members: ["A"], cwd: f.root });
	f.finish(["A"]);
	for (let i = 0; i < 4; i++) h.timers.iv?.();
	expect(h.timers.to).toBeDefined();
	h.view.stop();
	expect(cleared).toEqual([`T${n}`]);
	expect(h.calls.at(-1)).toBeUndefined();
	expect(h.timers.iv).toBeUndefined();
});

test("only the lead's assistant text pins the rail: user messages and non-text content never do", () => {
	const root = atlasFixture([{ name: "w1", joined: 1 }], [{ status: "in_progress", content: "no contract phase" }]);
	const { calls, ui, deps } = harness({ ATLAS_PROJECT_ROOT: root });
	type Handler = (e: Record<string, unknown>, c: Record<string, unknown>) => unknown;
	const handlers: Record<string, Handler[]> = {};
	const pi = { on: (name: string, h: Handler) => void (handlers[name] ??= []).push(h) } as unknown as Parameters<typeof registerChannelView>[0];
	const view = registerChannelView(pi, deps);
	const main = { cwd: root, agent: { kind: "main" } };
	const send = (message: unknown) => handlers.message_end?.forEach(h => h({ message }, main));
	const header = [{ type: "text", text: "ATLAS | ⛭ verify | looks like a header" }];
	const railOf = () => {
		view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
		return plain([calls.at(-1)![0]!]);
	};
	send({ role: "user", content: header });
	send({ role: "assistant", content: "ATLAS | ⛭ verify | plain string content" });
	send({ role: "assistant", content: [{ type: "tool_use", text: "ATLAS | ⛭ verify | x" }] });
	send(null);
	expect(railOf()).toMatch(/ATLAS ◗ {2}research · phase/);
	send({ role: "assistant", content: header });
	expect(railOf()).toMatch(/ATLAS ◗ {2}verify · phase/);
	send({ role: "assistant", content: [{ type: "text", text: "ATLAS | ⛭ bogus-phase | x" }] }); // not a rail phase: ignored
	expect(railOf()).toMatch(/ATLAS ◗ {2}verify · phase/);
	view.stop();
});

test("the tool recorder keeps only the last 64 call times", () => {
	const f = fixture();
	type H = (e: unknown, c: unknown) => unknown;
	const worker: Record<string, H> = {};
	registerLaneToolRecorder({ on: (ev: string, h: H) => void (worker[ev] = h) } as never, { ATLAS_WORKER_NAME: "busy-1" });
	const main = { cwd: f.root, agent: { kind: "main" } };
	for (let i = 0; i < 70; i++) worker.tool_call?.({ toolName: "bash", input: { command: `echo ${i}` } }, main);
	expect(laneCalls(f.root, "busy-1")).toHaveLength(64);
	expect(laneTool(f.root, "busy-1")?.target).toBe("echo 69");
});

test("sessionTodos: this session's live rows only; archived and advisor rows and an unreadable board give none", () => {
	const root = atlasFixture(
		[],
		[
			{ content: "mine", status: "pending", session_id: "s1" },
			{ content: "other session", status: "pending", session_id: "s2" },
			{ content: "archived", status: "completed", session_id: "s1", archived: true },
			{ content: "advisor note", status: "pending", session_id: "s1", origin: "advisor" },
			{ content: "manual", status: "in_progress", session_id: "s1", origin: "manual" },
		],
	);
	expect(sessionTodos(root, "s1").map(i => i.content)).toEqual(["mine", "manual"]);
	expect(sessionTodos(root, "s2").map(i => i.content)).toEqual(["other session"]);
	expect(sessionTodos(root).map(i => i.content)).toEqual(["mine", "other session", "manual"]); // no session: every session, still no archived/advisor
	expect(sessionTodos(root, "nobody")).toEqual([]);
	const run = join(root, ".atlas", ".run");
	writeFileSync(join(run, "todos.json"), "{ torn");
	expect(sessionTodos(root, "s1")).toEqual([]);
	rmSync(join(run, "todos.json"));
	expect(sessionTodos(root, "s1")).toEqual([]);
	writeFileSync(join(run, "todos.json"), JSON.stringify({ version: 1 })); // no items key
	expect(sessionTodos(root, "s1")).toEqual([]);
});

test("boardRoot: ATLAS_PROJECT_ROOT wins, else the nearest ancestor with .atlas, a linked worktree maps to its main repo, else cwd", () => {
	const tree = realpathSync(mkdtempSync(join(tmpdir(), "board-root-")));
	const proj = join(tree, "proj");
	const deep = join(proj, "a", "b", "c");
	mkdirSync(join(proj, ".atlas"), { recursive: true });
	mkdirSync(deep, { recursive: true });
	expect(boardRoot(deep, {})).toBe(proj);
	expect(boardRoot(proj, {})).toBe(proj);
	expect(boardRoot(deep, { ATLAS_PROJECT_ROOT: "/elsewhere" })).toBe("/elsewhere");
	expect(boardRoot(deep, { ATLAS_PROJECT_ROOT: "" })).toBe(proj); // empty means unset
	mkdirSync(join(proj, "a", ".atlas")); // a nearer .atlas shadows the outer one
	expect(boardRoot(deep, {})).toBe(join(proj, "a"));
	const bare = join(tree, "bare", "x");
	mkdirSync(bare, { recursive: true });
	expect(boardRoot(bare, {})).toBe(bare); // no .atlas anywhere up the tree: the cwd itself
	// linked worktree: `.git` file -> gitdir -> commondir -> the main repo, even with a stray .atlas of its own
	const main = join(tree, "main");
	mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
	writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
	const wt = join(tree, "wt");
	mkdirSync(join(wt, ".atlas"), { recursive: true });
	mkdirSync(join(wt, "sub"));
	writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
	expect(boardRoot(wt, {})).toBe(main);
	expect(boardRoot(join(wt, "sub"), {})).toBe(main);
	writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "\n"); // empty commondir: not a usable link, fall back to .atlas
	expect(boardRoot(wt, {})).toBe(wt);
	writeFileSync(join(wt, ".git"), "not a gitdir pointer\n");
	expect(boardRoot(wt, {})).toBe(wt);
});

test("todo summary: dispatch rows leave the plan count, but count when they are all the board has", () => {
	const withPlan = atlasFixture(
		[{ name: "lead-abc", role: "lead", joined: 1 }],
		[{ status: "completed" }, { status: "pending" }, { status: "in_progress", origin: "dispatch" }, { status: "completed", origin: "dispatch" }],
	);
	expect(todoSummary(withPlan)).toEqual({ done: 1, total: 2, phase: undefined });
	const onlyDispatch = atlasFixture(
		[{ name: "lead-abc", role: "lead", joined: 1 }],
		[{ status: "in_progress", origin: "dispatch" }, { status: "pending", origin: "dispatch" }],
	);
	expect(todoSummary(onlyDispatch)).toEqual({ done: 0, total: 2, phase: undefined });
});

test("D1/D2 todo summary: a placeholder stub and other sessions' open rows leave the count (parity with the mod)", () => {
	const root = atlasFixture(
		[{ name: "lead-abc", role: "lead", joined: 1 }],
		[
			{ status: "completed", session_id: "s1", content: "a" },
			{ status: "completed", session_id: "s1", content: "b" },
			{ status: "in_progress", session_id: "s1", content: "c", phase: "implement" },
			{ status: "pending", session_id: "s1", content: "placeholder" },
			{ status: "pending", session_id: "s1", content: "carried over", origin: "carried" },
		],
	);
	expect(todoSummary(root, "s1")).toEqual({ done: 2, total: 3, phase: "implement" });
});

test("D3 todo summary: every plan row done reads the done phase, not research", () => {
	const root = atlasFixture(
		[{ name: "lead-abc", role: "lead", joined: 1 }],
		[{ status: "completed", content: "a", phase: "implement" }, { status: "completed", content: "b", phase: "verify" }],
	);
	const sum = todoSummary(root);
	expect(sum).toEqual({ done: 2, total: 2, phase: "done" });
	expect(railPhase(sum.phase, "research")).toBe("done");
});

test("R2: omp todoSummary and mod planCounts/planPhase read the same rows to the same answer (rows without session_id are the session's own)", () => {
	const rows: Array<Record<string, unknown>> = [
		{ content: "legacy no session id", status: "completed", phase: "implement" },
		{ content: "mine", status: "in_progress", session_id: "s1", phase: "verify" },
		{ content: "other session", status: "pending", session_id: "s2" },
		{ content: "carried open", status: "pending", session_id: "s1", origin: "carried" },
		{ content: "carried done", status: "completed", session_id: "s1", origin: "carried" },
		{ content: "dispatch", status: "pending", session_id: "s1", origin: "dispatch" },
		{ content: "placeholder", status: "pending", session_id: "s1" },
		{ content: "archived", status: "completed", session_id: "s1", archived: true },
		{ content: "advisor", status: "pending", session_id: "s1", origin: "advisor" },
	];
	const root = atlasFixture([], rows);
	const live = rows.filter(r => !r.archived && r.origin !== "advisor") as Array<{ status: string; phase?: string }>;
	const expected = { ...planCounts(live, "s1"), phase: planPhase(live, "s1") };
	expect(expected).toEqual({ done: 2, total: 3, phase: "verify" });
	expect(todoSummary(root, "s1")).toEqual(expected);
});
