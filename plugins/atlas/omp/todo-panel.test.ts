// The Board on omp: the same lines as Claude Code (both draw mod/board-model.ts), painted as ANSI. Parity with the golden and with
// the Claude Code rows, the exact width of every line, the colours, and the board inside the mission panel.
import { expect, test } from "bun:test";
import { board_120, board_120_rich, board_80, WORLD_NOW, worldItems } from "../contracts/board-golden";
import { PALETTES, sgrColor, toneHex, type Ui } from "../mod/atlas-ui";
import { todoRows } from "../mod/todo-panel";
import { renderPanel, visibleWidth, type PanelModel } from "./mission-panel";
import { boardLines, todoLines } from "./todo-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const latte: Ui = { theme: "latte", ascii: false, color: "truecolor" };
const o = (width: number, over: Record<string, unknown> = {}) => ({ width, tick: 0, expanded: true, maxLines: 20, now: WORLD_NOW, ui: mocha, ...over });
const items = worldItems();

test("the whole surface equals the golden at 120, 120 rich and 80, every line exactly its width", () => {
	for (const [width, rich, golden] of [[120, false, board_120], [120, true, board_120_rich], [80, false, board_80]] as const) {
		const lines = boardLines(items, { width, tick: 0, now: WORLD_NOW, ui: mocha, rich });
		expect(lines.map(l => strip(l).trimEnd())).toEqual(golden);
		for (const l of lines) expect(visibleWidth(l)).toBe(width);
	}
});

test("Latte draws the same text", () => {
	expect(boardLines(items, { width: 120, tick: 0, now: WORLD_NOW, ui: latte }).map(l => strip(l).trimEnd())).toEqual(board_120);
});

test("parity: the slot lines are the Claude Code slot rows, character for character", () => {
	for (const [width, rich] of [[120, false], [120, true], [80, false], [60, false], [40, false]] as const) {
		const omp = todoLines(items, o(width, { rich })).map(strip);
		const cc = todoRows(items, { cols: width, tick: 0, expanded: true, maxRows: 20, now: WORLD_NOW, ui: mocha, rich }).map(r => r.map(s => s.t).join(""));
		expect([width, rich, omp]).toEqual([width, rich, cc]);
	}
});

test("[] without todos, without room or folded; a short slot ends in +N more", () => {
	expect(todoLines([], o(120))).toEqual([]);
	expect(todoLines(items, o(120, { maxLines: 0 }))).toEqual([]);
	expect(todoLines(items, o(120, { expanded: false }))).toEqual([]);
	const short = todoLines(items, o(120, { maxLines: 4 })).map(strip);
	expect(short).toHaveLength(4);
	expect(short[3]!.trimEnd()).toBe("  +5 more");
});

test("colours come from the shared tokens: done glyph ok, dim label sub, running marker accent bold, chip on its fill", () => {
	const line = (i: number, rich = false) => todoLines(items, o(120, { rich }))[i]!;
	const fg = (hex: string) => sgrColor(hex, 38, "truecolor");
	expect(line(1)).toContain(`${fg(PALETTES.mocha.ok)};${sgrColor(PALETTES.mocha.panel, 48, "truecolor")}m●`);
	expect(line(1)).toContain(fg(PALETTES.mocha.sub)); // the sub colour, never struck (critique 22)
	expect(line(1)).not.toContain("\x1b[9m");
	expect(line(4)).toContain(`1;${fg(toneHex("accent", "mocha"))}`);
	expect(line(1, true)).toContain(sgrColor(PALETTES.mocha.ok, 48, "truecolor")); // the DONE chip fill
});

test("the running row spins with the tick", () => {
	const glyph = (tick: number) => strip(todoLines(items, o(120, { tick }))[4]!).slice(2, 3);
	expect([0, 1, 2, 3].map(glyph)).toEqual(["◐", "◓", "◑", "◒"]);
});

test("NO_COLOR: no colour escapes, only bold", () => {
	const lines = todoLines(items, o(120, { ui: { ...mocha, color: "none" } }));
	for (const l of lines) expect(l).not.toMatch(/\x1b\[[0-9;]*(38|48);/);
	expect(lines.join("")).not.toContain("\x1b[9m"); // no strikethrough on any row (critique 22)
});

test("renderPanel puts the board under the band: header and one row per todo within the line budget", () => {
	const model: PanelModel = {
		width: 120, maxLines: 14, phase: "implement", spin: "◆", laneSpin: "◐", tick: 0, done: 3, total: 7, workers: [], notes: [], gates: [],
		channel: "demo@master/lead-1", todos: items, todosExpanded: true, ui: mocha, idle: { workers: 1, failed: 0 },
	};
	const rows = renderPanel(model).map(strip).map(r => r.trimEnd());
	expect(rows.some(r => /^ITEM +STATE +OWNER +DETAIL$/.test(r))).toBe(true);
	expect(rows.filter(r => /^[ ▸] [●◐◓◑◒◇■▲▲] /.test(r)).length).toBe(7);
	for (const l of renderPanel(model)) expect(visibleWidth(l)).toBe(120);
});
