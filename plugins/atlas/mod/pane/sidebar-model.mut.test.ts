// Mutation-kill tests for sidebar-model.ts (seed 1105 survivors): the task tag of a worker is its item id when that is five
// characters or fewer.
//
// Equivalent mutants, not tested (RANK, line 16):
//  - blocked 1 -> 2: workerOf() takes its state from liveState() -> workerWord(), which never returns `blocked` (a blocked
//    worker reads `waiting`), and queued members are `queued`, so no PanelWorker carries `blocked` and RANK.blocked is never read.
//  - waiting 2 -> 3 and failed 3 -> 4: liveWorkers() has already sorted by ORDER (blocked, failed, working, parked, done), so
//    waiting precedes failed and failed precedes queued in the input, and the queued members are appended last. A tie under
//    the (stable) sort keeps that order, which is the order RANK gives, so the output is identical for every input.
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import type { SquadAgent } from '../contract';
import type { Ui } from '../atlas-ui';
import { panelModelOf } from './sidebar-model';
import type { SidebarModel } from './sidebar-types';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const sq = (name: string, item?: string): SquadAgent => ({ name, persona: 'runner', state: 'running', source: 'task', ...(item === undefined ? {} : { item }) });
const act = { tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' };
const world = (squad: SquadAgent[]): LiveSnapshot =>
  ({ ...busySnap(), squad, activity: Object.fromEntries(squad.map((a) => [a.name, act])), comms: [], members: [], todos: [], todoGroups: [], now: NOW }) as unknown as LiveSnapshot;
const taskOf = (item: string | undefined): string | undefined => {
  const m = ({ snapshot: world([sq('w', item)]), gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 80, rows: 40, tick: 0 }) as unknown as SidebarModel;
  return panelModelOf(m, ui, 80).workers.find((w) => w.name === 'w')!.task;
};

describe('channel people count', () => {
  test('a member who left is not counted, one still present is', () => {
    const snap = { ...world([]), notes: [], members: [{ name: 'here' }, { name: 'gone', ended_at: '2026-11-11T10:00:00Z' }] } as unknown as LiveSnapshot;
    const m = ({ snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'channel' }, columns: 80, rows: 40, tick: 0 }) as unknown as SidebarModel;
    expect(panelModelOf(m, ui, 80).people).toBe(1);
  });
});

describe('workerOf: the task tag', () => {
  test('an item id of five characters or fewer shows upper-cased', () => {
    expect(taskOf('t4')).toBe('T4');
    expect(taskOf('abcde')).toBe('ABCDE');
  });
  test('a longer item id, or none, shows no tag', () => {
    expect(taskOf('abcdef')).toBeUndefined();
    expect(taskOf('implement-the-band')).toBeUndefined();
    expect(taskOf(undefined)).toBeUndefined();
  });
});

describe('workerOf: the elapsed seconds', () => {
  test('elapsed time is the snapshot clock minus the start, in thousandths of a second rounded', () => {
    const snap = world([sq('w')]);
    snap.activity.w = { ...act, startedAt: NOW - 1_000_000 } as never;
    const m = ({ snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 80, rows: 40, tick: 0 }) as unknown as SidebarModel;
    expect(panelModelOf(m, ui, 80).workers.find((w) => w.name === 'w')!.secs).toBe(1000);
  });
});

describe('panelModelOf: the default width', () => {
  const model = (columns: number): SidebarModel => ({ snapshot: world([]), gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns, rows: 40, tick: 0 }) as unknown as SidebarModel;
  test('is one column less than the pane, and never under ten', () => {
    expect(panelModelOf(model(80), ui).cols).toBe(79);
    expect(panelModelOf(model(5), ui).cols).toBe(10);
  });
});
