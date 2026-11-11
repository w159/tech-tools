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
