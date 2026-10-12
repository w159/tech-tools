// Self-check for the band's theme helpers (run: claude plugin test <dir>).
import { expect, test } from 'claude-code/testing';
import { bar, barParts, blink, dim, glyph, lerp, meterColor, phaseColor, STATE_GLYPH, stateColor } from './theme';

test('bar clamps and rounds', () => {
  expect(bar(0, 10)).toBe('▱▱▱▱▱▱▱▱▱▱');
  expect(bar(41, 10)).toBe('▰▰▰▰▱▱▱▱▱▱');
  expect(bar(100, 10)).toBe('▰▰▰▰▰▰▰▰▰▰');
  expect(bar(150, 10)).toBe('▰▰▰▰▰▰▰▰▰▰');
  expect(bar(-5, 3)).toBe('▱▱▱');
  expect(barParts(50, 4)).toEqual(['▰▰', '▱▱']);
});

test('meterColor steps ok / input / fail', () => {
  expect(meterColor(10)).toBe('#52c872');
  expect(meterColor(70)).toBe('#f2aa40');
  expect(meterColor(90)).toBe('#ff7570');
});

test('lerp interpolates', () => {
  expect(lerp(0, 10, 0.5)).toBe(5);
  expect(lerp(2, 4, 0)).toBe(2);
  expect(lerp(2, 4, 1)).toBe(4);
});

test('dim scales hex and passes non-hex through', () => {
  expect(dim('#ffffff', 0.5)).toBe('#808080');
  expect(dim('#2fbd9f', 1)).toBe('#2fbd9f');
  expect(dim('green', 0.5)).toBe('green');
  expect(dim('#2fbd9f', 0)).toBe('#000000');
});

test('phase and state colours resolve from BRAND', () => {
  expect(phaseColor('implement')).toBe('#2fbd9f');
  expect(phaseColor('blocked')).toBe('#ff7570');
  expect(stateColor('running')).toBe('#2fbd9f');
  expect(stateColor('failed')).toBe('#ff7570');
});

// Cell width: Ghostty draws East Asian Wide/Fullwidth, emoji-presentation and the hexagon
// block U+2B00-2BFF as 2 cells and overwrites the next letter. Every glyph must be one
// code point inside an allowlist of ranges that render 1 cell everywhere.
const ONE_CELL: ReadonlyArray<readonly [number, number]> = [
  [0x20, 0x7e], // ASCII
  [0xb7, 0xb7], // middle dot
  [0x2500, 0x259f], // box drawing + block elements
  [0x25a0, 0x25e1], // geometric shapes up to (not incl.) the U+25E2 triangles
  [0x2726, 0x2727], // four-point stars
  [0x2800, 0x28ff], // braille
  [0x2da, 0x2da], // ring above (spark)
];
const cellWidth = (s: string): number => {
  const cps = [...s];
  if (cps.length !== 1) return -1;
  const cp = cps[0]!.codePointAt(0)!;
  return ONE_CELL.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2;
};

test('every glyph and state glyph is exactly 1 cell wide', () => {
  for (const [k, v] of Object.entries({ ...glyph, ...STATE_GLYPH })) {
    expect([k, cellWidth(v)]).toEqual([k, 1]);
  }
  expect(cellWidth(String.fromCodePoint(0x2b22))).toBe(2);
  expect(cellWidth(String.fromCodePoint(0x25e2))).toBe(2);
});

test('blink domain', () => {
  expect([0, 1]).toContain(blink(500));
});
