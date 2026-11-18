import { describe, expect, test } from 'claude-code/testing';
import { bandMotionItems, type MissionModel, type MissionWorker } from '../view/band/mission-layout';
import { countWords } from '../view/panel/panel-layout';
import { stateCounts } from '../view/hud/hud-surface';
import type { UiState } from '../atlas-ui';
import { phaseFigure, tallyParts, tallyStateOf, workerTally } from './tally';

const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;
const mission = (workers: MissionWorker[]): MissionModel => ({ cols: 150, maxRows: 4, tick: 0, project: 'p', phases: ['research', 'plan', 'build', 'verify', 'done'], phase: 'build', done: 0, total: 0, workers, checks: null, ui });
const w = (name: string, state: string): MissionWorker => ({ name, state: state as MissionWorker['state'], secs: 1 });

// One snapshot, fed to the band, the panel and the HUD. `thinking` is a running worker: the band always folded it in, the panel did not.
const SNAP = [w('a', 'running'), w('b', 'thinking'), w('c', 'done'), w('d', 'failed'), w('e', 'waiting')];

const bandCounts = (ws: MissionWorker[]): Record<string, number> => Object.fromEntries(bandMotionItems(mission(ws)).filter((i) => i.key.startsWith('count:')).map((i) => [i.key.slice(6), Number(i.state)]));
const panelCounts = (ws: MissionWorker[]): Record<string, number> => {
  const text = countWords(ws.map((x) => ({ name: x.name, state: x.state as UiState, detail: '' })), ui);
  return Object.fromEntries([...text.matchAll(/(\d+) (\w+)/g)].map((m) => [m[2]!, Number(m[1])]));
};
const hudCounts = (ws: MissionWorker[]): Record<string, number> => Object.fromEntries(stateCounts(ws.map((x) => tallyStateOf(x.state as UiState))).split(' · ').filter(Boolean).map((p) => { const [n, s] = p.split(' '); return [s!, Number(n)]; }));

describe('one worker tally for band, panel and HUD', () => {
  test('the same snapshot gives the same running count on all three surfaces (thinking counts as running)', () => {
    expect(bandCounts(SNAP).running).toBe(2);
    expect(hudCounts(SNAP).running).toBe(2);
    expect(panelCounts(SNAP).running).toBe(2);
  });
  test('and the same done, failed and waiting counts', () => {
    const b = bandCounts(SNAP);
    const h = hudCounts(SNAP);
    expect([b.done, b.failed, b.waiting]).toEqual([1, 1, 1]);
    expect([h.done, h.failed, h.waiting]).toEqual([1, 1, 1]);
    // the panel words a failed worker its own way (`killed`): compare by the numbers it prints
    expect(Object.values(panelCounts(SNAP)).sort()).toEqual([1, 1, 1, 2]);
  });
  test('workerTally is the one function: thinking folds into running', () => {
    expect(workerTally([{ state: 'thinking' }, { state: 'running' }, { state: 'done' }])).toEqual({ running: 2, blocked: 0, failed: 0, waiting: 0, queued: 0, done: 1 });
  });
  test('tallyParts lists non-zero states in the given order, keeping the named zero', () => {
    const t = workerTally([{ state: 'done' }, { state: 'failed' }]);
    expect(tallyParts(t, ['running', 'failed', 'done'])).toEqual([['failed', 1], ['done', 1]]);
    expect(tallyParts(t, ['running', 'failed', 'done'], 'running')).toEqual([['running', 0], ['failed', 1], ['done', 1]]);
  });
  test('phaseFigure: the first for no phase, the last once the run is past the rail', () => {
    expect(phaseFigure(5, -1)).toBe('1/5');
    expect(phaseFigure(5, 2)).toBe('3/5');
    expect(phaseFigure(5, 5)).toBe('5/5');
  });
});
