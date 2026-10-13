// One worker list for every surface: squad + per-agent activity, lead excluded, urgent first.
import type { LiveSnapshot } from '../orchestra-types';

export interface LiveWorker {
  name: string;
  role: string;
  state: 'working' | 'blocked' | 'failed' | 'parked' | 'done';
  tool: string | null;
  /** Current-tool time (moves every call). */
  since: number;
  /** First sight of the worker; the age shown to people. */
  startedAt: number;
  target: string | null;
  lastLine: string;
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
      return { name: a.name, role: a.persona, state, tool: act?.tool ?? null, since: act?.since ?? now, startedAt: act?.startedAt ?? act?.since ?? now, target: act?.target ?? null, lastLine: act?.lastLine ?? '' };
    })
    .sort((x, y) => ORDER[x.state] - ORDER[y.state]);
}

export const activeCount = (ws: LiveWorker[]) => ws.filter((w) => w.state === 'working' || w.state === 'blocked').length;
