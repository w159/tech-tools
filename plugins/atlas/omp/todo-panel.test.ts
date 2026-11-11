import { fx } from "../contracts/todo-tree-fixture";
import { expect, test } from "bun:test";
import { renderPanel, visibleWidth, type PanelModel } from "./mission-panel";
import { TONE_HEX } from "../mod/mission-layout";
import { todoRows } from "../mod/todo-panel";
import type { TodoItem } from "../mod/contract";
import { hx, seg } from "./panel-paint";
import { type PanelTodo, todoLines } from "./todo-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const todos: PanelTodo[] = [
	{ content: "map the auth flow", status: "completed", owner: "explorer-1", evidence: "1. rg auth -> 3 hits" },
	{ content: "edit auth middleware", status: "in_progress", owner: "impl-auth" },
	{ content: "add ttl config", status: "pending" },
	{ content: "wait on token decision", status: "blocked", owner: "impl-ttl", evidence: "need a ttl" },
];
const opts = { width: 100, tick: 0, spin: "⣾", expanded: false, maxLines: 8 };
const rgb = (tone: keyof typeof TONE_HEX) => hx(TONE_HEX[tone]);

test("collapsed: one row, `N of M tasks`, a thin bar, the in-progress owner and text", () => {
	const lines = todoLines(todos, opts);
	expect(lines).toHaveLength(1);
	expect(strip(lines[0]!).trimEnd()).toBe(" 1 of 4 tasks ━━━━━━────────────────── ◉ impl-auth: edit auth middleware");
});

test("collapsed bar fills with progress, in one tone, and nothing moves with the tick", () => {
	const filled = (list: PanelTodo[]) => strip(todoLines(list, opts)[0]!).split("━").length - 1;
	expect(filled(todos.map(t => ({ ...t, status: "completed" })))).toBe(24);
	expect(filled(todos)).toBe(6);
	expect(filled(todos.map(t => ({ ...t, status: "pending" })))).toBe(0);
	expect(todoLines(todos, { ...opts, tick: 0 })[0]).toBe(todoLines(todos, { ...opts, tick: 7 })[0]);
	expect(todoLines(todos, opts)[0]).toContain(seg("━━━━━━", rgb("accent")));
	expect(todoLines(todos.map(t => ({ ...t, status: "completed" })), opts)[0]).toContain(seg("━".repeat(24), rgb("ok")));
	expect(todoLines(todos, opts)[0]).toContain(seg("─".repeat(18), rgb("dim")));
});

test("collapsed count is bold plain text and singular for one task", () => {
	expect(todoLines(todos, opts)[0]).toContain(seg("1 of 4 tasks", rgb("text"), undefined, true));
	expect(strip(todoLines([{ content: "x", status: "pending" }], opts)[0]!)).toContain(" 0 of 1 task ");
});

test("dispatch rows stay out of the count but can be the shown in-progress item", () => {
	const row = strip(todoLines([{ content: "plan", status: "completed" }, { content: "sub", status: "in_progress", origin: "dispatch" }], opts)[0]!);
	expect(row).toContain(" 1 of 1 task ");
	expect(row).toContain("◉ sub");
});

test("expanded: a row per item with the route view marks, owner, blocked word, evidence", () => {
	const p = todoLines(todos, { ...opts, expanded: true }).map(l => strip(l).trimEnd());
	expect(p).toEqual([
		" ✓ map the auth flow · explorer-1  rg auth -> 3 hits",
		" ◉ edit auth middleware · impl-auth",
		" ○ add ttl config",
		" ⏸ wait on token decision · impl-ttl  blocked  need a ttl",
	]);
});

test("expanded caps at the budget with +N more", () => {
	const p = todoLines(todos, { ...opts, expanded: true, maxLines: 3 }).map(strip);
	expect(p).toHaveLength(3);
	expect(p[2]!.trimEnd()).toBe("   +2 more");
});

test("no todos: no lines; a zero line budget draws nothing, expanded or not", () => {
	expect(todoLines([], opts)).toEqual([]);
	expect(todoLines(todos, { ...opts, maxLines: 0 })).toEqual([]);
	expect(todoLines(todos, { ...opts, expanded: true, maxLines: 0 })).toEqual([]);
});

test("collapsed without an in-progress item is the bar alone; a narrow row drops the tail", () => {
	const idle = todos.filter(t => t.status !== "in_progress");
	expect(strip(todoLines(idle, opts)[0]!)).not.toContain("◉");
	expect(strip(todoLines(todos, { ...opts, width: 20 })[0]!)).not.toContain("edit auth");
});

test("marks carry their tone: ok, accent, warn, muted; an unknown status reads as pending; nothing spins", () => {
	const row = (status: string, tick = 0) => todoLines([{ content: "edit auth middleware", status }], { ...opts, tick, expanded: true })[0]!;
	expect(row("completed")).toContain(seg("✓", rgb("ok")));
	expect(row("in_progress")).toContain(seg("◉", rgb("accent")));
	expect(row("blocked")).toContain(seg("⏸", rgb("warn")));
	expect(row("pending")).toContain(seg("○", rgb("muted")));
	expect(row("weird")).toContain(seg("○", rgb("muted")));
	expect(row("in_progress", 0)).toBe(row("in_progress", 5));
});

test("expanded rows colour done text muted and open text plain", () => {
	const lines = todoLines(todos, { ...opts, expanded: true });
	expect(lines[0]).toContain(seg("map the auth flow", rgb("muted")));
	expect(lines[2]).toContain(seg("add ttl config", rgb("text")));
	expect(lines[2]).not.toContain(seg("add ttl config", rgb("muted")));
	expect(lines[3]).toContain(seg("  blocked", rgb("warn")));
});

test("evidence numbering is stripped and the title takes 60% of the room when there is evidence", () => {
	const row = (content: string, evidence: string, width: number) => strip(todoLines([{ content, status: "pending", evidence }], { ...opts, width, expanded: true })[0]!);
	expect(row("abc", "2) first   line", 40)).toContain("abc  first line");
	const long = "x".repeat(80);
	expect(row(long, "proof here", 60)).toContain(`${"x".repeat(32)}…`);
});

test("every width pads to exactly the width, collapsed or expanded", () => {
	for (let width = 8; width <= 70; width += 3) {
		for (const expanded of [false, true]) for (const l of todoLines(todos, { ...opts, width, expanded })) expect([width, expanded, visibleWidth(l)]).toEqual([width, expanded, width]);
	}
});

test("same text as the Claude Code board for the same items, collapsed and expanded, at every width", () => {
	const items = [...(fx.items as TodoItem[]), ...(todos as TodoItem[])];
	for (const width of [20, 40, 60, 100]) {
		for (const expanded of [false, true]) {
			const claude = todoRows(items, { cols: width, tick: 0, expanded, maxRows: 20 }).map(r => r.map(x => x.t).join(""));
			const omp = todoLines(items as PanelTodo[], { width, tick: 0, spin: "⠋", expanded, maxLines: 20 }).map(strip);
			expect(omp).toEqual(claude);
		}
	}
});

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 100, maxLines: 10, phase: "implement", spin: "⣾", laneSpin: "⠋", tick: 1, done: 1, total: 4,
	workers: [{ name: "explorer-a324", secs: 72 }], notes: [], gates: [], todos, ...over,
});

test("renderPanel places the board under the rail within the width and line budget", () => {
	for (const todosExpanded of [false, true]) {
		const lines = renderPanel(model({ todosExpanded }));
		expect(lines.length).toBeLessThanOrEqual(10);
		expect(lines.every(l => visibleWidth(l) === 100)).toBe(true);
		// Folded, the board costs no row: the band carries `N of M` and row 1 is the breathing blank.
		expect(strip(lines[1]!)).toMatch(todosExpanded ? /^ ✓ / : /^ *$/);
		expect(strip(lines[0]!)).toContain("1 of 4");
	}
});

test("phase tree from the shared fixture: same rows as mod", () => {
	const rows = todoLines(fx.items, { width: 60, tick: 0, spin: "⠋", expanded: true, maxLines: 20 }).map(l => strip(l).trimEnd());
	expect(rows).toEqual(fx.rows);
});
