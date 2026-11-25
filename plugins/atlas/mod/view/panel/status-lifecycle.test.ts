// Status lifecycle: the status tab lists what is open (running workers, open todos), and a finished worker's elapsed time stops counting.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from '../../design/atlas-ui';
import { panelWorld } from '../../../contracts/panel-world';
import { liveWorkers, endedAt } from '../../data/live';
import { busySnap, NOW } from '../../live_fixture';
import { lineText, panelLines, type PanelModel } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const todo = (id: string, label: string, state: string) => ({ id, label, state });
const worker = (name: string, state: string, secs: number) => ({ name, role: 'explorer', state, secs });
const text = (m: PanelModel): string => panelLines(m).map((l) => lineText(l)).join('\n');

describe('status tab hides finished items', () => {
  test('lists the running worker and the open todo, not the done ones', () => {
    const m = panelWorld('route', 90, ui, {
      rows: 40, phases: ['research', 'implement'], phase: 'implement', entered: ['research', 'implement'],
      todos: [todo('t1', 'T1 finished job', 'done'), todo('t2', 'T2 open job', 'running')],
      workers: [worker('done-explorer', 'done', 30), worker('live-explorer', 'running', 12)],
      gates: [], notes: [], run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 },
    } as never);
    const t = text(m);
    expect(t).toContain('T2 open job');
    expect(t).toContain('live-explorer');
    expect(t).not.toContain('T1 finished job');
    expect(t).not.toContain('done-explorer');
    expect(t).toMatch(/2 done/);
  });
});

describe('status tab derived from a live snapshot', () => {
  type Row = { name: string; squad: 'running' | 'finished' | 'failed'; mood: string; plan: 'in_progress' | 'completed' };
  const model = (rows: Row[]): PanelModel => panelModelOf({
    snapshot: busySnap({
      sessionId: 's', notes: [],
      squad: rows.map((x) => ({ name: x.name, persona: 'explorer', state: x.squad, source: 'task' })),
      activity: Object.fromEntries(rows.map((x) => [x.name, { tool: x.mood === 'working' ? 'Read' : null, since: NOW - 4_000, startedAt: NOW - 14_000, toolCount: 1, tokens: 1, mood: x.mood, lastLine: '' }])),
      todos: rows.map((x, i) => ({ id: `t${i + 1}`, content: `T${i + 1} job of ${x.name}`, status: x.plan, owner: x.name, session_id: 's' })),
    } as never),
    gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 91, rows: 60, look: ui,
  } as never, ui, 90);
  const lines = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l));

  test('a plan row whose agent finished never reads running while its neighbour still runs', () => {
    const m = model([{ name: 'alpha-explorer', squad: 'finished', mood: 'done', plan: 'in_progress' }, { name: 'beta-explorer', squad: 'running', mood: 'working', plan: 'in_progress' }]);
    expect(m.todos.map((t) => t.state)).toEqual(['done', 'running']);
    const t = lines(m);
    expect(t.filter((l) => /T1 job/.test(l) && /[◐◓◑◒]/.test(l))).toEqual([]);
    expect(t.find((l) => /T2 job/.test(l))).toMatch(/[◐◓◑◒] T2 job/);
  });

  test('the `✗ 1 failed` tally and the `N done` line never double-count the same item', () => {
    // T2 was closed over a failed worker: it counts as failed, never among the done ones.
    const t = lines(model([
      { name: 'alpha-explorer', squad: 'finished', mood: 'done', plan: 'completed' },
      { name: 'ghost-explorer', squad: 'failed', mood: 'failed', plan: 'completed' },
      { name: 'beta-explorer', squad: 'running', mood: 'working', plan: 'in_progress' },
    ]));
    expect(t.find((l) => l.includes(' TEAM'))).toMatch(/✗ 1 failed/);
    expect(t.filter((l) => /^ +\d+ done$/.test(l)).map((l) => l.trim())).toEqual(['2 done']); // alpha and its row T1
    expect(t.find((l) => l.includes(' PLAN'))).toMatch(/1 of 3/);
    expect(t.filter((l) => /✗ T2 job/.test(l))).toHaveLength(1);
    expect(t.filter((l) => /✗ ghost-explorer/.test(l))).toHaveLength(1);
  });
});

describe('a finished worker stops counting', () => {
  // A pane worker the mod first sees already finished: no start stamp, so `startedAt` falls back to the finish stamp.
  const snap = (mood: string) => busySnap({
    squad: [{ name: 'w', persona: 'explorer', state: mood === 'done' ? 'finished' : 'running', source: 'task', task: 'w: go' }],
    activity: { lead: { tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' }, w: { tool: null, since: NOW - 5_000, toolCount: 1, tokens: 1, mood, lastLine: '' } },
  } as never);
  const elapsed = (mood: string, now: number): number => {
    const w = liveWorkers(snap(mood), now).find((x) => x.name === 'w')!;
    return endedAt(w, now) - w.startedAt;
  };
  test('finished: identical at now and now+60s', () => {
    expect(elapsed('done', NOW + 60_000)).toBe(elapsed('done', NOW));
  });
  test('running: grows', () => {
    expect(elapsed('working', NOW + 60_000)).toBeGreaterThan(elapsed('working', NOW));
  });
});
