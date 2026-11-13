// State 39: the TODO HUD and the SUBAGENTS table are one fixed grid with one overflow idiom (a dim summary row inside the box) and filled cells.
// One group per step of the slice: no `+N more` on any title, the TODO columns line up, idle keeps its done and failed marks, the FN count survives
// the stop path, LAST is never blank, and the 110-column SUBAGENTS title keeps its tally and folds to one row.
import { describe, expect, test } from 'claude-code/testing';
import { worldHudAgents, worldPhases, worldPlan } from '../contracts/hud-world';
import { runsString, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { functionsIn, hudLines, type HudAgent, type HudInput } from './hud';
import { overflowText } from './hud-surface';
import { stateRun } from './atlas-ui';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 5_000_000;
const text = (rows: readonly (readonly Run[])[]): string[] => rows.map((r) => runsString([...r]).trimEnd());
const item = (i: number, status: string, content: string, owner?: string, extra: Record<string, unknown> = {}): TodoItem => ({ id: `t${i}`, content, status, ...(owner ? { owner } : {}), ...extra }) as unknown as TodoItem;
const agent = (name: string, state: string, ui_: string, extra: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW - 20_000, ...extra }) as HudAgent;
const view = (cols: number, maxRows: number, extra: Record<string, unknown> = {}) => ({ cols, maxRows, ui, now: NOW, ...extra });
const running3: HudInput = { todos: worldPlan(), agents: worldHudAgents().slice(0, 3).map((a) => ({ ...a, state: 'working' })), phases: worldPhases() };

describe('1. one overflow idiom: no `+N more` on any HUD title', () => {
  const stopPlan = [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), item(2, 'blocked', 'T2 read ghost.py', 'ghost-explorer'), item(3, 'pending', 'T3 read beta.py', 'beta-explorer'), item(4, 'pending', 'T4 combine'), item(5, 'pending', 'T5 write')];
  const stop: HudInput = { todos: stopPlan, agents: [agent('alpha-explorer', 'done', 'done'), agent('ghost-explorer', 'failed', 'failed'), agent('beta-explorer', 'failed', 'failed')] };
  for (const cols of [93, 56]) for (const merge of [true, false]) {
    test(`${cols} cells, merge ${merge}: from 2 to 30 rows no row of the HUD reads \`+N more\``, () => {
      for (const input of [running3, stop]) for (let h = 2; h <= 30; h++) {
        const rows = text(hudLines(input, view(cols, h, { merge })));
        expect(rows.length).toBeLessThanOrEqual(h);
        for (const r of rows) expect([cols, h, /\+\d+ more/.test(r)]).toEqual([cols, h, false]);
      }
    });
  }
  test('a short budget counts the rows it leaves out on ONE dim summary row inside the box, running rows included (`⠋ 2 more running`)', () => {
    const rows = text(hudLines(running3, view(93, 3, { merge: true })));
    expect(rows.some((r) => /more running/.test(r)), rows.join('\n')).toBe(true);
    const summary = rows.find((r) => /more running/.test(r))!;
    expect(summary).toMatch(/^ {2}\S+ .*\d+ more running/);
    const shown = rows.filter((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] [A-Za-z]/.test(r)).length;
    expect(shown + [...summary.matchAll(/(\d+) (?:more )?(?:queued|running|done|failed|blocked)/g)].reduce((n, m) => n + Number(m[1]), 0)).toBe(running3.todos.length);
  });
  test('overflowText is one text: done and queued read `N state`, an open state reads `N more state`', () => {
    expect(overflowText({ done: 1, queued: 2 }, ui)).toBe(`${stateRun('done', ui).t} 1 done  ${stateRun('queued', ui).t} 2 queued`);
    expect(overflowText({ running: 2 }, ui, 7)).toMatch(/^\S 2 more running$/);
    expect(overflowText({}, ui)).toBe('');
  });
});

describe('2. the TODO columns line up on every row, at 150 and 110 columns', () => {
  const todos = [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), item(2, 'in_progress', 'T2 read beta.py', 'beta-explorer'), item(3, 'in_progress', 'T3 read gamma.py', 'gamma-explorer'), item(4, 'pending', 'T4 combine the reports'), item(5, 'pending', 'T5 write the summary')];
  const agents = [agent('alpha-explorer', 'done', 'done'), agent('beta-explorer', 'working', 'running', { startedAt: NOW - 5000 }), agent('gamma-explorer', 'working', 'running', { startedAt: NOW - 6000 })];
  const AT = { 93: { state: 45, owner: 54, time: 71 }, 56: { state: 28, owner: 37, time: 50 } } as const;
  for (const cols of [93, 56] as const) {
    test(`${cols} cells: state, owner and time start on the same cell in running, queued and done rows`, () => {
      const rows = text(hudLines({ todos, agents }, view(cols, 30, { merge: true }))).filter((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] T\d/.test(r));
      expect(rows).toHaveLength(5);
      for (const r of rows) {
        expect(r.slice(AT[cols].state, AT[cols].state + 8).trimEnd(), r).toMatch(/^(running|queued|done)$/);
        expect(r[AT[cols].owner - 1], r).toBe(' ');
        expect(r[AT[cols].owner], r).not.toBe(' '); // the owner (or `-`) starts here on every row
        expect(r.length, r).toBeLessThanOrEqual(cols);
      }
      expect(rows.map((r) => r.slice(AT[cols].state, AT[cols].state + 8).trimEnd())).toEqual(['done', 'running', 'running', 'queued', 'queued']);
      const queued = rows.filter((r) => /queued/.test(r));
      for (const r of queued) expect(r.slice(AT[cols].owner).trimStart().startsWith('-'), r).toBe(true); // a queued row has the owner cell `-`, never blank
    });
  }
  test('the title is clipped on its own cells with `…`, never into the state column', () => {
    const long = [item(1, 'in_progress', 'T1 a title that is much longer than the forty cells the grid gives it', 'alpha-explorer')];
    const row = text(hudLines({ todos: long, agents: [agent('alpha-explorer', 'working', 'running')] }, view(93, 20, { merge: true }))).find((r) => /T1/.test(r))!;
    expect(row.slice(0, 45)).toMatch(/…\s*$/);
    expect(row.slice(45, 53).trimEnd()).toBe('running');
  });
});

describe('3. idle keeps the done and failed marks in colour', () => {
  const todos = [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), item(2, 'completed', 'T2 read ghost.py', 'ghost-explorer')];
  const agents = [agent('alpha-explorer', 'done', 'done'), agent('ghost-explorer', 'failed', 'failed')];
  test('at rest the `●` stays the done tone and the `■` the failed tone; only titles and words go 245', () => {
    const rows = hudLines({ todos, agents }, view(93, 30, { merge: false, idle: true }));
    const marks = rows.flat().filter((r) => ['●', '■'].includes(r.t));
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(m.tone).toBe(m.t === '●' ? 'ok' : 'bad');
    const title = rows.flat().find((r) => r.t.startsWith('T1 read'))!;
    expect(title.tone).toBe('sub');
  });
});

describe('4. SUBAGENTS cells', () => {
  test('functionsIn: the whole report counts, whichever row states the outcome (the stop path lost the figure)', () => {
    expect(functionsIn(['1. Read `/tmp/p/alpha.py` -> alpha_one (line 1), alpha_two (line 5)'])).toBe(2);
    expect(functionsIn(['read alpha.py', '3 functions found'])).toBe(3);
    expect(functionsIn(['alpha_one (line 1) ... [4 functions]'])).toBeGreaterThanOrEqual(2);
    expect(functionsIn([null, undefined, ''])).toBe(0);
  });
  test('a done agent whose count lives on its closing line, not on the dispatch evidence, still reads its FN', () => {
    const dispatch = item(9, 'completed', 'Read alpha-explorer', 'alpha-explorer', { origin: 'dispatch', evidence: '1. read alpha.py -> ok' });
    const input: HudInput = { todos: [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), dispatch], agents: [agent('alpha-explorer', 'done', 'done', { lastLine: 'alpha_one (line 1), alpha_two (line 5), alpha_three (line 9)' })] };
    const row = text(hudLines(input, view(150, 30, { merge: false }))).find((r) => /^[▸ ] ● alpha-explorer/.test(r))!;
    expect(row, 'alpha row').toMatch(/3 fn/);
  });
  test('LAST is never blank: a done row shows its last tool action, a failed row `stopped`', () => {
    const input: HudInput = { todos: [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), item(2, 'blocked', 'T2 read ghost.py', 'ghost-explorer')], agents: [agent('alpha-explorer', 'done', 'done', { lastTool: 'Read', target: 'alpha.py' }), agent('ghost-explorer', 'failed', 'failed')] };
    for (const cols of [150, 61]) {
      const rows = text(hudLines(input, view(cols, 30, { merge: true })));
      const done = rows.find((r) => /^ {2}alpha-\S*\s+● done/.test(r))!;
      const failed = rows.find((r) => /^ {2}ghost-\S*\s+■ failed/.test(r))!;
      expect([cols, done.trimEnd().endsWith('read alpha.py'), done]).toEqual([cols, true, done]);
      expect([cols, failed.trimEnd().endsWith('stopped')]).toEqual([cols, true]);
    }
  });
  test('at 110 columns AGENT is cut to 12 before LAST drops below 14 cells', () => {
    const rows = text(hudLines(running3, view(61, 30, { merge: true })));
    const head = rows.find((r) => /AGENT\s+STATE/.test(r))!;
    expect(head.indexOf('STATE') - head.indexOf('AGENT')).toBe(12 + 2);
    expect(head.length - head.indexOf('LAST')).toBeGreaterThanOrEqual(0);
    const width = 61 - 1 - head.indexOf('LAST');
    expect(width).toBeGreaterThanOrEqual(14);
  });
  test('the 110 SUBAGENTS title keeps its tally, not a bare spinner', () => {
    const input: HudInput = { todos: [item(1, 'completed', 'T1 a', 'a-explorer'), item(2, 'in_progress', 'T2 b', 'b-explorer'), item(3, 'blocked', 'T3 c', 'c-explorer')], agents: [agent('a-explorer', 'done', 'done'), agent('b-explorer', 'working', 'running'), agent('c-explorer', 'failed', 'failed')] };
    const title = text(hudLines(input, view(50, 30, { merge: true }))).find((r) => r.includes('SUBAGENTS'))!;
    expect(title, title).toMatch(/SUBAGENTS \S 1 run · ■1 · ●1/);
  });
  test('a folded SUBAGENTS block is one title row with the tally, never an empty two-row box', () => {
    const rows = text(hudLines(running3, view(93, 3, { merge: true })));
    const at = rows.findIndex((r) => r.includes('SUBAGENTS'));
    expect(at).toBe(rows.length - 1); // the one row that closes the plan box carries the title
    expect(rows[at]).toMatch(/3 running/);
    expect(rows.filter((r) => /^╭/.test(r) && r.includes('SUBAGENTS'))).toHaveLength(0); // no second box opened over it
  });
});
