// One derived TODO row state for every surface: the HUD TODO block and the side panel's route tab are built from the same snapshot and must say
// the same state word row by row (critique 9: `T1 running` in the HUD against `queued` on the route tab; a returned owner fell back to `queued`).
import { describe, expect, test } from 'claude-code/testing';
import { worldSidebar, worldSnapshot } from '../contracts/world-live';
import { todoState } from './data/todos';
import { liveWorkers, queuedMembers } from './data/live';
import { agentModel, hudAgents, hudLines } from './hud';
import { hudPhases } from './band';
import { panelModelOf } from './pane/sidebar-model';
import { panelText } from './panel-layout';
import type { Ui } from './atlas-ui';
import type { LiveSnapshot } from './orchestra-types';
import type { TodoItem } from './contract';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const WORDS = 'queued|running|done|failed|blocked|waiting|returned';

describe('todoState', () => {
  test('a returned owner reads `returned` in the attention tone (blocked), never queued', () => {
    expect(todoState('pending', 'done')).toEqual({ state: 'blocked', word: 'returned' });
    expect(todoState('in_progress', 'done')).toEqual({ state: 'blocked', word: 'returned' });
    expect(todoState('ended', undefined)).toEqual({ state: 'blocked' });
  });
  test('the rest is the board rule', () => {
    expect(todoState('pending', 'running')).toEqual({ state: 'running' });
    expect(todoState('pending', undefined)).toEqual({ state: 'queued' });
    expect(todoState('completed', 'done')).toEqual({ state: 'done' });
    expect(todoState('pending', 'failed')).toEqual({ state: 'queued', word: 'worker failed' }); // critique 18 B3 (the queued glyph), critique 19 A3 (the word)
    expect(todoState('in_progress', 'failed')).toEqual({ state: 'failed' });
    expect(todoState('pending', 'waiting')).toEqual({ state: 'blocked' });
    expect(todoState('abandoned', 'done')).toEqual({ state: 'failed' });
  });
});

/** The world, with the store still holding every plan row open (pending) while its owner works, returned or failed. */
function openStore(): LiveSnapshot {
  const w = worldSnapshot();
  const todos = w.todos.map((t): TodoItem => { const { claimed_at: _c, completed_at: _d, ...rest } = t; return { ...rest, status: 'pending' } as TodoItem; });
  return { ...w, todos };
}

const hudRows = (s: LiveSnapshot, cols: number): string[] =>
  hudLines({ todos: s.todos, agents: hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), root: s.root, phases: hudPhases(s) }, { cols, maxRows: 60, ui, now: s.now }).map((r) => r.map((x) => x.t).join('').trimEnd());

/** `label head -> state word` for each plan row, read from the printed rows. */
function wordsOf(rows: readonly string[], s: LiveSnapshot): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of s.todos) {
    const head = t.content.replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 14);
    const row = rows.find((r) => r.includes(head));
    const m = row ? new RegExp(`(${WORDS})`).exec(row.slice(row.indexOf(head) + head.length)) : null;
    out[head] = m ? m[1]! : 'absent';
  }
  return out;
}

describe('HUD TODO block and the route tab agree row by row', () => {
  test('a returned owner reads `returned` on both, not `queued`', () => {
    const s = openStore();
    const hud = wordsOf(hudRows(s, 120), s);
    const route = wordsOf(panelText(panelModelOf(worldSidebar('route', 119, s), ui, 119)), s);
    expect(Object.values(hud)).not.toContain('absent');
    expect(route).toEqual(hud);
    expect(Object.values(hud)).toContain('returned');
    expect(Object.values(hud)).toContain('running');
  });
});

describe('SUBAGENTS order follows the T rows inside a state', () => {
  test('running agents list in plan order, not start order', () => {
    const t = (id: string, owner: string): TodoItem => ({ id, content: `task ${id}`, status: 'in_progress', owner, session_id: 's', origin: 'session' }) as TodoItem;
    const todos = [t('T1', 'alpha'), t('T2', 'beta'), t('T3', 'gamma')];
    const agent = (name: string) => ({ name, role: 'explorer', state: 'running', ui: 'running' as const });
    const rows = agentModel([agent('beta'), agent('gamma'), agent('alpha')] as never, todos);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows.map((r) => r.tasks)).toEqual([[1], [2], [3]]);
  });
  test('an agent with no plan row follows those with one; state still ranks first', () => {
    const todos = [{ id: 'T1', content: 'one', status: 'pending', owner: 'b', session_id: 's', origin: 'session' }] as TodoItem[];
    const a = (name: string, u: 'running' | 'done') => ({ name, role: 'x', state: u === 'done' ? 'done' : 'running', ui: u });
    expect(agentModel([a('loose', 'running'), a('b', 'running'), a('gone', 'done')] as never, todos).map((r) => r.name)).toEqual(['b', 'loose', 'gone']);
  });
});
