import { fx } from "../contracts/todo-tree-fixture";
import { expect, test } from "bun:test";
import { renderPanel, visibleWidth, type PanelModel } from "./mission-panel";
import { C, seg } from "./panel-paint";
import { type PanelTodo, todoLines } from "./todo-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const todos: PanelTodo[] = [
	{ content: "map the auth flow", status: "completed", owner: "explorer-1", evidence: "1. rg auth -> 3 hits" },
	{ content: "edit auth middleware", status: "in_progress", owner: "impl-auth" },
	{ content: "add ttl config", status: "pending" },
	{ content: "wait on token decision", status: "blocked", owner: "impl-ttl", evidence: "need a ttl" },
];
const opts = { width: 100, tick: 0, spin: "⣾", expanded: false, maxLines: 8 };

test("collapsed: one row, done/total, the in-progress owner and text", () => {
	const lines = todoLines(todos, opts);
	expect(lines).toHaveLength(1);
	const p = strip(lines[0]!);
	expect(p).toContain("1/4");
	expect(p).toContain("impl-auth: edit auth middleware");
});

test("collapsed bar fills with progress and the tick changes the frame", () => {
	const filled = (list: PanelTodo[]) => strip(todoLines(list, opts)[0]!).split("█").length - 1;
	expect(filled(todos.map(t => ({ ...t, status: "completed" })))).toBeGreaterThan(filled(todos));
	expect(filled(todos.map(t => ({ ...t, status: "pending" })))).toBe(0);
	expect(todoLines(todos, { ...opts, tick: 0 })[0]).not.toBe(todoLines(todos, { ...opts, tick: 1 })[0]);
});

test("expanded: a row per item with glyph, owner, evidence", () => {
	const p = todoLines(todos, { ...opts, expanded: true }).map(strip);
	expect(p).toHaveLength(4);
	expect(p[0]).toContain("✔");
	expect(p[0]).toContain("explorer-1");
	expect(p[0]).toContain("rg auth");
	expect(p[2]).toContain("○");
	expect(p[3]).toContain("✖");
});

test("expanded caps at the budget with +N more", () => {
	const p = todoLines(todos, { ...opts, expanded: true, maxLines: 3 }).map(strip);
	expect(p).toHaveLength(3);
	expect(p[2]).toContain("+2 more");
});

test("no todos: no lines", () => {
	expect(todoLines([], opts)).toEqual([]);
});

test("a zero line budget draws nothing, expanded or not", () => {
	expect(todoLines(todos, { ...opts, maxLines: 0 })).toEqual([]);
	expect(todoLines(todos, { ...opts, expanded: true, maxLines: 0 })).toEqual([]);
});

test("collapsed without an in-progress item is the bar alone; a narrow row drops the tail", () => {
	const idle = todos.filter(t => t.status !== "in_progress");
	expect(strip(todoLines(idle, opts)[0]!)).not.toContain("impl-auth");
	expect(strip(todoLines(todos, { ...opts, width: 20 })[0]!)).not.toContain("edit auth");
});

test("expanded rows: blocked glyph, ownerless padding, evidence numbering stripped", () => {
	const rows = todoLines(todos, { ...opts, expanded: true }).map(strip);
	expect(rows[3]).toContain("✖");
	expect(rows[2]).toContain("○");
	expect(rows[0]).toContain("rg auth -> 3 hits");
	expect(rows[0]).not.toContain("1. rg");
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
		expect(strip(lines[2]!)).toMatch(todosExpanded ? /✔/ : /1\/4/);
	}
});

test("phase tree from the shared fixture: same rows as mod", () => {
	const rows = todoLines(fx.items, { width: 60, tick: 0, spin: "⠋", expanded: true, maxLines: 20 }).map(l => strip(l).trimEnd());
	expect(rows).toEqual(fx.rows);
});

test("collapsed bar draws the partial cell after the filled ones, and the count is bold", () => {
	const five: PanelTodo[] = [
		{ content: "a", status: "completed" },
		{ content: "b", status: "completed" },
		{ content: "c", status: "in_progress" },
		{ content: "d", status: "pending" },
		{ content: "e", status: "pending" },
	];
	const raw = todoLines(five, { ...opts, tick: 2 })[0]!;
	const cells = [...strip(raw)].slice(" board ".length, " board ".length + 24); // width 100 -> 24 cells, 9.6 lit
	expect(cells.slice(0, 9).filter(c => c === "█").length).toBeGreaterThanOrEqual(8); // one is repainted by the pulse
	expect(cells[9]).toBe("▌"); // 0.6 of a cell -> the 4/8 block
	expect(cells[10]).toBe(" ");
	expect(raw).toMatch(/\x1b\[1m(?:\x1b\[[0-9;]*m)* 2\/5 /);
});

test("expanded rows colour done text muted and open text plain", () => {
	const lines = todoLines(todos, { ...opts, expanded: true });
	expect(lines[0]).toContain(seg("map the auth flow", C.MUT));
	expect(lines[2]).toContain(seg("add ttl config", C.TXT));
	expect(lines[2]).not.toContain(seg("add ttl config", C.MUT));
});

test("expanded row: text takes 60% of the room when there is evidence, evidence gets the rest", () => {
	const long = "0123456789abcdefghijklmnopqrstuvwxyz0123";
	const row = (content: string, evidence: string, width: number) => strip(todoLines([{ content, status: "pending", evidence }], { ...opts, width, expanded: true })[0]!);
	// head is 16 columns, so width 47 leaves room 30 and the text cell is floor(30 * 0.6) = 18 wide
	expect(row(long, "ev", 47)).toContain(`${long.slice(0, 17)}…  ev`);
	// short content, long evidence: room 20, text 3 -> evidence cell is 20 - 3 - 2 = 15 wide
	expect(row("abc", "x".repeat(30), 37).endsWith(`abc  ${"x".repeat(14)}…`)).toBe(true);
	// no room left after the text: the evidence tail is just its two spaces, never a stray ellipsis
	expect(row(long, "x".repeat(30), 29).endsWith("…  ")).toBe(true);
});
