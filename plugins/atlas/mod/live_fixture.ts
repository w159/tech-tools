// LiveSnapshot fixtures for the view layout tests (band, colony, channel).
// Deterministic; no Node APIs.
import type { SquadAgent } from './contract';
import type { LiveSnapshot } from './orchestra-types';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS } from './test_helpers';

export const NOW = FIXTURE_EPOCH_MS;

const worker = (name: string, persona: string, state: SquadAgent['state'], task: string): SquadAgent => ({ name, persona, state, source: 'task', task });

/** An idle session: lead only, nothing live. */
function idleSnap(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return {
    root: '/r', sessionId: 's', channel: 'lead-1', contract: FIXTURE_CONTRACT, personas: [], todos: [],
    counts: { done: 0, total: 0, byPhase: {} }, phase: 'research', phaseSource: 'default',
    notes: [], members: [], squad: [], contextPct: 12, now: NOW,
    activity: { lead: { tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' } },
    comms: [], todoGroups: [],
    ...over,
  };
}

/** One lead plus a working explorer, a blocked implementer and a failed runner. */
export function busySnap(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const act = (tool: string | null, mood: LiveSnapshot['activity'][string]['mood'], n: number) =>
    ({ tool, since: NOW - 42_000, toolCount: n, tokens: 1200 * n, mood, lastLine: 'found 3 call sites' });
  return idleSnap({
    phase: 'implement',
    counts: { done: 2, total: 5, byPhase: {} },
    squad: [
      worker('explorer-1', 'explorer', 'running', 'map the auth flow'),
      worker('impl-auth', 'implementer', 'input', 'edit auth middleware'),
      worker('runner-1', 'runner', 'failed', 'run the test suite'),
    ],
    activity: {
      lead: act('Agent', 'working', 4),
      'explorer-1': act('Grep', 'working', 9),
      'impl-auth': act(null, 'blocked', 3),
      'runner-1': act(null, 'failed', 2),
    },
    comms: [
      { seq: 1, ts: NOW - 60_000, from: 'lead', to: 'explorer-1', text: 'map the auth flow', kind: 'dispatch' },
      { seq: 2, ts: NOW - 30_000, from: 'explorer-1', to: 'lead', text: 'found 3 call sites in auth/', kind: 'report' },
      { seq: 3, ts: NOW - 5_000, from: 'impl-auth', to: 'lead', text: 'need a decision on the token ttl', kind: 'say' },
    ],
    todoGroups: [
      { phase: 'implement', dept: 'FORGE', glyph: '🔧', done: 1, total: 3, items: [
        { id: 't1', content: 'edit auth middleware', status: 'in_progress', owner: 'impl-auth', evidence: null, live: true },
        { id: 't2', content: 'add ttl config', status: 'pending', owner: null, evidence: null, live: true },
        { id: 't3', content: 'old refactor', status: 'completed', owner: 'impl-auth', evidence: 'tests green', live: false },
      ] },
      { phase: 'unsorted', dept: 'UNSORTED', glyph: '·', done: 0, total: 1, items: [
        { id: 't4', content: 'triage inbox', status: 'pending', owner: null, evidence: null, live: true },
      ] },
    ],
    ...over,
  });
}
