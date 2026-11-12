// omp draws the TODO and SUBAGENTS surfaces from the same rows as Claude Code: the rev 4 design goldens, and a parity
// assert that both hosts produce identical text for the fixture world at every width and in both forms. Mounted: the TODO rows only
// (omp/todo-fallback.ts, no agents); the SUBAGENTS rows are not drawn by any omp surface (omp has its own native Subagents widget),
// so the SUBAGENTS cases check the shared layout against the design goldens, not an omp surface.
import { expect, test } from "bun:test";
import { subagents_120, subagents_120_rich, subagents_80, todo_120, todo_120_rich, todo_40, todo_80 } from "../contracts/hud-golden";
import { worldHudAgents, worldPhases, worldPlan } from "../contracts/hud-world";
import type { Ui } from "../mod/atlas-ui";
import { hudRows } from "../mod/hud";
import { hudText as rawHudText, paintHud } from "./hud-paint";

const ui: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const opts = (cols: number, rich = false, maxRows = 60) => ({ cols, maxRows, ui, rich, now: 0 });
// The design goldens draw the first spinner frame; a row's frame is spinFrameOf(now, name), so the goldens compare with the frame normalised.
const hudText = (...a: Parameters<typeof rawHudText>) => rawHudText(...a).map(l => l.replace(/[◐◓◑◒]/g, "◐"));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const phases = worldPhases();
const block = (rows: string[]) => rows.slice(rows.findIndex(l => l.includes("SUBAGENTS")));

// The first row of the HUD runs its rule on to the last cell (mod/hud-surface.ts ruleToEdge) so the host's `[-]` marker sits at the rule's end: the design golden's first row, with its rule 2 cells shorter before the count and 3 after it.
const edge = (rows: readonly string[]): string[] => [rows[0]!.replace(/(━{6,})( \d+\/\d+)$/, (_m, f: string, c: string) => `${f.slice(2)}${c} ━━━`), ...rows.slice(1)];
test("omp TODO surface equals the design goldens at 120, 120 rich, 80 and 40; 60 uses the 40 form", () => {
	const input = { todos: worldPlan(), agents: [], phases };
	expect(hudText(input, opts(120))).toEqual(edge(todo_120));
	expect(hudText(input, opts(120, true))).toEqual(edge(todo_120_rich));
	expect(hudText(input, opts(80))).toEqual(edge(todo_80));
	expect(hudText(input, opts(40))).toEqual(edge(todo_40));
	expect(hudText(input, opts(60)).slice(1)).toEqual(todo_40.slice(1));
});

test("omp SUBAGENTS surface equals the design goldens at 120, 120 rich and 80; the block at 60 and 40 too", () => {
	const input = { todos: worldPlan(), agents: worldHudAgents(), phases };
	expect(block(hudText(input, opts(120)))).toEqual([...subagents_120]);
	expect(block(hudText(input, opts(120, true)))).toEqual([...subagents_120_rich]);
	expect(block(hudText(input, opts(80)))).toEqual([...subagents_80]);
	for (const cols of [60, 40]) expect(hudText(input, opts(cols)).join("\n")).toContain("SUBAGENTS");
});

test("parity: Claude Code rows and omp rows are the same text at 120, 100, 80, 60 and 40, standard and rich", () => {
	const input = { todos: worldPlan(), agents: worldHudAgents(), phases };
	for (const cols of [120, 100, 80, 60, 40]) {
		for (const rich of [false, true]) {
			for (const maxRows of [60, 12, 6, 2, 1]) {
				const cc = hudRows(input, opts(cols, rich, maxRows)).map(r => r.map(s => s.t).join("").trimEnd());
				expect(rawHudText(input, opts(cols, rich, maxRows))).toEqual(cc);
				expect(paintHud(input, opts(cols, rich, maxRows)).map(l => strip(l).trimEnd())).toEqual(cc);
			}
		}
	}
});

test("omp paints the rev 4 panel (#181825) behind every row, not the legacy #11111b", () => {
	const painted = paintHud({ todos: worldPlan(), agents: worldHudAgents() }, opts(120)).join("\n");
	expect(painted).toContain("48;2;24;24;37"); // #181825
	expect(painted).not.toContain("48;2;17;17;27"); // #11111b, except the capsule ink which is a foreground
});

test("NO_COLOR: no colour escapes, words and glyphs remain", () => {
	const plain = paintHud({ todos: worldPlan(), agents: [] }, { ...opts(120), ui: { ...ui, color: "none" } }).join("\n");
	expect(plain).not.toMatch(/\x1b\[[0-9;]*38;/);
	expect(plain).toContain("running");
});
