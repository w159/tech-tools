// Round 3 chart and data primitives (E1 to E5, E10 spark form): the braille area chart with its frame, eighth-block spark, run bars, context history, ribbon header and gate dot rule.
import { describe, expect, test } from 'claude-code/testing';
import { runsCells } from './atlas-ui';
import { areaChart, areaChartRuns, blockSpark, blockSparkRuns, chartFrame, runBars, runsSummary } from './chart';
import { sectionRibbon } from '../view/hud/hud-surface';
import { activityStats, ctxDelta, ctxSeries, ctxText, type Pulse } from '../data/pulse';
import { ctxInk, ctxTone, gaugeRuns } from './spark';
import { checkOff, gateDot } from './vocab';
import { textWidth } from './theme';

const ui = { theme: 'mocha' as const, ascii: false, color: 'truecolor' as const };
const pulse = (ctx: Array<[number, number]>, extra: Partial<Pulse> = {}): Pulse => ({ events: [], runs: [], ctx: ctx.map(([tokens, pct], i) => ({ tokens, pct, at: i })), ...extra });
const isBraille = (ch: string): boolean => ch === ' ' || (ch >= '⠀' && ch <= '⣿');
const dots = (s: string): number => [...s].reduce((n, ch) => n + (ch >= '⠀' ? [...(ch.codePointAt(0)! - 0x2800).toString(2)].filter((b) => b === '1').length : 0), 0);

describe('areaChart', () => {
  test('rows x width cells, every char braille or space, max floors at 4', () => {
    const c = areaChart([0, 1, 2, 4, 3, 1, 0, 2], { width: 10, rows: 4 });
    expect(c.lines).toHaveLength(4);
    for (const l of c.lines) { expect([...l]).toHaveLength(10); expect([...l].every(isBraille)).toBe(true); }
    expect(c.max).toBe(4);
    expect(areaChart([9, 2], { width: 4, rows: 2 }).max).toBe(9);
    expect(areaChart([9, 2], { width: 4, rows: 2, max: 20 }).max).toBe(20);
  });
  test('a single event stays below full height; the series max reaches the top row', () => {
    const one = areaChart([0, 0, 1], { width: 4, rows: 4 });
    expect(one.lines.slice(0, 3).every((l) => l.trim() === '')).toBe(true);
    expect(one.lines[3]![3]).toBe('⢸');
    const full = areaChart([0, 0, 4], { width: 4, rows: 4 });
    expect(full.lines[0]![3]).not.toBe(' ');
  });
  test('the fill is monotone: a taller sample never draws fewer dots', () => {
    let prev = -1;
    for (const v of [0, 1, 2, 3, 4]) {
      const n = dots(areaChart([v], { width: 3, rows: 3, max: 4 }).lines.join(''));
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
  test('the newest sample is the right dot column of the last cell; a short series pads on the left', () => {
    const c = areaChart([4], { width: 3, rows: 1 });
    expect(c.lines[0]).toBe('⣀⣀⢸');
    const two = areaChart([4, 4], { width: 3, rows: 1 });
    expect(two.lines[0]).toBe('⣀⣀⣸'.replace('⣸', '⣿').slice(0, 2) + '⣿');
  });
  test('an empty series is a flat baseline on the bottom row only', () => {
    expect(areaChart([], { width: 5, rows: 3 }).lines).toEqual(['     ', '     ', '⣀⣀⣀⣀⣀']);
  });
  test('ascii: `.:|#` fill, `_` baseline', () => {
    const l = areaChart([0, 4, 4], { width: 2, rows: 1, ascii: true }).lines[0]!;
    expect(l).toBe('_#');
    expect(/^[ _.:|#]+$/.test(areaChart([1, 2, 3, 4], { width: 4, rows: 3, ascii: true }).lines.join(''))).toBe(true);
  });
  test('runs: body ink, newest column peak ink, baseline dim', () => {
    const r = areaChartRuns([0, 0, 2, 2, 4, 4], { width: 4, rows: 1 }, ui);
    expect(r.rows[0]!.map((x) => x.t).join('')).toBe(areaChart([0, 0, 2, 2, 4, 4], { width: 4, rows: 1 }).lines[0]);
    expect(r.rows[0]!.at(-1)!.fg).toBe('#87afd7');
    expect(r.rows[0]![0]!.tone).toBe('dim');
    expect(r.rows[0]!.some((x) => x.fg === '#5f87af')).toBe(true);
  });
});

describe('chartFrame', () => {
  const chart = areaChart([1, 2, 4], { width: 12, rows: 3 });
  const f = chartFrame(chart, { yMax: '4', xLeft: '-7m', xRight: 'now', width: 20 });
  test('y max on the first row, 0 on the last, rows exactly width cells', () => {
    expect(f).toHaveLength(4);
    expect(f[0]!.startsWith('4 ')).toBe(true);
    expect(f[2]!.startsWith('0 ')).toBe(true);
    expect(f[1]!.startsWith('  ')).toBe(true);
    for (const l of f) expect(textWidth(l)).toBe(20);
    expect(f[0]!.slice(2, 14)).toBe(chart.lines[0]);
  });
  test('x-axis labels: -7m under the first chart cell, now ending on the last', () => {
    expect(f[3]!.slice(2, 5)).toBe('-7m');
    expect(f[3]!.slice(2, 14).endsWith('now')).toBe(true);
    expect(f[3]!.trimEnd().length).toBe(14);
  });
  test('a wide y label widens the label column; labels that collide drop the left one', () => {
    const w = chartFrame(chart, { yMax: '120', xLeft: '-7m', xRight: 'now', width: 20 });
    expect(w[0]!.startsWith('120 ')).toBe(true);
    expect(w[2]!.startsWith('  0 ')).toBe(true);
    const tight = chartFrame(areaChart([1], { width: 6, rows: 1 }), { yMax: '4', xLeft: '-7m', xRight: 'now', width: 8 });
    expect(tight[1]!.includes('-7m')).toBe(false);
    expect(tight[1]!.includes('now')).toBe(true);
  });
});

describe('blockSpark', () => {
  test('zero is the dim ▁ baseline, the peak is █, scale floors at 4', () => {
    expect(blockSpark([0, 4], 3)).toBe('▁▁█');
    expect(blockSpark([], 4)).toBe('▁▁▁▁');
    expect(blockSpark([1], 1)).not.toBe('▁');
    expect(blockSpark([2, 8], 2)).toBe('▃█');
    expect(textWidth(blockSpark([1, 2, 3], 8))).toBe(8);
    expect(blockSpark([5, 6, 7, 8], 2)).toHaveLength(2);
  });
  test('ascii uses eight plain levels', () => {
    expect(blockSpark([0, 4], 2, { ascii: true })).toBe('_#');
  });
  test('runs: baseline dim, body ink, the highest cell the peak ink', () => {
    const r = blockSparkRuns([0, 2, 4, 2], 5, ui);
    expect(r.map((x) => x.t).join('')).toBe(blockSpark([0, 2, 4, 2], 5));
    expect(r[0]!.tone).toBe('dim');
    expect(r.find((x) => x.fg === '#87afd7')!.t).toBe('█');
  });
});

describe('runBars and runsSummary', () => {
  const runs = [{ secs: 5, ok: true }, { secs: 10, ok: false }, { secs: 4, ok: true }];
  test('one cell per run, newest right, scaled to the longest, green ok and red fail', () => {
    const r = runBars(runs, 6);
    expect(r.map((x) => x.t).join('')).toBe('▁▁▁▅█▄');
    expect(runsCells(r)).toBe(6);
    expect(r[0]).toEqual({ t: '▁▁▁', tone: 'dim' });
    expect(r.slice(1).map((x) => [x.t, x.tone])).toEqual([['▅', 'ok'], ['█', 'bad'], ['▄', 'ok']]);
  });
  test('more runs than cells keeps the newest; no runs is an all-dim track', () => {
    expect(runBars(runs, 2).map((x) => x.t).join('')).toBe('█▄');
    expect(runBars([], 4)).toEqual([{ t: '▁▁▁▁', tone: 'dim' }]);
  });
  test('summary forms', () => {
    expect(runsSummary([{ secs: 5, ok: true }, { secs: 9, ok: false }])).toBe('2 runs · avg 0:07 · 1 fail');
    expect(runsSummary([{ secs: 65, ok: true }])).toBe('1 run · avg 1:05');
    expect(runsSummary([])).toBe('no runs yet');
  });
});

describe('context history', () => {
  test('ctxSeries is the percent of every measure', () => {
    expect(ctxSeries(pulse([[10000, 1], [64000, 6]]))).toEqual([1, 6]);
  });
  test('ctxDelta needs two measures and rounds the token change to k', () => {
    expect(ctxDelta(pulse([]))).toBeUndefined();
    expect(ctxDelta(pulse([[64000, 6]]))).toBeUndefined();
    expect(ctxDelta(pulse([[52000, 5], [64000, 6]]))).toBe('+12k/turn');
    expect(ctxDelta(pulse([[64000, 6], [60400, 6]]))).toBe('-4k/turn');
  });
  test('ctxText: `6% · 64k of 1M · +12k/turn`, the delta only from two measures', () => {
    expect(ctxText(pulse([[52000, 5], [64000, 6]], { window: 1_000_000 }))).toBe('6% · 64k of 1M · +12k/turn');
    expect(ctxText(pulse([[64000, 6]], { window: 1_000_000 }))).toBe('6% · 64k of 1M');
    expect(ctxText(pulse([]))).toBeUndefined();
  });
  test('tone: data ink under 50, amber 50 to 80, red over 80; never green', () => {
    expect([6, 55, 85].map(ctxTone)).toEqual(['sub', 'warn', 'bad']);
    expect(ctxInk(6, ui)).toEqual({ tone: 'sub', fg: '#5f87af' });
    expect(ctxInk(55, ui)).toEqual({ tone: 'warn' });
    expect(ctxInk(85, ui)).toEqual({ tone: 'bad' });
  });
  test('the gauge has track cells only: no bracket glyphs, exactly the width, fill in the data ink at 6%', () => {
    const g = gaugeRuns(6, 10, ui);
    const text = g.map((x) => x.t).join('');
    expect(/[▕▏[\]]/.test(text)).toBe(false);
    expect(textWidth(text)).toBe(10);
    expect(g[0]!.fg).toBe('#5f87af');
    expect(g[0]!.tone).toBe('sub');
    expect(gaugeRuns(85, 10, ui)[0]!.tone).toBe('bad');
    expect(gaugeRuns(undefined, 6, { ...ui, ascii: true }).map((x) => x.t).join('')).toBe('......');
  });
});

describe('activityStats', () => {
  test('events, per-minute rate over the window the series covers, peak, tools', () => {
    const events = [...new Array(24).fill(0), 1, 4, 0, 1];
    expect(activityStats({ events }, 3)).toBe('6 events · 6.0/min · peak 4 · 3 tools');
    expect(activityStats({ events: new Array(28).fill(0) }, 0)).toBe('0 events · 0.0/min · peak 0 · 0 tools');
    expect(activityStats({ events: [...new Array(27).fill(0), 1] }, 1)).toBe('1 event · 1.0/min · peak 1 · 1 tool');
  });
});

describe('sectionRibbon', () => {
  test('exactly width cells at 40, 60 and 96: title bright, rule and figure dim', () => {
    for (const w of [40, 60, 96]) {
      const r = sectionRibbon('ACTIVITY', '6 in 5m', w, ui);
      expect(runsCells(r)).toBe(w);
      const text = r.map((x) => x.t).join('');
      expect(text.startsWith('── ACTIVITY ─')).toBe(true);
      expect(text.endsWith(' 6 in 5m ──')).toBe(true);
      expect(r[1]!.tone).toBe('text');
      expect(r[1]!.bold).toBe(true);
      expect(r[0]!.tone).toBe('dim');
      expect(r[2]!.tone).toBe('dim');
    }
  });
  test('no figure is a plain rule; a figure that does not fit drops; ascii uses dashes', () => {
    const none = sectionRibbon('GATES', '', 30, ui).map((x) => x.t).join('');
    expect(none).toBe('── GATES ' + '─'.repeat(21));
    expect(runsCells(sectionRibbon('RECENT', 'a very long figure here', 20, ui))).toBe(20);
    expect(sectionRibbon('RUNS', '2 runs', 24, { ...ui, ascii: true }).map((x) => x.t).join('')).toBe('-- RUNS ------ 2 runs --');
    expect(runsCells(sectionRibbon('X', 'y', 3, ui))).toBe(3);
  });
});

describe('gate dot tone rule', () => {
  test('green only when pass > 0 and deny = 0; red on any deny; grey hollow for not fired and for off checks', () => {
    expect(gateDot(3, 0)).toEqual({ glyph: '●', tone: 'ok' });
    expect(gateDot(3, 1)).toEqual({ glyph: '●', tone: 'bad' });
    expect(gateDot(0, 2)).toEqual({ glyph: '●', tone: 'bad' });
    expect(gateDot(0, 0)).toEqual({ glyph: '○', tone: 'sub' });
    expect(gateDot(1, 0, { off: true })).toEqual({ glyph: '○', tone: 'sub' });
    expect(gateDot(0, 0, {}, true)).toEqual({ glyph: 'o', tone: 'sub' });
    expect(gateDot(1, 0, {}, true)).toEqual({ glyph: '*', tone: 'ok' });
  });
  test('checkOff reads team mode off from the label or note', () => {
    expect(checkOff('Team mode', 'off')).toBe(true);
    expect(checkOff('Team mode: off')).toBe(true);
    expect(checkOff('Team mode', 'on')).toBe(false);
    expect(checkOff('completion')).toBe(false);
  });
});
