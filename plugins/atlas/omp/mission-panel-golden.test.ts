// Parity: the omp mission panel renders the same text rows as the Claude band for the shared band fixture.
// Twin: mod/band-golden.test.ts. Both compare against contracts/band-golden.ts.
import { expect, test } from "bun:test";
import { fx, trimRows } from "../contracts/band-fixture";
import { golden } from "../contracts/band-golden";
import { renderPanel, type PanelModel } from "./mission-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

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
		spark: w.spark,
		tool: { tool: w.tool, target: w.target, active: w.active },
	})),
	notes: fx.notes.map((n) => ({
		from: n.from,
		to: n.to,
		text: n.text,
		ts: n.ts / 1000,
	})),
	gates: fx.gates.map((g) => ({
		id: g.id,
		title: g.id,
		lines: [{ ok: g.ok, label: g.id }],
	})) as never,
	channel: `${fx.project}@${fx.branch}/${fx.lead}`,
	team: fx.scope,
	elapsedSecs: fx.elapsedSecs,
	todos: fx.todos as never,
};

// Excluded rows: the omp panel's blank spacer rows (the design's breathing room, no text to compare).
const textRows = (rows: string[]) => trimRows(rows).filter(r => r !== "");

test("renders the shared fixture to the golden rows (plain text, 120 columns, tick 0)", () => {
	expect(textRows(renderPanel(model).map(strip))).toEqual(golden);
});
