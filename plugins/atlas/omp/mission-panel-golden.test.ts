// Parity: the omp mission panel renders the same text rows as the Claude band for the shared world.
// Twin: mod/band-golden.test.ts. Both compare against contracts/band-golden.ts, blank spacer rows included.
import { expect, test } from "bun:test";
import { trimRows } from "../contracts/band-fixture";
import { golden, idleGolden, tierGolden } from "../contracts/band-golden";
import { worldModel } from "../contracts/band-world";
import { coreGolden } from "../contracts/core-golden";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { worldIdleSnapshot, worldOmp } from "../contracts/world-live";
import { coreModel } from "../mod/data/core";
import { paintMission, renderPanel } from "./mission-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("renders the shared world to the golden rows (plain text, 120 columns, tick 0)", () => {
	expect(trimRows(renderPanel(worldOmp(120)).map(strip))).toEqual(golden);
});

test("idle renders the shared idle golden, core row included, a failed worker still counted", () => {
	const idleModel = worldOmp(120, {
		phase: "done", done: 7, elapsedSecs: undefined, todos: worldIdleSnapshot().todos, idle: { workers: 1, secs: 42, failed: 1 },
		workers: worldOmp(120).workers.map((w: { state?: string }) => (w.state === "failed" ? w : { ...w, state: "done", tool: undefined })),
		core: coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 }),
	});
	const rows = trimRows(renderPanel(idleModel).map(strip));
	expect(rows).toEqual(idleGolden);
	expect(rows.some((r) => r.startsWith(coreGolden[120]))).toBe(true);
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
