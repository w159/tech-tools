// metrics.ts: AA1, the one place every figure of the health surfaces is computed. The band, the side panel's tabs, the health card and the narrow strip only FORMAT what `metricsOf(health)` returns:
//   activity   the event series at ONE bucket size (the smallest round bucket that spans the window in PANEL_CHART_COLS columns), its total, its peak, the y-axis maximum
//   run        the newest finished run (this session's, else an earlier session's) and the one m:ss text of its duration
//   ctx        the context percent (the host's measure, else the pulse's, else the last session's) and whether it is an earlier session's
//   hook       the handler latency median and p95 over every sample the hook log holds
// The result is memoised per Health object, so one snapshot cannot render two different figures; a Health built twice from the same inputs computes the same figures (pure functions of them).
import { elapsedClock } from '../atlas-ui';
import type { Health } from './idle-health';
import { RATE_BUCKETS } from './pulse';

/** Buckets of the pulse's own 15 s series: 20 x 15 s = 5 minutes. */
export const STATUS_BUCKETS = RATE_BUCKETS;
/** The panel's chart width in cells at its narrowest dock (110 columns): the bucket is chosen for it, so a wider pane draws the same bars with blank room, never a different bucket. */
export const PANEL_CHART_COLS = 40;
/** AA3: the y axis never tops out below this many events per bucket (one event is half the chart at most). */
export const CHART_AXIS_MIN = 2;
/** Z2: a percentile needs this many samples behind it. */
export const P95_MIN_SAMPLES = 5;

const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);
const trimNum = (x: number): string => String(Math.round(x * 10) / 10);
/** Y2f: the bucket sizes the chart may use, in seconds (1s 2s 5s 10s 15s 30s 1m 2m): a round figure, never `1.7s`. */
export const ROUND_BUCKETS = [1, 2, 5, 10, 15, 30, 60, 120] as const;
/** The smallest round bucket that spans `windowSecs` in at most `cols` columns (the largest when none does). */
export const roundBucket = (windowSecs: number, cols: number): number => ROUND_BUCKETS.find((b) => windowSecs / b <= cols) ?? ROUND_BUCKETS[ROUND_BUCKETS.length - 1]!;
/** `10s`, `45s`, `1m`, `1.5m`: a bucket's size in the rule. */
export const bucketLabel = (secs: number): string => (secs >= 60 ? `${trimNum(secs / 60)}m` : `${trimNum(secs)}s`);
/** The window the chart covers: the session's age rounded up to the next minute, clamped to 2..30 minutes (5 when the age is unknown). */
export const chartMinutes = (h: Pick<Health, 'upSecs'>): number => (h.upSecs === undefined ? 5 : Math.max(2, Math.min(30, Math.ceil(h.upSecs / 60))));

export type ChartData = {
  /** This session's events per bucket across the window, oldest first (`n` buckets); the last holds `now`. */
  vals: number[];
  /** Y1a: the earlier sessions' events as the same unit (events per bucket, from their per-minute counts), one column per minute, oldest first; empty when none fit. */
  prev: number[];
  total: number;
  /** The tallest bar drawn, this session's or `prev`, in events per bucket. */
  peak: number;
  minutes: number;
  bucketSecs: number;
  /** Blank columns at the far left of the `cols` the series was built for. */
  pad: number;
};

/** The chart's series at `cols` columns (Y1b, Y2f, AA1): the window follows the session age (`chartMinutes`), buckets are the smallest round size that fits the window in the columns, only that many columns are drawn, right-aligned, aligned to the wall clock (`pulse.stamps`); a pulse with only the 20 x 15 s series spreads each bucket's count to the column at its centre. The persisted minutes before the window (`h.hist`) fill the spare columns left of it. */
export function chartSeries(h: Health, cols: number = PANEL_CHART_COLS): ChartData {
  const p = h.pulse;
  const age = h.upSecs;
  const windowMinutes = chartMinutes(h);
  const windowSecs = windowMinutes * 60;
  const mins = h.hist?.minutes ?? [];
  const firstMin = p?.at !== undefined ? Math.floor((p.at - windowSecs * 1000) / 60_000) : 0; // the first minute of the window
  const byMin = new Map(mins.map((x) => [x.m, x.n] as const));
  const prevCols = age !== undefined && p?.at !== undefined && mins.length > 0 && cols >= 24 ? Math.min(Math.floor(cols / 4), firstMin - mins[0]!.m) : 0;
  const prevRaw = prevCols >= 3 ? Array.from({ length: prevCols }, (_, j) => byMin.get(firstMin - prevCols + j) ?? 0) : [];
  const showPrev = prevRaw.some((x) => x > 0);
  const avail = showPrev ? cols - prevCols - 1 : cols;
  const bucketSecs = roundBucket(windowSecs, avail);
  const n = Math.min(avail, Math.ceil(windowSecs / bucketSecs)); // only the columns the window needs; the chart is right-aligned
  const vals = new Array<number>(n).fill(0);
  if (p?.stamps && p.at !== undefined) {
    const bms = bucketSecs * 1000;
    const cur = Math.floor(p.at / bms);
    for (const at of p.stamps) {
      const slot = n - 1 - Math.max(0, cur - Math.floor(at / bms));
      if (slot >= 0) vals[slot]!++;
    }
  } else {
    const ev = [...new Array<number>(Math.max(0, STATUS_BUCKETS - (p?.events.length ?? 0))).fill(0), ...(p?.events ?? []).slice(-STATUS_BUCKETS)];
    ev.forEach((v, i) => {
      if (v <= 0) return;
      const col = n - 1 - Math.floor(((STATUS_BUCKETS - i - 0.5) * 15) / bucketSecs);
      if (col >= 0) vals[col]! += v;
    });
  }
  // the minutes in the persisted unit of the chart (events per bucket): a minute's count spread over the bucket's share of the minute, at least 1 for a minute that had events
  const prev = showPrev ? prevRaw.map((c) => (c > 0 ? Math.max(1, Math.round((c * bucketSecs) / 60)) : 0)) : [];
  return { vals, prev, total: sum(vals), peak: Math.max(0, ...vals, ...prev), minutes: (n * bucketSecs) / 60, bucketSecs, pad: avail - n };
}

/** The runs a figure may draw, oldest first: the earlier sessions' (Y1a, persisted: `prev`) then this session's. */
export function runsOf(h: Pick<Health, 'pulse' | 'hist'>): { secs: number; ok: boolean; prev: boolean }[] {
  return [...(h.hist?.runs ?? []).map((x) => ({ secs: x.secs, ok: x.ok, prev: true })), ...(h.pulse?.runs ?? []).map((x) => ({ secs: x.secs, ok: x.ok, prev: false }))];
}
/** The median and the 90th percentile of run seconds (the sorted list's nearest ranks). */
export function runFigures(secs: readonly number[]): { med: number; p90: number } {
  const sorted = [...secs].sort((p, q) => p - q);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
  return { med, p90: sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.9) - 1))]! };
}

export type Metrics = {
  activity: ChartData;
  /** The y-axis maximum and the top label: max(peak, CHART_AXIS_MIN). */
  scale: number;
  /** `peak 3 / 5s`: the one wording of the busiest bucket and its size. */
  peakText: string;
  /** The newest run and its duration as the one `m:ss` text. */
  run?: { secs: number; ok: boolean; prev: boolean; text: string };
  runCount: number;
  /** Context percent (whole) and its text `6%`; `prev` when it is an earlier session's measure. */
  ctx?: { pct: number; text: string; prev: boolean };
  /** The handler latency median and p95 over every sample, and how many samples. */
  hook?: { p50: number; p95: number; n: number };
};

const cache = new WeakMap<object, Metrics>();

/** Every figure of `h`, once. */
export function computeMetrics(h: Health): Metrics {
  const activity = chartSeries(h, PANEL_CHART_COLS);
  const runs = runsOf(h);
  const last = runs.at(-1);
  const live = h.ctxPct ?? h.pulse?.ctx.at(-1)?.pct;
  const old = live === undefined ? h.hist?.ctx?.pcts.at(-1) : undefined;
  const pct = live ?? old;
  const lat = h.hooks?.latency;
  return {
    activity,
    scale: Math.max(CHART_AXIS_MIN, activity.peak),
    peakText: `peak ${activity.peak} / ${bucketLabel(activity.bucketSecs)}`,
    ...(last ? { run: { secs: last.secs, ok: last.ok, prev: last.prev, text: elapsedClock(last.secs) } } : {}),
    runCount: runs.length,
    ...(pct !== undefined ? { ctx: { pct: Math.round(pct), text: `${Math.round(pct)}%`, prev: old !== undefined } } : {}),
    ...(lat ? { hook: { p50: lat.p50, p95: lat.p95, n: lat.n } } : {}),
  };
}

/** The figures of `h`: computed on the first read and shared by every surface that reads this Health. */
export function metricsOf(h: Health): Metrics {
  const hit = cache.get(h);
  if (hit) return hit;
  const m = computeMetrics(h);
  cache.set(h, m);
  return m;
}
