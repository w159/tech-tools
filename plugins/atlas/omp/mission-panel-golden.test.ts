// Parity: the omp mission panel renders the same text rows as the Claude band for the shared band fixture.
// Twin: mod/band-golden.test.ts. Both compare against contracts/band-golden.ts, blank spacer rows included.
import { expect, test } from "bun:test";
import { fx, idleFx, trimRows } from "../contracts/band-fixture";
import { golden, idleGolden, tierGolden } from "../contracts/band-golden";
import { worldModel } from "../contracts/band-world";
import { coreGolden } from "../contracts/core-golden";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { coreModel } from "../mod/data/core";
import { paintMission, type PanelModel, renderPanel } from "./mission-panel";

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

// The band at each tier on the shared world (twin: mod/band-golden.test.ts).
const ui = { theme: "mocha", ascii: false, color: "truecolor" } as const;
for (const [name, columns, rich] of [["120", 120, false], ["120-rich", 120, true], ["80", 80, false], ["60", 60, false], ["40", 40, false]] as const) {
	test(`band tier ${name} equals the golden`, () => {
		const rows = paintMission(worldModel(columns, ui, { rich, maxRows: rich ? 3 : 1 }));
		expect(trimRows(rows.map(strip))).toEqual(tierGolden[name]!);
		for (const row of rows) expect([...strip(row)].length).toBe(columns);
	});
}
