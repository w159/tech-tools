// Critique 16, slice B: every state the store holds is drawn. Live shapes: stoprun-150-e4a8186a-1/truth.json (T2 set `blocked` after ghost-explorer was
// stopped) and stoprun-150-e4a8186a-3/frames/f0085.ans (HUD: `■ T2 ... failed` while the lead says `T2 blocked`).
import { describe, expect, test } from 'claude-code/testing';
import { boardRowsOf, itemState } from './board-model';
import { STATE_GLYPHS, cells } from './atlas-ui';
import { todoState } from './data/todos';
import { hudLines, type HudAgent, type HudInput } from './hud';
import type { SquadAgent, TodoItem } from './contract';
import { busySnap } from './live_fixture';
import type { LiveSnapshot } from './orchestra-types';
import type { PanelModel } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import type { SidebarModel } from './pane/sidebar-types';

const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;
const NOW = 1_000_000;const text = (rows: readonly (readonly { t: string }[])[]): string[] => rows.map((r) => r.map((x) => x.t).join(''));
const todo = (id: string, content: string, status: string, owner?: string): TodoItem => ({ id, content, status, ...(owner ? { owner } : {}), origin: 'session', session_id: '' }) as unknown as TodoItem;
const agent = (name: string, state: HudAgent['state'], extra: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: state as never, since: NOW - 5000, ...extra });

/** The f0085 plan: T2 is `blocked` in the store, its owner was killed. */
const PLAN: TodoItem[] = [
  todo('1', 'T1 read alpha.py (alpha-explorer)', 'completed', 'alpha-explorer'), todo('2', 'T2 read ghost.py (ghost-explorer)', 'blocked', 'ghost-explorer'),
  todo('3', 'T3 read beta.py (beta-explorer)', 'pending', 'beta-explorer'), todo('4', 'T4 combine the reports', 'pending'), todo('5', 'T5 write the final summary', 'pending'),
];
const AGENTS: HudAgent[] = [
  agent('alpha-explorer', 'done', { model: 'haiku', task: 'alpha-explorer: read alpha.py', lastTool: 'Read' }),
  agent('ghost-explorer', 'failed', { task: 'ghost-explorer: read ghost.py', lastTool: 'Read', target: 'util.py' }),
  agent('beta-explorer', 'working', { ui: 'running', task: 'beta-explorer: read beta.py', tool: 'Read', target: 'beta.py' }),
];

describe('B1: blocked is its own state', () => {
  test('the store word `blocked` outranks a failed owner (the lead said blocked, the killed agent stays failed)', () => {
    expect(itemState('blocked', 'failed')).toBe('blocked');
    expect(todoState('blocked', 'failed')).toEqual({ state: 'blocked' });
    expect(itemState('pending', 'failed')).toBe('queued'); // a row the store still holds pending stays queued under a killed agent (critique 18 B3); the owner is named failed beside it
    expect(itemState('in_progress', 'failed')).toBe('failed'); // an unmarked row the lead started still fails
    expect(todoState('in_progress', 'failed')).toEqual({ state: 'failed' });
  });
  test('the HUD row for T2 reads blocked with the blocked glyph, and the ghost agent row stays failed', () => {
    const rows = text(hudLines({ todos: PLAN, agents: AGENTS }, { cols: 120, maxRows: 30, ui, now: NOW }));
    const t2 = rows.find((r) => r.includes('T2 read ghost.py'))!;
    expect(t2).toMatch(/\(ghost-explorer\)\s+blocked/); // the state word; the detail may still say `owner failed`
    expect(t2).toContain(STATE_GLYPHS.blocked);
    const ghost = rows.find((r) => r.includes('ghost-explorer ') && !r.includes('T2 read'))!;
    expect(ghost).toContain('failed');
    expect(ghost).not.toContain('blocked');
  });
  test('the board folds a failed dispatch row into a blocked plan row without turning it failed', () => {
    const dispatch = { content: 'Read ghost.py first', status: 'failed', owner: 'ghost-explorer', origin: 'dispatch' };
    const rows = boardRowsOf([{ content: 'T2 read ghost.py (ghost-explorer)', status: 'blocked' }, dispatch]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('blocked');
    expect(cells(rows[0]!.label)).toBeGreaterThan(0);
  });
});

describe('B2: every row that fits is drawn, only the rest is folded', () => {
  // stoprun-150-e4a8186a-3/frames/f0085.ans:25-27: `3 more todos not shown` under 2 drawn rows; the fold row itself cost the third.
  const four: HudAgent[] = [...AGENTS, agent('beta-explorer-2', 'done', { model: 'haiku', lastTool: 'Read' })];
  test('9 rows: two plan rows beside the four agents and their column names, the count of the other three on the title', () => {
    const rows = text(hudLines({ todos: PLAN, agents: four }, { cols: 103, maxRows: 9, ui, now: NOW }));
    expect(rows).toHaveLength(9);
    const at = rows.findIndex((r) => r.includes('SUBAGENTS'));
    expect(at).toBe(3); // title, two plan rows, then the agents (rev 5: the column names stay, so the plan gives up a row)
    expect(rows[0]).toMatch(/TODO {2}1\/5 · 3 more todos not shown ─+/);
    expect(rows.some((r) => /^\s+\d+ more todos? not shown\s*$/.test(r))).toBe(false); // no row of its own
  });
  test('a plan that fits in full carries no count', () => {
    const rows = text(hudLines({ todos: PLAN, agents: four }, { cols: 103, maxRows: 14, ui, now: NOW }));
    expect(rows[0]).not.toContain('more');
    expect(rows.filter((r) => /\bT\d read|\bT\d (combine|write)/.test(r) && !r.includes('haiku'))).toHaveLength(5);
  });
});

describe('B4: LAST is an outcome for a finished row and the current action for a live one', () => {
  const dispatch = (owner: string, evidence: string): TodoItem => ({ id: `d-${owner}`, content: `Read ${owner}`, status: 'completed', owner, origin: 'dispatch', session_id: '', evidence }) as unknown as TodoItem;
  const lastOf = (rows: string[], name: string): string => rows.find((r) => r.includes(` ${name} `))!;
  test('a done agent reads the evidence its dispatch row holds, not `finished`', () => {
    const todos = [...PLAN, dispatch('alpha-explorer', '1. Read `/tmp/p/alpha.py` -> alpha_one (line 1), alpha_two (line 5)')];
    const rows = text(hudLines({ todos, agents: AGENTS }, { cols: 120, maxRows: 30, ui, now: NOW }));
    expect(lastOf(rows, 'alpha-explorer')).toContain('alpha_one (line 1)');
    expect(lastOf(rows, 'alpha-explorer')).not.toContain('finished');
    expect(lastOf(rows, 'alpha-explorer')).not.toContain('/tmp/p'); // never a path
  });
  test('the dispatch row does not become a task id: T-numbers count plan rows only', () => {
    const todos = [dispatch('alpha-explorer', 'ok done'), ...PLAN];
    const rows = text(hudLines({ todos, agents: AGENTS }, { cols: 120, maxRows: 30, ui, now: NOW }));
    expect(lastOf(rows, 'alpha-explorer')).toMatch(/\sT1\s/);
  });
  test('a narrow HUD (the 110-column transcript, 61 cells) never cuts a call to its bare verb', () => {
    const live: HudAgent[] = [...['alpha', 'beta'].map((n) => agent(`${n}-explorer`, 'working', { ui: 'running', model: 'haiku', task: `${n}-explorer: read ${n}.py`, tool: 'Read', target: `${n}.py` })), agent('gamma-explorer', 'done', { model: 'haiku', task: 'gamma-explorer: read gamma.py', lastTool: 'Read' })];
    const plan = PLAN.map((t, i) => ({ ...t, owner: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'][i], status: 'pending' }) as TodoItem);
    for (const cols of [61, 56, 52, 48]) {
      const rows = text(hudLines({ todos: plan, agents: live }, { cols, maxRows: 30, ui, now: NOW }));
      for (const r of rows) expect(r).not.toMatch(/\b[a-z]{1,6}\.\.\./); // `read...`, `report...`
      for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(cols);
      if (cols === 61) { expect(lastOf(rows, 'alpha-explorer')).toContain('read alpha.py'); expect(lastOf(rows, 'gamma-explorer')).toContain('finished'); } // critique 17: the name column is as wide as the names under 80 columns, so the whole outcome fits
    }
  });
});

describe('B4: the team and channel tabs say what the HUD says', () => {
  const act = { tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' };
  const sq = (name: string, state: string): SquadAgent => ({ name, persona: 'explorer', state, source: 'task' }) as SquadAgent;
  const world = (squad: SquadAgent[], extra: object = {}): LiveSnapshot =>
    ({ ...busySnap(), squad, activity: Object.fromEntries(squad.map((a) => [a.name, { ...act, mood: a.state === 'failed' ? 'failed' : 'idle', lastTool: 'Read', target: 'util.py' }])), comms: [], todos: [], todoGroups: [], now: NOW, ...extra }) as unknown as LiveSnapshot;
  const model = (snap: LiveSnapshot): PanelModel => panelModelOf({ snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'channel' }, columns: 80, rows: 40, tick: 0 } as unknown as SidebarModel, ui, 80);
  test('a killed agent that never got an end time is not a person in the channel (stoprun-150-e4a8186a-1: shown 2, true 1)', () => {
    const snap = world([sq('ghost-explorer', 'failed')], { notes: [], members: [{ name: 'lead-104043' }, { name: 'ghost-explorer' }] });
    expect(model(snap).people).toBe(1);
  });
  test('a failed worker row on the team tab reads `killed`, as the HUD LAST does', () => {
    const snap = world([sq('ghost-explorer', 'failed')], { notes: [], members: [] });
    const w = model(snap).workers.find((x) => x.name === 'ghost-explorer')!;
    expect(w.state).toBe('failed');
    expect(w.detail).toBe('killed'); // critique 17: the call it was making is not what happened to it
  });
  test('a done worker row on the team tab reads the evidence of its dispatch row, as the HUD LAST does', () => {
    const snap = world([sq('alpha-explorer', 'finished')], { notes: [], members: [], todos: [{ id: 'd1', content: 'Read alpha.py', status: 'completed', owner: 'alpha-explorer', origin: 'dispatch', session_id: '', evidence: '1. Read `/tmp/p/alpha.py` -> alpha_one (line 1)' }] });
    expect(model(snap).workers.find((x) => x.name === 'alpha-explorer')!.detail).toBe('alpha_one (line 1)'); // the result of the echo, not the echo (critique 17)
  });
});

describe('B3: the final SUBAGENTS block keeps the agents that finished', () => {
  // stoprun-150-e4a8186a-1/tab-board.png: SUBAGENTS showed only ghost under `1 failed` while route listed `2 done ■ 1 failed`.
  const settled: HudAgent[] = [agent('alpha-explorer', 'done', { since: NOW - 3_600_000, lastTool: 'Read' }), agent('ghost-explorer', 'failed', { since: NOW - 3_600_000, lastTool: 'Read', target: 'util.py' }), agent('beta-explorer', 'done', { since: NOW - 3_600_000, lastTool: 'Read' })];
  test('a failed agent keeps its done siblings in the block, long after the wave lingered', () => {
    const rows = text(hudLines({ todos: PLAN, agents: settled }, { cols: 120, maxRows: 30, ui, now: NOW }));
    expect(rows.some((r) => r.includes('SUBAGENTS') && r.includes('1 failed') && r.includes('2 done'))).toBe(true);
    for (const n of ['alpha-explorer', 'ghost-explorer', 'beta-explorer']) expect(rows.some((r) => r.includes(` ${n} `))).toBe(true);
  });
  test('with no failure the finished wave stays after it lingered (critique 17 B3)', () => {
    const rows = text(hudLines({ todos: PLAN, agents: settled.filter((a) => a.state === 'done') }, { cols: 120, maxRows: 30, ui, now: NOW }));
    expect(rows.some((r) => r.includes('SUBAGENTS'))).toBe(true);
  });
});
