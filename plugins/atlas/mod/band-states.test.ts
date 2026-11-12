// Slice A2: the band's four states (working, idle, done, needs-you) by glyph AND word, an elapsed clock, at 150 and 110 columns; and the rule that
// the band's own text never says something runs without a spinner glyph beside it (live-150 f0077-f0085: `3 explorers running`, no glyph).
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from './atlas-ui';
import { cells, sweepIndex, WORDMARK } from './atlas-ui';
import { reducedMotion } from './motion';
import { bandLines, runsText, type MissionModel, type MissionWorker } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SPIN = '[◐◓◑◒◐◓◑◒◐◓]';
const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const run = (n: number): MissionWorker[] => Array.from({ length: n }, (_, i) => ({ name: `e${i}-explorer`, state: 'running', secs: 4 }));
const model = (over: Partial<MissionModel> = {}): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 7, workers: [], checks: null, ui, ...over });
const head = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).trimEnd();

describe('A2: working', () => {
  for (const cols of [150, 110]) {
    test(`at ${cols} columns: spinner, the word working and the elapsed clock lead, in that order`, () => {
    const t = head(model({ cols, busy: true, turnSecs: 42 }));
    expect(t).toMatch(new RegExp(`ATLAS ◗ +${SPIN} working 0:42`));
    });
  }
  test('the spinner moves with the tick and the clock counts with turnSecs', () => {
    const frames = [0, 1, 2].map((tick) => head(model({ busy: true, tick, turnSecs: 5 + tick })));
    expect(new Set(frames).size).toBe(3);
    expect(frames[2]).toContain('working 0:07');
  });
  test('at 110 the lower segments go first; the word, spinner and clock stay whole at every width down to 60', () => {
    for (const cols of [110, 90, 73, 60]) {
      const row = bandLines(model({ cols, busy: true, turnSecs: 75, workers: run(2) }))[0]!.runs;
      const t = runsText(row).trimEnd();
      expect(cells(t)).toBeLessThanOrEqual(cols);
      expect(t).toMatch(new RegExp(`${SPIN} working 1:15`));
      expect(t).not.toMatch(/\b(working|runn|todo)\S*…/); // no word is cut
    }
  });
});

describe('A2: idle, done and needs-you', () => {
  test('idle reads `○ idle` and carries no spinner and no clock', () => {
    const t = head(model({ phase: 'research', done: 0, total: 0 }));
    expect(t).toContain('○ idle');
    expect(t).not.toMatch(new RegExp(SPIN));
    expect(t).not.toMatch(/\d:\d\d/);
  });
  test('done reads `● done n/m · clock`: the plan figure, then how long the run took', () => {
    const t = head(model({ phase: 'done', done: 7, total: 7, ranSecs: 70 }));
    expect(t).toContain('● done 7/7 · 1:10');
    expect(t).not.toMatch(new RegExp(SPIN));
  });
  for (const cols of [150, 110]) {
    test(`needs-you (blocked) at ${cols} columns keeps the mark, the word and the reason`, () => {
    const t = head(model({ cols, checks: [{ id: 'routing', ok: false, name: 'routing' }], stopGates: ['routing'] }));
    expect(t).toMatch(/▲ blocked/);
    expect(t).not.toMatch(new RegExp(SPIN + ' working'));
    });
  }
});

describe('A2: the band never says something runs without a spinner beside it', () => {
  // live-150 f0077-f0085 read `3 explorers running` with no glyph while the lead worked
  for (const cols of [150, 120, 110, 90, 73]) {
    test(`at ${cols} columns every N running has a spinner glyph before it`, () => {
    const t = head(model({ cols, workers: run(3), turnSecs: 12 }));
    expect(t).toMatch(/\b3 running\b/);
    expect(t).toMatch(new RegExp(`${SPIN} +working`));
    expect(t).toMatch(new RegExp(`${SPIN} 3 running`));
    });
  }
  test('a worker running with the host quiet still shows the working state', () => {
    expect(head(model({ workers: run(1) }))).toMatch(new RegExp(`${SPIN} working`));
  });
});

describe('A3: the wordmark sweep and the reduced-motion off switch', () => {
  const litLetter = (m: MissionModel): number => {
    const runs = bandLines(m)[0]!.runs;
    const at = runs.findIndex((x) => x.t === 'A');
    return [...WORDMARK].findIndex((_, i) => runs[at + i]!.bg === 'panel');
  };
  test('while working one letter of ATLAS is lit and the lit letter walks left to right, one step per 200 ms (two frames)', () => {
    const lit = [0, 2, 4, 6, 8].map((tick) => litLetter(model({ busy: true, tick })));
    expect(lit).toEqual([0, 1, 2, 3, 4]);
    expect(sweepIndex(10)).toBe(0); // and wraps
  });
  test('idle has no lit letter: the wordmark is still', () => {
    expect(litLetter(model({ phase: 'research', done: 0, total: 0 }))).toBe(-1);
  });
  test('still (reduced motion) freezes the sweep but keeps the spinner and the word', () => {
    const lit = [0, 2, 4].map((tick) => litLetter(model({ busy: true, tick, still: true })));
    expect(lit).toEqual([-1, -1, -1]);
    expect(head(model({ busy: true, tick: 2, still: true }))).toMatch(new RegExp(`${SPIN} working`));
  });
  test('ATLAS_REDUCED_MOTION and NO_COLOR switch motion off; an empty value does not', () => {
    expect(reducedMotion({ ATLAS_REDUCED_MOTION: '1' })).toBe(true);
    expect(reducedMotion({ NO_COLOR: '1' })).toBe(true);
    expect(reducedMotion({ ATLAS_REDUCED_MOTION: '0' })).toBe(false);
    expect(reducedMotion({})).toBe(false);
  });
});
