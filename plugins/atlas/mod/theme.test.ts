// Self-check for the band's theme helpers (run: claude plugin test <dir>).
import { expect, test } from 'claude-code/testing';
import { ATLAS_GLYPHS, capsule, gauge, rail, ribbon, runsString, sparkline, stateRun, UI_STATES } from './atlas-ui';
import { DEJAVU_SANS_MONO_HAS } from './fixtures/dejavu-sans-mono-glyphs';
import { PHASE_TABLE } from './contract-pattern';
import { DONE_GLYPH, bar, barParts, blink, contractGlyph, dim, glyph, textWidth, lerp, STATE_GLYPH } from './theme';

test('bar clamps and rounds', () => {
  expect(bar(0, 10)).toBe('▱▱▱▱▱▱▱▱▱▱');
  expect(bar(41, 10)).toBe('▰▰▰▰▱▱▱▱▱▱');
  expect(bar(100, 10)).toBe('▰▰▰▰▰▰▰▰▰▰');
  expect(bar(150, 10)).toBe('▰▰▰▰▰▰▰▰▰▰');
  expect(bar(-5, 3)).toBe('▱▱▱');
  expect(barParts(50, 4)).toEqual(['▰▰', '▱▱']);
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

test('ATLAS design glyph set: one cell each, all in DejaVu Sans Mono, and nothing else is emitted', () => {
  for (const ch of ATLAS_GLYPHS) {
    expect([ch, cellWidth(ch)]).toEqual([ch, 1]);
    expect([ch, DEJAVU_SANS_MONO_HAS.includes(ch)]).toEqual([ch, true]);
  }
  const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;
  const text = [capsule(ui), ribbon(80, 'BOARD', '7 items', ui), rail(['plan', 'build'], 1, ui), gauge(12, 0.4, ui), ...UI_STATES.map((s) => [stateRun(s, ui)])]
    .map(runsString).join('') + sparkline([0, 30, 60, 90, 120, 150, 180, 20], 180);
  for (const ch of new Set([...text])) expect([ch, ch.charCodeAt(0) < 0x7f || ATLAS_GLYPHS.includes(ch)]).toEqual([ch, true]);
});

test('blink domain', () => {
  expect([0, 1]).toContain(blink(500));
});

test('contractGlyph maps every contract emoji to one cell', () => {
  for (const e of ['🔍', '💡', '🧪', '📋', '🔧', '✅', '🏁', '⛔']) expect([e, textWidth(contractGlyph(e))]).toEqual([e, 1]);
  expect(contractGlyph('🔍')).toBe('◎');
  expect(contractGlyph('🦄')).toBe('·');
  expect(contractGlyph('※')).toBe('※');
});

test('textWidth: Emoji_Presentation (East Asian Width W) code points in the BMP are two cells, their text-style neighbours one', () => {
  for (const ch of ['✅', '⚡', '❌', '⏳', '✨', '⛔', '⌚', '⏩', '☔', '♈', '♿', '⚓', '⚪', '⚽', '⛄', '⛎', '⛪', '⛲', '⛵', '⛺', '⛽', '✊', '❎', '❓', '❗', '➕', '➰', '➿', '⬛', '⬜', '⭐', '⭕']) expect(textWidth(ch), ch).toBe(2);
  for (const ch of ['⬆', '⬅', '⬇', '⬡', '☀', '✓', '✗', '❯', '▲', '◐', '⠸', '▰']) expect(textWidth(ch), ch).toBe(1);
});
test('textWidth: a skin tone after an emoji, variation selectors, combining marks for symbols and Thai vowel marks take no cell', () => {
  expect(textWidth('👍🏽')).toBe(2);
  expect(textWidth('👍🏻👍🏿')).toBe(4);
  expect(textWidth('🏽')).toBe(2); // a swatch alone is a picture of its own
  expect(textWidth('e⃗')).toBe(1);
  expect(textWidth('a︎')).toBe(1);
  expect(textWidth('a︀')).toBe(1);
  expect(textWidth('ก้ำ')).toBe(2); // U+0E01 U+0E49 (mark) U+0E33 (spacing vowel)
  expect(textWidth('กัิฺ็๎')).toBe(1);
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MOD_ROOT = new URL('.', import.meta.url).pathname;
const sourcesUnder = (dir = ''): string[] =>
  readdirSync(join(MOD_ROOT, dir)).flatMap((n) => {
    const rel = dir ? `${dir}/${n}` : n;
    if (statSync(join(MOD_ROOT, rel)).isDirectory()) return sourcesUnder(rel);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/\.d\.ts$/.test(n) ? [rel] : [];
  });

/** The runtime (value) edges of one source file: `import type` and all-`type` specifier lists are erased, `export ... from` stays. */
const runtimeEdges = (rel: string): string[] => {
  const src = readFileSync(join(MOD_ROOT, rel), 'utf8');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const out: string[] = [];
  const add = (spec: string): void => {
    const base = join('/', dir, spec).slice(1);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (sourcesUnder_cache().includes(base + ext)) return void out.push(base + ext);
  };
  for (const m of src.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+'(\.[^']*)'/gm)) {
    const names = m[1]!.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => !n.startsWith('type '))) add(m[2]!);
  }
  for (const m of src.matchAll(/^export\s+(?!type\b)(?:\{[^}]*\}|\*)\s+from\s+'(\.[^']*)'/gm)) add(m[1]!);
  return out;
};
let cache: string[] | undefined;
const sourcesUnder_cache = (): string[] => (cache ??= sourcesUnder());
const reaches = (from: string, to: string): boolean => {
  const seen = new Set<string>();
  const walk = (f: string): boolean => runtimeEdges(f).some((n) => n === to || (!seen.has(n) && (seen.add(n), walk(n))));
  return walk(from);
};

test('M4: band-frame.ts and status-frame.ts are not a runtime import cycle', () => {
  expect(sourcesUnder_cache()).toContain('band-frame.ts');
  expect(sourcesUnder_cache()).toContain('status-frame.ts');
  expect([reaches('band-frame.ts', 'status-frame.ts'), reaches('status-frame.ts', 'band-frame.ts')]).not.toEqual([true, true]);
  expect(reaches('band-frame.ts', 'band-frame.ts')).toBe(false);
});

test('M5: no hex colour literal outside the token file (atlas-ui.ts) and the files that own another palette', () => {
  const OWN_PALETTE = (f: string): boolean => f === 'atlas-ui.ts' || f === 'contract.ts' || f === 'data/personas.ts' || f.startsWith('sprites/') || f.startsWith('fixtures/') || /golden-(fixture|cases)\.ts$/.test(f);
  const stray: string[] = [];
  for (const f of sourcesUnder_cache().filter((x) => !OWN_PALETTE(x))) {
    for (const m of readFileSync(join(MOD_ROOT, f), 'utf8').matchAll(/#[0-9a-fA-F]{6}\b/g)) stray.push(`${f}: ${m[0]}`);
  }
  expect(stray).toEqual([]);
});

test('contractGlyph draws each phase with the phase table cell, and verify with the one done mark', () => {
  for (const p of PHASE_TABLE) expect([p.id, contractGlyph(p.glyph)]).toEqual([p.id, p.cell]);
  expect(contractGlyph('✅')).toBe(DONE_GLYPH);
});
