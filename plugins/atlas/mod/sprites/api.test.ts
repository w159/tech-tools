// Sprite API gallery: every persona x mood x size renders rows of the exact width,
// personas have distinct silhouettes (renderer independent), and moods animate across frames.
import { describe, expect, test } from 'claude-code/testing';
import { ART } from './art';
import { CREATURES, PROP_LEGEND, PROPS } from './palette';
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

/**
 * Problems with one run, as text: runs only use the half-block glyphs, fit the sprite, padding carries no
 * colour, and bg only paints the lower half of a top-half block. Collected rather than asserted one by one,
 * because the gallery has about 90k runs and the host kit's expect() is slow enough to time the test out.
 */
function cleanRunProblems(run: Run, size: SpriteSize): string[] {
  const out: string[] = [];
  const at = `${JSON.stringify(run)} @${size}`;
  if ([...run.text].length > spriteWidth(size)) out.push(`overflow ${at}`);
  if (!/^[ \u2580\u2584\u2588]+$/.test(run.text)) out.push(`glyph ${at}`);
  if (run.text.includes(' ') && run.text.trim() !== '') out.push(`mixed padding ${at}`); // a space run is pure padding
  if (run.text.trim() === '' && (run.fg !== undefined || run.bg !== undefined)) out.push(`coloured padding ${at}`);
  if (run.bg !== undefined && !/^\u2580+$/.test(run.text)) out.push(`bg off a top-half block ${at}`);
  return out;
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
    const problems: string[] = [];
    for (const { p, m, s, f } of cases(BIG_SIZES)) {
      for (const row of spriteRows(p, m, f, s)) {
        if (width(row) !== spriteWidth(s)) problems.push(`${p}/${m}/${s}/${f}: width ${width(row)}`);
        for (const run of row) problems.push(...cleanRunProblems(run, s).map((x) => `${p}/${m}/${f}: ${x}`));
      }
    }
    expect(problems).toEqual([]);
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

// ---- pixel-level checks: unfold the half-block rows back to a pixel grid and compare to the design grid ----
type Px = string | undefined;
const PX_N: Record<'m' | 'l', number> = { m: 12, l: 16 };
const EYE_HEX = '#14161c';

/** Half-block rows -> pixel grid (2 pixel rows per cell row), the inverse of the glyph folding. */
function unfold(rows: Run[][]): Px[][] {
  const out: Px[][] = [];
  for (const row of rows) {
    const top: Px[] = [];
    const bot: Px[] = [];
    for (const run of row) {
      for (const ch of run.text) {
        top.push(ch === '▀' || ch === '█' ? run.fg : undefined);
        bot.push(ch === '▄' || ch === '█' ? run.fg : ch === '▀' ? run.bg : undefined);
      }
    }
    out.push(top, bot);
  }
  return out;
}

/** Pixel coordinates of one design pixel (14x14 grid) at size n, as "x,y" keys. */
function designToPixels(x: number, y: number, n: number): string[] {
  const sx = n / 14;
  const span = (v: number): number[] => {
    const lo = Math.floor(v * sx);
    const hi = Math.max(lo, Math.floor((v + 1) * sx) - 1);
    return range(hi - lo + 1).map((i) => lo + i);
  };
  return span(x).flatMap((px) => span(y).map((py) => `${px},${py}`));
}

const pixelsWhere = (grid: Px[][], test: (c: string, x: number, y: number) => boolean): string[] =>
  grid.flatMap((row, y) => row.flatMap((c, x) => (c !== undefined && test(c, x, y) ? [`${x},${y}`] : []))).sort();
const sorted = (xs: string[]): string[] => [...new Set(xs)].sort();

describe('sprite pixels', () => {
  test('procedural personas draw: eyes land on the design grid (plain, working shift, happy, X)', () => {
    const eyes = (mood: (typeof MOODS)[number], fr: number, size: 'm' | 'l'): string[] => pixelsWhere(unfold(spriteRows('db-prober', mood, fr, size)), (c) => c === EYE_HEX);
    const want = (pts: [number, number][], n: number): string[] => sorted(pts.flatMap(([x, y]) => designToPixels(x, y, n)));
    const problems: string[] = [];
    for (const size of ['m', 'l'] as const) {
      const n = PX_N[size];
      // done / celebrate: happy arches (^ ^), no body bob at frame 0 of done
      const happy: [number, number][] = [[4, 5], [5, 4], [6, 5], [7, 5], [8, 4], [9, 5]];
      if (JSON.stringify(eyes('done', 0, size)) !== JSON.stringify(want(happy, n))) problems.push(`done ${size}: ${eyes('done', 0, size).join(' ')}`);
      // idle frame 0: plain eyes at (5,5) and (8,5); bob 0
      if (JSON.stringify(eyes('idle', 0, size)) !== JSON.stringify(want([[5, 5], [8, 5]], n))) problems.push(`idle ${size}: ${eyes('idle', 0, size).join(' ')}`);
      // working frame 2: eyes shifted by [1, 1], head bob 1 => (6, 7) and (9, 7)
      if (JSON.stringify(eyes('working', 2, size)) !== JSON.stringify(want([[6, 7], [9, 7]], n))) problems.push(`working ${size}: ${eyes('working', 2, size).join(' ')}`);
      // thinking frame 1: shift [1, -1] => (6, 4) and (9, 4)
      if (JSON.stringify(eyes('thinking', 1, size)) !== JSON.stringify(want([[6, 4], [9, 4]], n))) problems.push(`thinking ${size}`);
    }
    expect(problems).toEqual([]);
  });

  test('a failed procedural creature has X eyes in red and a sunken body (bob 1)', () => {
    const grid = unfold(spriteRows('db-prober', 'failed', 0, 'l'));
    const red = pixelsWhere(grid, (c, x, y) => c === '#ff5a52' && x < 12 && y > 3 && y < 14);
    const wantX: [number, number][] = [4, 7].flatMap((ox): [number, number][] => [[ox, 4], [ox + 2, 4], [ox + 1, 5], [ox, 6], [ox + 2, 6]]).map(([x, y]) => [x, y + 1]);
    expect(red).toEqual(sorted(wantX.flatMap(([x, y]) => designToPixels(x, y, 16))));
  });

  test('the prop sits one design pixel below its anchor at rest and three when failed', () => {
    const c = CREATURES['db-prober']!;
    const prop = PROPS[c.prop];
    const inRegion = (n: number) => (_c: string, x: number, y: number): boolean => x >= Math.floor(11 * (n / 14)) && y >= Math.floor(5 * (n / 14));
    const problems: string[] = [];
    for (const size of ['m', 'l'] as const) {
      const n = PX_N[size];
      for (const [mood, dy] of [['idle', 1], ['done', 1], ['failed', 3]] as const) {
        const cells: [number, number][] = prop.art.flatMap((row, ry) => [...row].flatMap((ch, rx): [number, number][] => (ch !== '.' && (ch === 'a' || PROP_LEGEND[ch]) ? [[11 + rx, 6 + dy + ry]] : [])));
        const got = pixelsWhere(unfold(spriteRows('db-prober', mood, 0, size)), inRegion(n));
        const want = sorted(cells.flatMap(([x, y]) => designToPixels(x, y, n)));
        if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${mood}/${size}: got ${got.join(' ')} want ${want.join(' ')}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('adjacent runs in a row never merge-able: same colours and glyph are one run', () => {
    const problems: string[] = [];
    for (const { p, m, s, f } of cases(BIG_SIZES)) {
      if (f > 1) continue;
      for (const row of spriteRows(p, m, f, s)) {
        row.forEach((run, i) => {
          const prev = row[i - 1];
          if (prev && prev.fg === run.fg && prev.bg === run.bg && prev.text[0] === run.text[0]) problems.push(`${p}/${m}/${s}/${f}: split run ${JSON.stringify(run)}`);
        });
      }
    }
    expect(problems).toEqual([]);
  });

  test('hand-drawn art: confetti marks mirror into the right padding columns, on empty art cells only', () => {
    const CONFETTI = ['#ffd84a', '#f472b6', '#56d4dd', '#52c872', '#ff7570'];
    const problems: string[] = [];
    // (frame, size) -> [x, y, confetti index] after the left/right mirror and the row limit of the size
    const MARKS: Record<string, [number, number, number][]> = {
      '0/m': [[0, 2, 0], [11, 1, 1], [0, 0, 4]],
      '0/l': [[1, 2, 0], [15, 1, 1], [0, 0, 4]],
      '1/m': [[0, 0, 1], [11, 3, 2], [11, 1, 0]],
      '1/l': [[0, 0, 1], [14, 3, 2], [15, 1, 0]],
    };
    for (const persona of ['lead', 'explorer', 'implementer', 'verifier', 'runner', 'planner', 'completeness-critic']) {
      for (const [k, marks] of Object.entries(MARKS)) {
        const [fr, size] = k.split('/') as [string, 'm' | 'l'];
        const art = ART[persona]![size];
        const grid = unfold(spriteRows(persona, 'celebrate', Number(fr), size));
        for (const [x, y, ci] of marks) if (art[y]![x] === '.' && grid[y]![x] !== CONFETTI[ci]) problems.push(`${persona} ${k}: (${x},${y}) is ${grid[y]![x]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('failed colours are an exact half-way mix towards gray', () => {
    const hex = (h: string, i: number): number => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    const half = (a: string, b: string): string => `#${[0, 1, 2].map((i) => Math.round(hex(a, i) * 0.5 + hex(b, i) * 0.5).toString(16).padStart(2, '0')).join('')}`;
    const problems: string[] = [];
    for (const p of PERSONA_KEYS) {
      const bg = badge(p, 'failed', 0)[0]?.bg;
      if (bg !== half(personaStyle(p).color, '#7a7f8a')) problems.push(`${p}: ${bg} vs ${half(personaStyle(p).color, '#7a7f8a')}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('speech bubble wrapping', () => {
  const text = (rows: Run[][]): string[] => rows.map((r) => r.map((x) => x.text).join(''));
  test('a word longer than the inner width is split into inner-wide chunks, the remainder on its own line', () => {
    expect(text(speechBubble('abcdefgh', 10, 'l'))).toEqual(['╭────────╮', '│ abcdef │', '│ gh     │', '╰────────╯', ' ╱        ']);
    expect(text(speechBubble('abcdefghijklmnopq', 10, 'r'))).toEqual(['╭────────╮', '│ abcdef │', '│ ghijkl │', '│ mnopq  │', '╰────────╯', '        ╲ ']);
  });
  test('a long word after a short one starts a fresh line; an exact multiple leaves no empty line', () => {
    expect(text(speechBubble('hi abcdefgh', 10, 'l')).slice(1, -2)).toEqual(['│ hi     │', '│ abcdef │', '│ gh     │']);
    expect(text(speechBubble('abcdefghijkl', 10, 'l')).slice(1, -2)).toEqual(['│ abcdef │', '│ ghijkl │']);
  });
});
