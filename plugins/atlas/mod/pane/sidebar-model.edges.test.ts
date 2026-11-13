// Edge pins for panelModelOf (surviving mutants of the 553a9bce run): the detail text of each of the five worker states, the age in
// seconds, the roster order of the six state words, a todo's owner rule (failed owner fails it, waiting owner blocks it) and the
// defaults of tick and evidence. Expectations are literal values.
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import type { SquadAgent } from '../contract';
import type { Ui } from '../atlas-ui';
import { panelModelOf } from './sidebar-model';
import type { SidebarModel } from './sidebar-types';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const sq = (name: string, state: SquadAgent['state']): SquadAgent => ({ name, persona: 'runner', state, source: 'task' });
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...over });
const world = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ ...busySnap(), squad: [], activity: {}, comms: [], members: [], todos: [], todoGroups: [], now: NOW, ...over }) as LiveSnapshot;
const model = (snapshot: LiveSnapshot, over: Partial<SidebarModel> = {}): SidebarModel =>
  ({ snapshot, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 80, rows: 40, tick: 0, ...over }) as SidebarModel;
const workers = (s: LiveSnapshot) => panelModelOf(model(s), ui, 80).workers;
const byName = (s: LiveSnapshot, name: string) => workers(s).find((w) => w.name === name)!;

describe('worker detail per state', () => {
  const s = world({
    squad: [sq('run-tool', 'running'), sq('run-bare', 'running'), sq('run-last', 'running'), sq('run-idle', 'running'), sq('fail-line', 'failed'), sq('fail-none', 'failed'), sq('done-line', 'finished'), sq('done-none', 'finished'), sq('wait', 'running'), sq('park', 'parked')],
    activity: {
      'run-tool': act({ tool: 'Grep', target: 'src/a.ts' }),
      'run-bare': act({ tool: 'Bash' }),
      'run-last': act({ lastTool: 'Edit' }),
      'run-idle': act(),
      'fail-line': act({ lastLine: 'boom\n  at   line 3' }),
      'fail-none': act(),
      'done-line': act({ lastLine: 'all   green' }),
      'done-none': act(),
      wait: act({ mood: 'blocked', lastLine: 'ignored' }),
      park: act({ lastLine: 'ignored' }),
    } as never,
  });
  test('running reads the tool and target, the bare tool, the last tool or plain thinking', () => {
    // The HUD's LAST form (hud.ts lastAction): the call in lower case, its target after it; between calls the last call.
    expect(byName(s, 'run-tool')).toMatchObject({ state: 'running', detail: 'grep src/a.ts' });
    expect(byName(s, 'run-bare')).toMatchObject({ state: 'running', detail: 'bash' });
    expect(byName(s, 'run-last')).toMatchObject({ state: 'running', detail: 'edit' });
    expect(byName(s, 'run-idle')).toMatchObject({ state: 'running', detail: 'thinking' });
  });
  test('failed and done read the last line on one line, else the state word', () => {
    expect(byName(s, 'fail-line')).toMatchObject({ state: 'failed', detail: 'boom at line 3' });
    expect(byName(s, 'fail-none')).toMatchObject({ state: 'failed', detail: 'failed' });
    expect(byName(s, 'done-line')).toMatchObject({ state: 'done', detail: 'all green' });
    expect(byName(s, 'done-none')).toMatchObject({ state: 'done', detail: 'finished' });
  });
  test('a blocked worker reads waiting for the lead, a parked one reads parked, whatever their last lines say', () => {
    expect(byName(s, 'wait')).toMatchObject({ state: 'waiting', detail: 'waiting for lead reply' });
    expect(byName(s, 'park')).toMatchObject({ state: 'queued', detail: 'parked' });
  });
});

describe('worker age and order', () => {
  test('secs is the whole seconds since the worker started, and never negative', () => {
    const s = world({ squad: [sq('past', 'running'), sq('future', 'running')], activity: { past: act({ startedAt: NOW - 5400, toolCount: 7 }), future: act({ startedAt: NOW + 9000 }) } as never });
    expect(byName(s, 'past')).toMatchObject({ secs: 5, tools: 7 });
    expect(byName(s, 'future').secs).toBe(0);
  });
  test('a finished worker keeps its own run time (start to finish), not the time since it started', () => {
    // critique 8: the team tab read 1m10s for agents whose cards read 14s to 19s; the 18 s run ended 52 s before the snapshot
    const s = world({
      squad: [sq('dn', 'finished'), sq('fl', 'failed'), sq('rn', 'running'), sq('nofin', 'finished')],
      activity: { dn: act({ startedAt: NOW - 70_000, since: NOW - 52_000 }), fl: act({ startedAt: NOW - 70_000, since: NOW - 61_000 }), rn: act({ startedAt: NOW - 70_000 }), nofin: act({ startedAt: NOW - 70_000, since: NOW - 70_000 }) } as never,
    });
    expect(byName(s, 'dn').secs).toBe(18);
    expect(byName(s, 'fl').secs).toBe(9);
    expect(byName(s, 'rn').secs).toBe(70); // a running worker still counts to now
    expect(byName(s, 'nofin').secs).toBe(70); // no finish stamp (since == start): fall back to now rather than show 0s
  });
  test('start order, never state order (critique 11 A3): the squad as listed, then the dispatched members the host does not list', () => {
    const s = world({
      squad: [sq('dn', 'finished'), sq('pk', 'parked'), sq('fl', 'failed'), sq('bl', 'running'), sq('rn', 'running')],
      activity: { dn: act(), pk: act(), fl: act(), bl: act({ mood: 'blocked' }), rn: act() } as never,
      members: [{ name: 'qm' }] as never,
    });
    expect(workers(s).map((w) => `${w.name}:${w.state}`)).toEqual(['dn:done', 'pk:queued', 'fl:failed', 'bl:waiting', 'rn:running', 'qm:queued']);
  });
});

describe('todos from the board groups', () => {
  const squad = [sq('fl', 'failed'), sq('bl', 'running'), sq('rn', 'running')];
  const activity = { fl: act({ lastLine: 'boom' }), bl: act({ mood: 'blocked' }), rn: act({ tool: 'Grep', target: 'src' }) } as never;
  const item = (id: string, status: string, owner: string | null, evidence: string | null = null) => ({ id, content: `item ${id}`, status, owner, evidence, live: true });
  const groups = [{ phase: 'implement', dept: 'FORGE', glyph: 'x', done: 0, total: 5, items: [item('a', 'in_progress', 'fl'), item('b', 'pending', 'bl'), item('c', 'pending', 'rn'), item('d', 'pending', null), item('e', 'completed', 'fl', 'tests green')] }];
  const todos = panelModelOf(model(world({ squad, activity, todoGroups: groups as never })), ui, 80).todos!;
  const t = (id: string) => todos.find((x) => x.id === id)!;
  test('a failed owner fails the item and shows the owner line', () => {
    expect(t('a')).toMatchObject({ state: 'failed', detail: 'boom', owner: 'fl' });
  });
  test('a waiting owner blocks the item and the detail says why', () => {
    expect(t('b')).toMatchObject({ state: 'blocked', detail: 'blocked: waiting for lead reply', owner: 'bl' });
  });
  test('a running owner or no owner carries no detail; a finished item whose worker failed reads `closed` red and carries no detail: the pane draws `killed` once (critique 17 A1, wave 30)', () => {
    expect(t('c').detail).toBeUndefined();
    expect(t('c').state).not.toBe('failed');
    expect(t('d')).toMatchObject({ detail: undefined, owner: undefined });
    expect(t('e')).toMatchObject({ state: 'done', word: 'closed', detail: undefined });
  });
  test('evidence passes through, and an item without evidence reads null', () => {
    expect(t('e').evidence).toBe('tests green');
    expect(t('a').evidence).toBeNull();
    expect(t('d').evidence).toBeNull();
  });
});

describe('defaults', () => {
  test('a model without a tick reads tick 0', () => {
    expect(panelModelOf(model(world(), { tick: undefined }), ui, 80).tick).toBe(0);
    expect(panelModelOf(model(world(), { tick: 3 }), ui, 80).tick).toBe(3);
  });
});
