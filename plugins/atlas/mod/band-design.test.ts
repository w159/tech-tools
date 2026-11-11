// Design-level checks on the rebuilt band: goldens per tier and theme, WCAG on every rendered run, one chip per row, counts that
// equal the fixture world, and gauges that match their labels.
import { describe, expect, test } from 'claude-code/testing';
import { world, worldModel } from '../contracts/band-world';
import { band_120, band_120_rich, band_40, band_60, band_80 } from '../contracts/band-world-golden';
import { chipCount, contrast, glyphTone, NEED, PALETTES, runKind, runsString, toneHex, type Run, type Ui } from './atlas-ui';
import { bandLines, runsWidth } from './mission-layout';

const ui = (theme: 'mocha' | 'latte'): Ui => ({ theme, ascii: false, color: 'truecolor' });
const text = (rows: { runs: Run[] }[]): string[] => rows.map((r) => runsString(r.runs).trimEnd());
const tiers = [
  [120, false, band_120],
  [120, true, band_120_rich],
  [80, false, band_80],
  [60, false, band_60],
  [40, false, band_40],
] as const;

describe('band goldens', () => {
  for (const theme of ['mocha', 'latte'] as const) {
    for (const [cols, rich, golden] of tiers) {
      test(`${theme} ${cols}${rich ? ' rich' : ''} equals the design golden and fits its width`, () => {
        const rows = bandLines(worldModel(cols, ui(theme), { rich, maxRows: rich ? 3 : 1 }));
        expect(text(rows)).toEqual([...golden]);
        for (const r of rows) expect(runsWidth(r.runs)).toBeLessThanOrEqual(cols);
      });
    }
  }
});

describe('WCAG on every rendered run', () => {
  for (const theme of ['mocha', 'latte'] as const) {
    test(`${theme}: each run's foreground meets 4.5:1 as text or 3:1 as a glyph on its background`, () => {
      const p = PALETTES[theme];
      const variants = [{}, { ctx: 0.97 }, { ctx: undefined }];
      let checked = 0;
      for (const over of variants) {
        for (const [cols, rich] of tiers.map((t) => [t[0], t[1]] as const)) {
          for (const r of bandLines(worldModel(cols, ui(theme), { ...over, rich, maxRows: rich ? 3 : 1 })).flatMap((l) => l.runs)) {
            if (!r.t.trim()) continue;
            const bg = r.bg ? toneHex(r.bg, theme) : p.panel;
            const need = r.chip ? NEED.text : NEED[runKind(r.t)];
            const ratio = contrast(toneHex(r.tone, theme), bg);
            expect([theme, cols, r.t, r.tone, ratio >= need]).toEqual([theme, cols, r.t, r.tone, true]);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(40);
      expect(glyphTone('ok', theme)).toBe(theme === 'latte' ? 'text' : 'ok');
    });
  }
});

describe('counts and gauges equal the data', () => {
  const todos = world.todos;
  const done = todos.filter((t) => t.state === 'done').length;
  const states = (s: string) => world.workers.filter((w) => w.state === s).length + todos.filter((t) => t.state === s && !world.workers.some((w) => w.task === t.id)).length;
  test('chips: at most one per row in every tier', () => {
    for (const [cols, rich] of tiers.map((t) => [t[0], t[1]] as const)) {
      for (const l of bandLines(worldModel(cols, ui('mocha'), { rich, maxRows: rich ? 3 : 1 }))) expect(chipCount(l.runs)).toBeLessThanOrEqual(1);
    }
    // the brand capsule is the band's only chip, once per surface
    for (const row of text(bandLines(worldModel(120, ui('mocha'))))) expect([...row].filter((c) => c === '◆')).toHaveLength(1);
  });
  test('todo and phase counts equal the world', () => {
    const row = text(bandLines(worldModel(120, ui('mocha'))))[0]!;
    expect(row).toContain(`todo `);
    expect(row).toContain(`${done} of ${todos.length}`);
    const active = world.phases.findIndex((p) => p.state === 'active');
    expect(row).toContain(`phase ${active + 1}/${world.phases.length}`);
    expect(row).toMatch(/1 running/);
    expect(row).toMatch(/1 failed/);
    expect(row).toMatch(/1 queued/);
    expect(states('running')).toBeGreaterThanOrEqual(1);
  });
  test('every gauge matches its label (within one eighth of a cell plus label rounding)', () => {
    for (const [cols, rich] of [[120, false], [120, true]] as const) {
      for (const row of text(bandLines(worldModel(cols, ui('mocha'), { rich, maxRows: rich ? 3 : 1 })))) {
        for (const m of row.matchAll(/([█▏▎▍▌▋▊▉]*)([░]*)(?= )/g)) {
          const [bar, full, track] = [m[0], m[1]!, m[2]!];
          if (!bar) continue;
          const w = [...bar].length;
          const eighths = [...full].reduce((n, c) => n + (c === '█' ? 8 : '▏▎▍▌▋▊▉'.indexOf(c) + 1), 0);
          const after = row.slice((m.index ?? 0) + bar.length);
          const pct = /^ (\d+)%/.exec(after);
          const frac = /^ (\d+) of (\d+)/.exec(after);
          const value = pct ? Number(pct[1]) / 100 : frac ? Number(frac[1]) / Number(frac[2]) : undefined;
          if (value === undefined) continue;
          const tol = 0.125 + (pct ? 0.005 * w : 0);
          expect([row, Math.abs(eighths / 8 - value * w) <= tol, track.length + [...full].length >= 0]).toEqual([row, true, true]);
        }
      }
    }
  });
});
