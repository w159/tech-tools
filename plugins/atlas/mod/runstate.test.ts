// One run-state model: the band, the checks row and the side panel's gates count read the same derived values.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from './atlas-ui';
import { textWidth } from './theme';
import { gateTally, blockReasons, ranWorkers } from './data/runstate';
import { endedOf, settleDispatch } from './data/todos';
import { bandLines, runsText, missionLines, type MissionModel } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['plan', 'research', 'build', 'verify', 'ship'] as const;
const model = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: PHASES, phase: 'done', done: 5, total: 5, workers: [], checks: null, ui, ...over,
});
const line = (ok: boolean, id = 'x') => ({ id, label: id, ok });
const groups = [
  { id: 'header', title: 'Header', lines: [line(true)] },
  { id: 'completion', title: 'C', lines: [line(true)] },
  { id: 'tripwire', title: 'T', lines: [line(false)] },
  { id: 'routing', title: 'R', lines: [line(true)] },
  { id: 'empty', title: 'E', lines: [] },
] as never;

describe('runstate: gates and checks are one count', () => {
  test('gateTally counts every group with data, the header included', () => {
    const t = gateTally(groups);
    expect(t.total).toBe(4);
    expect(t.green).toBe(3);
    expect(t.failing).toEqual(['tripwire']);
    expect(t.checks.map((c) => c.id)).toEqual(['header', 'completion', 'tripwire', 'routing']);
  });
  test('the checks row total equals the tally total', () => {
    const t = gateTally(groups);
    const row = runsText(missionLines(model({ checks: t.checks, cols: 120, workers: [] })).map((l) => l.runs).flat());
    expect(row).toContain('tripwire');
    for (const id of ['header', 'completion', 'tripwire', 'routing']) expect(row).toContain(id);
    expect(missionLines(model({ checks: t.checks.slice(0, 1), cols: 80 })).length).toBeGreaterThan(0);
  });
});

describe('runstate: blocked shows glyph, word and reason at every width', () => {
  const checks = [{ id: 'routing', ok: true }, { id: 'tripwire', ok: false }];
  for (const cols of [40, 60, 80, 120]) {
    test(`${cols} cells`, () => {
      const t = runsText(bandLines(model({ cols, checks }))[0]!.runs);
      expect(t).toContain('▲ BLOCKED');
      expect(textWidth(t)).toBeLessThanOrEqual(cols);
      if (cols >= 60) expect(t).toContain('tripwire');
    });
  }
  test('declared blocked says needs you', () => {
    expect(runsText(bandLines(model({ blocked: true, phase: 'blocked' }))[0]!.runs)).toContain('▲ BLOCKED · needs you');
  });
  test('blockReasons', () => {
    expect(blockReasons(false, ['tripwire']).long).toBe('tripwire failing');
    expect(blockReasons(false, ['a', 'b']).long).toBe('2 checks failing');
    expect(blockReasons(true, ['a']).long).toBe('needs you');
  });
});

describe('runstate: one vocabulary at every width', () => {
  const m = (cols: number) => model({ cols, phase: 'build', done: 3, total: 7, workers: [{ name: 'a', state: 'running', secs: 1 }, { name: 'f', state: 'failed', secs: 1 }] });
  for (const cols of [60, 80, 120]) {
    test(`${cols} cells use the long word`, () => {
      const t = runsText(bandLines(m(cols))[0]!.runs);
      expect(t).toContain('phase 3/5');
      expect(t).not.toMatch(/\bph \d/);
    });
  }
  test('abbreviates only when the long word does not fit', () => {
    const t = runsText(bandLines(m(48))[0]!.runs);
    expect(t.includes('ph 3/5') || !t.includes('phase')).toBe(true);
  });
});

describe('runstate: last run counts real dispatches', () => {
  test('dispatch rows that ran count even when the host no longer lists them', () => {
    expect(ranWorkers(['gamma'], ['alpha', 'beta', 'gamma', 'delta']).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });
});

describe('runstate: dispatch rows close from agent completion (S1)', () => {
  test('a reported agent absent from the squad settles its row', () => {
    const ended = endedOf([], { stage: { a1: 'reported' }, meta: { a1: { name: 'alpha' } }, activity: { a1: { mood: 'done' } } } as never);
    expect(ended).toEqual({ alpha: 'done' });
    const rows = settleDispatch([{ status: 'pending', owner: 'alpha', origin: 'dispatch' }], ended);
    expect(rows[0]!.status).toBe('completed');
  });
});
