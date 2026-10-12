// Sprite API gallery: every persona x mood x size renders rows of the exact width,
// personas have distinct silhouettes (renderer independent), and moods animate across frames.
import { describe, expect, test } from 'claude-code/testing';
import { badge, badgeWidth, displayName, frameCount, MOODS, PERSONA_KEYS, personaStyle, spriteRows, spriteWidth, speechBubble, type Run, type SpriteSize } from './api';

const SIZES: SpriteSize[] = ['s', 'm', 'l'];
const BIG_SIZES = ['m', 'l'] as const;
const WIDTH: Record<SpriteSize, number> = { s: 3, m: 12, l: 16 };
const HEIGHT: Record<SpriteSize, number> = { s: 1, m: 6, l: 8 };
const key = (rows: Run[][]): string => rows.map((r) => r.map((x) => `${x.text}${x.fg ?? ''}${x.bg ?? ''}`).join('')).join('|');
const width = (row: Run[]): number => row.reduce((n, r) => n + [...r.text].length, 0);
const distinct = (xs: string[]): number => new Set(xs).size;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Every persona x mood x size x frame combination. */
const cases = (sizes: readonly SpriteSize[]): { p: string; m: (typeof MOODS)[number]; s: SpriteSize; f: number }[] =>
  PERSONA_KEYS.flatMap((p) => MOODS.flatMap((m) => sizes.flatMap((s) => range(frameCount(m)).map((f) => ({ p, m, s, f })))));

/** Cell silhouette: any non-space glyph is '#'. */
const cells = (rows: Run[][]): string[] => rows.map((r) => [...r.map((x) => x.text).join('')].map((c) => (c === ' ' ? '.' : '#')).join(''));

const BOTTOM_FILLED = new Set(['▄', '█']);
const topPixel = (c: string): string => (c === '▀' || c === '█' ? '#' : '.');
const bottomPixel = (c: string, bg?: string): string => (BOTTOM_FILLED.has(c) || (c === '▀' && bg) ? '#' : '.');
/** Pixel silhouette of one row of runs: each half-block cell expands to two pixel rows. */
const rowPixels = (row: Run[]): string[] => {
  const glyphs = row.flatMap((run) => [...run.text].map((c) => ({ c, bg: run.bg })));
  return [glyphs.map((g) => topPixel(g.c)).join(''), glyphs.map((g) => bottomPixel(g.c, g.bg)).join('')];
};
const pixels = (rows: Run[][]): string[] => rows.flatMap(rowPixels);

const CORE = ['lead', 'explorer', 'implementer', 'verifier', 'runner', 'planner', 'completeness-critic'];
const coreSilhouettes = (size: 'm' | 'l', level: (rows: Run[][]) => string[]): string[] => CORE.map((p) => level(spriteRows(p, 'idle', 0, size)).join('/'));
const count = (row: string): number => (row.match(/#/g) ?? []).length;

function expectColourlessPadding(run: Run): void {
  if (run.text.includes(' ')) expect(run.text.trim()).toBe(''); // a space run is pure padding
  if (run.text.trim() === '') expect(run.fg === undefined && run.bg === undefined).toBe(true);
}

/** Runs only use the half-block glyphs, fit the sprite, and bg only paints the lower half of a top-half block. */
function expectCleanRun(run: Run, size: SpriteSize): void {
  expect([...run.text].length).toBeLessThanOrEqual(spriteWidth(size));
  expect(run.text).toMatch(/^[ \u2580\u2584\u2588]+$/);
  expectColourlessPadding(run);
  if (run.bg !== undefined) expect(run.text).toMatch(/^\u2580+$/);
}

function expectLeadCrown(size: 'm' | 'l'): void {
  const px = pixels(spriteRows('lead', 'idle', 0, size));
  const [tips, band] = [px[0] as string, (px[1] as string).slice(0, -1)]; // last column holds the baton tip
  expect(tips).toMatch(/#\.+#/); // crown teeth: gap between two filled pixels
  expect(band).toMatch(/^\.*#{6}\.*$/); // solid crown band
  expect(count(band)).toBeLessThan(Math.max(...px.map(count)));
  expect(cells(spriteRows('lead', 'idle', 0, size))[0]).toContain('#');
}

describe('sprite api', () => {
  test('every persona, mood, size and frame has the exact cell geometry', () => {
    for (const { p, m, s, f } of cases(SIZES)) {
      const rows = spriteRows(p, m, f, s);
      expect(rows.length).toBe(HEIGHT[s]);
      expect(spriteWidth(s)).toBe(WIDTH[s]);
      if (s !== 's') for (const r of rows) expect(width(r)).toBe(WIDTH[s]); // the s chip is as wide as its name
    }
  });

  test('runs never overflow the sprite and padding carries no colour', () => {
    for (const { p, m, s, f } of cases(BIG_SIZES)) {
      for (const row of spriteRows(p, m, f, s)) {
        expect(width(row)).toBe(spriteWidth(s));
        row.forEach((run) => expectCleanRun(run, s));
      }
    }
  });

  test('size s is the 1-row badge chip', () => {
    const b = badge('explorer', 'working', 0);
    expect(width(b)).toBe(badgeWidth('Explorer') + 1);
    expect(b[0]?.text).toBe(' Explorer ');
    expect(b[0]?.bg).toBe(personaStyle('explorer').color);
    expect(key(spriteRows('explorer', 'working', 0, 's'))).toBe(key([b]));
  });

  test('badge and display names read as people, not keys', () => {
    expect(badge('db-prober', 'idle', 0)[0]?.text).toBe(' DB prober ');
    expect(badge('lead', 'idle', 0, 'Lead agent')[0]?.text).toBe(' Lead agent ');
    expect(displayName('lead')).toBe('Lead agent');
    expect(displayName('atlas:implementer')).toBe('Implementer');
    expect(displayName('unknown', 'selffix')).toBe('Selffix');
    expect(displayName('unknown', 'impl-ui')).toBe('Impl ui');
    expect(displayName('unknown')).toBe('Agent');
    for (const p of PERSONA_KEYS) expect(badge(p, 'idle', 0)[0]?.text.trim().length).toBeGreaterThan(2);
    expect(key([badge('explorer', 'idle', 0)])).not.toBe(key([badge('explorer', 'failed', 0)]));
  });

  test('personas have distinct silhouettes at m and l (cell and pixel level)', () => {
    for (const size of BIG_SIZES) {
      expect(distinct(coreSilhouettes(size, cells))).toBe(CORE.length);
      expect(distinct(coreSilhouettes(size, pixels))).toBe(CORE.length);
    }
  });

  test('every persona has a distinct pixel silhouette at m and l', () => {
    for (const size of BIG_SIZES) {
      expect(distinct(PERSONA_KEYS.map((p) => pixels(spriteRows(p, 'idle', 0, size)).join('/')))).toBe(PERSONA_KEYS.length);
    }
  });

  test('lead silhouette has a crown row on top, narrower than the head', () => {
    BIG_SIZES.forEach(expectLeadCrown);
  });

  test('personas are visually distinct and moods animate', () => {
    expect(distinct(PERSONA_KEYS.map((p) => key(spriteRows(p, 'idle', 0, 'm'))))).toBe(PERSONA_KEYS.length);
    for (const m of MOODS) expect(distinct(range(frameCount(m)).map((f) => key(spriteRows('explorer', m, f, 'm'))))).toBeGreaterThan(1);
    expect(key(spriteRows('explorer', 'idle', 0, 'l'))).not.toBe(key(spriteRows('explorer', 'failed', 0, 'l')));
  });

  test('persona aliases resolve and unknown falls back', () => {
    expect(key(spriteRows('atlas:explorer', 'idle', 0, 'l'))).toBe(key(spriteRows('explorer', 'idle', 0, 'l')));
    expect(key(spriteRows('atlas:explorer', 'idle', 0, 's'))).toBe(key(spriteRows('explorer', 'idle', 0, 's')));
    expect(personaStyle('no-such-persona').color).toMatch(/^#/);
  });

  test('speech bubble rows share one width within maxCols', () => {
    const rows = speechBubble('found 3 call sites in the auth flow and more words to wrap around', 24, 'l');
    const w = width(rows[0] ?? []);
    expect(w).toBeLessThanOrEqual(24);
    for (const r of rows) expect(width(r)).toBe(w);
  });
});
