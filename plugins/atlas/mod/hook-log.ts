// hook-log.ts: the mod's own count of the host events its hooks see this session (prompt, tool call, turn end, Stop, measure). The idle health reads it: the `hooks` row's detail,
// the `last event` figure, the side panel's recent-activity list. Only what a handler really saw is stored; nothing is made up, and it is empty after a reset.
import type { EngineInterface } from 'claude-code';

export type HookEvent = { label: string; at: number };
export type HookStats = {
  total: number;
  /** Events seen this session by kind (the label's first word: `tool.call` for `tool.call Bash`), most frequent first. */
  byLabel: { label: string; n: number }[];
  /** The newest events, newest first, with their age at `now` in whole seconds. */
  recent: { label: string; ageSecs: number }[];
  /** Age of the newest event that is not the session's own start (the figure `last event 12s ago`); absent when none. */
  lastEventSecs?: number;
};

const KEEP = 64;
let log: HookEvent[] = [];
const counts = new Map<string, number>();

/** A new session starts an empty log. */
export function resetHookLog(): void {
  log = [];
  counts.clear();
}

/** Record one event the handlers saw, at the engine clock `at` (ms); an event with no clock reading is not recorded. */
export function noteHook(label: string, at: number | undefined): void {
  if (at === undefined || !Number.isFinite(at)) return;
  log.push({ label, at });
  if (log.length > KEEP) log = log.slice(-KEEP);
  const kind = label.split(' ')[0]!;
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
}

/** The engine clock for a handler; undefined when it cannot be read (a hook never fails for it). */
export async function hookStamp($: EngineInterface): Promise<number | undefined> {
  try { return await $.clock.now(); } catch { return undefined; }
}

export function hookStats(now: number, max = 8): HookStats {
  const recent = [...log].reverse().slice(0, max).map((e) => ({ label: e.label, ageSecs: Math.max(0, Math.floor((now - e.at) / 1000)) }));
  const last = [...log].reverse().find((e) => e.label !== 'session.start');
  return {
    total: [...counts.values()].reduce((n, x) => n + x, 0),
    byLabel: [...counts].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    recent,
    ...(last ? { lastEventSecs: Math.max(0, Math.floor((now - last.at) / 1000)) } : {}),
  };
}
