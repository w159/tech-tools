// Edge pins for omp/todo-panel.ts (surviving mutants of the 553a9bce run): the padding tail is the panel background (SGR 48) with
// colour and plain blanks under NO_COLOR, and a one-line budget is `+N more` alone.
import { expect, test } from "bun:test";
import { WORLD_NOW, worldItems } from "../contracts/board-golden";
import { PALETTES, sgrColor, type Ui } from "../mod/atlas-ui";
import { boardLines, todoLines } from "./todo-panel";

const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const RST = "\x1b[0m";
const esc = (s: string) => s.replace(/[[\]]/g, "\\$&");
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const items = worldItems();

test("with colour every padded line ends in the panel background (SGR 48), its blanks, then the reset", () => {
	const fill = `\x1b[${sgrColor(PALETTES.mocha.panel, 48, "truecolor")}m`;
	const tail = new RegExp(`${esc(fill)} +${esc(RST)}$`);
	for (const lines of [boardLines(items, { width: 120, tick: 0, now: WORLD_NOW, ui: mocha }), todoLines(items, { width: 120, tick: 0, expanded: true, maxLines: 20, now: WORLD_NOW, ui: mocha })]) {
		const padded = lines.filter((l) => l.includes(`${RST}${fill}`));
		expect(padded.length).toBeGreaterThan(0);
		for (const l of padded) expect(l).toMatch(tail);
	}
});

test("NO_COLOR: lines are padded with plain blanks, with no escape sequence at all except bold and strike", () => {
	const ui: Ui = { ...mocha, color: "none" };
	const lines = boardLines(items, { width: 120, tick: 0, now: WORLD_NOW, ui });
	for (const l of lines) {
		for (const seq of l.match(/\x1b\[[0-9;]*m/g) ?? []) expect(["\x1b[1m", "\x1b[9m", "\x1b[1;9m", RST]).toContain(seq);
		expect([...strip(l)].length).toBe(120);
	}
	expect(lines.some((l) => / {2,}$/.test(l))).toBe(true);
});

test("a one-line budget is `+N more` alone, counting every line it left out", () => {
	const all = todoLines(items, { width: 120, tick: 0, expanded: true, maxLines: 99, now: WORLD_NOW, ui: mocha });
	const one = todoLines(items, { width: 120, tick: 0, expanded: true, maxLines: 1, now: WORLD_NOW, ui: mocha });
	expect(one).toHaveLength(1);
	expect(strip(one[0]!).trimEnd()).toBe(`  +${all.length} more`);
	const board = boardLines(items, { width: 120, tick: 0, now: WORLD_NOW, ui: mocha, maxLines: 1 });
	expect(board).toHaveLength(1);
	expect(strip(board[0]!).trimEnd()).toMatch(/^ {2}\+\d+ more$/);
});
