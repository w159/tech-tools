// pulse.ts: the observed-only history the band, side panel and health card draw shapes from (spark, gauge, run bars). Nothing is invented:
// an empty session is all zeros and empty rings, and every sample is something a handler really saw this session.
//
// API
//   type Pulse = { events: number[]; ctx: CtxSample[]; runs: RunSample[]; window?: number; cost?: { usd: number } }
//     events  hook events per 15 s bucket aligned to the wall clock (slot = floor(at / 15 s)), BUCKETS (28) buckets, OLDEST FIRST, the last is the window holding `now` (from hook-log's stamps); the band draws the last 8, the panel 20, the card 28 of this one series
//     ctx     the last CTX_KEEP (24) context measures, oldest first: { tokens, pct (0..100), at }
//     runs    the last RUNS_KEEP (12) finished runs, oldest first: { secs, ok, at }
//     window  the model's context window in tokens from the newest measure (the `of 1M` figure); absent until measured
//     cost    session.measure's `cost.usd` as of the newest measure that carried one; the key is absent when the host sent none
//   BUCKETS, BUCKET_MS, CTX_KEEP, RUNS_KEEP   the constants above
//   RATE_BUCKETS, rateLabel(events)   the last 20 buckets (5 min) summed as `6/5m`
//   noteMeasure(e, at)   record one session.measure input (only `context.tokens`, `context.percent`, `context.window`, `cost.usd` are read)
//   noteRunEnd(secs, ok, at)   record one finished run
//   pulseOf(now)         the current Pulse at engine clock `now` (ms)
//   resetPulse()         a new session: empty rings, no cost (the event stamps are cleared by hook-log's resetHookLog)
import { eventBuckets } from './hook-log';

export type CtxSample = { tokens: number; pct: number; at: number };
export type RunSample = { secs: number; ok: boolean; at: number };
export type Pulse = { events: number[]; ctx: CtxSample[]; runs: RunSample[]; window?: number; cost?: { usd: number } };
/** The fields of the host's `session.measure` input the pulse reads (a structural subset of SessionMeasureInput). */
export type MeasureLike = { context: { tokens?: number; percent?: number; window?: number }; cost?: { usd: number } };

export const BUCKETS = 28;
export const BUCKET_MS = 15_000;
export const CTX_KEEP = 24;
export const RUNS_KEEP = 12;
/** The buckets of the rate window: 20 x 15 s = 5 minutes. */
export const RATE_BUCKETS = 20;
/** The events rate, `6/5m`: the events of the last five minutes (the newest RATE_BUCKETS of the series). */
export const rateLabel = (events: readonly number[]): string => `${events.slice(-RATE_BUCKETS).reduce((n, x) => n + x, 0)}/5m`;

let ctx: CtxSample[] = [];
let runs: RunSample[] = [];
let windowTokens: number | undefined;
let cost: { usd: number } | undefined;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function resetPulse(): void {
  ctx = [];
  runs = [];
  windowTokens = undefined;
  cost = undefined;
}

export function noteMeasure(e: MeasureLike, at: number): void {
  const { tokens, percent, window } = e.context;
  if (finite(window) && window > 0) windowTokens = window;
  if (finite(tokens)) {
    const pct = finite(percent) ? percent : finite(window) && window > 0 ? Math.round((tokens / window) * 100) : undefined;
    if (pct !== undefined) ctx = [...ctx, { tokens, pct, at }].slice(-CTX_KEEP);
  }
  if (e.cost && finite(e.cost.usd)) cost = { usd: e.cost.usd };
}

export function noteRunEnd(secs: number, ok: boolean, at: number): void {
  if (!finite(secs) || !finite(at)) return;
  runs = [...runs, { secs, ok, at }].slice(-RUNS_KEEP);
}

export function pulseOf(now: number): Pulse {
  return {
    events: eventBuckets(now, BUCKETS, BUCKET_MS),
    ctx: ctx.map((s) => ({ ...s })),
    runs: runs.map((r) => ({ ...r })),
    ...(windowTokens !== undefined ? { window: windowTokens } : {}),
    ...(cost ? { cost: { ...cost } } : {}),
  };
}
