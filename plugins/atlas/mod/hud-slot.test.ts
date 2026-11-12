// A3 (critique 14): the SUBAGENTS column header (AGENT STATE MODEL ...) is missing from 30 of 33 frames at 110 columns and from the middle of
// every 150 run, because the HUD's row floor (hudCompactRows) leaves it out, and the band butts against the last agent row. The slot the
// register gives the HUD keeps the header and one blank row under the agents whenever the band can still keep its title row.
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { ownTodos } from './data/todos';
import { hudBudget, hudCompactRows, hudFloorRows, hudLines, hudWantRows, type HudAgent, type HudInput } from './hud';
import { hudGapRows, hudSlotCap } from './register';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const todo = (id: string, content: string, status: string): TodoItem => ({ id, content, status });
const PLAN = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'].map((c, i) => todo(`t${i + 1}`, c, 'pending'));
const agent = (name: string, state: 'working' | 'done' = 'working'): HudAgent => ({ name, role: 'explorer', state, model: 'haiku', ui: state === 'done' ? 'done' : 'running', ...(state === 'done' ? { since: Date.now() } : {}) });
const running: HudInput = { todos: ownTodos(PLAN), agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((n) => agent(n)) };
const settled: HudInput = { todos: ownTodos(PLAN.map((t) => ({ ...t, status: 'completed' }))), agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((n) => agent(n, 'done')) };
const draw = (input: HudInput, cols: number, maxRows: number) => hudLines(input, { cols, maxRows, ui, rich: false, now: Date.now() }).map(runsString); // hudCompactRows reads the wall clock: so does the draw

const AGENT_ROW = /^[▸ ] [◐◓◑◒◇●■▲◉] \S+-explorer\b/;
const PLAN_ROW = /^[▸ ] [◐◓◑◒◇●■▲◉] T[1-5] /;
const closed = (hud: string[]): boolean => hud.filter((r) => r.startsWith('╭─ ') && r.endsWith('╮')).length === 2 && hud.filter((r) => r.startsWith('╰') && r.endsWith('╯')).length === 2;

/** What register.ts draws for a slot: the HUD at the slot cap, then the gap row, and the rows the band keeps. */
function slot(input: HudInput, cols: number, budget: number, isRunning: boolean) {
  const compact = hudCompactRows(input, cols);
  const cap = hudSlotCap(budget, compact, hudFloorRows(input, cols, Date.now()), 7, isRunning, input.agents.length > 0 && cols >= 80, hudWantRows(input, cols, Date.now()));
  const hud = draw(input, cols, cap);
  const gap = hudGapRows(hud.length > 0 && hud.some((r) => r.includes('SUBAGENTS')) && !hud.at(-1)!.includes('SUBAGENTS'), hud.length, budget);
  return { hud, gap, band: budget - hud.length - gap };
}

describe('A3: the SUBAGENTS column header and the blank before the band', () => {
  for (const cols of [88, 104, 138]) {
    for (const [name, input, isRunning] of [['running', running, true], ['settled', settled, false]] as const) {
      for (const budget of [16, 17, 18]) { // round 5: the boxes keep both rules, so 16 rows hold the five plan rows, both boxes, the names, the blank, three agents, the gap and a band row
        test(`${cols} columns, ${name}, ${budget} rows: header kept, one blank after the agents, the band keeps a row`, () => {
          const { hud, gap, band } = slot(input, cols, budget, isRunning);
          const at = hud.findIndex((r) => r.includes('SUBAGENTS'));
          expect(hud[at + 1]).toMatch(/AGENT\s+STATE/); // the column names sit under the ribbon
          expect(hud.filter((r) => AGENT_ROW.test(r))).toHaveLength(3); // every agent keeps its row
          expect(closed(hud)).toBe(true);
          expect(hud[at - 1]!.trim()).toBe(''); // and the blank between the plan and the agents stays
          expect(gap).toBe(1);
          expect(band).toBeGreaterThanOrEqual(1);
        });
      }
    }
  }
  for (const cols of [88, 104, 138]) for (const budget of [14, 15]) {
    test(`${cols} columns, ${budget} rows: the blank goes first, then the names; every plan row and agent row and both closed boxes stay, the band keeps a row`, () => {
      const { hud, band } = slot(running, cols, budget, true);
      expect(closed(hud)).toBe(true);
      expect(hud.filter((r) => PLAN_ROW.test(r))).toHaveLength(5);
      expect(hud.filter((r) => AGENT_ROW.test(r))).toHaveLength(3);
      expect(hud.some((r) => /not shown/.test(r))).toBe(false);
      expect(band).toBeGreaterThanOrEqual(1);
    });
  }
  test('a slot too small for the whole plan and the boxes leaves the band its row (no gap); both boxes stay closed, every agent row stays, the plan is counted on its title (round 5)', () => {
    const want = hudWantRows(running, 104, Date.now());
    const cap = hudSlotCap(11, hudCompactRows(running, 104), hudFloorRows(running, 104, Date.now()), 7, true, true, want);
    expect(cap).toBe(Math.min(hudBudget(11, hudCompactRows(running, 104), 7, true), 10)); // the running clamp keeps the band row
    const hud = draw(running, 104, cap);
    expect(closed(hud)).toBe(true);
    expect(hud.filter((r) => AGENT_ROW.test(r))).toHaveLength(3); // every agent keeps its row
    expect(hud.filter((r) => PLAN_ROW.test(r)).length).toBeGreaterThanOrEqual(1);
    expect(hud[0]).toMatch(/more todos? not shown/);
    expect(hudGapRows(true, 10, 11)).toBe(0);
  });
  test('the HUD asks for every row it has (hudWantRows) and gets it whenever the band keeps its title row and the blank under the agents: no `N more todos not shown` beside spare rows (critique 23, live-150-1 f0060:24)', () => {
    const want = hudWantRows(running, 150, Date.now());
    expect(want).toBe(14); // five plan rows and three agents with the names, the blank and both closing rules
    for (const cols of [150, 110]) {
      for (const budget of [14, 15, 16, 17, 18, 24]) {
        const { hud, gap, band } = slot(running, cols, budget, true);
        expect([cols, budget, hud.filter((r) => PLAN_ROW.test(r)).length]).toEqual([cols, budget, 5]);
        expect([cols, budget, hud.filter((r) => AGENT_ROW.test(r)).length]).toEqual([cols, budget, 3]);
        expect([cols, budget, closed(hud)]).toEqual([cols, budget, true]);
        expect([cols, budget, hud.some((r) => /not shown|\+\d+ more/.test(r))]).toEqual([cols, budget, false]);
        expect([cols, budget, band >= 1, hud.length + gap + band]).toEqual([cols, budget, true, budget]);
        if (budget >= 16) expect([cols, budget, hud.filter((r) => r.trim() === '').length]).toEqual([cols, budget, 1]); // exactly one blank between TODO and SUBAGENTS
      }
    }
  });
  test('no agents listed: the plan alone gets the old budget and no gap', () => {
    const only: HudInput = { todos: running.todos, agents: [] };
    expect(hudSlotCap(14, hudCompactRows(only, 104), hudFloorRows(only, 104, Date.now()), 7, false, false)).toBe(hudBudget(14, hudCompactRows(only, 104), 7, false));
    expect(hudGapRows(false, 6, 14)).toBe(0);
  });
});
