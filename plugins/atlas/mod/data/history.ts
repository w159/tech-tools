// history.ts: Y1a, the rolling history the mod keeps across sessions in the project's own runtime state, `<root>/.atlas/.run/history.json` (the file the mod writes the same way it writes
// `hud-state.json`: `$.fs.write` of a temp file, then `mv`). One small bounded JSON file, read at session start, written atomically while the session runs:
//   runs  the last 50 finished runs { secs, ok, tools, at }, oldest first
//   lat   per hook kind the last 64 handler latencies in ms, oldest first (hook-log.ts seeds its rings from it, so p50 and p95 read the last 64 calls)
//   min   events per wall-clock minute { m: floor(at / 60 s), n } for the last 60 minutes
//   ctx   the context percents of the last session's measures { at, pcts } (the newest session that measured)
// Everything in it is something a handler or the run clock really recorded; a missing, unreadable or corrupt file is an empty history (never an error), and what is drawn from the persisted part is
// labelled `prev` by the surfaces. Pure functions (parse, compose, view) plus the two IO calls the boot and the tick make; the file is never written under plugins/**.
import type { EngineInterface } from 'claude-code';
import { eventMinutes, hookLatencyRings, seedHookLatency } from '../host/hook-log';

export type HistRun = { secs: number; ok: boolean; tools: number; at: number };
export type HistCtx = { at: number; pcts: number[] };
export type HistMinute = { m: number; n: number };
/** AA4: the pass and deny counts each gate showed when the last session's run ended. */
export type HistGate = { id: string; pass: number; deny: number };
export type History = { v: 1; runs: HistRun[]; lat: Record<string, number[]>; min: HistMinute[]; ctx: HistCtx | null; gates: HistGate[] };
/** What the surfaces read of the persisted part: the earlier sessions' runs and minutes, and the context of the last session that measured. */
export type HistView = { runs: HistRun[]; minutes: HistMinute[]; ctx?: HistCtx; gates?: HistGate[] };

export const HIST_RUNS = 50;
export const HIST_LAT = 64;
export const HIST_MINUTES = 60;
export const HISTORY_FILE = 'history.json';
const MIN_MS = 60_000;
/** The file is rewritten at most this often while the session runs (a run end writes at once). */
const WRITE_EVERY_MS = 10_000;

export const emptyHistory = (): History => ({ v: 1, runs: [], lat: {}, min: [], ctx: null, gates: [] });
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The history a file holds; anything unreadable is dropped entry by entry, a file that is not JSON (or not an object) is empty. Never throws. */
export function parseHistory(text: string | null | undefined): History {
  try {
    const doc = JSON.parse(text ?? '') as Partial<Record<keyof History, unknown>> | null;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return emptyHistory();
    const runs = (Array.isArray(doc.runs) ? doc.runs : [])
      .filter((r): r is HistRun => !!r && typeof r === 'object' && fin((r as HistRun).secs) && (r as HistRun).secs >= 0 && typeof (r as HistRun).ok === 'boolean' && fin((r as HistRun).at))
      .map((r) => ({ secs: Math.round(r.secs), ok: r.ok, tools: fin(r.tools) && r.tools >= 0 ? Math.round(r.tools) : 0, at: r.at }))
      .slice(-HIST_RUNS);
    const lat: Record<string, number[]> = {};
    if (doc.lat && typeof doc.lat === 'object' && !Array.isArray(doc.lat)) {
      for (const [k, v] of Object.entries(doc.lat as Record<string, unknown>)) {
        const ring = (Array.isArray(v) ? v : []).filter((x): x is number => fin(x) && x >= 0).slice(-HIST_LAT);
        if (ring.length) lat[k] = ring;
      }
    }
    const min = (Array.isArray(doc.min) ? doc.min : [])
      .filter((x): x is HistMinute => !!x && typeof x === 'object' && fin((x as HistMinute).m) && fin((x as HistMinute).n) && (x as HistMinute).n > 0)
      .map((x) => ({ m: Math.floor(x.m), n: Math.round(x.n) }))
      .sort((a, b) => a.m - b.m)
      .slice(-HIST_MINUTES);
    const c = doc.ctx as Partial<HistCtx> | null | undefined;
    const pcts = c && Array.isArray(c.pcts) ? c.pcts.filter((x): x is number => fin(x) && x >= 0 && x <= 100).slice(-24) : [];
    const ctx = c && fin(c.at) && pcts.length ? { at: c.at, pcts } : null;
    const gates = (Array.isArray(doc.gates) ? doc.gates : [])
      .filter((x): x is HistGate => !!x && typeof x === 'object' && typeof (x as HistGate).id === 'string' && fin((x as HistGate).pass) && fin((x as HistGate).deny) && (x as HistGate).pass >= 0 && (x as HistGate).deny >= 0)
      .map((x) => ({ id: x.id, pass: Math.round(x.pass), deny: Math.round(x.deny) }))
      .slice(0, 16);
    return { v: 1, runs, lat, min, ctx, gates };
  } catch {
    return emptyHistory();
  }
}

export const serializeHistory = (h: History): string => JSON.stringify(h);

// ---- this session's side of the history -------------------------------------------------------------------------------------------------------------------------------------------------

let base: History = emptyHistory();
let startMin = 0;
let sessionRuns: HistRun[] = [];
let sessionCtx: HistCtx | null = null;
let sessionGates: HistGate[] | null = null;
let lastWritten = '';
let wroteAt = -Infinity;
let dirFor = '';

/** A new session: no persisted part, no runs of its own. `startMs` is the session's start on the engine clock (the minutes before it are `prev`). */
export function resetHistory(startMs = 0): void {
  base = emptyHistory();
  startMin = Math.floor(startMs / MIN_MS);
  sessionRuns = [];
  sessionCtx = null;
  sessionGates = null;
  lastWritten = '';
  wroteAt = -Infinity;
  dirFor = '';
}

/** One run that just ended (its seconds, verdict and the tool calls it saw), at engine clock `at`. */
export function noteHistoryRun(run: HistRun): void {
  if (!fin(run.secs) || !fin(run.at)) return;
  sessionRuns = [...sessionRuns, { secs: Math.round(run.secs), ok: run.ok, tools: Math.max(0, Math.round(run.tools)), at: run.at }].slice(-HIST_RUNS);
}

/** The context percents of this session's measures (oldest first); an empty list keeps the persisted last-session figure. */
export function noteHistoryCtx(pcts: readonly number[], at: number): void {
  const ok = pcts.filter((x) => fin(x) && x >= 0 && x <= 100).slice(-24);
  sessionCtx = ok.length && fin(at) ? { at, pcts: ok } : sessionCtx;
}

/** AA4: the gate counts at the end of a run (a gate with no lines yet is not recorded); the next session shows them as `prev`. */
export function noteHistoryGates(gates: readonly HistGate[]): void {
  const ok = gates.filter((g) => g.id && fin(g.pass) && fin(g.deny) && g.pass + g.deny > 0).map((g) => ({ id: g.id, pass: Math.round(g.pass), deny: Math.round(g.deny) }));
  if (ok.length) sessionGates = ok;
}

/** What the surfaces draw as `prev`: the runs of earlier sessions, the per-minute counts of the minutes before this session (inside the last hour at `now`), and the last measured context. */
export function historyView(now: number): HistView | undefined {
  const nowMin = Math.floor(now / MIN_MS);
  const minutes = base.min.filter((x) => x.m < startMin && x.m >= nowMin - HIST_MINUTES);
  if (!base.runs.length && !minutes.length && !base.ctx && !base.gates.length) return undefined;
  return { runs: base.runs.map((r) => ({ ...r })), minutes: minutes.map((x) => ({ ...x })), ...(base.ctx ? { ctx: { ...base.ctx, pcts: [...base.ctx.pcts] } } : {}), ...(base.gates.length ? { gates: base.gates.map((g) => ({ ...g })) } : {}) };
}

/** The whole history as the file would hold it at `now`: the loaded part and this session's runs, the hook rings (seeded from the loaded part), the minutes, the context. */
export function composeHistory(now: number): History {
  const nowMin = Math.floor(now / MIN_MS);
  const sum = new Map<number, number>();
  for (const x of [...base.min, ...eventMinutes()]) sum.set(x.m, (sum.get(x.m) ?? 0) + x.n);
  const min = [...sum].map(([m, n]) => ({ m, n })).filter((x) => x.m >= nowMin - HIST_MINUTES).sort((a, b) => a.m - b.m).slice(-HIST_MINUTES);
  const lat: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(hookLatencyRings())) lat[k] = v.slice(-HIST_LAT);
  for (const [k, v] of Object.entries(base.lat)) if (!lat[k]) lat[k] = v.slice(-HIST_LAT);
  return { v: 1, runs: [...base.runs, ...sessionRuns].slice(-HIST_RUNS), lat, min, ctx: sessionCtx ?? base.ctx, gates: sessionGates ?? base.gates };
}

const dirOf = (root: string): string => `${root.replace(/\/+$/, '')}/.atlas/.run`;

/** Session start: read the file under `root` (empty when none, unreadable or corrupt) and seed the hook latency rings from it. */
export async function loadHistory($: EngineInterface, root: string | null | undefined, startMs: number): Promise<void> {
  resetHistory(startMs);
  if (root === undefined || root === null || root === '') return;
  const text = await $.fs.read(`${dirOf(root)}/${HISTORY_FILE}`).catch(() => undefined);
  base = parseHistory(text);
  seedHookLatency(base.lat);
}

/** Write the history (no fork; a half file reads as empty history) when it changed: at most every WRITE_EVERY_MS unless `force`. Skips a project that has no `.atlas` directory (nothing is created in a repo that never used Atlas). Fail soft. */
export async function flushHistory($: EngineInterface, root: string | null | undefined, now: number, force = false): Promise<void> {
  try {
    if (root === undefined || root === null || root === '') return;
    if (!force && now - wroteAt < WRITE_EVERY_MS) return;
    // At rest the only drift is old minutes aging out of the window: compare at the last write's clock, so aging alone never writes.
    if (!force && lastWritten !== '' && Number.isFinite(wroteAt) && serializeHistory(composeHistory(wroteAt)) === lastWritten) return;
    const text = serializeHistory(composeHistory(now));
    if (text === lastWritten) return;
    const dir = dirOf(root);
    if (dirFor !== dir) {
      if (!(await $.fs.exists(`${root.replace(/\/+$/, '')}/.atlas`))) return;
      dirFor = dir; // fs.write creates the missing directories
    }
    const path = `${dir}/${HISTORY_FILE}`;
    await $.fs.write(path, text);
    lastWritten = text;
    wroteAt = now;
  } catch {
    wroteAt = now; // a failed write is retried on the next interval, never on every beat
  }
}
