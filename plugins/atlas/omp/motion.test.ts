// Motion on omp (round 2, slice C): omp paints the Runs mod/ builds, so a frame is the same colours and the same text on both hosts;
// the omp widgets drive their own frame timer only while a transition is open, and draw the resting render when idle or reduced.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { worldHudAgents, worldPhases, worldPlan } from "../contracts/hud-world";
import { worldBoardRows } from "../contracts/board-golden";
import { runHex, sgrColor, type Ui } from "../mod/atlas-ui";
import { boardBody, boardMotionItems, boardRowsOf } from "../mod/board-model";
import { hudLines, hudMotionItems, hudRows, type HudInput } from "../mod/hud";
import { Motion, MOTION_MS, sinceChange, windowOf } from "../mod/motion";
import { boardLines } from "./todo-panel";
import { paintHud } from "./hud-paint";
import { TODO_WIDGET_KEY, registerTodoFallback } from "./todo-fallback";

const ui: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const T0 = 1000;
const input = (status: string): HudInput => ({ todos: worldPlan().map((t, i) => (i === 3 ? { ...t, status } : t)), agents: worldHudAgents(), phases: worldPhases() });
const motionAt = (dt: number) => {
	const m = new Motion(true);
	m.observe("hud-todo", hudMotionItems(input("pending"), { now: T0 }).todos, 0);
	m.observe("hud-todo", hudMotionItems(input("completed"), { now: T0 }).todos, T0);
	return m.ctx(T0 + dt);
};

test("parity: every frame of a TODO transition has the same text and the same colours in omp ANSI as in the Claude Code segments", () => {
	for (const dt of [0, 100, 300, 600, windowOf({ state: "done" })]) {
		const view = { cols: 120, maxRows: 60, ui, now: T0 + dt, motion: motionAt(dt) };
		const cc = hudRows(input("completed"), view);
		const omp = paintHud(input("completed"), view);
		expect(omp.map(strip)).toEqual(cc.map(r => r.map(x => x.t).join("")));
		cc.forEach((r, i) => {
			const want = r.filter(x => x.t !== "").map(x => sgrColor(x.color!, 38, "truecolor"));
			const got = [...omp[i]!.matchAll(/\x1b\[(?:[0-9];)?(?:9;)?(38;2;\d+;\d+;\d+)/g)].map(m => m[1]);
			expect(got).toEqual(want);
		});
	}
});

test("parity: omp's board frames are the shared board runs, painted", () => {
	const rows = worldBoardRows().map((r, i) => (i === 1 ? { ...r, state: "done" as const } : r));
	const prev = worldBoardRows().map((r, i) => (i === 1 ? { ...r, state: "queued" as const } : r));
	const m = new Motion(true);
	m.observe("board", boardMotionItems(prev), 0);
	m.observe("board", boardMotionItems(rows), T0);
	const frames = [0, 200, 400, 600].map(dt => {
		const motion = m.ctx(T0 + sinceChange("done", dt)); // a done mark holds its first beat
		const mod = boardBody(rows, { cols: 120, ui, motion });
		return { fg: mod.flatMap(l => l.runs.filter(x => x.t.trim()).map(x => runHex(x, "mocha"))).join(","), text: mod.map(l => l.runs.map(x => x.t).join("")) };
	});
	expect(new Set(frames.map(f => f.fg)).size).toBeGreaterThanOrEqual(2); // wave 31: 231 for one step, then 151 held (the weight falls on the last beat)
	const items = rows.map(r => ({ content: r.label, status: r.state === "done" ? "completed" : r.state === "running" ? "in_progress" : "pending", owner: r.owner }));
	const at = { width: 120, tick: 0, ui, now: 0, motion: m.ctx(T0 + 100) };
	const painted = boardLines(items, at).map(strip);
	expect(painted).toHaveLength(boardRowsOf(items, 0).length + 3);
});

test("omp: ATLAS_REDUCED_MOTION and NO_COLOR draw the resting HUD", () => {
	const m = new Motion(false);
	m.observe("hud-todo", hudMotionItems(input("pending"), { now: T0 }).todos, 0);
	m.observe("hud-todo", hudMotionItems(input("completed"), { now: T0 }).todos, T0);
	const view = { cols: 120, maxRows: 60, ui, now: T0 };
	expect(paintHud(input("completed"), { ...view, motion: m.ctx(T0) })).toEqual(paintHud(input("completed"), view));
	expect(hudLines(input("completed"), { ...view, motion: m.ctx(T0) })).toEqual(hudLines(input("completed"), view));
});

// ---- the TODO fallback widget drives its frame timer only while a transition is open ----------------------------------------------
function board(items: Array<{ content: string; status: string }>) {
	const root = mkdtempSync(join(tmpdir(), "todo-motion-"));
	mkdirSync(join(root, ".atlas", ".run"), { recursive: true });
	const write = (rows: typeof items) => writeFileSync(join(root, ".atlas", ".run", "todos.json"), JSON.stringify({ version: 1, items: rows.map(r => ({ session_id: "s1", origin: "session", archived: false, ...r })) }));
	write(items);
	return { root, write };
}
function harness(root: string, env: Record<string, string> = {}) {
	const handlers: Record<string, Array<(e: unknown, c: unknown) => unknown>> = {};
	const pi = { on: (n: string, h: (e: unknown, c: unknown) => unknown) => void (handlers[n] ??= []).push(h) };
	const widgets: Array<string[] | undefined> = [];
	const ui = { setWidget: (key: string, c: string[] | undefined) => void (key === TODO_WIDGET_KEY && widgets.push(c)) };
	const t = { poll: undefined as (() => void) | undefined, frame: undefined as (() => void) | undefined, frames: 0, clock: 10_000 };
	registerTodoFallback(pi as never, {
		env: { ATLAS_PROJECT_ROOT: root, COLORTERM: "truecolor", ...env },
		now: () => t.clock,
		setInterval: fn => ((t.poll = fn), "poll"),
		clearInterval: () => void (t.poll = undefined),
		setFrame: fn => (t.frames++, (t.frame = fn), "frame"),
		clearFrame: () => void (t.frame = undefined),
	});
	const ctx = { agent: { kind: "main" }, cwd: root, ui, hasUI: true, sessionManager: { getSessionId: () => "s1" } };
	return { start: () => handlers.before_agent_start?.forEach(h => h({}, ctx)), widgets, t };
}
const rows = (status: string) => [{ content: "Research: a", status }, { content: "Implement: b", status: "pending" }];

test("fallback widget: idle schedules no frame timer; a state change runs it, draws in-between frames and ends on the resting render", () => {
	const b = board(rows("pending"));
	const h = harness(b.root);
	h.start();
	expect(h.t.frame).toBeUndefined(); // a first sight is at rest
	h.t.clock += 5000;
	h.t.poll?.();
	expect(h.t.frame).toBeUndefined(); // nothing changed: nothing scheduled
	b.write(rows("completed"));
	h.t.clock += 1000;
	h.t.poll?.();
	expect(h.t.frame).toBeDefined(); // the change opens a window
	const shots = new Set<string>();
	for (let dt = 0; dt < windowOf({ state: "done" }); dt += 100) {
		h.t.frame?.();
		shots.add((h.widgets.at(-1) ?? []).join("\n"));
		h.t.clock += 100;
	}
	expect(shots.size).toBeGreaterThanOrEqual(3);
	h.t.clock += 100;
	h.t.frame?.();
	expect(h.t.frame).toBeUndefined(); // the window closed: the timer stopped itself
	const rest = h.widgets.at(-1)!.join("\n");
	h.t.poll?.();
	expect(h.widgets.at(-1)!.join("\n")).toBe(rest);
});

test("fallback widget: ATLAS_REDUCED_MOTION=1 and NO_COLOR never start the frame timer", () => {
	for (const env of [{ ATLAS_REDUCED_MOTION: "1" }, { NO_COLOR: "1" }]) {
		const b = board(rows("pending"));
		const h = harness(b.root, env);
		h.start();
		b.write(rows("completed"));
		h.t.clock += 1000;
		h.t.poll?.();
		expect(h.t.frames).toBe(0);
	}
});
