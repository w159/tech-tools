// C1: the done-transition glyph is a mark nothing else in Atlas draws (state glyphs, spinner frames, bar tracks and fills, rail and focus
// marks, the sparkline, the theme glyph tables, the role eyes and mouths) and not one of the host's own marks, in Unicode and in ASCII.
import { describe, expect, test } from 'claude-code/testing';
import { ATLAS_GLYPHS, gaugeParts, gauge, sparkline, spinnerGlyph, STATE_ASCII, STATE_GLYPHS, type Ui } from './atlas-ui';
import { POP_ASCII, POP_UNICODE } from './motion';
import { MOUTHS, ROLE_EYES } from './roles';
import { barParts, glyph, STATE_GLYPH } from './theme';

const chars = (xs: readonly string[]): string[] => xs.flatMap((x) => [...x]);
const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };

/** Marks the host draws itself (Claude Code and omp): separators, bullets, spinner stars, check marks, tree corners. */
const HOST = chars(['·', '•', '⏺', '⎿', '✓', '✗', '✻', '✶', '✢', '✳', '✽', '❯', '>', '…', '├', '└', '│', '─']);

const unicodeTokens = (): string[] => [
  ...Object.values(STATE_GLYPHS), ...[0, 1, 2, 3].map((f) => spinnerGlyph(f)), ...chars(Object.values(glyph)), ...Object.values(STATE_GLYPH),
  ...chars([gaugeParts(8, 0.5).full, gaugeParts(8, 0.5).partial, gaugeParts(8, 0.5).track, gaugeParts(8, 0.51).partial, gaugeParts(8, 0.9).partial]),
  ...chars(barParts(50, 4)), ...chars([sparkline([0, 1, 2, 3, 4, 5, 6, 7], 7)]), ...gauge(8, 0.5, mocha).flatMap((r) => [...r.t]),
  ...Object.values(ROLE_EYES).flat(), ...Object.values(MOUTHS).flat().flatMap((m) => [...m]), '▸', '━', '─', '◖', '◗', '◆',
];
const asciiTokens = (): string[] => [
  ...Object.values(STATE_ASCII), ...[0, 1, 2, 3].map((f) => spinnerGlyph(f, true)), ...gauge(8, 0.5, ascii).flatMap((r) => [...r.t]),
  ...chars([sparkline([0, 1, 2, 3, 4], 4, true)]), '>', '+', '-', '|', '=', '.', ' ',
];

describe('C1: the done-transition glyph is used by nothing else', () => {
  test('Unicode frames match no state glyph, spinner frame, bar track or fill, theme glyph, role eye or host mark', () => {
    const taken = new Set([...unicodeTokens(), ...HOST]);
    expect(POP_UNICODE.length).toBeGreaterThan(0);
    for (const g of POP_UNICODE) expect([g, taken.has(g)]).toEqual([g, false]);
  });
  test('ASCII frames match no state mark, spinner frame, gauge character, sparkline level, box character or host mark', () => {
    const taken = new Set([...asciiTokens(), ...HOST]);
    for (const g of POP_ASCII) expect([g, taken.has(g)]).toEqual([g, false]);
  });
  test('the frames are one cell each and listed in ATLAS_GLYPHS (checked against the DejaVu cmap by theme.test.ts)', () => {
    for (const g of POP_UNICODE) expect([g, [...g].length, ATLAS_GLYPHS.includes(g)]).toEqual([g, 1, true]);
    for (const g of POP_ASCII) expect([g, g.length]).toEqual([g, 1]);
  });
});
