// pulse.ts: the observed-only history the band, side panel and health card draw shapes from (spark, gauge, run bars). Nothing is invented:
// an empty session is all zeros and empty rings, and every sample is something a handler really saw this session.
//
// API
//   type Pulse = { events: number[]; ctx: CtxSample[]; runs: RunSample[]; window?: number; cost?: { usd: number } }
//     events  hook events per 15 s bucket aligned to the wall clock (slot = floor(at / 15 s)), BUCKETS (28) buckets, OLDEST FIRST, the last is the window holding `now` (from hook-log's stamps); the band draws the last 8, the panel 20, the card 28 of this one series
//     ctx     the last CTX_KEEP (24) context measures, oldest first: { tokens, pct (0..100), at }
//     runs    the last RUNS_KEEP (12) finished runs, oldest first: { secs, ok, at }
//     window  the model's context window in tokens from the newest measure (the `of 1M` figure); absent until measured
//     cost    session.measure's `cost.usd` as of the newest measure that carried one; the key is absent when the host sent none, and unless noteBilling said `api`
//   BUCKETS, BUCKET_MS, CTX_KEEP, RUNS_KEEP   the constants above
//   RATE_BUCKETS, rateLabel(events)   the last 20 buckets (5 min) summed as `6/5m`
//   noteMeasure(e, at)   record one session.measure input (only `context.tokens`, `context.percent`, `context.window`, `cost.usd` are read)
//   noteBilling(kind)   how the login is billed, from the status line's statusline-rows.json: 'api' (per token) or 'plan'; anything else is unknown
//   noteRunEnd(secs, ok, at)   record one finished run
//   pulseOf(now)         the current Pulse at engine clock `now` (ms)
//   ctxSeries(pulse)      the context percent of every measure, oldest first (the context chart's series)
//   ctxDelta(pulse)       `+12k/turn`: the token change between the last two measures, k-rounded (`-3k/turn` when it fell); undefined under two measures
//   ctxRunway(pulse)      turns the window still holds at the newest turn's growth (`~78 turns left`); undefined under two measures, with no window or while the context is flat
//   ctxText(pulse)        `6% · 64k of 1M · +12k/turn` (the window and the delta ride only when known); undefined before the first measure
//   activityStats(pulse, runTools) -> `6 events · 1.2/min · peak 4 · 3 tools`   the events of the window, per minute over the window's span, the busiest bucket, the tools the run has called
//   resetPulse()         a new session: empty rings, no cost, billing unknown (the event stamps are cleared by hook-log's resetHookLog)
import { eventBuckets, eventStamps } from './hook-log';

export type CtxSample = { tokens: number; pct: number; at: number };
export type RunSample = { secs: number; ok: boolean; at: number };
export type Pulse = { events: number[]; ctx: CtxSample[]; runs: RunSample[]; window?: number; cost?: { usd: number }; /** The raw event clock readings of the last 30 minutes (oldest first) and the clock `now` they were read at: the status chart buckets them to its own width. Absent: it spreads `events`. */ stamps?: number[]; at?: number };
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
/** The host's cost is an API-price estimate: it is a charge only on a per-token login. Unknown (undefined) shows no dollar figure. */
let billing: 'plan' | 'api' | undefined;
/** N3: the denied-call count last seen and the clock reading at which it last ROSE (a count that falls to 0 forgets the rise). */
let denied = 0;
let deniedRoseAt: number | undefined;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function resetPulse(): void {
  ctx = [];
  runs = [];
  windowTokens = undefined;
  cost = undefined;
  billing = undefined;
  denied = 0;
  deniedRoseAt = undefined;
}

/** Record the denied-call count the gates show at engine clock `at`: a rise stamps the clock, a fall to 0 clears it. */
export function noteDenied(count: number, at: number): void {
  if (!finite(count) || !finite(at)) return;
  if (count > denied) deniedRoseAt = at;
  else if (count <= 0) deniedRoseAt = undefined;
  denied = Math.max(0, count);
}

/** Whole seconds since the denied count last rose; undefined when none is shown or none was seen rising. */
export const denyAgeSecs = (now: number): number | undefined => (denied > 0 && deniedRoseAt !== undefined ? Math.max(0, Math.floor((now - deniedRoseAt) / 1000)) : undefined);

export function noteMeasure(e: MeasureLike, at: number): void {
  const { tokens, percent, window } = e.context;
  if (finite(window) && window > 0) windowTokens = window;
  if (finite(tokens)) {
    const pct = finite(percent) ? percent : finite(window) && window > 0 ? Math.round((tokens / window) * 100) : undefined;
    if (pct !== undefined) ctx = [...ctx, { tokens, pct, at }].slice(-CTX_KEEP);
  }
  if (e.cost && finite(e.cost.usd)) cost = { usd: e.cost.usd };
}

/** Record how the login is billed; only 'api' lets pulseOf report the cost. Any other value is unknown. */
export function noteBilling(kind: unknown): void {
  billing = kind === 'api' || kind === 'plan' ? kind : undefined;
}

export function noteRunEnd(secs: number, ok: boolean, at: number): void {
  if (!finite(secs) || !finite(at)) return;
  runs = [...runs, { secs, ok, at }].slice(-RUNS_KEEP);
}

export function pulseOf(now: number): Pulse {
  return {
    events: eventBuckets(now, BUCKETS, BUCKET_MS),
    stamps: eventStamps(now, 1_800_000), // Y1b: the chart's window grows with the session to 30 minutes
    at: now,
    ctx: ctx.map((s) => ({ ...s })),
    runs: runs.map((r) => ({ ...r })),
    ...(windowTokens !== undefined ? { window: windowTokens } : {}),
    ...(cost && billing === 'api' ? { cost: { ...cost } } : {}), // a dollar figure only when validated as an actual charge
  };
}

const tok = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);

export const ctxSeries = (p: Pick<Pulse, 'ctx'>): number[] => p.ctx.map((s) => s.pct);

export function ctxDelta(p: Pick<Pulse, 'ctx'>): string | undefined {
  if (p.ctx.length < 2) return undefined;
  const d = p.ctx[p.ctx.length - 1]!.tokens - p.ctx[p.ctx.length - 2]!.tokens;
  const k = Math.round(Math.abs(d) / 1000);
  return `${d < 0 && k > 0 ? '-' : '+'}${k}k/turn`;
}

/** NEW (runway): `~78 turns left`, the tokens still free in the window over the newest turn's growth (the last two measures); undefined under two measures, with no window, or while the context is not growing. */
export function ctxRunway(p: Pick<Pulse, 'ctx' | 'window'>): number | undefined {
  if (p.ctx.length < 2 || p.window === undefined || !(p.window > 0)) return undefined;
  const last = p.ctx[p.ctx.length - 1]!;
  const d = last.tokens - p.ctx[p.ctx.length - 2]!.tokens;
  return d > 0 ? Math.max(0, Math.floor((p.window - last.tokens) / d)) : undefined;
}

export function ctxText(p: Pick<Pulse, 'ctx' | 'window'>): string | undefined {
  const last = p.ctx.at(-1);
  if (!last) return undefined;
  const delta = ctxDelta(p);
  return [`${Math.round(last.pct)}%`, p.window !== undefined ? `${tok(last.tokens)} of ${tok(p.window)}` : `${tok(last.tokens)} tokens`, ...(delta ? [delta] : [])].join(' · ');
}

/** The events of the series' window as one line. The per-minute rate spans the window the series covers (the first non-empty bucket to now), at least one minute, so one event is `1.0/min` at most. */
export function activityStats(p: Pick<Pulse, 'events'>, runTools: number): string {
  const ev = p.events;
  const total = ev.reduce((n, x) => n + x, 0);
  const first = ev.findIndex((x) => x > 0);
  const spanMin = first < 0 ? 1 : Math.max(1, ((ev.length - first) * BUCKET_MS) / 60_000);
  const peak = Math.max(0, ...ev);
  const tools = Math.max(0, Math.floor(runTools));
  return `${total} ${total === 1 ? 'event' : 'events'} · ${(total / spanMin).toFixed(1)}/min · peak ${peak} · ${tools} ${tools === 1 ? 'tool' : 'tools'}`;
}
