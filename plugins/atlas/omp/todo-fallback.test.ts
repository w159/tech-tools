import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { TODO_WIDGET_KEY, registerTodoFallback, todoTreeLines } from "./todo-fallback";

function board(items: Array<{ content: string; status: string; session_id?: string }>) {
	const root = mkdtempSync(join(tmpdir(), "todo-fb-"));
	mkdirSync(join(root, ".atlas", ".run"), { recursive: true });
	const write = (rows: typeof items) =>
		writeFileSync(join(root, ".atlas", ".run", "todos.json"), JSON.stringify({ version: 1, items: rows.map(r => ({ session_id: "s1", origin: "session", archived: false, ...r })) }));
	write(items);
	return { root, write };
}

function harness(root: string, kind = "main") {
	const handlers: Record<string, Array<(e: unknown, c: unknown) => unknown>> = {};
	const pi = { on: (n: string, h: (e: unknown, c: unknown) => unknown) => void (handlers[n] ??= []).push(h) };
	const widgets: Array<string[] | undefined> = [];
	const ui = { setWidget: (key: string, c: string[] | undefined) => void (key === TODO_WIDGET_KEY && widgets.push(c)) };
	let tick: (() => void) | undefined;
	const view = registerTodoFallback(pi as never, {
		env: { ATLAS_PROJECT_ROOT: root },
		setInterval: fn => ((tick = fn), 1),
		clearInterval: () => {},
	});
	const ctx = { agent: { kind }, cwd: root, ui, hasUI: true, sessionManager: { getSessionId: () => "s1" } };
	const fire = (name: string, e: unknown = {}) => handlers[name]?.forEach(h => h(e, ctx));
	return { fire, widgets, view, tick: () => tick?.() };
}

const strip = (ls: string[]) => ls.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
const title = (c: string[] | undefined) => strip(c?.slice(0, 1) ?? []);

test("tree: the rev 4 TODO surface, one row per plan item with its state word, the prefix dropped", () => {
	const lines = todoTreeLines([
		{ content: "Research: trace calc module", status: "completed" },
		{ content: "Research: map call paths", status: "in_progress" },
		{ content: "Implement: add mul", status: "pending" },
		{ content: "Verify: run tests", status: "abandoned" },
		{ content: "Docs: changelog", status: "blocked" },
	]);
	const rows = lines.slice(2);
	expect(rows).toHaveLength(5);
	const want: Array<[string, string]> = [["●", "trace calc module done"], ["◐", "map call paths running"], ["◇", "add mul queued"], ["■", "run tests failed"], ["▲", "changelog blocked"]];
	rows.forEach((r, i) => expect(r.replace(/ +/g, " ").replace(/^[ ▸] ?/, "")).toBe(`${want[i]![0]} ${want[i]![1]}`));
	expect(rows[1]!.startsWith("▸")).toBe(true);
	expect(lines[1]).toMatch(/^progress .{16} 1 of 5 · 20%$/);
	expect(lines[0]).toContain("▸ TODO");
	expect(lines[0]).toContain("1 of 5 done");
});

test("a completed row stays in the tree and the board's evidence is its detail", () => {
	const lines = strip(todoTreeLines([{ content: "[build] wire it", status: "completed", evidence: "tests green" }, { content: "plain item", status: "pending" }]).map(l => l));
	expect(lines).toMatch(/● wire it +done +tests green/);
	expect(lines).toMatch(/◇ plain item +queued/);
});

test("fallback widget appears for board items when no native todo has run", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }, { content: "Implement: b", status: "pending" }]);
	const h = harness(b.root);
	h.fire("before_agent_start");
	const last = h.widgets.at(-1);
	expect(title(last)).toContain("▸ TODO");
	expect(strip(last ?? [])).toMatch(/▸ [◐◓◑◒] a +running/);
});

test("a successful native todo result removes the fallback and keeps it removed", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const h = harness(b.root);
	h.fire("before_agent_start");
	expect(h.widgets.at(-1)).toBeDefined();
	h.fire("tool_result", { toolName: "todo", isError: false });
	expect(h.widgets.at(-1)).toBeUndefined();
	b.write([{ content: "Research: a", status: "completed" }, { content: "Verify: b", status: "pending" }]);
	h.tick();
	h.fire("tool_result", { toolName: "bash", isError: false });
	expect(h.widgets.at(-1)).toBeUndefined();
});

test("a failed native todo result does not suppress the fallback; subagent sessions and empty boards draw nothing", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const h = harness(b.root);
	h.fire("tool_result", { toolName: "todo", isError: true });
	expect(title(h.widgets.at(-1))).toContain("▸ TODO");
	const sub = harness(b.root, "sub");
	sub.fire("before_agent_start");
	expect(sub.widgets).toEqual([]);
	const empty = board([]);
	const e = harness(empty.root);
	e.fire("before_agent_start");
	expect(e.widgets.filter(Boolean)).toEqual([]);
});

test("items of another session are ignored", () => {
	const b = board([{ content: "Research: a", status: "pending", session_id: "other" }]);
	const h = harness(b.root);
	h.fire("before_agent_start");
	expect(h.widgets.filter(Boolean)).toEqual([]);
});

/** Harness variant that records every interval the module starts and clears. */
function timers(root: string, pollMs?: number) {
	const handlers: Record<string, Array<(e: unknown, c: unknown) => unknown>> = {};
	const pi = { on: (n: string, h: (e: unknown, c: unknown) => unknown) => void (handlers[n] ??= []).push(h) };
	const started: Array<{ fn: () => void; ms: number }> = [];
	const cleared: unknown[] = [];
	const widgets: Array<string[] | undefined> = [];
	const view = registerTodoFallback(pi as never, {
		env: { ATLAS_PROJECT_ROOT: root },
		pollMs,
		setInterval: (fn, ms) => (started.push({ fn, ms }), `h${started.length}`),
		clearInterval: h => void cleared.push(h),
	});
	const ctx = { agent: { kind: "main" }, cwd: root, hasUI: true, ui: { setWidget: (_k: string, c: string[] | undefined) => void widgets.push(c) }, sessionManager: { getSessionId: () => "s1" } };
	const fire = (name: string, e: unknown = {}) => (handlers[name] ?? []).map(h => h(e, ctx));
	return { started, cleared, widgets, view, fire };
}

test("polling: one interval at the default 2000ms (or the injected pollMs), however many refreshes", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const t = timers(b.root);
	t.fire("before_agent_start");
	t.fire("before_agent_start");
	t.fire("tool_result", { toolName: "bash" });
	expect(t.started.map(s => s.ms)).toEqual([2000]);
	const custom = timers(b.root, 750);
	custom.fire("before_agent_start");
	expect(custom.started.map(s => s.ms)).toEqual([750]);
});

test("polling: stop() and session_shutdown clear exactly the live handle, once; nothing to clear before a poll exists", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const t = timers(b.root);
	t.view.stop();
	expect(t.cleared).toEqual([]); // no poll yet -> clearInterval must not be called
	t.fire("before_agent_start");
	t.view.stop();
	expect(t.cleared).toEqual(["h1"]);
	t.view.stop();
	expect(t.cleared).toEqual(["h1"]); // handle forgotten after the first stop
	t.fire("before_agent_start"); // a stopped poll restarts on the next refresh
	expect(t.started.length).toBe(2);
	t.fire("session_shutdown");
	expect(t.cleared).toEqual(["h1", "h2"]);
	expect(t.widgets.at(-1)).toBeUndefined();
});

test("a native todo stops the poll, and later refreshes never restart it", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const t = timers(b.root);
	t.fire("before_agent_start");
	t.fire("tool_result", { toolName: "TODO", isError: false }); // tool name is case-insensitive
	expect(t.cleared).toEqual(["h1"]);
	t.fire("before_agent_start");
	t.fire("tool_result", { toolName: "bash" });
	expect(t.started.length).toBe(1);
});

test("an error todo result or a missing tool name keeps the fallback alive and polling", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const t = timers(b.root);
	t.fire("tool_result", { toolName: "todo", isError: true });
	t.fire("tool_result", {});
	expect(t.started.length).toBe(1);
	expect(title(t.widgets.at(-1))).toContain("▸ TODO");
});

test("event handlers return undefined (they never veto or rewrite a tool result)", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const t = timers(b.root);
	expect(t.fire("before_agent_start")).toEqual([undefined]);
	expect(t.fire("tool_result", { toolName: "bash" })).toEqual([undefined]);
	expect(t.fire("tool_result", { toolName: "todo", isError: false })).toEqual([undefined]);
	expect(t.fire("session_shutdown")).toEqual([undefined]);
});

test("an unchanged board is not repainted; a changed one is", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }]);
	const h = harness(b.root);
	h.fire("before_agent_start");
	h.tick();
	h.tick();
	expect(h.widgets.length).toBe(1);
	b.write([{ content: "Research: a", status: "completed" }]);
	h.tick();
	expect(h.widgets.length).toBe(2);
	expect(strip(h.widgets.at(-1) ?? [])).toContain("1 of 1 done");
});

test("long item text is clipped with `...` inside the row width, and short text is kept whole", () => {
	const long = "x".repeat(300);
	const lines = todoTreeLines([{ content: `Research: ${long}`, status: "in_progress" }, { content: "Research: short one", status: "pending" }]).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
	const rows = lines.slice(2);
	expect(rows[0]).toMatch(/^▸ ◐ x+\.\.\./);
	expect(rows[0]!.length).toBeLessThan(200);
	expect(rows[0]).not.toContain("x".repeat(250));
	expect(rows[1]).toMatch(/◇ short one +queued/);
});
