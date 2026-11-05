import { expect, test } from "bun:test";
import { BASE, C, DIM, GREEN, MUT, PANEL, PANEL2, PEACH, PINK, RED, RST, SKY, TEAL, TXT, VIOLET, WHITE, YEL, BLUE, bar, bg, chip, cut, fg, hx, lerp, seg, visibleWidth } from "./panel-paint";

const ESC = "\x1b";

test("hx parses #rrggbb into channel triples", () => {
	expect(hx("#000000")).toEqual([0, 0, 0]);
	expect(hx("#ffffff")).toEqual([255, 255, 255]);
	expect(hx("#0a141e")).toEqual([10, 20, 30]); // each pair is its own channel, in r,g,b order
	expect(hx("#CBA6F7")).toEqual([203, 166, 247]); // upper case hex
});

test("palette entries hold the exact catppuccin-mocha colors the panels draw with", () => {
	expect(PANEL).toEqual([0x11, 0x11, 0x1b]);
	expect(PANEL2).toEqual([0x18, 0x18, 0x25]);
	expect(BASE).toEqual([0x1e, 0x1e, 0x2e]);
	expect(TXT).toEqual([0xcd, 0xd6, 0xf4]);
	expect(MUT).toEqual([0x6c, 0x70, 0x86]);
	expect(DIM).toEqual([0x45, 0x47, 0x5a]);
	expect(VIOLET).toEqual([0xcb, 0xa6, 0xf7]);
	expect(TEAL).toEqual([0x94, 0xe2, 0xd5]);
	expect(SKY).toEqual([0x89, 0xdc, 0xeb]);
	expect(BLUE).toEqual([0x89, 0xb4, 0xfa]);
	expect(GREEN).toEqual([0xa6, 0xe3, 0xa1]);
	expect(PEACH).toEqual([0xfa, 0xb3, 0x87]);
	expect(RED).toEqual([0xf3, 0x8b, 0xa8]);
	expect(YEL).toEqual([0xf9, 0xe2, 0xaf]);
	expect(PINK).toEqual([0xf5, 0xc2, 0xe7]);
	expect(WHITE).toEqual([255, 255, 255]);
});

test("C exposes exactly the palette entries todo-panel draws with", () => {
	expect(Object.keys(C).sort()).toEqual(["GREEN", "MUT", "PANEL2", "RED", "TEAL", "TXT", "VIOLET", "WHITE", "YEL"]);
	expect(C.YEL).toBe(YEL);
	expect(C.GREEN).toBe(GREEN);
	expect(C.RED).toBe(RED);
	expect(C.MUT).toBe(MUT);
	expect(C.TXT).toBe(TXT);
	expect(C.VIOLET).toBe(VIOLET);
	expect(C.TEAL).toBe(TEAL);
	expect(C.WHITE).toBe(WHITE);
	expect(C.PANEL2).toBe(PANEL2);
});

test("fg, bg and RST emit true-color SGR sequences", () => {
	expect(RST).toBe(`${ESC}[0m`);
	expect(fg([1, 2, 3])).toBe(`${ESC}[38;2;1;2;3m`);
	expect(bg([4, 5, 6])).toBe(`${ESC}[48;2;4;5;6m`);
});

test("lerp interpolates each channel and rounds to the nearest integer", () => {
	expect(lerp([0, 0, 0], [100, 200, 50], 0)).toEqual([0, 0, 0]);
	expect(lerp([0, 0, 0], [100, 200, 50], 1)).toEqual([100, 200, 50]);
	expect(lerp([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
	expect(lerp([0, 100, 255], [100, 0, 255], 0.25)).toEqual([25, 75, 255]); // descending channel + a constant channel
	expect(lerp([0, 0, 0], [1, 3, 5], 0.5)).toEqual([1, 2, 3]); // 0.5 -> 1 (round half up), 1.5 -> 2, 2.5 -> 3
	expect(lerp([0, 0, 0], [10, 10, 10], 0.34)).toEqual([3, 3, 3]); // 3.4 rounds down, not up
});

test("seg wraps text in background (default PANEL), optional foreground, optional bold, then reset", () => {
	expect(seg("hi")).toBe(`${bg(PANEL)}hi${RST}`);
	expect(seg("hi", RED)).toBe(`${fg(RED)}${bg(PANEL)}hi${RST}`);
	expect(seg("hi", RED, BASE)).toBe(`${fg(RED)}${bg(BASE)}hi${RST}`);
	expect(seg("hi", undefined, BASE, true)).toBe(`${ESC}[1m${bg(BASE)}hi${RST}`);
	expect(seg("hi", RED, BASE, true)).toBe(`${ESC}[1m${fg(RED)}${bg(BASE)}hi${RST}`);
});

test("chip is bold BASE-on-color text padded with one space each side", () => {
	expect(chip("ok", GREEN)).toBe(seg(" ok ", BASE, GREEN, true));
	expect(chip("ok", GREEN)).toBe(`${ESC}[1m${fg(BASE)}${bg(GREEN)} ok ${RST}`);
	expect(visibleWidth(chip("ok", GREEN))).toBe(4);
});

test("visibleWidth counts code points and ignores SGR escapes", () => {
	expect(visibleWidth("")).toBe(0);
	expect(visibleWidth("abc")).toBe(3);
	expect(visibleWidth(`${fg(RED)}${bg(BASE)}abc${RST}`)).toBe(3);
	expect(visibleWidth(`${ESC}[1;38;2;1;2;3mxy${ESC}[0m`)).toBe(2); // digits and semicolons inside the escape
	expect(visibleWidth("█▏…")).toBe(3); // one column per code point
	expect(visibleWidth("😀a")).toBe(2); // an astral code point is one, not two UTF-16 units
	expect(visibleWidth("[0m")).toBe(3); // without the ESC byte it is plain text
	expect(visibleWidth("a\x1b[Kb")).toBe(5); // only SGR (…m) sequences are stripped
});

test("cut pads short text, keeps exact-fit text, and truncates long text with an ellipsis in exactly w columns", () => {
	expect(cut("ab", 5)).toBe("ab   ");
	expect(cut("abcde", 5)).toBe("abcde");
	expect(cut("abcdef", 5)).toBe("abcd…");
	expect(cut("abcdef", 1)).toBe("…");
	expect(cut("", 3)).toBe("   ");
	expect(cut("abc", 0)).toBe("");
	expect(cut("abc", -2)).toBe("");
	expect(cut("😀😀😀😀", 3)).toBe("😀😀…"); // counts code points, never splits a surrogate pair
	expect(visibleWidth(cut("xyz", 8))).toBe(8);
});

// ---- bar ----

/** Expected single cell: foreground, PANEL2 background, glyph. */
const cell = (color: readonly [number, number, number], ch: string) => fg(color) + bg(PANEL2) + ch;

test("bar: empty fraction is all DIM track cells then a reset", () => {
	expect(bar(0, 3, RED, GREEN)).toBe(cell(lerp(RED, GREEN, 0), " ") + cell(DIM, " ") + cell(DIM, " ") + RST);
});

test("bar: full fraction is all full blocks on the gradient from a to b", () => {
	expect(bar(1, 3, RED, GREEN)).toBe(cell(lerp(RED, GREEN, 0), "█") + cell(lerp(RED, GREEN, 0.5), "█") + cell(lerp(RED, GREEN, 1), "█") + RST);
});

test("bar: a fractional fill draws whole blocks, one eighth-block edge cell, then track", () => {
	// width 4, frac 0.625 -> 2.5 cells: two full, an edge of 4/8 (▌), one empty track cell
	const out = bar(0.625, 4, RED, GREEN);
	expect(out).toBe(cell(lerp(RED, GREEN, 0 / 3), "█") + cell(lerp(RED, GREEN, 1 / 3), "█") + cell(lerp(RED, GREEN, 2 / 3), "▌") + cell(DIM, " ") + RST);
});

test("bar: the edge glyph steps through all eight eighths", () => {
	const glyphs = " ▏▎▍▌▋▊▉";
	for (let k = 0; k < 8; k++) {
		const out = bar((k + 0.5) / 8, 1, RED, GREEN); // width 1: cells = frac, so the single cell is the edge glyph
		expect(out).toBe(cell(lerp(RED, GREEN, 0), glyphs[k]!) + RST);
	}
});

test("bar: fractions are clamped to 0..1 and the output always has `width` cells", () => {
	expect(bar(-3, 3, RED, GREEN)).toBe(bar(0, 3, RED, GREEN));
	expect(bar(7, 3, RED, GREEN)).toBe(bar(1, 3, RED, GREEN));
	expect(visibleWidth(bar(0.4, 10, RED, GREEN))).toBe(10);
	expect(bar(0.5, 0, RED, GREEN)).toBe(RST);
});

test("bar: the gradient uses the full a..b range across width-1 and a width-1 bar does not divide by zero", () => {
	const out = bar(1, 5, [0, 0, 0], [100, 100, 100]);
	expect(out).toBe([0, 25, 50, 75, 100].map(v => cell([v, v, v], "█")).join("") + RST);
	expect(bar(1, 1, [0, 0, 0], [100, 100, 100])).toBe(cell([0, 0, 0], "█") + RST);
});
