// C5: the channel, team and core tabs use the pane height (as gates does): a body with more to show than the pane holds fills the
// pane and never runs past it, at 30 and 40 rows, on both hosts (they share panelLines).
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import { coreModel } from './data/core';
import { panelLines, type PanelTab } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core0 = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const core = {
  ...core0,
  verdicts: Array.from({ length: 20 }, (_, i) => ({ ...core0.verdicts[i % core0.verdicts.length]!, id: `finding-${i}`, at: i })),
  offload: { ...core0.offload, workers: Array.from({ length: 12 }, (_, i) => ({ ...core0.offload.workers[0]!, name: `worker-${i}` })) },
  routes: Array.from({ length: 9 }, (_, i) => ({ ...core0.routes[0]!, teamId: `t${i}` })),
};
const base = panelWorld('route', 37, ui);
const workers = Array.from({ length: 14 }, (_, i) => ({ ...base.workers[0]!, name: `agent-${i}`, state: 'done' as const }));
const notes = Array.from({ length: 40 }, (_, i) => ({ at: `10:${i}`, from: `agent-${i % 5}`, text: `message number ${i} with a long body that needs wrapping across rows` }));

describe('C5: the tab bodies use the pane height', () => {
  // Wave 24: the team tab is one row per agent at every height (the detail rows open on a press), so a tall pane leaves it short instead of stretching it.
  for (const rows of [30, 40]) {
    test(`team at ${rows} rows: one row per agent, never past the pane`, () => {
      const lines = panelLines(panelWorld('team', 37, ui, { core, rows, workers, notes } as never));
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(lines.filter((l: { press?: { kind: string } }) => l.press?.kind === 'worker')).toHaveLength(workers.length); // every agent one row (the lead row is a header, not a worker press)
    });
  }
  for (const rows of [30, 40]) for (const tab of ['channel', 'core'] as PanelTab[]) {
    test(`${tab} at ${rows} rows: fills the pane, one foot row free, never past it`, () => {
      const n = panelLines(panelWorld(tab, 37, ui, { core, rows, workers, notes } as never)).length;
      expect(n).toBeLessThanOrEqual(rows - 1);
      expect(n).toBeGreaterThanOrEqual(rows - 4);
    });
  }
  test('core with less to show than the pane keeps its rows (nothing is stretched)', () => {
    const few = panelLines(panelWorld('core', 37, ui, { core: core0, rows: 50 })).length;
    expect(few).toBeLessThan(50);
    expect(panelLines(panelWorld('core', 37, ui, { core: core0, rows: 60 })).length).toBe(few);
  });
});
