import { expect, test } from "bun:test";
import { renderPanel, visibleWidth, type PanelModel } from "./mission-panel";
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
