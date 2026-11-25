// Wave 36: the SUBAGENTS table's CALLS column and the finish card's `· N calls` read the same figure (the live worker's call list), so a finished worker never shows two counts.
import { describe, expect, test } from 'claude-code/testing';
import { resetWorkerFacts } from '../data/live';
import type { Ui } from '../design/atlas-ui';
import { hudPhases } from './band/band';
import type { SquadAgent } from '../contract';
import { liveWorkers, queuedMembers } from '../data/live';
import { ownTodos } from '../data/todos';
import { hudAgents, hudLines, type HudInput } from './hud/hud';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import { notificationTree } from './transcript/cards';
import { finishedWorkers } from './transcript/placed';

/** The text of an element tree, run records included. */
function flat(n: unknown): string {
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(flat).join('');
  if (n === null || typeof n !== 'object') return '';
  const o = n as Record<string, unknown>;
  if (typeof o.t === 'string') return o.t;
  const kids = o.props && typeof o.props === 'object' && 'children' in (o.props as object) ? (o.props as { children: unknown }).children : o.children;
  return flat(kids) + (Array.isArray(o.runs) ? flat(o.runs) : '');
}
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

const CALLS = [NOW - 12_000, NOW - 10_000, NOW - 8_000, NOW - 6_000, NOW - 5_000];
function snapshot(state: 'running' | 'finished', calls: number[] | undefined): LiveSnapshot {
  const squad = [{ name: 'alpha-explorer', persona: 'explorer', state, source: 'task', task: 'alpha-explorer: read alpha.py' }] as SquadAgent[];
  return busySnap({
    sessionId: 's', phase: 'research' as never, phaseSource: 'header', contextPct: 7, squad, comms: [],
    activity: {
      lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: 'working', lastLine: '' },
      'alpha-explorer': { tool: null, since: NOW - 3_000, startedAt: NOW - 14_000, toolCount: calls?.length ?? 0, tokens: 100, mood: state === 'running' ? 'working' : 'done', lastLine: '', ...(calls ? { calls } : {}) },
    } as never,
    todos: [{ id: 't1', content: 'T1 read alpha.py', status: state === 'running' ? 'in_progress' : 'completed', owner: 'alpha-explorer' }] as never, counts: { done: state === 'running' ? 0 : 1, total: 1, byPhase: {} }, todoGroups: [],
  });
}

function tableRow(snap: LiveSnapshot): string {
  const live = liveWorkers(snap, snap.now);
  const agents = hudAgents(live, snap.squad, queuedMembers(snap));
  const hudIn: HudInput = { todos: ownTodos(snap.todos ?? [], snap.sessionId), agents, root: snap.root, phases: hudPhases(snap, null) };
  // The slot no longer draws the SUBAGENTS table (the status tab owns it); hudLines is the same table both read.
  const rows = hudLines(hudIn, { cols: 93, maxRows: 20, ui, now: snap.now, tick: 3 }).map((r) => r.map((x) => x.t).join(''));
  return rows.find((r) => /^[│▌] \S alpha-explorer\s/.test(r)) ?? '';
}

describe('CALLS column and finish card share one count', () => {
  test('a finished worker with 5 calls: the table row ends the CALLS cell in 5 and the card reads `· 5 calls`', () => {
    resetWorkerFacts();
    const prev = snapshot('running', CALLS);
    const next = snapshot('finished', CALLS);
    const fw = finishedWorkers(prev, next);
    expect(fw).toHaveLength(1);
    expect(fw[0]!.calls).toBe(CALLS.length);
    const card = flat(notificationTree(fw[0]!.name, fw[0]!.role, 'finished · 0:14', false, ui, false, { cols: 60, calls: fw[0]!.calls }));
    expect(card).toContain(`· ${CALLS.length} calls`);
    const row = tableRow(next);
    expect(row, 'the table row for the finished worker').not.toBe('');
    expect(row.split(/\s+/)).toContain(String(CALLS.length));
  });
  test('no calls seen: the card prints no count and the table draws no count cell', () => {
    resetWorkerFacts();
    const prev = snapshot('running', undefined);
    const next = snapshot('finished', undefined);
    const fw = finishedWorkers(prev, next);
    expect(fw[0]!.calls).toBeUndefined();
    expect(flat(notificationTree(fw[0]!.name, fw[0]!.role, 'finished · 0:14', false, ui, false, { cols: 60, calls: fw[0]!.calls }))).not.toMatch(/calls?\b/);
    const row = tableRow(next);
    expect(row).not.toBe('');
    expect(row.split(/\s+/).filter((t) => /^\d+$/.test(t))).toEqual([]); // redesign: a column with no figure in any row is dropped, so no count is drawn at all
    expect(row.trimEnd().split(/\s+/).at(-3)).toBe('finished'); // the NOW / RESULT cell is never blank: it reads finished here, then the TIME cell
  });
});
