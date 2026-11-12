// Critique 18, slice C1: the SUBAGENTS column-name row shows in every frame the block shows (stoprun-150-562576ed-1/f0080.ans:31-34 lost it
// while beta ran), the MODEL and TASK cells keep a gap (`haiku T1` ran together), and MODEL is never blank (stoprun-110-562576ed-1/tab-route.png).
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { ownTodos } from './data/todos';
import { hudCompactRows, hudFloorRows, hudLines, agentModel, type HudAgent, type HudInput } from './hud';
import { hudGapRows, hudSlotCap } from './register';

const NOW = 1_794_458_960_000;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const todo = (id: string, content: string, status: string): TodoItem => ({ id, content, status });
const PLAN = ['T1 read alpha.py (alpha-explorer)', 'T2 read ghost.py (ghost-explorer)', 'T3 read beta.py (beta-explorer)', 'T4 combine the reports', 'T5 write the final summary'];
const OWNERS = ['alpha-explorer', 'ghost-explorer', 'beta-explorer'];
const plan = (statuses: string[]): TodoItem[] => PLAN.map((c, i) => ({ ...todo(`t${i + 1}`, c, statuses[i] ?? 'pending'), ...(OWNERS[i] ? { owner: OWNERS[i] } : {}) }));
const agent = (name: string, ui: HudAgent['ui'], state: string, model = 'haiku'): HudAgent => ({ name, role: 'explorer', state, ui, ...(model ? { model } : {}), since: NOW - 5000 });
// stoprun-150-562576ed-1/f0080.ans: alpha done, ghost killed, beta running.
const stop: HudInput = { todos: ownTodos(plan(['completed', 'blocked', 'pending'])), agents: [agent('alpha-explorer', 'done', 'done'), agent('ghost-explorer', 'failed', 'failed', ''), agent('beta-explorer', 'running', 'working')] };

/** What register.ts draws for a slot: the HUD at the slot cap, the gap row, the rows left for the band. */
function slot(input: HudInput, cols: number, budget: number) {
  const cap = hudSlotCap(budget, hudCompactRows(input, cols), hudFloorRows(input, cols, NOW), 7, true, true);
  const hud = hudLines(input, { cols, maxRows: cap, ui, rich: false, now: NOW }).map(runsString);
  const lists = hud.some((r) => r.includes('SUBAGENTS')) && !hud.at(-1)!.includes('SUBAGENTS');
  return { hud, band: budget - hud.length - hudGapRows(lists, hud.length, budget) };
}

describe('C1: the SUBAGENTS header row and the fixed MODEL / TASK grid', () => {
  // Rev 5: the column names stay while the grid shows. Of the blank between the blocks and the names (one row each) the blank goes first; then the plan is capped, never the names.
  for (const [cols, budget] of [[150, 16], [150, 15], [61, 15], [61, 14]] as const) { // round 3: both boxes close, three rows more than before
    test(`${cols} columns, ${budget} rows, an agent running: the column names stay, every agent keeps its row and the band keeps a row`, () => {
      const { hud, band } = slot(stop, cols, budget);
      const at = hud.findIndex((r) => r.includes('SUBAGENTS'));
      expect(at).toBeGreaterThan(0);
      expect(hud[at + 1]!).toMatch(/AGENT\s+STATE/); // the names show whenever the grid does
      expect(hud.slice(at + 2).filter((r) => /-explorer/.test(r))).toHaveLength(3); // every agent keeps its row
      const plan = hud.slice(0, at).filter((r) => /T\d /.test(r)).length;
      expect(plan).toBeGreaterThanOrEqual(budget >= 16 ? 5 : 4); // every plan row while the rows fit, one folded onto the title below that
      if (hud.length >= 14) expect(hud[at - 1]!.trim()).toBe(''); // the gap row between the blocks, when a row is left over
      expect(band).toBeGreaterThanOrEqual(1);
    });
  }
  test('MODEL and TASK keep two blank cells between them, also when the LAST text is long (`haiku T1` ran together)', () => {
    const long: HudInput = { ...stop, todos: ownTodos([...plan(['completed', 'blocked', 'pending']).map((t) => ({ ...t, evidence: null as never }))]), agents: stop.agents };
    const rows = hudLines(long, { cols: 150, maxRows: 30, ui, rich: false, now: NOW }).map(runsString);
    for (const r of rows.filter((x) => /haiku/.test(x))) expect(r).toMatch(/haiku {2,}T\d/);
  });
  test('MODEL is never blank: an agent the squad gave no model reads `-`', () => {
    const rows = agentModel(stop.agents, stop.todos);
    expect(rows.find((r) => r.name === 'ghost-explorer')!.model).toBe('-');
    const drawn = hudLines(stop, { cols: 61, maxRows: 30, ui, rich: false, now: NOW }).map(runsString);
    expect(drawn.find((r) => r.includes('ghost-explorer') && /failed\s+-/.test(r))).toMatch(/failed\s+-\s+T2/);
  });
});
