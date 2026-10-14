// One worker list for every surface: squad + per-agent activity, lead excluded, urgent first.
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
  lastLine: string;
  /** Tool start times over the last minute (sparkline). */
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
      return { name: a.name, role: a.persona, state, tool: act?.tool ?? null, lastTool: act?.lastTool ?? null, since: act?.since ?? now, startedAt: act?.startedAt ?? act?.since ?? now, target: act?.target ?? null, lastLine: act?.lastLine ?? '', calls: act?.calls ?? [], scope: act?.scope ?? null };
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
