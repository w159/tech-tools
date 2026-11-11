// Mutation-kill tests for mission-panel.ts (seed 1105 survivors): panelMotionOf reads the board it is given.
// Equivalent (seed 1105, third pass), not tested: panelMotionOf `Math.max(20, m.width)` -> `21` (mission-panel.ts:178). The width reaches the model only as
// `cols` and coreCells(m.core, w); bandMotionItems reads the agent counts (workers, lastRun), which are built from m.workers and m.idle (lines 135, 154).
import { expect, test } from "bun:test";
import { type PanelModel, panelMotionOf, renderPanel } from "./mission-panel";

const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 140, maxLines: 12, phase: "implement", spin: "x", laneSpin: "x", tick: 0, done: 0, total: 0,
	workers: [], notes: [], gates: [], channel: "demo@master/lead-1", ui: { theme: "mocha", ascii: false, color: "truecolor" }, ...over,
});

test("panelMotionOf: the board items are the todos, and no todos means none", () => {
	const todos = [{ content: "a", status: "pending" }, { content: "b", status: "completed" }];
	expect(panelMotionOf(model({ todos, nowSecs: 100 })).board).toHaveLength(2);
	expect(panelMotionOf(model()).board).toHaveLength(0);
});

test("renderPanel: an explicit rich flag draws the rich band whatever the environment says", () => {
	const saved = process.env.ATLAS_BAND_RICH;
	delete process.env.ATLAS_BAND_RICH;
	try {
		const plain = renderPanel(model({ width: 160, maxLines: 3, rich: false })).join("\n");
		const rich = renderPanel(model({ width: 160, maxLines: 3, rich: true })).join("\n");
		expect(rich).not.toBe(plain);
		expect(renderPanel(model({ width: 160, maxLines: 3 })).join("\n")).toBe(plain);
		process.env.ATLAS_BAND_RICH = "1";
		expect(renderPanel(model({ width: 160, maxLines: 3 })).join("\n")).toBe(rich);
	} finally {
		if (saved === undefined) delete process.env.ATLAS_BAND_RICH;
		else process.env.ATLAS_BAND_RICH = saved;
	}
});
