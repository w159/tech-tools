// mission-layout.ts, pinned at the exact boundaries the mutation run (round 2, seed 1105) found unguarded: which runs are bold,
// failure counts while running or idle, the lit phase of an unknown phase, the thinking mark, the name column, the footer's
// key flag, the "+N more" slot rule, attention order, the board slot and the one-row threshold.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from './atlas-ui';
import { spinnerGlyph } from './atlas-ui';
import { bandLines, missionLines, planRows, runsText, type MissionModel, type MissionWorker, type WorkerState } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['plan', 'build', 'verify'] as const;
const model = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: PHASES, phase: 'build', done: 1, total: 3, workers: [], checks: null, ui, ...over,
});
const w = (name: string, state: WorkerState, over: Partial<MissionWorker> = {}): MissionWorker => ({ name, state, secs: 5, ...over });
const rows = (m: MissionModel): string[] => missionLines(m).map((l) => runsText(l.runs));
const band = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs);

describe('mission-layout: bold is opt-in', () => {
  test('the muted `todo ` label is not bold; the phase name is', () => {
    const runs = bandLines(model({ workers: [w('a', 'running')] }))[0]!.runs;
    const label = runs.find((x) => x.t === 'todo ')!;
    expect(label.bold).toBeUndefined();
    expect(runs.find((x) => x.t === 'build')!.bold).toBe(true);
    expect(runs.filter((x) => x.bold).length).toBeLessThan(runs.length / 2);
  });
});

describe('mission-layout: critique 9, the contract row outlasts the last-run row when rows are tight (the 110 band)', () => {
  const core = [{ t: ' contract  4 of 4 headers', tone: 'text' as const }];
  const idle = (maxRows: number, cols = 110) => rows(model({ cols, maxRows, phase: 'done', done: 3, total: 3, core, lastRun: { workers: 3, secs: 19, failed: 0 }, checks: [{ id: 'completion', ok: true }], keysWidth: 40 }));
  test('4 rows: band, contract, checks and keys; the last run gives way', () => {
    const r4 = idle(4);
    expect(r4).toHaveLength(4);
    expect(r4.some((x) => x.includes('contract'))).toBe(true);
    expect(r4.some((x) => x.includes('last run'))).toBe(false);
  });
  test('5 rows: everything shows, last run above contract', () => {
    const r5 = idle(5);
    expect(r5.findIndex((x) => x.includes('last run'))).toBeGreaterThan(-1);
    expect(r5.findIndex((x) => x.includes('last run'))).toBeLessThan(r5.findIndex((x) => x.includes('contract')));
  });
  test('no gauge track in the 110 band', () => {
    expect(idle(4)[0]).not.toContain('░');
  });
});

describe('mission-layout: A3 the count order is the shared COUNT_ORDER', () => {
  test('running, failed, waiting, queued: waiting reads before queued on every form', () => {
    const ws = [w('q', 'queued'), w('wt', 'waiting'), w('f', 'failed'), w('r', 'running')];
    const full = band(model({ workers: ws }));
    expect(full.indexOf('running')).toBeLessThan(full.indexOf('failed'));
    expect(full.indexOf('failed')).toBeLessThan(full.indexOf('waiting'));
    expect(full.indexOf('waiting')).toBeLessThan(full.indexOf('queued'));
  });
});

describe('mission-layout: the header never reads idle or all ok beside a failing check, and BLOCKED only follows a refused Stop', () => {
  const bad = [{ id: 'completion', ok: true }, { id: 'routing', ok: false }];
  const lastRun = { workers: 4, secs: 70, failed: 0 };
  const all = (m: MissionModel): string => missionLines(m).map((l) => runsText(l.runs)).join('\n');
  test('idle with a failing check reads a warning, never BLOCKED, in every width form', () => {
    for (const cols of [160, 120, 100, 80, 60, 40]) {
      const b = band(model({ cols, checks: bad, phase: 'verify', done: 3 }));
      expect(b).not.toContain('idle');
      expect(b).not.toContain('blocked');
      expect(b).toContain('routing warning');
    }
    expect(band(model({ checks: [{ id: 'a', ok: false }, { id: 'b', ok: false }] }))).toContain('2 gates warning');
    expect(band(model({ checks: [{ id: 'routing', ok: true }] }))).toContain('idle');
    expect(band(model({ checks: null }))).toContain('idle');
  });
  test('the rich band says warning too', () => {
    const b = runsText(bandLines(model({ cols: 160, rich: true, checks: bad }))[0]!.runs);
    expect(b).not.toContain('idle');
    expect(b).not.toContain('blocked');
    expect(b).toContain('routing warning');
  });
  test('a refused Stop reads BLOCKED with the refusing gate named, in every width form and the rich band', () => {
    for (const cols of [160, 120, 100, 80, 60, 40]) {
      const b = band(model({ cols, checks: bad, stopGates: ['team gate'], phase: 'verify', done: 3 }));
      expect(b).toContain('blocked');
      expect(b).not.toContain('warning');
      if (cols >= 60) expect(b).toContain('team gate');
    }
    expect(band(model({ checks: null, stopGates: ['a', 'b'] }))).toContain('a, b');
    const rich = runsText(bandLines(model({ cols: 160, rich: true, checks: bad, stopGates: ['team gate'] }))[0]!.runs);
    expect(rich).toContain('blocked: team gate');
  });
  test('no Stop block and no declaration: a passing or failing check alone is never BLOCKED', () => {
    expect(band(model({ checks: bad, workers: [w('a', 'running')] }))).not.toContain('blocked');
    expect(band(model({ checks: null, stopGates: [] }))).not.toContain('blocked');
  });
  test('a declared block still reads BLOCKED: needs you', () => {
    expect(band(model({ blocked: true }))).toContain('blocked: needs you');
  });
  test('last run does not say all ok while a check fails; it does when none fails', () => {
    expect(all(model({ checks: bad, lastRun }))).not.toContain('all ok');
    expect(all(model({ checks: bad, lastRun }))).toContain('last run');
    expect(all(model({ checks: [{ id: 'routing', ok: true }], lastRun }))).toContain('all ok');
    expect(all(model({ checks: bad, lastRun: { ...lastRun, failed: 1 } }))).toContain('1 failed');
  });
});

describe('mission-layout: failure count on the band', () => {
  test('while a worker runs, the last wave\'s failures are not counted; with nothing listed failed there is no failed count', () => {
    expect(band(model({ workers: [w('a', 'running')], lastRun: { workers: 2, failed: 3 } }))).not.toContain('failed');
    expect(band(model({ workers: [w('a', 'running')] }))).not.toContain('failed');
  });
  test('idle with no last wave shows no failure; idle with a last wave of 2 failures counts them', () => {
    expect(band(model())).not.toContain('failed');
    expect(band(model({ lastRun: { workers: 2, failed: 2 } }))).toContain('2 failed');
    expect(band(model({ workers: [w('a', 'failed')], lastRun: { workers: 1, failed: 0 } }))).toContain('1 failed');
  });
  test('a finished-only worker list is idle', () => {
    expect(band(model({ workers: [w('a', 'done'), w('b', 'failed')] }))).toContain('idle');
    expect(band(model({ workers: [w('a', 'done'), w('b', 'queued')] }))).not.toContain('idle');
  });
});

describe('mission-layout: the lit phase', () => {
  test('a plan count replaces the phase position: `phase 1/5 · todo 4/5` can not appear', () => {
    for (const cols of [160, 120, 100, 80, 60]) {
      const b = band(model({ cols, phase: 'research', done: 4, total: 5, workers: [w('a', 'running')] }));
      expect(b).not.toMatch(/\bph(ase)? \d\/\d/);
      expect(b).toContain('4');
    }
  });
  test('the first phase is 1/3; a phase off the rail still lights the first, never the second', () => {
    expect(band(model({ phase: 'plan', total: 0 }))).toContain('phase 1/3');
    expect(band(model({ phase: 'blocked', total: 0 }))).not.toContain('phase 2/3');
    expect(band(model({ phase: 'nonsense', total: 0, workers: [w('a', 'running')] }))).toContain('phase 1/3');
    expect(band(model({ phase: 'verify', total: 0 }))).toContain('phase 3/3');
    expect(band(model({ phase: 'done', total: 0 }))).toContain('phase 3/3');
  });
});

describe('mission-layout: worker rows', () => {
  const running = (ws: MissionWorker[], over: Partial<MissionModel> = {}) => model({ cols: 100, workers: ws, ...over });

  test('a thinking worker draws the muted spinner frame, not a blank', () => {
    const m = running([w('thinker', 'thinking', { tool: 'Read' })], { tick: 2 });
    const line = missionLines(m).find((l) => runsText(l.runs).includes('thinker'))!;
    expect(line.runs[1]).toMatchObject({ t: spinnerGlyph(2), tone: 'muted' });
    expect(runsText(line.runs)).toContain('thinking');
  });
  test('the name column is the longest name (at least 8) plus two cells: the activity starts at a fixed cell', () => {
    const m = running([w('abc', 'running', { tool: 'Grep' })], { cols: 80 });
    const line = rows(m).find((r) => r.includes('abc'))!;
    expect(line.indexOf('Grep')).toBe(3 + 10); // ` ` mark ` ` then the name padded to 9 and a space
    const long = running([w('a-very-long-worker-name-indeed', 'running', { tool: 'Grep' })], { cols: 80 });
    expect(rows(long).find((r) => r.includes('a-very-long'))!.indexOf('Grep')).toBe(3 + 20); // the name clips at the 18 cell cap, so the field is 18 + 2
  });
  test('the role column joins at 100 columns, not before', () => {
    const at = (cols: number) => rows(running([w('abc', 'running', { role: 'implementer', tool: 'Grep' })], { cols })).find((r) => r.includes('abc'))!;
    expect(at(100)).toContain('implementer');
    expect(at(99)).not.toContain('implementer');
  });
  test('attention first: failed, waiting, running, thinking, queued, finished; stable inside a state', () => {
    const ws = [w('done1', 'done'), w('queued1', 'queued'), w('think1', 'thinking'), w('run1', 'running'), w('run2', 'running'), w('wait1', 'waiting'), w('fail1', 'failed')];
    const order = rows(running(ws, { maxRows: 20 })).map((r) => /(done1|queued1|think1|run1|run2|wait1|fail1)/.exec(r)?.[1]).filter(Boolean);
    expect(order).toEqual(['fail1', 'wait1', 'run1', 'run2', 'think1', 'queued1', 'done1']);
  });
  test('a waiting worker outranks a running one even when it comes later', () => {
    const order = rows(running([w('run1', 'running'), w('wait1', 'waiting')])).map((r) => /(run1|wait1)/.exec(r)?.[1]).filter(Boolean);
    expect(order).toEqual(['wait1', 'run1']);
  });
});

describe('mission-layout: the footer', () => {
  const checks = [{ id: 'completion', ok: true }, { id: 'tripwire', ok: false }];
  test('no checks and no keys draws no footer row at all', () => {
    for (const cs of [null, []] as const) {
      const ls = missionLines(model({ checks: cs, workers: [w('a', 'running')] }));
      expect(ls.some((l) => runsText(l.runs).includes('checks'))).toBe(false);
      expect(ls.every((l) => l.keys === undefined || l.keys === false)).toBe(true);
    }
  });
  test('the footer is flagged `keys` only when the band reserves key cells for it', () => {
    const foot = (keysWidth?: number) => missionLines(model({ checks, keysWidth })).find((l) => l.keys !== undefined)!;
    expect(foot(40).keys).toBe(true);
    expect(foot(0)?.keys ?? false).toBe(false);
    expect(foot(undefined)?.keys ?? false).toBe(false);
  });
  test('keys alone (no checks) still make a footer row', () => {
    const ls = missionLines(model({ checks: null, keysWidth: 40 }));
    expect(ls.some((l) => l.keys === true)).toBe(true);
  });
});

describe('mission-layout: the row budget', () => {
  test('C3: planRows keeps two footer rows when they fit, one (the key row) when they do not, none under the worker', () => {
    expect(planRows(6, 1, false, 2)).toMatchObject({ lanes: 1, footer: true, footerRows: 2 });
    expect(planRows(5, 1, false, 2)).toMatchObject({ lanes: 1, footer: true, footerRows: 2 });
    expect(planRows(4, 1, false, 2)).toMatchObject({ lanes: 1, footerRows: 1 });
    expect(planRows(3, 1, false, 2)).toMatchObject({ lanes: 1, footerRows: 0, footer: false });
    expect(planRows(4, 1, false, true)).toMatchObject({ footerRows: 1 });
  });
  test('planRows: two slots with more workers than slots shows one lane and the "+N more" row', () => {
    expect(planRows(4, 5, false, false)).toMatchObject({ lanes: 1, more: true, ticker: false, footer: false });
    expect(planRows(3, 5, false, false)).toMatchObject({ lanes: 1, more: false }); // one slot: no room for a "+N more" row
    expect(planRows(5, 5, false, false)).toMatchObject({ lanes: 2, more: true });
  });
  test('three rows while running is already more than the band alone', () => {
    const m = model({ cols: 100, maxRows: 3, workers: [w('a', 'running', { tool: 'Grep' }), w('b', 'running', { tool: 'Read' })] });
    expect(missionLines(m).length).toBeGreaterThan(1);
    expect(missionLines({ ...m, maxRows: 2 })).toHaveLength(1);
  });
  test('an expanded board that leaves under four rows below the band takes no slot', () => {
    const m = model({ cols: 100, maxRows: 3, boardRows: 5, workers: [w('a', 'running', { tool: 'Grep' })] });
    expect(missionLines(m).some((l) => l.board !== undefined)).toBe(false);
    const tall = model({ cols: 100, maxRows: 12, boardRows: 5, workers: [w('a', 'running', { tool: 'Grep' })] });
    expect(missionLines(tall).find((l) => l.board !== undefined)?.board).toBe(5);
  });
  test('80 columns is the first width that shows more than the band', () => {
    const m = model({ cols: 80, workers: [w('a', 'running', { tool: 'Grep' })] });
    expect(missionLines(m).length).toBeGreaterThan(1);
    expect(missionLines({ ...m, cols: 79 })).toHaveLength(1);
  });
});
