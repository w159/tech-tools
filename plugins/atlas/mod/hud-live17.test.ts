// Critique 17, slice B: LAST is an outcome (not a tool echo), the 110 HUD keeps its columns, its gap and a band row, a clean finish keeps the SUBAGENTS
// block, and the route and board tabs share one strip with no wrapped rows at 110. Live shapes: stoprun-150-a4fad2f9-2/frames/f0088.ans:33-35 (LAST),
// live-110-a4fad2f9-1/frames/f0039.ans:21-31 (10 rows, no band, `gamma-explor` with no MODEL and TASK), live-150-a4fad2f9-3/tab-team.png (block gone after DONE),
// stoprun-110-a4fad2f9-2/tab-route.png (`T1 read alpha.py` / `(alpha-explorer) done`).
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { cells, runsString, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudBudget, hudCompactRows, hudFloorRows, hudLines, hudMotionItems, lastOf, type HudAgent, type HudInput } from './hud';
import { Motion } from './motion';
import { bodyLines, lineText, stripLayout, tabRows } from './panel-layout';
import { hudGapRows, hudSlotCap } from './register';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 5_000_000;
const none = { tool: null, target: null, detail: null, lastTool: null, lastLine: '' } as const;

describe('B1: LAST is the outcome, never the raw tool echo', () => {
  // stoprun-150-a4fad2f9-2/truth.json todos.json: the evidence the dispatch rows hold.
  const ALPHA = '1. Read `/mnt/attach/project-files/atlas-ui-redesign/round2/lc-krsau21t/alpha.py` -> first 3 lines: `1 def alpha_one():` / `2     return 1` / `3 (blank)`; last 3 lines: `5 def alpha_two(x):` / `6     return x * 2` / `7 (end of file)`';
  const BETA = '1. Read /mnt/attach/project-files/atlas-ui-redesign/round2/lc-krsau21t/beta.py -> line 1 `def beta_sum(a, b):`, line 2 `    return a + b`, line 3 empty, ... lines 5-6 `class BetaBox:` / `    pass`, line 7 empty (file is 7 lines)';
  test('a file dump reads as a count of what was found', () => {
    expect(lastOf({ ...none, lastTool: 'Read' }, 'done', [ALPHA])).toBe('2 functions found');
    expect(lastOf({ ...none, lastTool: 'Read' }, 'done', [BETA])).toBe('1 function found');
  });
  test('a dump with nothing to count reads `<file> read`', () => {
    expect(lastOf({ ...none, lastTool: 'Read' }, 'done', ['1. Read `/a/b/notes.md` -> first 3 lines: `# Notes` / `` / `text`'])).toBe('notes.md read');
  });
  test('a plain outcome stays, to its first sentence', () => {
    expect(lastOf(none, 'done', ['tests green'])).toBe('tests green');
    expect(lastOf(none, 'done', ['3 files changed. Then more words that are not the outcome.'])).toBe('3 files changed.');
  });
  test('a tool echo whose result is short keeps the result only', () => {
    expect(lastOf(none, 'done', ['1. Read `/tmp/p/alpha.py` -> alpha_one (line 1), alpha_two (line 5)'])).toBe('alpha_one (line 1), alpha_two (line 5)');
  });
  test('a STATUS line gives its word', () => {
    expect(lastOf(none, 'done', ['STATUS: BLOCKED FILES_CHANGED: none'])).toBe('blocked');
  });
  test('a killed agent reads `killed`, not the call it was making (f0088.ans:34 `read ghost.py`)', () => {
    expect(lastOf({ ...none, lastTool: 'Read', target: 'ghost.py' }, 'failed', [])).toBe('killed');
    expect(lastOf({ ...none, tool: 'Read', target: 'ghost.py' }, 'running', [])).toBe('read ghost.py');
  });
  test('the HUD rows show the outcome in the LAST column (f0088.ans:33-35)', () => {
    const plan = ['T1 read alpha.py (alpha-explorer)', 'T2 read ghost.py (ghost-explorer)', 'T3 read beta.py (beta-explorer)'].map((c, i): TodoItem => ({ id: `p${i}`, content: c, status: 'completed', owner: ['alpha-explorer', 'ghost-explorer', 'beta-explorer'][i], origin: 'session', session_id: '' }) as unknown as TodoItem);
    const dispatch = (owner: string, evidence: string): TodoItem => ({ id: `d-${owner}`, content: `Read ${owner}`, status: 'completed', owner, origin: 'dispatch', session_id: '', evidence }) as unknown as TodoItem;
    const agent = (name: string, state: string, extra: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: state as never, model: 'haiku', since: NOW - 1000, ...extra });
    const agents = [agent('alpha-explorer', 'done', { lastTool: 'Read' }), agent('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' }), agent('beta-explorer', 'done', { lastTool: 'Read' })];
    const rows = hudLines({ todos: [...plan, dispatch('alpha-explorer', ALPHA), dispatch('beta-explorer', BETA)], agents }, { cols: 150, maxRows: 30, ui, now: NOW }).map(runsString);
    const of = (n: string): string => rows.find((r) => r.includes(` ${n} `) && /haiku/.test(r))!;
    expect(of('alpha-explorer')).toContain('2 functions found');
    expect(of('ghost-explorer')).toContain('killed');
    expect(of('beta-explorer')).toContain('1 function found');
    for (const r of rows) expect(r).not.toMatch(/first 3 lines|-> line 1/);
  });
});

describe('B2: at 110 columns the SUBAGENTS rows keep MODEL, TASK and LAST', () => {
  const agent = (name: string, over: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state: 'working', ui: 'running', model: 'haiku', task: `${name}: read ${name.split('-')[0]}.py`, tool: 'Read', target: `${name.split('-')[0]}.py`, ...over });
  const plan: TodoItem[] = ['alpha', 'beta', 'gamma'].map((n, i) => ({ id: `t${i}`, content: `T${i + 1} read ${n}.py (${n}-explorer)`, status: 'pending', owner: `${n}-explorer` }) as unknown as TodoItem);
  const input: HudInput = { todos: plan, agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((n) => agent(n)) };
  test('the column names include LAST and every row shows what the agent is doing (61 cells: the transcript beside the docked pane)', () => {
    const rows = hudLines(input, { cols: 61, maxRows: 30, ui, now: NOW }).map(runsString);
    const head = rows.find((r) => /AGENT\s+STATE/.test(r))!;
    expect(head).toContain('LAST');
    for (const n of ['alpha', 'beta', 'gamma']) expect(rows.find((r) => r.includes(`${n}-explorer`) && r.includes('haiku'))).toContain(`read ${n}.py`);
    for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(61);
  });
  test('a new row reveals its name only: MODEL and TASK are whole on every frame (f0039.ans:30 `gamma-explor` with both blank)', () => {
    const fewer: HudInput = { ...input, agents: input.agents.slice(0, 2) };
    const mo = new Motion(true);
    mo.observe('hud-agents', hudMotionItems(fewer, { now: 1000 }).agents, 0);
    mo.observe('hud-agents', hudMotionItems(input, { now: 1000 }).agents, 1000);
    for (const dt of [0, 40, 100, 200]) {
      const rows = hudLines(input, { cols: 61, maxRows: 30, ui, now: 1005, motion: mo.ctx(1000 + dt) }).map(runsString);
      const agentRows = rows.slice(rows.findIndex((r) => r.includes('SUBAGENTS')) + 2); // under the column names
      const gamma = agentRows[2]!; // the newest row, third in start order
      expect([dt, gamma.includes('haiku'), gamma.includes('T3')]).toEqual([dt, true, true]);
    }
  });
});

describe('B3: the SUBAGENTS block stays after a clean finish', () => {
  test('three done agents, long after they ended: the block is still drawn (live-150-a4fad2f9-3/tab-team.png)', () => {
    const done = (n: string): HudAgent => ({ name: n, role: 'explorer', state: 'done', ui: 'done', model: 'haiku', since: NOW - 3_600_000, lastTool: 'Read' });
    const todos: TodoItem[] = [{ id: 'a', content: 'T1 read alpha.py (alpha-explorer)', status: 'completed', owner: 'alpha-explorer' } as unknown as TodoItem];
    const rows = hudLines({ todos, agents: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map(done) }, { cols: 150, maxRows: 30, ui, now: NOW }).map(runsString);
    expect(rows.some((r) => r.includes('SUBAGENTS'))).toBe(true);
    expect(rows.filter((r) => /haiku/.test(r))).toHaveLength(3);
  });
});

describe('B4: at 10 rows with 5 todos and 3 agents the band keeps a row, the blank between the blocks stays', () => {
  const agent = (n: string): HudAgent => ({ name: n, role: 'explorer', state: 'working', ui: 'running', model: 'haiku', tool: 'Read', target: `${n.split('-')[0]}.py` });
  const plan = (statuses: string[]): TodoItem[] => statuses.map((s, i) => ({ id: `t${i}`, content: `T${i + 1} step ${i + 1} (${['alpha', 'beta', 'gamma'][i] ?? 'lead'}-explorer)`, status: s, owner: ['alpha', 'beta', 'gamma'][i] ? `${['alpha', 'beta', 'gamma'][i]}-explorer` : undefined }) as unknown as TodoItem);
  const agents = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map(agent);
  const slot = (todos: TodoItem[], cols: number, budget: number): { hud: string[]; gap: number; band: number } => {
    const input: HudInput = { todos, agents };
    const cap = hudSlotCap(budget, hudCompactRows(input, cols), hudFloorRows(input, cols, NOW), 7, true, true);
    const hud = hudLines(input, { cols, maxRows: cap, ui, now: NOW }).map(runsString);
    const gap = hudGapRows(hud.some((r) => r.includes('SUBAGENTS')) && !hud.at(-1)!.includes('SUBAGENTS'), hud.length, budget);
    return { hud, gap, band: budget - hud.length - gap };
  };
  test('3 done, 2 open: the done rows fold to `3 done` on the ribbon, both open rows, the blank and the header stay', () => {
    const { hud, band } = slot(plan(['completed', 'completed', 'completed', 'pending', 'pending']), 61, 10);
    expect(band).toBeGreaterThanOrEqual(1);
    expect(hud[0]).toMatch(/TODO .*3 done/);
    expect(hud.filter((r) => /T[45] step/.test(r))).toHaveLength(2);
    expect(hud.some((r) => /T[123] step/.test(r))).toBe(false);
    const at = hud.findIndex((r) => r.includes('SUBAGENTS'));
    expect(hud[at - 1]!.trim()).toBe('');
    expect(hud[at + 1]).toMatch(/AGENT\s+STATE/);
    expect(hud.filter((r) => /haiku/.test(r))).toHaveLength(3);
  });
  test('all open (the live frame): the band still keeps a row and every agent stays', () => {
    const { hud, band } = slot(plan(['in_progress', 'in_progress', 'in_progress', 'pending', 'pending']), 61, 10);
    expect(band).toBeGreaterThanOrEqual(1);
    expect(hud.filter((r) => /haiku/.test(r))).toHaveLength(3);
    expect(hud.length).toBeLessThanOrEqual(9);
  });
  test('a roomy slot is unchanged (hudBudget still floors at the compact form)', () => {
    expect(hudBudget(14, 10, 7, true)).toBe(10);
    expect(hudSlotCap(14, 10, 12, 7, true, true)).toBe(12);
  });
});

describe('B5: route rows do not wrap at 110, and one strip form serves every tab', () => {
  const todos = [
    { id: '1', label: 'T1 read alpha.py (alpha-explorer)', state: 'done' as const, owner: 'alpha-explorer' },
    { id: '2', label: 'T2 read ghost.py (ghost-explorer)', state: 'blocked' as const, owner: 'ghost-explorer' },
    { id: '3', label: 'T4 combine the reports', state: 'queued' as const },
  ];
  test('37 cells (the 110-column pane): one row per task, title then state, no owner on its own line', () => {
    const rows = bodyLines(panelWorld('route', 37, ui, { todos, workers: [], rows: 40 })).map((l) => lineText(l).trimEnd());
    const t1 = rows.findIndex((r) => r.includes('T1 read alpha.py'));
    expect(rows[t1]).toMatch(/T1 read alpha\.py\s+done$/);
    const t2 = rows.findIndex((r) => r.includes('T2 read ghost.py'));
    expect(rows[t2]).toMatch(/T2 read ghost\.py\s+blocked$/);
    expect(rows.some((r) => /^\s+\(alpha-explorer\)/.test(r))).toBe(false);
    for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(37);
  });
  test('wide panes keep the owner in the title as before', () => {
    const rows = bodyLines(panelWorld('route', 120, ui, { todos, workers: [], rows: 40 })).map((l) => lineText(l).trimEnd());
    expect(rows.some((r) => r.includes('T1 read alpha.py (alpha-explorer)'))).toBe(true);
  });
  test('the strip is the same on every tab at every width; the keys are named where they fit (critique 18: under 53 cells the six words are one row and the keys stay bound)', () => {
    for (const cols of [37, 44, 47, 52, 60, 80, 120]) {
      const forms = (['route', 'team', 'channel', 'gates', 'core', 'board'] as const).map((t) => JSON.stringify(stripLayout(cols, t)));
      expect([cols, new Set(forms).size]).toEqual([cols, 1]);
      expect([cols, tabRows(panelWorld('route', cols, ui)).map(lineText).join('\n')]).toEqual([cols, expect.stringMatching(cols >= 54 ? /r: route/ : /^ route {1,2}team {1,2}channel {1,2}gates {1,2}core {1,2}board$/m)]);
    }
  });
});
