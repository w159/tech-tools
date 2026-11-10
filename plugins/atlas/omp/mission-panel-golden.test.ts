// Parity: the omp mission panel renders the same text rows as the Claude band for the shared band fixture.
// Twin: mod/band-golden.test.ts. Both compare against contracts/band-golden.ts, blank spacer rows included.
import { expect, test } from "bun:test";
import { fx, idleFx, trimRows } from "../contracts/band-fixture";
import { golden, idleGolden, railGolden } from "../contracts/band-golden";
import { coreGolden } from "../contracts/core-golden";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { coreModel } from "../mod/data/core";
import { type PanelModel, railText, renderPanel } from "./mission-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const gates = fx.gates.map((g) => ({
	id: g.id,
	title: g.id,
	lines: [{ ok: g.ok, label: g.id }],
})) as never;

const model: PanelModel = {
	width: fx.columns,
	maxLines: 12,
	phase: fx.phase,
	spin: "◆",
	laneSpin: "⠋",
	tick: 0,
	done: fx.todos.filter((t) => t.status === "completed").length,
	total: fx.todos.length,
	workers: fx.workers.map((w) => ({
		name: w.name,
		secs: w.secs,
		role: w.role,
		tool: { tool: w.tool, target: w.target, active: w.active },
	})),
	notes: fx.notes.map((n) => ({
		from: n.from,
		to: n.to,
		text: n.text,
		ts: n.ts / 1000,
	})),
	gates,
	channel: `${fx.project}@${fx.branch}/${fx.lead}`,
	team: fx.scope,
	elapsedSecs: fx.elapsedSecs,
	todos: fx.todos as never,
};

const idleModel: PanelModel = {
	...model,
	phase: idleFx.phase,
	done: idleFx.todos.length,
	workers: [],
	elapsedSecs: undefined,
	idle: idleFx.lastRun,
	core: coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 }),
};

test("renders the shared fixture to the golden rows (plain text, 120 columns, tick 0)", () => {
	expect(trimRows(renderPanel(model).map(strip))).toEqual(golden);
});

test("idle renders the shared idle golden, core row included", () => {
	const rows = trimRows(renderPanel(idleModel).map(strip));
	expect(rows).toEqual(idleGolden);
	expect(rows[2]).toBe(coreGolden[120]);
});

// The stepper keeps the widest form that fits (twin: mod/band-golden.test.ts).
for (const [cols, want] of Object.entries(railGolden)) {
	test(`rail tier at ${cols} columns`, () => {
		expect(railText(model, Number(cols))).toBe(want);
	});
}
