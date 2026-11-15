// Round 2 data and primitive rules (spec-r2 D3-D7): done holds at every width, gates report denials, one fixed-scale wall-clock event series, a semantic context gauge, run outcome dots.
import { describe, expect, test } from 'claude-code/testing';
import type { Run, Ui } from './atlas-ui';
import { dataInk } from './atlas-ui';
import { newKindHold, stepKind } from './band-motion';
import { bandSegments } from './band-segments';
import { eventBuckets, noteHook, resetHookLog } from './hook-log';
import { bandLines, runsText, runStateOf, type MissionModel } from './mission-layout';
import { healthCardRows } from './hud-surface';
import { fitFields, gateOf, healthDetail, healthRows, type Health } from './idle-health';
import { bodyLines, lineText } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { BUCKETS, rateLabel } from './pulse';
import { sparkOf } from './spark';
import { gatesTotal } from './vocab';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const text = (rs: readonly Run[]): string => rs.map((x) => x.t).join('');
const GLYPHS = /^[⣀⣄⣤⣦⣶⣷⣿]+$/;
/** The spark's cells of a row: the leading runs that are braille. */
const sparkText = (rs: readonly Run[]): string => text(rs.filter((x) => GLYPHS.test(x.t)));

describe('D3: a closed run is done at every width', () => {
  const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
  const model = (cols: number, over: Partial<MissionModel> = {}): MissionModel => ({ cols, maxRows: 1, tick: 0, project: 'p', phases: PHASES, phase: 'research', done: 0, total: 0, workers: [], checks: null, ui, ranSecs: 5, restSecs: 0, ...over });
  for (const cols of [150, 110]) {
    test(`no plan rows, ranSecs 5 at ${cols}: kind done and the head reads done 0:05`, () => {
      const m = model(cols);
      expect(runStateOf(m).kind).toBe('done');
      expect(runsText(bandLines(m)[0]!.runs)).toMatch(/done( ·)? 0:05/);
    });
  }
  test('working then the next step 1.0 s later still reads done', () => {
    const h = stepKind(newKindHold(), 'working', 0).hold;
    expect(stepKind(h, runStateOf(model(110)).kind, 1000).shown).toBe('done');
  });
  test('a run with no ranSecs is not done, and a rested one is idle', () => {
    expect(runStateOf(model(150, { ranSecs: undefined, restSecs: undefined })).kind).toBe('idle');
    expect(runStateOf(model(150, { restSecs: 600 })).kind).toBe('idle');
  });
});

describe('D4: gates report denials', () => {
  const chk = (id: string, lines: number, pass: number, extra: object = {}) => ({ id, ok: pass === lines, lines, pass, ...extra });
  const health = (checks: ReturnType<typeof chk>[], over: Partial<Health> = {}): Health => ({ gates: { total: checks.length, green: checks.filter((c) => c.ok).length, checks }, upSecs: 36, button: true, ...over });
  const okH = health([chk('routing', 8, 8), chk('tripwire', 3, 3), chk('header', 0, 0)]);
  const badH = health([chk('routing', 8, 8), chk('completion', 3, 1), chk('header', 0, 0)]);
  const seg = (h: Health): Run[] => bandSegments(h, ui).find((s) => s.id === 'gates')!.runs;

  test('band: ok is a green dot and `gates ok`; a gate that never fired changes nothing', () => {
    expect(text(seg(okH)).trimEnd()).toBe('● gates ok'); // round 2 D9: the slot is padded to a fixed width
    expect(seg(okH)[0]!.tone).toBe('ok');
  });
  test('band: denials read `✗ N denied` in the bad tone', () => {
    expect(text(seg(badH)).trimEnd()).toBe('✗ 2 denied');
    expect(seg(badH).filter((x) => x.t.trim() !== '').every((x) => x.tone === 'bad')).toBe(true);
  });
  test('row form: pass and deny counts; a gate that never fired is grey `not fired`', () => {
    const a = gateOf(chk('routing', 8, 8), ui);
    expect(a.text).toBe('● routing 8 pass · 0 deny');
    expect(a.tone).toBe('ok');
    const d = gateOf(chk('completion', 3, 1), ui);
    expect(d.text).toBe('● completion 1 pass · 2 deny');
    expect(d.tone).toBe('bad');
    const n = gateOf(chk('header', 0, 0), ui);
    expect(n.text).toBe('○ header not fired');
    expect(n.tone).toBe('sub');
  });
  test('totals exclude gates that never fired', () => {
    const t = gatesTotal([{ pass: 8, total: 8 }, { pass: 1, total: 3 }, { pass: 0, total: 0 }]);
    expect(t).toMatchObject({ pass: 9, total: 11, deny: 2, fired: 2, notFired: 1, tone: 'bad', text: '2 denied' });
    expect(gatesTotal([{ pass: 8, total: 8 }, { pass: 0, total: 0 }])).toMatchObject({ deny: 0, text: 'ok', tone: 'ok' });
  });
  test('the gates row summarises denials, not a ratio', () => {
    const row = healthRows(badH, ui).find((x) => x.id === 'gates')!;
    expect(text(row.runs)).toContain('2 denied');
    expect(text(row.runs)).toContain('3 gates');
    expect(text(row.runs)).toContain('1 not fired');
  });
  test('no n/m gate ratio in the band, the rows, the detail, the card or the panel', () => {
    const gateRatio = /(gates?|routing|tripwire|completion|header)[^\n]*\d+\/\d+/;
    const panel = bodyLines(panelWorld('route', 57, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: 0 }, health: badH, expanded: 'health:gates' } as never)).map(lineText);
    const all = [
      text(seg(okH)), text(seg(badH)),
      ...healthRows(badH, ui).map((x) => text(x.runs)),
      ...healthDetail(badH, 'gates'),
      ...healthCardRows(badH, { cols: 110, ui }).map(text),
      ...panel,
    ];
    for (const l of all) expect(l).not.toMatch(gateRatio);
    expect(panel.join('\n')).toMatch(/completion\s+1 pass · 2 deny/);
    expect(panel.join('\n')).toMatch(/header\s+not fired/);
  });
});

describe('D5: one wall-clock event series on a fixed scale', () => {
  test('buckets align to the wall clock: two now values in one 15 s window give the same series', () => {
    resetHookLog();
    noteHook('tool.call Bash', 46_000);
    noteHook('tool.call Read', 52_000);
    expect(eventBuckets(46_500)).toEqual(eventBuckets(59_900));
    expect(eventBuckets(59_900).at(-1)).toBe(2);
    expect(eventBuckets(60_000).at(-1)).toBe(0); // the next window opens at the edge
    expect(eventBuckets(60_000).at(-2)).toBe(2);
    expect(eventBuckets(46_500).length).toBe(BUCKETS);
  });
  test('one event is not full height; four fill the scale', () => {
    const one = sparkOf([0, 0, 0, 0, 0, 0, 0, 1], 8);
    expect(one.endsWith('⣿')).toBe(false);
    expect(one.at(-1)).not.toBe('⣀');
    expect(sparkOf([0, 0, 0, 0, 0, 0, 0, 4], 8).at(-1)).toBe('⣿');
    expect(sparkOf([0, 0, 0, 0, 0, 0, 0, 9, 3], 8).at(-1)).not.toBe('⣿');
  });
  test('band 8, panel 20 and card 28 cells are the last N of the same series', () => {
    const events = Array.from({ length: BUCKETS }, (_, i) => (i % 5 === 0 ? 1 : i % 7 === 0 ? 3 : 0));
    const h: Health = { gates: { total: 0, green: 0, checks: [] }, pulse: { events, ctx: [], runs: [] } };
    const band = sparkText(bandSegments(h, ui).find((s) => s.id === 'events')!.runs);
    const sparkOfRow = (w: number): string => sparkText(healthRows(h, ui, { sparkW: w }).find((x) => x.id === 'events')!.runs);
    const panel = sparkOfRow(20);
    const card = sparkOfRow(28);
    expect(band.length).toBe(8);
    expect(panel.length).toBe(20);
    expect(card.length).toBe(28);
    expect(panel.endsWith(band)).toBe(true);
    expect(card.endsWith(panel)).toBe(true);
  });
  test('the rate is labelled `N/5m` over the last 5 minutes', () => {
    expect(rateLabel(new Array(BUCKETS).fill(0).map((_, i) => (i === BUCKETS - 1 || i === BUCKETS - 3 ? 3 : 0)))).toBe('6/5m');
    expect(rateLabel([9, ...new Array(BUCKETS - 1).fill(0)])).toBe('0/5m'); // older than 5 minutes
  });
  test('data ink is a blue-grey ramp, not violet, with the peak one step brighter', () => {
    const ink = dataInk(ui);
    expect(ink.body).not.toBe('#af87ff');
    expect(ink.peak).not.toBe(ink.body);
    const h: Health = { gates: { total: 0, green: 0, checks: [] }, pulse: { events: [0, 0, 1, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ctx: [], runs: [] } };
    const runs = healthRows(h, ui, { sparkW: 28 }).find((x) => x.id === 'events')!.runs;
    const sparkRuns = runs.filter((x) => GLYPHS.test(x.t));
    expect(sparkRuns.some((x) => x.fg === ink.body)).toBe(true);
    expect(sparkRuns.filter((x) => x.fg === ink.peak).map((x) => x.t).join('')).toBe('⣿');
    expect(sparkRuns.every((x) => x.tone !== 'accent')).toBe(true);
  });
});

describe('D6: the context gauge is semantic', () => {
  const ctxRow = (pct: number | undefined, extra: Partial<Health> = {}): Run[] => healthRows({ gates: { total: 0, green: 0, checks: [] }, ...(pct !== undefined ? { ctxPct: pct } : {}), ...extra }, ui).find((x) => x.id === 'context')!.runs;
  const fill = (rs: Run[]): Run => rs.find((x) => /[█▎▍▌▋▊▉]/.test(x.t))!;
  test('data ink (not green) under 50, amber 50 to 80, red over 80', () => {
    expect(fill(ctxRow(6)).tone).toBe('sub');
    expect(fill(ctxRow(49)).tone).toBe('sub');
    expect(fill(ctxRow(50)).tone).toBe('warn');
    expect(fill(ctxRow(80)).tone).toBe('warn');
    expect(fill(ctxRow(81)).tone).toBe('bad');
  });
  test('the track is dark and the text is `6% · 64k of 1M`', () => {
    const rs = ctxRow(6, { tokens: 64_000, window: 1_000_000 });
    expect(text(rs)).toContain('6% · 64k of 1M');
    const track = rs.find((x) => x.t.includes('░'))!;
    expect(track.fg).toBeDefined();
    expect(track.tone).not.toBe('ok');
  });
  test('before the first measure: an empty track and an em dash, never `none yet`', () => {
    const rs = ctxRow(undefined);
    const t = text(rs);
    expect(t).toContain('—');
    expect(t).not.toContain('none yet');
    expect(t).not.toContain('█');
    expect(t).toContain('░');
  });
});

describe('D7: runs are outcome dots', () => {
  const h = (runs: { secs: number; ok: boolean; at: number }[], extra: Partial<Health> = {}): Health => ({ gates: { total: 0, green: 0, checks: [] }, pulse: { events: [], ctx: [], runs }, ...extra });
  const row = (x: Health): Run[] => fitFields(healthRows(x, ui).find((r) => r.id === 'runs')!.fields, 200);
  test('a dot per run, newest right, green ok and red fail, then the count, last run and age', () => {
    const rs = row(h([{ secs: 9, ok: false, at: 1 }, { secs: 5, ok: true, at: 2 }], { last: { secs: 5, done: 0, total: 0, agents: 0, failed: 0, endedAgo: 18 } }));
    const dots = rs.filter((x) => x.t === '●');
    expect(dots.map((x) => x.tone)).toEqual(['bad', 'ok']);
    expect(text(rs)).toContain('2 runs · last 0:05 · 18s ago');
  });
  test('one run reads `1 run`', () => {
    expect(text(row(h([{ secs: 65, ok: true, at: 1 }])))).toContain('1 run · last 1:05');
  });
  test('no spark glyph in the runs row', () => {
    expect(text(row(h([{ secs: 9, ok: true, at: 1 }, { secs: 5, ok: true, at: 2 }])))).not.toMatch(/[⣀⣄⣤⣦⣶⣷⣿]/);
  });
  test('before the first run: `○ no runs this session` in grey', () => {
    const rs = row(h([]));
    expect(text(rs)).toBe('○ no runs this session');
    expect(rs.every((x) => x.tone === 'muted' || x.tone === 'sub')).toBe(true);
  });
});
