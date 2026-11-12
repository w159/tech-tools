// The one phase rail (mod/rail.ts): the default rail equals the operating contract's phases minus the three that are not steps, and the omp
// mission panel lights the same step the band does for the same phase list. No `done` step of its own.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contractRail, RAIL_DEFAULT, RAIL_SKIP, railIds, railNo, railOf } from "../mod/rail";
import { renderPanel } from "./mission-panel";

const contract = JSON.parse(readFileSync(join(import.meta.dir, "..", "contracts", "operating-contract.json"), "utf8")) as { phases: Array<string | { id: string }> };
const ids = contract.phases.map(p => (typeof p === "string" ? p : p.id));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("RAIL_DEFAULT is the contract's phases minus validate, blocked and done", () => {
	expect(RAIL_DEFAULT).toEqual(ids.filter(id => !RAIL_SKIP.has(id)));
	expect(railIds()).toEqual([...RAIL_DEFAULT]);
	expect(railIds(ids)).toEqual([...RAIL_DEFAULT]);
});

test("a finished run lights the end of the rail; an off-rail phase keeps the last lit step", () => {
	const done = railOf([...RAIL_DEFAULT], "done");
	expect([done.index, railNo(done)]).toEqual([5, "5/5"]);
	expect(railOf([...RAIL_DEFAULT], "blocked", "test").phase).toBe("test");
	expect(railOf([...RAIL_DEFAULT], "blocked").phase).toBe("research");
	expect(contractRail({ phases: ids.map(id => ({ id })) as never })).toEqual([...RAIL_DEFAULT]);
});

test("the omp band counts the same rail: no sixth `done` step, `phase 4/5` for implement", () => {
	const m = { width: 120, maxLines: 4, phase: "implement", spin: "◆", laneSpin: "◐", tick: 0, done: 0, total: 0, workers: [], notes: [], gates: [], channel: "d@m/l", ui: { theme: "mocha", ascii: false, color: "truecolor" } } as never;
	expect(strip(renderPanel(m)[0]!)).toContain("phase 4/5");
	expect(strip(renderPanel({ ...(m as object), phases: ["research", "theory", "build", "verify"], phase: "build" } as never)[0]!)).toContain("phase 3/4");
});
