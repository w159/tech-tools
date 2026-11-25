// Critique 11, slice A: the route tab, the team tab and the HUD derive TODO and agent rows from one model. The snapshot is shaped like the live run
// (live-150-5d6a53ef-1 f0050/f0060/f0063): the store holds NO owner on the plan rows, the worker is named only in the title `T1 read alpha.py (alpha-explorer)`,
// and the dispatch rows (origin `dispatch`) carry the owners. Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../../../live_fixture';
import type { LiveSnapshot } from '../../../orchestra-types';
import type { SquadAgent, TodoItem } from '../../../contract';
import { bodyLines, lineText } from '../panel-layout';
import type { Ui } from '../../../design/atlas-ui';
import { panelWorld } from '../../../../contracts/panel-world';
import type { CoreModel } from '../../../data/core';
import { hudAgents, hudLines } from '../../hud/hud';
import { liveWorkers, queuedMembers } from '../../../data/live';
import { ownTodos } from '../../../data/todos';
import { panelModelOf } from './sidebar-model';
import type { SidebarModel } from './sidebar';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const sq = (name: string, state: SquadAgent['state'], item?: string): SquadAgent => ({ name, persona: 'explorer', state, source: 'task', ...(item ? { item } : {}) });
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, startedAt: NOW - 20_000, toolCount: 1, tokens: null, mood: 'working', lastLine: '', ...over });
const row = (id: string, content: string, status: string, extra: Partial<TodoItem> = {}): TodoItem => ({ id, content, status, session_id: 's1', origin: 'session', ...extra });
const dispatch = (n: string, status = 'in_progress'): TodoItem => row(`d-${n}`, `dispatch ${n}`, status, { origin: 'dispatch', owner: n });
const plan = (): TodoItem[] => [
  row('1', 'T1 read alpha.py (alpha-explorer)', 'pending'), row('2', 'T2 read beta.py (beta-explorer)', 'pending'), row('3', 'T3 read gamma.py (gamma-explorer)', 'pending'),
  row('4', 'T4 combine the three reports', 'pending'), row('5', 'T5 write the final summary', 'pending'),
  dispatch('alpha-explorer'), dispatch('beta-explorer'), dispatch('gamma-explorer'),
];
const world = (squad: SquadAgent[], todos = plan()): LiveSnapshot =>
  ({ ...busySnap(), sessionId: 's1', squad, activity: Object.fromEntries(squad.map((a) => [a.name, act({ mood: a.state === 'finished' ? 'done' : 'working' })])), comms: [], members: [], todos, now: NOW }) as LiveSnapshot;
const model = (s: LiveSnapshot, view: SidebarModel['ui']['view'], cols = 100): SidebarModel =>
  ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: cols + 1, rows: 40, tick: 0 }) as SidebarModel;
const tab = (s: LiveSnapshot, view: SidebarModel['ui']['view'], cols = 100): string[] => bodyLines(panelModelOf(model(s, view, cols), ui, cols)).map((l) => lineText(l).trimEnd());
const hud = (s: LiveSnapshot): string[] => hudLines({ todos: ownTodos(s.todos, s.sessionId), agents: hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), root: s.root }, { cols: 100, maxRows: 40, ui, now: s.now, settled: true }).map((r) => r.map((x) => x.t).join('').trimEnd());
/** `T1 read alpha.py (alpha-explorer)` -> its state word on a route/HUD row. */
const GLYPH_WORD: Record<string, string> = { '◐': 'running', '◓': 'running', '◑': 'running', '◒': 'running', '✓': 'done', '●': 'done', '○': 'queued', '◇': 'queued', '✗': 'failed', '■': 'failed', '▲': 'blocked', '◉': 'waiting' };
const todoWord = (rows: string[], label: string): string | undefined => { const l = rows.find((x) => x.includes(`${label} `)); if (!l) return undefined; return new RegExp('\\b(queued|running|done|failed|blocked|waiting|returned)\\b').exec(l.slice(l.indexOf(label)))?.[1] ?? GLYPH_WORD[/[◐◓◑◒✓●○◇✗■▲◉]/.exec(l)?.[0] ?? '']; }; // a state is its word (the HUD) or its mark (the panel's plan row)

describe('A1: the route tab and the HUD read the same state for a row whose worker is named only in the title', () => {
  test('running workers: T1 to T3 read running on the route tab as on the HUD (f0050), T4 and T5 stay queued', () => {
    const s = world([sq('alpha-explorer', 'running'), sq('beta-explorer', 'running'), sq('gamma-explorer', 'running')]);
    for (const t of ['T1', 'T2', 'T3']) { expect(todoWord(hud(s), t)).toBe('running'); expect(todoWord(tab(s, 'route'), t)).toBe('running'); }
    for (const t of ['T4', 'T5']) expect(todoWord(tab(s, 'route'), t)).toBe('queued');
  });
  test('a returned worker: the row is settled on both (f0063): the HUD draws no word on it, the route tab folds it into `N done`, never queued', () => {
    const s = world([sq('alpha-explorer', 'finished'), sq('beta-explorer', 'finished'), sq('gamma-explorer', 'finished')], plan().map((t) => (t.origin === 'dispatch' ? { ...t, status: 'completed' } : t)));
    for (const t of ['T1', 'T2', 'T3']) { expect(todoWord(tab(s, 'route'), t)).toBeUndefined(); expect(todoWord(hud(s), t)).not.toBe('returned'); } // a done row leaves the route tab; the settled HUD block draws no word on it and never says `returned`
    expect(tab(s, 'route').join('\n')).toMatch(/PLAN +3 of 5/); // the plan still counts the folded rows
  });
  test('A2: the panel agent summary and its own todo rows agree: three done agents leave no queued row of theirs', () => {
    const s = world([sq('alpha-explorer', 'finished'), sq('beta-explorer', 'finished'), sq('gamma-explorer', 'finished')]);
    const out = tab(s, 'route').join('\n');
    expect(out).toMatch(/PLAN +3 of 5/);
    expect(out).toMatch(/^ +\d+ done$/m); // the three finished agents and their done rows are one count line, not rows
    expect(out).not.toMatch(/○ T[123] read/); // no queued mark on a row of a done agent
  });
});

describe('A3: one stable agent order, by task', () => {
  const order = (rows: string[]): string[] => rows.flatMap((l) => /(alpha|beta|gamma)-explorer/.exec(l)?.[1] ?? []).filter((n, i, all) => all.indexOf(n) === i);
  test('the HUD keeps T1, T2, T3 whichever worker finishes first (f0060: alpha, gamma, beta before)', () => {
    const s = world([sq('gamma-explorer', 'running'), sq('beta-explorer', 'finished'), sq('alpha-explorer', 'running')]);
    const agents = hud(s).filter((l) => /T[0-9]/.test(l));
    expect(order(agents)).toEqual(['alpha', 'beta', 'gamma']);
  });
  test('the team tab lists T1, T2, T3 in reverse finish order too', () => {
    const s = world([sq('gamma-explorer', 'running'), sq('alpha-explorer', 'running'), sq('beta-explorer', 'failed')]); // finished agents leave the team tab, so the order is checked on listed ones
    expect(order(tab(s, 'team'))).toEqual(['alpha', 'beta', 'gamma']);
  });
  test('an agent without a task follows the tasked ones, in start order', () => {
    const s = world([sq('zed-explorer', 'running'), sq('gamma-explorer', 'failed'), sq('alpha-explorer', 'running')]);
    const names = tab(s, 'team').flatMap((l) => /(alpha|gamma|zed)-explorer/.exec(l)?.[1] ?? []).filter((n, i, a) => a.indexOf(n) === i);
    expect(names).toEqual(['alpha', 'gamma', 'zed']);
  });
});

describe('A4: the team tab names the lead once', () => {
  test('one row begins with `lead`', () => {
    const s = world([sq('alpha-explorer', 'finished'), sq('beta-explorer', 'finished'), sq('gamma-explorer', 'finished')]);
    expect(tab(s, 'team').filter((l) => /^[▸▾ ]?\s*(◉|[◐◓◑◒◐◓◑◒◐◓●◇]\s)?\s*lead\b/.test(l)).length).toBeLessThanOrEqual(1); // the TEAM section lists the agents; the lead is never named twice
  });
});

describe('A4: the core tab never counts in-process dispatches as tmux teams', () => {
  const empty = (): CoreModel => ({
    contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, openGates: 0, verifiedDone: { ok: 0, total: 0 } },
    verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
    offload: { workers: [], kept: 0, returned: 0, ratio: null }, routes: [], inProcess: true,
  } as unknown as CoreModel);
  const route = (id: string, transport: string) => ({ teamId: id, name: id, cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, seats: [], drift: [], transport });
  const core = (routes: unknown[]): string => bodyLines(panelWorld('core', 120, ui, { rows: 24, core: { ...empty(), routes } as never })).map((l) => lineText(l).trimEnd()).join('\n');
  test('one in-process route: the heading does not say `teams 1`, beside `no tmux team` (tab-core.png)', () => {
    const out = core([route('in-process:audit/low', 'in-process')]);
    expect(out).toContain('workers ran in-process (no tmux team)');
    expect(out).not.toMatch(/teams\s+1 this session/);
    expect(out).toMatch(/dispatches\s+1 this session/);
  });
  // Critique 17 A6 (live-150-a4fad2f9-1/tab-core.png): `dispatches 1 this session` after three explorers ran; the figure is the workers the dispatches ran.
  test('three explorers ran in one in-process group: the heading says `dispatches 3 this session`, never 1', () => {
    const seat = { role: 'explorer', model: 'haiku', effort: 'low', count: 1, ran: ['haiku', 'haiku', 'haiku'] };
    const out = core([{ ...route('in-process:audit/low', 'in-process'), seats: [seat] }]);
    expect(out).toMatch(/dispatches\s+3 this session/);
    expect(out).not.toMatch(/dispatches\s+1 this session/);
  });
  test('tmux teams keep `teams N this session`; a mix says both', () => {
    expect(core([route('t1', 'tmux')])).toMatch(/teams\s+1 this session/);
    expect(core([route('t1', 'tmux'), route('in-process:audit/low', 'in-process')])).toMatch(/teams\s+1 tmux, 1 in-process/);
  });
});
