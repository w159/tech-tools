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
  /** False when no first-sight time was recorded (a worker only the host lists): its start is unknown, so it is never `starting`. */
  seen?: boolean;
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
      return { name: a.name, role: a.persona, state, tool: act?.tool ?? null, lastTool: act?.lastTool ?? null, since: act?.since ?? now, startedAt: act?.startedAt ?? act?.since ?? now, target: act?.target ?? null, detail: act?.detail ?? null, lastLine: act?.lastLine ?? '', calls: act?.calls ?? [], scope: act?.scope ?? null, seen: act?.startedAt !== undefined };
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

/** A working worker with no call yet reads `starting` (queued) for this long after it was first seen; after it, `thinking`. */
export const STARTING_MS = 90_000;

/** A worker's state word before the first call: working with nothing in flight and nothing answered yet, seen within STARTING_MS. */
export const isStarting = (w: LiveWorker, now: number): boolean => w.seen !== false && w.state === 'working' && !w.tool && !w.lastTool && now - w.startedAt <= STARTING_MS;

/** The one state word of a worker, for every surface (HUD, band, side panel): a starting worker reads queued (design: `◇ queued`),
 * a working one running (tool in flight or thinking between calls), blocked reads waiting (it waits for the lead), parked queued. */
export function liveState(w: LiveWorker, now: number): UiState {
  return isStarting(w, now) ? 'queued' : workerUiState(w.state);
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
