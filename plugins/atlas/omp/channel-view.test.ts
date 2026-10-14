import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WIDGET_KEY, createChannelView, laneTool, liveWorkers, registerLaneToolRecorder, spinFrame, todoSummary, finishedMembers, formatNote, readChannelNotes, registerChannelView } from "./channel-view";
import { createGatesCache, renderPanel, type PanelModel } from "./mission-panel";
import { isTerminalYield, registerStopBridge } from "./stop-bridge";
import { registerWorkerReport } from "./worker-report";
import { readFileSync } from "node:fs";
import { spin } from "../mod/theme";
import { expect, test } from "bun:test";

const CHAN = "repo@main/lead-abc";
const plain = (ls?: string[]) => (ls ?? []).join("\n").replace(/\x1b\[[0-9;]*m/g, "");

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
	expect(plain(calls[0])).toContain("lead-abc > A: scope: do the thing");
	expect(plain(calls[0])).toContain("▌ A");
	expect(timers.iv).toBeDefined();

	// no member has posted yet; many polls later (minutes) the view is still up and still polling
	for (let i = 0; i < 20; i++) timers.iv?.();
	expect(timers.iv).toBeDefined();
	expect(timers.to).toBeUndefined();

	f.note("A", "B", "touching shared.ts"); // child <-> child, written after the tool ended
	f.note("B", "lead-abc", "start: reading it"); // child -> lead
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("A > B: touching shared.ts");
	expect(plain(calls.at(-1))).toContain("B > lead-abc: start: reading it");

	f.finish(["A"]);
	for (let i = 0; i < 5; i++) timers.iv?.();
	expect(plain(calls.at(-1))).toContain("▌ B");
	expect(plain(calls.at(-1))).not.toContain("▌ A");
	expect(timers.iv).toBeDefined(); // B still working

	f.finish(["A", "B"]);
	timers.iv?.(); // quiet poll 1
	expect(plain(calls.at(-1))).toContain("idle · last run: 2 workers");
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
	expect(plain(calls.at(-1))).toContain("▌ B");
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
	expect(calls[0]?.[0]).toContain("╭");
	expect(plain(calls[0])).toContain("▌ A");
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
	expect(plain(calls.at(-1))).toContain("▌ A");
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
	expect(plain(calls[0])).toContain("▌ w1");
	view.stop();
});

test("widget never exceeds omp's 10-line cap with 6 workers and 8 notes; footer stays above the bottom border", () => {
	const names = Array.from({ length: 6 }, (_, i) => `w${i}`);
	const root = atlasFixture(names.map(name => ({ name, joined: 1 })), [{ status: "pending", phase: "verify" }]);
	for (let i = 0; i < 8; i++) appendFileSync(join(root, ".atlas", ".run", "board", "a.jsonl"), `${JSON.stringify({ ts: i, seq: i + 1, owner: "a", to: "all", text: `n${i}`, channel: CHAN })}\n`);
	const { calls, ui, view } = harness({ ATLAS_PROJECT_ROOT: root });
	view.open(ui, { channel: CHAN, members: names, cwd: root });
	expect(calls[0]!.length).toBeLessThanOrEqual(10);
	expect(plain([calls[0]![1]])).toContain("ATLAS");
	expect(plain([calls[0]!.at(-2)!])).toContain("todos");
	view.stop();
});

test("widget paints header first and advances spinner per poll", () => {
	const root = atlasFixture([{ name: "w1", joined: 1 }], [{ status: "pending", phase: "verify" }]);
	const { calls, ui, timers, view } = harness({ ATLAS_PROJECT_ROOT: root });
	view.open(ui, { channel: CHAN, members: ["w1"], cwd: root });
	timers.iv?.();
	expect(plain([calls[0]![1]])).toContain("ATLAS");
	expect(calls.length).toBe(2);
	expect(calls[0]?.[2]).not.toBe(calls[1]?.[2]);
	view.stop();
});

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 120, maxLines: 10, phase: "research", spin: "◜", laneSpin: "⠋", done: 0, total: 2,
	workers: [{ name: "mc-one", secs: 11 }, { name: "mc-two", secs: 11 }],
	notes: ["lead > mc-two: sleep loop", "mc-two > all: joined"],
	gates: [{ id: "completion", title: "c", lines: [] }, { id: "tripwire", title: "t", lines: [] }, { id: "routing", title: "r", lines: [] }],
	...over,
});

test("panel at width 120 with 2 workers: borders, rail, 2 lanes with bars, ticker, gates footer", () => {
	const lines = renderPanel(model()).map(l => plain([l]));
	expect(lines[0]).toStartWith("╭");
	expect(lines.at(-1)).toStartWith("╰");
	expect(lines[1]).toContain("ATLAS");
	expect(lines[1]).toContain("◜ research ─ ○ theory ─ ○ test ─ ○ implement ─ ○ verify ─ ○ done");
	expect(lines[1]).toContain("0/2 tasks · gates ✓");
	expect(lines.filter(l => l.includes("▕") && l.includes("▏")).length).toBe(2);
	expect(lines.join("\n")).toContain("#lead  lead > mc-two: sleep loop · mc-two > all: joined");
	expect(lines.at(-2)).toContain("✓ completion ✓ tripwire ✓ routing");
	expect(lines.length).toBe(7);
});

test("panel never exceeds the line budget or the given width, whatever the load", () => {
	for (const width of [40, 80, 120, 160]) for (const n of [0, 1, 4, 6, 9]) for (const maxLines of [5, 7, 10]) {
		const m = model({ width, maxLines, workers: Array.from({ length: n }, (_, i) => ({ name: `worker-number-${i}`, secs: 500 })), notes: ["x".repeat(300), "y".repeat(300)] });
		const lines = renderPanel(m);
		expect(lines.length).toBeLessThanOrEqual(maxLines);
		for (const l of lines) expect([...plain([l])].length).toBeLessThanOrEqual(width);
	}
});

test("panel with 6 workers: 4 lanes + '+2 more' + ticker fit in 10 lines; short budgets drop the ticker first", () => {
	const six = Array.from({ length: 6 }, (_, i) => ({ name: `w${i}`, secs: 5 }));
	const full = plain(renderPanel(model({ workers: six })));
	expect(full).toContain("+2 more");
	expect(full).toContain("#lead");
	const tight = plain(renderPanel(model({ workers: six, maxLines: 8 })));
	expect(tight).not.toContain("#lead");
	expect(tight).toContain("▌ w3");
});

test("panel: idle is a 3-line frame; an open gate shows an X in header and footer", () => {
	const idle = renderPanel(model({ workers: [], idle: { workers: 2, minutes: 3 } }));
	expect(idle.length).toBe(3);
	expect(plain(idle)).toContain("ATLAS  ○ idle · last run: 2 workers, 3 min");
	const bad = plain(renderPanel(model({ gates: [{ id: "completion", title: "c", lines: [{ id: "a", label: "a", ok: false }] }] })));
	expect(bad).toContain("gates ✗1");
	expect(bad).toContain("✗ completion");
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
	expect(out).toContain("Bash echo hi");
	expect(out).toContain("ctx_search where is the widget mounted from the t");
	expect(out).not.toContain("mcp__");
	expect(out).toContain("Edit mission-panel.ts");
	const raw = (calls.at(-1) ?? []).join("\n");
	expect(raw).toContain("\x1b[2mBash echo hi"); // answered: dim
	expect(raw).not.toContain("\x1b[2mEdit mission-panel.ts"); // in flight: normal
	const widths = (calls.at(-1) ?? []).map(l => [...stripAnsi(l)].length);
	expect(new Set(widths).size).toBe(1); // ANSI in a lane never skews the frame

	live(f.root, ["audit-1", "audit-2", "audit-3"], ["audit-2"]); // audit-2 posted its exit
	timers.iv?.();
	expect(plain(calls.at(-1))).not.toContain("audit-2");
	expect(plain(calls.at(-1))).toContain("▌ audit-3");

	live(f.root, ["audit-1", "audit-2", "audit-3"], ["audit-1", "audit-2", "audit-3"]);
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("idle · last run: 3 workers");
	writeFileSync(join(f.root, ".atlas", ".run", "channels.json"), JSON.stringify({ version: 1, channels: {} })); // atlas_team reap drops the channel
	timers.iv?.();
	expect(plain(calls.at(-1))).not.toContain("▌ audit"); // finished stays finished: lanes never resurrect
});

test("a team reaped between polls (channel gone after it was seen) ends every lane", () => {
	const f = fixture();
	live(f.root, ["w1", "w2"]);
	const { calls, ui, timers, view } = harness();
	view.open(ui, { channel: CHAN, members: ["w1", "w2"], cwd: f.root });
	expect(plain(calls.at(-1))).toContain("▌ w1");
	writeFileSync(join(f.root, ".atlas", ".run", "channels.json"), JSON.stringify({ version: 1, channels: {} }));
	timers.iv?.();
	expect(plain(calls.at(-1))).toContain("idle · last run: 2 workers");
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

	const lead: Record<string, H> = {};
	registerLaneToolRecorder({ on: (ev: string, h: H) => void (lead[ev] = h) } as never, {});
	lead.tool_call?.({ toolName: "read", toolCallId: "c2", input: { path: "/a/b/c.ts" } }, main); // the lead itself: no lane
	expect(laneTool(f.root, "Main")).toBeUndefined();
	lead.tool_call?.({ toolName: "read", toolCallId: "c3", input: { path: "/a/b/c.ts" } }, { cwd: f.root, agent: { kind: "sub", id: "Probe-3", name: "explore" } });
	expect(laneTool(f.root, "Probe")).toEqual({ tool: "read", target: "c.ts", active: true });
	lead.tool_call?.({ toolName: "read", toolCallId: "c4", input: { path: "x" } }, { cwd: f.root, agent: { kind: "sub", id: "../evil", name: "x" } });
	expect(laneTool(f.root, "../evil")).toBeUndefined();
});
