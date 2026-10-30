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

const strip = (ls: string[]) => ls.join("\n");

test("tree: Research:/Implement: prefixes become roman-numbered phases with counts, active phase expanded", () => {
	const lines = todoTreeLines([
		{ content: "Research: trace calc module", status: "completed" },
		{ content: "Research: map call paths", status: "in_progress" },
		{ content: "Implement: add mul", status: "pending" },
		{ content: "Verify: run tests", status: "pending" },
		{ content: "Docs: changelog", status: "pending" },
	]);
	expect(lines).toEqual([
		" TODO",
		"  ├─ I. Research · 1/2",
		"  │  ├─ ☑ trace calc module",
		"  │  └─ ☐ map call paths",
		"  ├─ II. Implement · 0/1",
		"  ├─ III. Verify · 0/1",
		"  ├─ IV. Docs · 0/1",
		"  └─────",
	]);
});

test("tree: [label] prefix works and unprefixed items group under Tasks", () => {
	const lines = strip(todoTreeLines([{ content: "[build] wire it", status: "in_progress" }, { content: "plain item", status: "pending" }]));
	expect(lines).toContain("I. Build · 0/1");
	expect(lines).toContain("II. Tasks · 0/1");
	expect(lines).toContain("☐ wire it");
});

test("fallback widget appears for board items when no native todo has run", () => {
	const b = board([{ content: "Research: a", status: "in_progress" }, { content: "Implement: b", status: "pending" }]);
	const h = harness(b.root);
	h.fire("before_agent_start");
	const last = h.widgets.at(-1);
	expect(last?.[0]).toBe(" TODO");
	expect(strip(last ?? [])).toContain("I. Research · 0/1");
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
	expect(h.widgets.at(-1)?.[0]).toBe(" TODO");
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
