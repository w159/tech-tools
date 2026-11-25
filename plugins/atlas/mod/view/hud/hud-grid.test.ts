// Critique 18, slice C1: the SUBAGENTS column-name row shows in every frame the block shows (stoprun-150-562576ed-1/f0080.ans:31-34 lost it
// while beta ran), the MODEL and TASK cells keep a gap (`haiku T1` ran together), and MODEL is never blank (stoprun-110-562576ed-1/tab-route.png).
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Ui } from '../../design/atlas-ui';
import type { TodoItem } from '../../contract';
import { ownTodos } from '../../data/todos';
import { hudLines, agentModel, type HudAgent, type HudInput } from './hud';

const NOW = 1_794_458_960_000;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const todo = (id: string, content: string, status: string): TodoItem => ({ id, content, status });
const PLAN = ['T1 read alpha.py (alpha-explorer)', 'T2 read ghost.py (ghost-explorer)', 'T3 read beta.py (beta-explorer)', 'T4 combine the reports', 'T5 write the final summary'];
const OWNERS = ['alpha-explorer', 'ghost-explorer', 'beta-explorer'];
const plan = (statuses: string[]): TodoItem[] => PLAN.map((c, i) => ({ ...todo(`t${i + 1}`, c, statuses[i] ?? 'pending'), ...(OWNERS[i] ? { owner: OWNERS[i] } : {}) }));
const agent = (name: string, ui: HudAgent['ui'], state: string, model = 'haiku'): HudAgent => ({ name, role: 'explorer', state, ui, ...(model ? { model } : {}), since: NOW - 5000 });
// stoprun-150-562576ed-1/f0080.ans: alpha done, ghost killed, beta running.
const stop: HudInput = { todos: ownTodos(plan(['completed', 'blocked', 'pending'])), agents: [agent('alpha-explorer', 'done', 'done'), agent('ghost-explorer', 'failed', 'failed', ''), agent('beta-explorer', 'running', 'working')] };

/** The HUD in `budget` rows less one. */
const slot = (input: HudInput, cols: number, budget: number): { hud: string[]; band: number } => {
  const hud = hudLines(input, { merge: false, cols, maxRows: budget - 1, ui, rich: false, now: NOW }).map(runsString);
  return { hud, band: budget - hud.length };
};

describe('C1: the SUBAGENTS header row and the fixed MODEL / TASK grid', () => {
  // Rev 5: the column names stay while the grid shows. Of the blank between the blocks and the names (one row each) the blank goes first; then the plan is capped, never the names.
  for (const [cols, budget] of [[150, 18], [150, 17], [61, 17], [61, 16]] as const) { // both boxes close and carry their column names: two rows more than round 3
    test(`${cols} columns, ${budget} rows, an agent running: the column names stay, every agent keeps its row and the band keeps a row`, () => {
      const { hud, band } = slot(stop, cols, budget);
      const at = hud.findIndex((r) => r.includes('SUBAGENTS'));
      expect(at).toBeGreaterThan(0);
      expect(hud[at + 1]!).toMatch(/AGENT\s+ROLE\s+STATE/); // the names show whenever the grid does
      expect(hud.slice(at + 2).filter((r) => /-explorer/.test(r))).toHaveLength(3); // every agent keeps its row
      const plan = hud.slice(0, at).filter((r) => /T\d /.test(r)).length;
      expect(plan).toBeGreaterThanOrEqual(budget >= 17 ? 5 : 4); // every plan row while the rows fit, one folded onto a summary row below that
      expect(hud[at - 1]!.startsWith('╰')).toBe(true); // no blank row between the boxes: the TODO box's closing rule sits right above the SUBAGENTS box
      expect(band).toBeGreaterThanOrEqual(1);
    });
  }
  test('MODEL is no column: no row carries the model word, so it can never run into the next cell (`haiku T1` ran together)', () => {
    const long: HudInput = { ...stop, todos: ownTodos([...plan(['completed', 'blocked', 'pending']).map((t) => ({ ...t, evidence: null as never }))]), agents: stop.agents };
    const rows = hudLines(long, { merge: false, cols: 150, maxRows: 30, ui, rich: false, now: NOW }).map(runsString);
    expect(rows.filter((x) => /haiku/.test(x))).toEqual([]);
  });
  test('MODEL is never blank: an agent the squad gave no model reads `-`', () => {
    const rows = agentModel(stop.agents, stop.todos);
    expect(rows.find((r) => r.name === 'ghost-explorer')!.model).toBe('-');
    const drawn = hudLines(stop, { merge: false, cols: 150, maxRows: 30, ui, rich: false, now: NOW }).map(runsString); // 150: at 61 cells MODEL gives its cells to LAST (critique 23)
    expect(drawn.find((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] ghost-explorer/.test(r))).toMatch(/ghost-explorer\s+\S+\s+(failed|killed)/); // no MODEL column to draw the dash in
    expect(drawn.find((r) => /T2 read ghost\.py/.test(r))).toMatch(/ghost-explorer/); // the plan row names its owner in OWNER
  });
});
