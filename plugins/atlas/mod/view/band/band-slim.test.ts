// Band slimming: the slot is the band alone. Done todos and finished agents add no HUD rows; the band keeps its status row and key chips and never lists TODO, SUBAGENTS or worker lanes.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import type { Ui } from '../../design/atlas-ui';
import { bandTree, hudPhases, type BandModel } from './band';
import type { SquadAgent, TodoItem } from '../../contract';
import { liveWorkers, queuedMembers } from '../../data/live';
import { ownTodos } from '../../data/todos';
import { hudAgents, isRunning, type HudInput } from '../hud/hud';
import { busySnap, NOW } from '../../live_fixture';
import { composeSlot } from './slot';
import type { Segment } from '../../design/runs';

type Node = { kind: string; props: Record<string, unknown> };
const mk = (kind: string) => (props: Record<string, unknown>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const textOf = (n: unknown): string => {
  const c = (n as Node).props?.children;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).map(textOf).join('');
};
function rowsOf(n: Node): string[] {
  const kids = (n.props.children ?? []) as Node[];
  const boxes = (Array.isArray(kids) ? kids : [kids]).filter((k) => k && (k as Node).kind === 'Box');
  return boxes.length === 0 ? [textOf(n)] : boxes.flatMap((b) => rowsOf(b as Node));
}
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const handlers = { openView: () => undefined, toggleTodos: () => undefined };

function frame(running: boolean, cols = 93) {
  const squad = [{ name: 'a-explorer', persona: 'explorer', state: running ? 'running' : 'finished', source: 'task', task: 'a-explorer: read a.py' }] as SquadAgent[];
  const todos = [{ id: 't1', content: 'T1 read a.py', status: running ? 'in_progress' : 'completed', owner: 'a-explorer' }] as unknown as TodoItem[];
  const snapshot = busySnap({
    sessionId: 's', phase: 'research' as never, phaseSource: 'header', contextPct: 7, squad, comms: [], members: [],
    activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: running ? 'working' : 'idle', lastLine: '' }, 'a-explorer': { tool: null, since: NOW - 2_000, startedAt: NOW - 9_000, toolCount: 1, tokens: 1, mood: running ? 'working' : 'done', lastLine: '' } } as never,
    todos, counts: { done: running ? 0 : 1, total: 1, byPhase: {} }, todoGroups: [],
  });
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const bandIn = (_h: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates: [] as never, working: running, workSecs: 9, columns: cols, tick: 3, ui, rich: false, maxRows, lastPhase: null } as BandModel);
  const plan = composeSlot({ budget: 20, hasSlot: true, hudOn: true, runOn: running, columns: cols, hudIn, hudView: { cols, tick: 3, ui, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn, held: 0 });
  return { plan, rows: rowsOf(bandTree(els, plan.band, handlers) as unknown as Node) };
}

describe('the slot is the band alone', () => {
  test('a done todo and a finished agent leave no HUD rows', () => {
    expect(frame(false).plan.hud.length).toBe(0);
  });
  for (const running of [true, false]) {
    test(`${running ? 'running' : 'finished'}: at most 3 rows, no TODO / SUBAGENTS / lane rows, the status row stays`, () => {
      const { rows } = frame(running);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThanOrEqual(3);
      const all = rows.join('\n');
      expect(all).not.toMatch(/TODO|SUBAGENTS|a-explorer|T1 read/);
      expect(rows[0]).toMatch(/ATLAS/);
    });
  }
});
