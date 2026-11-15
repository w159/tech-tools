// hook-log.ts: the mod's own count of the host events its hooks see this session (prompt, tool call, turn end, Stop, measure). The idle health reads it: the `hooks` row's detail,
// the `last event` figure, the side panel's recent-activity list. Only what a handler really saw is stored; nothing is made up, and it is empty after a reset.
import type { EngineInterface } from 'claude-code';

export type HookEvent = { label: string; at: number; /** The handler's own latency in whole ms (N1), set when its hook handed the event on. */ ms?: number };
export type HookStats = {
  total: number;
  /** Events seen this session by kind (the label's first word: `tool.call` for `tool.call Bash`), most frequent first. */
  byLabel: { label: string; n: number }[];
  /** The newest events, newest first, with their age at `now` in whole seconds. */
  recent: { label: string; ageSecs: number; /** The mod's own handler time for this event in whole ms (N1); absent while it is unmeasured (a boot, an event whose hook stamped no exit). */ ms?: number }[];
  /** Age of the newest event that is not the session's own start (the figure `last event 12s ago`); absent when none. */
  lastEventSecs?: number;
  /** Tool calls seen since the run began (`hookStats`'s `since`, the run clock's start); absent when no run is open. The band's `N tools` is this, not the session's total. */
  runTools?: number;
  /** The tool of the newest `tool.call` event of this run (the label's word after `tool.call`, as `Bash`); absent when the run has seen none or the label carried no name. The band's `◓ research · Bash`. */
  runTool?: string;
  /** How long the mod's own handlers held an event before handing it on (N1): the median and p95 over every sample of the session, `n` samples; absent before the first. */
  latency?: { n: number; p50: number; p95: number };
  /** Per label kind (the label's first word: `tool.call` for `tool.call Bash`): events seen, the handler latency median and p95 over that kind's samples (absent while unmeasured), and the age in whole seconds of its newest event (absent when it never fired). The status tab's HOOKS table reads it. */
  perHook?: { label: string; n: number; p50?: number; p95?: number; lastSecs?: number }[];
};

/** N2: the hooks the mod wires and stamps (`6 hooks` armed on the status tab): session start, prompt, tool call, Stop, measure, turn end. */
export const WIRED_HOOKS: readonly string[] = ['session.start', 'prompt.submit', 'tool.call', 'classic.Stop', 'session.measure', 'turn.complete'];

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
/** The engine clock of the newest event of each kind (the label's first word). */
const lastAtKind = new Map<string, number>();
/** Handler latency samples in ms, a ring of KEEP per label (N1). */
const latencies = new Map<string, number[]>();

/** A new session starts an empty log. */
export function resetHookLog(): void {
  log = [];
  stamps = [];
  toolStamps = [];
  lastTool = null;
  newest = -Infinity;
  counts.clear();
  lastAtKind.clear();
  latencies.clear();
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
  lastAtKind.set(kind, Math.max(lastAtKind.get(kind) ?? -Infinity, at));
}

/**
 * N1: one handler's own latency, `endAt - startAt` in whole ms of the engine clock, kept per label (a ring of KEEP). Handlers stamp at entry (the `at` they give noteHook) and again right before they hand
 * the event on with `next`, so the figure is the mod's work, never the tool or turn the host runs after it. The clock's resolution is the engine's own (whole ms): a sub-millisecond handler reads 0.
 */
export function noteHookMs(label: string, startAt: number | undefined, endAt: number | undefined): void {
  if (startAt === undefined || endAt === undefined || !Number.isFinite(startAt) || !Number.isFinite(endAt)) return;
  const ring = latencies.get(label) ?? [];
  const ms = Math.max(0, Math.round(endAt - startAt));
  ring.push(ms);
  if (ring.length > KEEP) ring.shift();
  latencies.set(label, ring);
  for (let i = log.length - 1; i >= 0; i--) { // the event this handler stamped: the newest one of this label at its entry reading
    const e = log[i]!;
    if (e.label === label && e.at === startAt) { if (e.ms === undefined) e.ms = ms; break; }
  }
}

/** `noteHookMs` with the exit stamp read here; call it right before `next(e)`. */
export async function hookDone($: EngineInterface, label: string, startAt: number | undefined): Promise<void> {
  noteHookMs(label, startAt, await hookStamp($));
}

/** The engine clock for a handler; undefined when it cannot be read (a hook never fails for it). */
export async function hookStamp($: EngineInterface): Promise<number | undefined> {
  try { return await $.clock.now(); } catch { return undefined; }
}

const rank = (sorted: readonly number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!;

export function hookStats(now: number, max = 8, since?: number): HookStats {
  const samples = [...latencies.values()].flat().sort((a, b) => a - b);
  const recent = [...log].reverse().slice(0, max).map((e) => ({ label: e.label, ageSecs: Math.max(0, Math.floor((now - e.at) / 1000)), ...(e.ms !== undefined ? { ms: e.ms } : {}) }));
  const last = [...log].reverse().find((e) => e.label !== 'session.start');
  const perHook = [...counts].map(([label, n]) => {
    const ms = [...latencies].filter(([l]) => l.split(' ')[0] === label).flatMap(([, v]) => v).sort((a, b) => a - b);
    const at = lastAtKind.get(label);
    return { label, n, ...(ms.length ? { p50: rank(ms, 0.5), p95: rank(ms, 0.95) } : {}), ...(at !== undefined ? { lastSecs: Math.max(0, Math.floor((now - at) / 1000)) } : {}) };
  });
  return {
    perHook,
    total: [...counts.values()].reduce((n, x) => n + x, 0),
    byLabel: [...counts].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    recent,
    ...(last ? { lastEventSecs: Math.max(0, Math.floor((now - last.at) / 1000)) } : {}),
    ...(samples.length ? { latency: { n: samples.length, p50: rank(samples, 0.5), p95: rank(samples, 0.95) } } : {}),
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

/** The raw event clock readings of the last `spanMs` before `now` (oldest first): the status chart buckets them itself, to its own width, aligned to the wall clock. */
export function eventStamps(now: number, spanMs = 300_000): number[] {
  return stamps.filter((t) => t >= now - spanMs - 1000 && t <= now + 1000);
}
