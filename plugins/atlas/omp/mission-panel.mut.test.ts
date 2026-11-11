// Mutation-kill tests for mission-panel.ts (seed 1105 survivors): panelMotionOf reads the board it is given.
import { expect, test } from "bun:test";
import { type PanelModel, panelMotionOf } from "./mission-panel";

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 140, maxLines: 12, phase: "implement", spin: "x", laneSpin: "x", tick: 0, done: 0, total: 0,
	workers: [], notes: [], gates: [], channel: "demo@master/lead-1", ui: { theme: "mocha", ascii: false, color: "truecolor" }, ...over,
});

test("panelMotionOf: the board items are the todos, and no todos means none", () => {
	const todos = [{ content: "a", status: "pending" }, { content: "b", status: "completed" }];
	expect(panelMotionOf(model({ todos, nowSecs: 100 })).board).toHaveLength(2);
	expect(panelMotionOf(model()).board).toHaveLength(0);
});
