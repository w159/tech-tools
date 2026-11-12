// Critique 19, slice A: the HUD TODO box tells the truth under a retry and keeps its rows and its gap.
// Live shapes: stoprun-150-232567af-3/frames/f0104.ans:24-34 (T1 gone under `1/5 · 1 done`, T3 `queued` while beta-explorer #2 runs, no blank before SUBAGENTS),
// stoprun-150-232567af-1/frames/f0093.ans:24-34 (T2 `queued` beside a failed worker, no blank), stoprun-150-232567af-3/tab-board.png (`done · worker killed` after #2 finished T3).
import { describe, expect, test } from 'claude-code/testing';
import { boardLines, boardRowsOf, boardText, ownerOutcome, type BoardSource } from './board-model';
import { runsString, type Ui, type UiState } from './atlas-ui';
import type { TodoItem } from './contract';
import { withOwnerStates } from './data/live';
import { todoState } from './data/todos';
import { hudLines, type HudAgent, type HudInput } from './hud';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 1_794_458_960_000;
const names = ['alpha-explorer', 'ghost-explorer', 'beta-explorer'];
const item = (i: number, status: string, content: string, owner?: string, extra: object = {}): TodoItem => ({ id: `t${i}`, content, status, ...(owner ? { owner } : {}), ...extra }) as unknown as TodoItem;
const agent = (name: string, state: string, ui_: UiState): HudAgent => ({ name, role: 'explorer', state, ui: ui_, model: 'haiku', since: NOW - 20_000, lastTool: 'Read', target: 'x.py' });
const hud = (input: HudInput, cols: number, maxRows: number): string[] => hudLines(input, { cols, maxRows, ui, now: NOW }).map(runsString);
const rowOf = (rows: string[], key: string): string => rows.find((r) => r.includes(key)) ?? '';

/** f0104: T1 completed 20 s ago (past the linger), T2 blocked, T3 pending; alpha done, ghost and beta killed, beta-explorer #2 running. */
const f0104 = (): HudInput => ({
  todos: [
    item(1, 'completed', 'T1 read alpha.py (alpha-explorer)', names[0], { completed_at: Math.floor(NOW / 1000) - 20 }),
    item(2, 'blocked', 'T2 read ghost.py (ghost-explorer)', names[1]),
    item(3, 'pending', 'T3 read beta.py (beta-explorer)', names[2]),
    item(4, 'pending', 'T4 combine the reports'),
    item(5, 'pending', 'T5 write the final summary'),
  ],
  agents: [agent(names[0]!, 'done', 'done'), agent(names[1]!, 'failed', 'failed'), agent(names[2]!, 'failed', 'failed'), agent('beta-explorer #2', 'working', 'running')],
});

describe('A1: a completed row is drawn while ten rows hold it (f0104)', () => {
  test('150 columns, 15 rows (the column names and both closing rules take three), four agents: all five rows show, T1 included, with no `done` fold on the ribbon', () => {
    const rows = hud(f0104(), 150, 15);
    expect(rows.filter((r) => /\bT[1-5] /.test(r) && !/haiku/.test(r))).toHaveLength(5);
    expect(rowOf(rows, 'T1 read alpha.py')).toMatch(/done/);
    expect(rows[0]).toContain('1/5');
    expect(rows[0]).not.toMatch(/· \d+ done/);
    expect(rows.some((r) => r.includes('beta-explorer #2'))).toBe(true); // the running agent keeps its row
  });
});

describe('A4: the gap row between TODO and SUBAGENTS stays while an agent runs (f0093, f0104)', () => {
  test('f0093 shape: five plan rows and three agents in 14 rows keep both closing rules, the blank and the column names (round 3: the rules and the names outrank the blank in 13)', () => {
    const input: HudInput = { todos: [item(1, 'pending', 'T1 read alpha.py (alpha-explorer)', names[0]), item(2, 'pending', 'T2 read ghost.py (ghost-explorer)', names[1]), item(3, 'pending', 'T3 read beta.py (beta-explorer)', names[2]), item(4, 'pending', 'T4 combine the reports'), item(5, 'pending', 'T5 write the final summary')], agents: [agent(names[0]!, 'working', 'running'), agent(names[1]!, 'failed', 'failed'), agent(names[2]!, 'done', 'done')] };
    const rows = hud(input, 150, 14);
    const at = rows.findIndex((r) => r.includes('SUBAGENTS'));
    expect(rows).toHaveLength(14);
    expect(rows[at + 1]).toMatch(/AGENT\s+STATE/);
    expect(rows[at - 1]!.trim()).toBe('');
    expect(rows.filter((r) => /\bT[1-5] /.test(r) && !/haiku/.test(r))).toHaveLength(5);
    expect(rows.filter((r) => /-explorer/.test(r) && /haiku/.test(r))).toHaveLength(3);
  });
});

describe('A3: a retry reads as one row, in one voice on the HUD, the panel rule and the board', () => {
  test('ownerOutcome: the latest instance decides; a killed first worker with a live #2 is a retry', () => {
    const states = new Map<string, UiState>([['beta-explorer', 'failed'], ['beta-explorer #2', 'running']]);
    expect(ownerOutcome(states, 'beta-explorer')).toEqual({ state: 'running', retried: true, as: 'beta-explorer #2' });
    expect(ownerOutcome(new Map<string, UiState>([['beta-explorer', 'failed'], ['beta-explorer #2', 'failed']]), 'beta-explorer').retried).toBe(false);
    expect(ownerOutcome(new Map<string, UiState>([['beta-explorer', 'failed']]), 'beta-explorer')).toEqual({ state: 'failed', retried: false, as: 'beta-explorer' });
    expect(ownerOutcome(states, 'ghost-explorer')).toEqual({ retried: false, as: 'ghost-explorer' });
  });
  test('HUD f0104: T3 reads running with `beta-explorer #2`, not queued', () => {
    const t3 = rowOf(hud(f0104(), 150, 16), 'T3 read beta.py');
    expect(t3).toMatch(/running/);
    expect(t3).not.toMatch(/queued/);
    expect(t3).toContain('beta-explorer #2');
  });
  test('HUD: T3 completed after #2 returned reads `retried · done`, never `worker killed`', () => {
    const input = f0104();
    input.todos[2] = item(3, 'completed', 'T3 read beta.py (beta-explorer)', names[2]);
    input.agents[3] = agent('beta-explorer #2', 'done', 'done');
    const t3 = rowOf(hud(input, 150, 16), 'T3 read beta.py');
    expect(t3).toContain('retried · done');
    expect(t3).not.toContain('worker killed');
  });
  test('todoState: the retried word is only for a completed row; a pending row whose worker failed says `worker failed` and keeps the queued glyph', () => {
    expect(todoState('completed', 'done', true)).toEqual({ state: 'done', word: 'retried · done' });
    expect(todoState('completed', 'failed', false)).toEqual({ state: 'done', word: 'done' });
    expect(todoState('pending', 'failed')).toEqual({ state: 'queued', word: 'worker failed' });
    expect(todoState('pending', 'running')).toEqual({ state: 'running' });
  });
  test('HUD f0093: T2 whose worker failed reads `worker failed` on a queued glyph', () => {
    const input = f0104();
    input.todos[1] = item(2, 'pending', 'T2 read ghost.py (ghost-explorer)', names[1]);
    const t2 = rowOf(hud(input, 150, 14), 'T2 read ghost.py');
    expect(t2).toContain('◇');
    expect(t2).toContain('worker failed');
  });
  test('board: the same rows through withOwnerStates read running, retried and worker failed', () => {
    const states = new Map<string, UiState>([['alpha-explorer', 'done'], ['ghost-explorer', 'failed'], ['beta-explorer', 'failed'], ['beta-explorer #2', 'running']]);
    const src = (status: string, owner: string): BoardSource => ({ content: `T read ${owner}`, status, owner });
    const rows = (items: BoardSource[]) => boardRowsOf(withOwnerStates(items, states));
    expect(rows([src('pending', 'beta-explorer')])[0]).toMatchObject({ state: 'running' });
    expect(rows([src('pending', 'ghost-explorer')])[0]).toMatchObject({ state: 'queued', word: 'worker failed' });
    const done = withOwnerStates([src('completed', 'beta-explorer')], new Map<string, UiState>([['beta-explorer', 'failed'], ['beta-explorer #2', 'done']]));
    const row = boardRowsOf(done)[0]!;
    expect(row).toMatchObject({ state: 'done', word: 'retried · done' });
    expect(row.word).not.toBe('done');
    const text = boardText(boardLines(boardRowsOf(done), { cols: 80, ui, tick: 0 })).join('\n');
    expect(text).toContain('retried');
    expect(text).not.toContain('worker killed');
  });
});
