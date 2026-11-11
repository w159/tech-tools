// One worker list for every surface: squad + per-agent activity, lead excluded, urgent first.
import type { UiState } from '../atlas-ui';
import type { LiveSnapshot } from '../orchestra-types';

export interface LiveWorker {
  name: string;
  role: string;
  state: 'working' | 'blocked' | 'failed' | 'parked' | 'done';
  tool: string | null;
  /** The tool answered last; the band shows it dimmed between calls. */
  lastTool: string | null;
  /** Current-tool time (moves every call). */
  since: number;
  /** First sight of the worker; the age shown to people. */
  startedAt: number;
  target: string | null;
  /** The current (else last) call's intent, as omp's tool preview shows it. */
  detail?: string | null;
  lastLine: string;
  /** Tool start times over the last minute (tool-call history). */
  calls: number[];
  /** Dispatch `SCOPE:` value (`audit/medium`), when the prompt carried one. */
  scope: string | null;
}

const ORDER = { blocked: 0, failed: 1, working: 2, parked: 3, done: 4 } as const;

// Takes LiveSnapshot (AtlasSnapshot & activity): AtlasSnapshot alone has no per-agent activity.
export function liveWorkers(snapshot: LiveSnapshot, now: number): LiveWorker[] {
  return snapshot.squad
    .filter((a) => a.name !== 'lead')
    .map((a): LiveWorker => {
      const act = snapshot.activity[a.name];
      // Host-listed completion wins over a stale 'blocked' mood; only live squad states can be blocked.
      const state = a.state === 'finished' ? 'done'
        : a.state === 'failed' || a.state === 'dead' ? 'failed'
        : a.state === 'parked' ? 'parked'
        : act?.mood === 'blocked' || a.state === 'input' || a.state === 'stuck' ? 'blocked'
        : act?.mood === 'failed' ? 'failed'
        : act?.mood === 'done' ? 'done'
        : 'working';
      return { name: a.name, role: a.persona, state, tool: act?.tool ?? null, lastTool: act?.lastTool ?? null, since: act?.since ?? now, startedAt: act?.startedAt ?? act?.since ?? now, target: act?.target ?? null, detail: act?.detail ?? null, lastLine: act?.lastLine ?? '', calls: act?.calls ?? [], scope: act?.scope ?? null };
    })
    .sort((x, y) => ORDER[x.state] - ORDER[y.state]);
}

/** Calls per `bucketMs` slot over the last `n` slots, oldest first. */
export function callBuckets(calls: readonly number[], now: number, n = 12, bucketMs = 5000): number[] {
  const out = new Array<number>(n).fill(0);
  for (const t of calls) {
    const slot = n - 1 - Math.floor((now - t) / bucketMs);
    if (slot >= 0 && slot < n) out[slot]! += 1;
  }
  return out;
}

export const activeCount = (ws: LiveWorker[]) => ws.filter((w) => w.state === 'working' || w.state === 'blocked').length;

/** What the data shows about one worker; `workerWord` turns it into the state word. */
export type WorkerEvidence = {
  /** The host lists the worker (a squad entry, a registry row). False: dispatched, not seen yet. */
  listed: boolean;
  /** How it ended, when it has. */
  outcome?: 'done' | 'failed';
  /** The board says it waits (on the lead, on input). */
  blocked?: boolean;
};

/** THE state rule, one for every surface and both hosts (band, HUD, side panel, board, omp). A state word comes from the
 * data, never from a clock: queued = dispatched but the host does not list the worker yet; running = the host lists it (a
 * tool in flight or not); done and failed from the outcome; waiting from the board. */
export function workerWord(e: WorkerEvidence): UiState {
  if (e.outcome) return e.outcome;
  if (!e.listed) return 'queued';
  return e.blocked ? 'waiting' : 'running';
}

/** The one state word of a host-listed worker, for every surface (HUD, band, side panel). A parked worker is one the host
 * lists as resting: it has not started the work, so it reads queued, the one place a listed worker is not running. */
export function liveState(w: LiveWorker): UiState {
  if (w.state === 'parked') return 'queued';
  return workerWord({ listed: true, outcome: w.state === 'done' || w.state === 'failed' ? w.state : undefined, blocked: w.state === 'blocked' });
}

/** The same mapping for a bare state word (a fixture's `running` and `queued` pass through; an unknown word reads running). */
export function workerUiState(state: string): UiState {
  switch (state) {
    case 'working': case 'running': return 'running';
    case 'blocked': case 'waiting': return 'waiting';
    case 'failed': return 'failed';
    case 'done': return 'done';
    case 'parked': case 'queued': return 'queued';
    default: return 'running';
  }
}

/** Dispatched members the host does not list: roster rows still open (no `ended_at`), not the lead, not in the squad. Each is
 * a queued worker on every surface, until the host lists it. */
export function queuedMembers(s: Pick<LiveSnapshot, 'members' | 'squad'>): string[] {
  const listed = new Set(s.squad.map((a) => a.name));
  const names = s.members.filter((x) => !x.ended_at && x.role !== 'lead' && x.name !== 'lead' && !x.name.startsWith('lead-') && !listed.has(x.name)).map((x) => x.name);
  return [...new Set(names)];
}

/** Name -> state word of every worker a surface lists: the host-listed workers and the queued members. */
export function workerStates(s: Pick<LiveSnapshot, 'members' | 'squad'>, workers: readonly LiveWorker[]): Map<string, UiState> {
  return new Map<string, UiState>([...queuedMembers(s).map((n): [string, UiState] => [n, 'queued']), ...workers.map((w): [string, UiState] => [w.name, liveState(w)])]);
}

/** Items with their owner's state word attached (`ownerState`), for the board and the TODO tree. */
export const withOwnerStates = <T extends { owner?: string }>(items: readonly T[], states: ReadonlyMap<string, UiState>): (T & { ownerState?: UiState })[] =>
  items.map((it) => { const o = it.owner ? states.get(it.owner) : undefined; return o ? { ...it, ownerState: o } : { ...it }; });
