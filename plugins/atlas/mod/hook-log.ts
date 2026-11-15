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
  /** Tool calls seen since the run began (`hookStats`'s `since`, the run clock's start); absent when no run is open. The band's `N tools` is this, not the session's total. */
  runTools?: number;
  /** The tool of the newest `tool.call` event of this run (the label's word after `tool.call`, as `Bash`); absent when the run has seen none or the label carried no name. The band's `◓ research · Bash`. */
  runTool?: string;
};

const KEEP = 64;
/** Every event's clock reading for the pulse series; only the last STAMP_SPAN_MS before the newest is kept (the 64-entry log would drop a busy minute). */
const STAMP_SPAN_MS = 450_000;
const STAMP_CAP = 4096;
let log: HookEvent[] = [];
let stamps: number[] = [];
let toolStamps: number[] = [];
let lastTool: { name: string; at: number } | null = null;
let newest = -Infinity;
const counts = new Map<string, number>();

/** A new session starts an empty log. */
export function resetHookLog(): void {
  log = [];
  stamps = [];
  toolStamps = [];
  lastTool = null;
  newest = -Infinity;
  counts.clear();
}

/** Record one event the handlers saw, at the engine clock `at` (ms); an event with no clock reading is not recorded. */
export function noteHook(label: string, at: number | undefined): void {
  if (at === undefined || !Number.isFinite(at)) return;
  log.push({ label, at });
  stamps.push(at);
  newest = Math.max(newest, at);
  if (stamps[0]! < newest - STAMP_SPAN_MS || stamps.length > STAMP_CAP) stamps = stamps.filter((t) => t >= newest - STAMP_SPAN_MS).slice(-STAMP_CAP);
  if (log.length > KEEP) log = log.slice(-KEEP);
  const kind = label.split(' ')[0]!;
  if (kind === 'tool.call') {
    toolStamps = [...toolStamps, at].slice(-STAMP_CAP);
    const name = label.slice(kind.length).trim();
    lastTool = name ? { name, at } : null;
  }
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
}

/** The engine clock for a handler; undefined when it cannot be read (a hook never fails for it). */
export async function hookStamp($: EngineInterface): Promise<number | undefined> {
  try { return await $.clock.now(); } catch { return undefined; }
}

export function hookStats(now: number, max = 8, since?: number): HookStats {
  const recent = [...log].reverse().slice(0, max).map((e) => ({ label: e.label, ageSecs: Math.max(0, Math.floor((now - e.at) / 1000)) }));
  const last = [...log].reverse().find((e) => e.label !== 'session.start');
  return {
    total: [...counts.values()].reduce((n, x) => n + x, 0),
    byLabel: [...counts].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    recent,
    ...(last ? { lastEventSecs: Math.max(0, Math.floor((now - last.at) / 1000)) } : {}),
    ...(since !== undefined ? { runTools: toolStamps.filter((t) => t >= since).length } : {}),
    ...(since !== undefined && lastTool && lastTool.at >= since ? { runTool: lastTool.name } : {}),
  };
}

/**
 * Events per bucket as the handlers really saw them: `buckets` slots of `bucketMs`, OLDEST FIRST, aligned to the wall clock (round 2, D5): an event's slot is
 * floor(at / bucketMs), the last slot is floor(now / bucketMs), so two `now` values in one window give the same series and a bar never slides under the reader.
 * An event older than the whole span is not counted; one stamped after `now` counts in the newest slot. Before any event every slot is 0.
 */
export function eventBuckets(now: number, buckets = 28, bucketMs = 15_000): number[] {
  const out = new Array<number>(buckets).fill(0);
  const cur = Math.floor(now / bucketMs);
  for (const at of stamps) {
    const slot = buckets - 1 - Math.max(0, cur - Math.floor(at / bucketMs));
    if (slot >= 0) out[slot]!++;
  }
  return out;
}
