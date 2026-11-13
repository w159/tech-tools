// hud110: at 110 columns the docked side pane leaves the transcript about 61 cells. The HUD used to draw no SUBAGENTS block below 80 columns
// (tier 'min'), so live-110 frames showed the TODO box and the band but no `▸ SUBAGENTS` title while an agent ran (workers_any_surface 0.0).
// The block now shows at every width: its ribbon, the column names and a row per agent, with the counts giving way before the row overflows.
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { ownTodos } from './data/todos';
import { hudCompactRows, hudFloorRows, hudLines, type HudAgent, type HudInput } from './hud';
import { hudSlotCap } from './register';
import { textWidth } from './theme';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PLAN = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'].map((c, i): TodoItem => ({ id: `t${i + 1}`, content: c, status: 'pending' }));
const agent = (name: string): HudAgent => ({ name, role: 'explorer', state: 'working', model: 'haiku', ui: 'running' });
const NAMES = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];
const COLS = 61;

/** The rows register.ts draws for a slot of `budget` rows with `n` agents running. */
const hudAt = (n: number, budget: number): string[] => {
  const input: HudInput = { todos: ownTodos(PLAN), agents: NAMES.slice(0, n).map(agent) };
  const now = Date.now();
  const cap = hudSlotCap(budget, hudCompactRows(input, COLS), hudFloorRows(input, COLS, now), 7, true, true);
  return hudLines(input, { cols: COLS, maxRows: cap, ui, rich: false, now }).map(runsString);
};

describe('SUBAGENTS block at 61 transcript cells (110 columns with the pane docked)', () => {
  for (const n of [1, 2, 3]) {
    for (const budget of [12, 14, 18, 27]) {
      test(`${n} running, ${budget} rows: the title and one row per agent show, every row fits 61 cells`, () => {
        const hud = hudAt(n, budget);
        expect(hud.some((r) => r.includes('▸ SUBAGENTS'))).toBe(true);
        // State 39: the rows a box leaves out are counted on one summary row inside it, which costs a row; where the slot cannot hold the plan rows, that row and the table, SUBAGENTS folds to its one title row and its tally
        // (`⠧ 3 run`) while every running plan row keeps its place (wave 38). At 61 cells AGENT is 12 cells wide, so a name ends in `…` and LAST keeps 14.
        const table = hud.some((r) => /AGENT\s+STATE/.test(r));
        for (const name of NAMES.slice(0, n)) {
          const short = name.slice(0, 11);
          if (table) expect(hud.filter((r) => r.trimStart().startsWith(short) && /running/.test(r))).toHaveLength(1); // wave 36: the table row (the plan row only names its owner at the end)
          else expect(hud.filter((r) => r.includes(short) && /running/.test(r))).toHaveLength(1);
        }
        if (!table) expect(hud.find((r) => r.includes('▸ SUBAGENTS'))).toContain(`${n} run`);
        for (const r of hud) expect(textWidth(r)).toBe(COLS);
      });
    }
  }
  test('the ribbon keeps the running count where the full counts would overflow', () => {
    const input: HudInput = { todos: [], agents: [agent('alpha-explorer'), { ...agent('beta-explorer'), state: 'failed', ui: 'failed' }, { ...agent('gamma-explorer'), state: 'queued', ui: 'queued' }] };
    const [ribbon] = hudLines(input, { cols: COLS, maxRows: 10, ui, rich: false, now: Date.now() }).map(runsString);
    expect(ribbon).toContain('1 running');
    expect(textWidth(ribbon!)).toBe(COLS);
  });
});
