// band-motion.ts: the band's eased gauges as pure functions of time (design rev 4, section 6). A Move is one gauge's
// current glide: the value it started from, the value it heads for and the clock reading when it began. The ticks in
// register.ts retarget a Move when the figure changes and ask `settled` when to stop; the render only reads
// `displayed`. Nothing here keeps a timer, so an unchanged gauge costs nothing.
import { EASE_MS, easedValue } from './atlas-ui';
import { todoCounts } from './data/todos';
import type { LiveSnapshot } from './orchestra-types';

export type Move = { from: number; to: number; at: number };
/** The two band gauges. `ctx` is absent while the host reports no context fill. */
export type GaugeMoves = { todo: Move; ctx: Move | null };
export type GaugeTargets = { todo: number; ctx?: number };

/** The value on screen `now` ms on the clock. */
export const displayed = (m: Move, now: number): number => easedValue(m.from, m.to, now - m.at);
export const settled = (m: Move, now: number): boolean => now - m.at >= EASE_MS;

/** Head for `to`. An unchanged target returns the same Move (so a state write can be skipped); a new one starts from
 * the value now on screen, so a move interrupted halfway never jumps. */
export function retarget(m: Move, to: number, now: number): Move {
  return Math.abs(to - m.to) < 1e-9 ? m : { from: displayed(m, now), to, at: now };
}

/** The figures the band gauges show: plan ratio (the one count basis the header and HUD read) and context fill. */
export function gaugeTargets(s: LiveSnapshot): GaugeTargets {
  const { done, total } = todoCounts(s);
  return { todo: total ? Math.min(1, done / total) : 0, ...(s.contextPct > 0 ? { ctx: Math.min(1, s.contextPct / 100) } : {}) };
}

/** `prev` moved to `t`, or `prev` itself when nothing changed. A first sight does not glide (the figure is simply there). */
export function retargetAll(prev: GaugeMoves | null, t: GaugeTargets, now: number): GaugeMoves {
  const fresh = (to: number): Move => ({ from: to, to, at: now - EASE_MS });
  if (!prev) return { todo: fresh(t.todo), ctx: t.ctx === undefined ? null : fresh(t.ctx) };
  const todo = retarget(prev.todo, t.todo, now);
  const ctx = t.ctx === undefined ? null : prev.ctx ? retarget(prev.ctx, t.ctx, now) : fresh(t.ctx);
  return todo === prev.todo && ctx === prev.ctx ? prev : { todo, ctx };
}

export const allSettled = (g: GaugeMoves, now: number): boolean => settled(g.todo, now) && (!g.ctx || settled(g.ctx, now));

/** The values on screen: what the band passes as `eased`. */
export const easedNow = (g: GaugeMoves, now: number): { todo: number; ctx?: number } => ({ todo: displayed(g.todo, now), ...(g.ctx ? { ctx: displayed(g.ctx, now) } : {}) });

// ---- the run clock and the frame beat (round 3) ----------------------------------------------------------------------------
// The band's `working 0:42` and its `done . 1:08` are wall-clock readings of one RunClock, never a count of ticks: a tick that is late, skipped or
// refused cannot stall the figure, and a run that flickers (a worker ends a beat before the next starts) neither resets the clock to 0:00 nor
// ends the run. The spinner is driven by FRAME_MS beats of one `$.clock.every` loop (register.ts) that waits for nothing: no store update,
// no poll, no snapshot. A watchdog (`beatStale`) re-arms the loop when the host ended it.

/** One spinner frame per beat: 100 ms is 10 redraws a second, the host cap (index.d.ts: a redraw, ten a second at most); the fastest period the host does not fold. */
export const FRAME_MS = 100;
/** Not working for this long ends a run when the host gives no turn signal of its own (omp, headless fixtures); a gap shorter than that is the same run (a worker ending a beat before the next starts).
 * Where the host says its turn is over (AbovePrompt `isWorking` false) the run ends on that beat: there is no grace. */
export const END_GRACE_MS = 1_500;
/** A user prompt arms the next run for this long: a prompt that starts no work does not leave a stale start behind. */
export const ARM_MS = 15_000;
/** The loop is presumed dead (the host refused a period and ended the interval) when no beat landed for this many frames. */
export const STALE_BEATS = 5;

/** `startMs`: when the current run began (null at rest). `lastSeenMs`: the last beat that found Atlas working. `ranMs`: how long the last finished run lasted, frozen until the next run ends. `endedMs`: when it ended. */
export type RunClock = { startMs: number | null; lastSeenMs: number; ranMs?: number; endedMs?: number };
export const newRunClock = (): RunClock => ({ startMs: null, lastSeenMs: 0 });

/** What a beat knows beyond `working`. `hostIdle`: the host says its model turn is over (AbovePrompt `isWorking` false), so a run that no worker or lead work holds up ends now.
 * `promptMs`: when the person's prompt armed the next run. A run that already ended starts a new one only from a prompt: work with no prompt behind it (a background task's
 * notification, a worker flicker) leaves `ranMs`, `endedMs` and so `idle` exactly as they were. The very first run needs no prompt. */
export type BeatSignal = { hostIdle?: boolean; promptMs?: number | null; resumed?: boolean };

/** The clock after a beat at `now` that found Atlas `working` or not. Returns the same object when nothing changed. */
export function stepRun(c: RunClock, working: boolean, now: number, sig: BeatSignal = {}): RunClock {
  if (working) {
    if (c.startMs !== null) return c.lastSeenMs === now ? c : { ...c, lastSeenMs: now };
    const prompt = sig.promptMs ?? null;
    if (c.endedMs !== undefined && prompt === null) {
      // truth 40: a Stop-hook continuation or a worker notification's turn right after the run closed is the same run: the clock reopens at the run's own start and counts on.
      if (sig.resumed === true && c.ranMs !== undefined) return { startMs: c.endedMs - c.ranMs, lastSeenMs: now, ranMs: c.ranMs, endedMs: c.endedMs };
      return c;
    } // a blip after a finished run: not a new run, not a new clock
    return { ...c, startMs: prompt !== null ? Math.min(prompt, now) : now, lastSeenMs: now };
  }
  if (c.startMs !== null && (sig.hostIdle === true || now - c.lastSeenMs >= END_GRACE_MS)) return { startMs: null, lastSeenMs: c.lastSeenMs, ranMs: Math.max(0, c.lastSeenMs - c.startMs), endedMs: c.lastSeenMs };
  return c;
}
/** A host turn or live work counts as the run only while the run clock is open, or none has ended yet, or a prompt armed the next one. A closed run with no new prompt (the host runs a slash command, f0106 of live-150-2) is not working:
 * the band keeps reading `idle`/`done` and the clock never restarts from the old start (truth 39). */
export const runLive = (c: RunClock, armed: boolean, resumed = false): boolean => c.startMs !== null || c.endedMs === undefined || armed || resumed;
/** A host turn that starts this close to the run's end belongs to that run when a Stop hook refused (its continuation) or a worker's notification woke the lead (truth 40, stoprun-110-1 f0062-f0072: `idle 0:29` for 5.6 s under the host's `Fermenting`).
 * A slash command typed later is neither: it records no resume mark, and a mark older than this never counts. */
export const RESUME_TURN_MS = 30_000;
/** The notification that wakes the lead arrives a beat before the run's clock closes (f0061 34.78 s, close 35.0 s); a mark made earlier in the run belongs to an earlier turn. */
export const RESUME_PRE_MS = 2_000;
/** `resumedAt`: when a Stop refusal or a worker notification last started a host turn (null: none). True when that was within RESUME_TURN_MS of the closed run's end (or up to RESUME_PRE_MS before it). */
export const resumeOk = (c: RunClock, resumedAt: number | null, now: number): boolean => resumedAt !== null && c.endedMs !== undefined && resumedAt >= c.endedMs - RESUME_PRE_MS && now - c.endedMs <= RESUME_TURN_MS;
/** The run clock never steps back (truth 40, stoprun-110-1 f0061 `0:30`, f0062 `0:29`: the open clock counted through the end grace, the closed total stopped at the last beat). `held` is the largest figure shown for the run `key`; a new key starts over. */
export type ClockHold = { key: number; max: number } | null;
export const holdClock = (h: ClockHold, key: number | undefined, secs: number | undefined): { hold: ClockHold; secs: number | undefined } => {
  if (secs === undefined || key === undefined) return { hold: h, secs };
  const max = h && h.key === key ? Math.max(h.max, secs) : secs;
  return { hold: { key, max }, secs: max };
};
/** Identity of the run a clock belongs to: its start, open or closed. */
export const runKey = (c: RunClock): number | undefined => (c.startMs !== null ? c.startMs : c.endedMs !== undefined && c.ranMs !== undefined ? c.endedMs - c.ranMs : undefined);
/** Whole seconds the current run has lasted; undefined at rest. */
export const workSecsOf = (c: RunClock, now: number): number | undefined => (c.startMs === null ? undefined : Math.max(0, Math.floor((now - c.startMs) / 1000)));
/** Whole seconds the last run took (frozen); undefined before any run ended. */
export const ranSecsOf = (c: RunClock): number | undefined => (c.ranMs === undefined ? undefined : Math.floor(c.ranMs / 1000));
/** The figure `done` and `idle` read: a closed run's frozen time, and for a run whose clock has not closed yet (the host's turn ended, the next beat has not run) the span that beat will freeze,
 * `lastSeenMs - startMs`. Without it the first `done` frame had no figure and fell back to the worker wave's span: `done . 0:20`, then `1:05` (critique 27, stoprun-150-46d4825c-1 f0130:24 and f0131:24). */
export const finalSecsOf = (c: RunClock): number | undefined => (c.startMs !== null ? Math.max(0, Math.floor((c.lastSeenMs - c.startMs) / 1000)) : ranSecsOf(c));
/** Whole seconds at rest since the last run ended; undefined while one runs or before any ended. */
export const restSecsOf = (c: RunClock, now: number): number | undefined => (c.startMs === null && c.endedMs !== undefined ? Math.max(0, Math.floor((now - c.endedMs) / 1000)) : undefined);
/** The frame loop is stale: Atlas is working, yet no beat landed for STALE_BEATS frames. */
export const beatStale = (lastBeatMs: number, now: number): boolean => now - lastBeatMs > STALE_BEATS * FRAME_MS;

/** State 38 (critique: `working` -> `idle` -> `blocked` inside one second, live-150-1 f0070-f0076): the band holds the last non-idle word for at least `KIND_HOLD_MS` before it may read `idle`, so a held `working`
 * never drops to idle ahead of a `blocked` that arrives inside the window. `at` is when the last non-idle word was computed. Pure: the render keeps the returned hold. */
export const KIND_HOLD_MS = 1000;
export type KindWord = 'working' | 'done' | 'blocked' | 'idle';
export type KindHold = { kind: KindWord | null; at: number };
export const newKindHold = (): KindHold => ({ kind: null, at: 0 });
export function stepKind(h: KindHold, computed: KindWord, now: number): { hold: KindHold; shown: KindWord } {
	if (computed !== 'idle') return { hold: { kind: computed, at: now }, shown: computed };
	if (h.kind !== null && h.kind !== 'idle' && now - h.at < KIND_HOLD_MS) return { hold: h, shown: h.kind };
	return { hold: h.kind === 'idle' ? h : { kind: 'idle', at: now }, shown: 'idle' };
}
