// Atlas mod theme: brand glyphs, colour helpers and the bar gauge.
// Every colour traces to BRAND (contract.ts); helpers never hardcode a hex.
// Brand tokens mirror scripts/dashboard_ui/css/tokens.css.

import { BRAND, type AgentState, type PhaseId } from './contract';

/** Single-cell glyphs used across the mod surfaces. */
export const glyph = {
  hex: '⬢',
  diamond: '◆',
  hollow: '◇',
  rail: '━',
  dash: '┄',
  play: '▶',
  star: '✦',
  starDim: '✧',
  spark: '˚',
  dot: '·',
} as const;

/** Linear interpolation from a to b at t (t unclamped; callers own their ranges). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Multiply a #rrggbb colour by f (clamped 0..1). Non-hex values (theme keys, names) pass through. */
export function dim(hex: string, f: number): string {
  if (hex.length !== 7 || hex[0] !== '#') return hex;
  const n = parseInt(hex.slice(1), 16);
  if (Number.isNaN(n)) return hex;
  const k = Math.max(0, Math.min(1, f));
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const PHASE_COLORS = {
  research: BRAND.working,
  theory: BRAND.subagent,
  test: BRAND.input,
  validate: BRAND.focus,
  implement: BRAND.accent,
  verify: BRAND.ok,
  done: BRAND.accent,
  blocked: BRAND.fail,
} satisfies Record<PhaseId, string>;

/** Hex colour for a contract phase. */
export function phaseColor(phase: PhaseId): string {
  return PHASE_COLORS[phase];
}

const STATE_COLORS = {
  spawning: BRAND.subagent,
  running: BRAND.accent,
  idle: BRAND.idle,
  input: BRAND.input,
  stuck: BRAND.fail,
  parked: BRAND.dim,
  finished: BRAND.ok,
  failed: BRAND.fail,
  dead: BRAND.dim,
} satisfies Record<AgentState, string>;

/** Hex colour for a squad agent state. Requires a defined state. */
export function stateColor(s: AgentState): string {
  return STATE_COLORS[s];
}

/** Bar gauge: pct (0-100, clamped) across width cells, ▰ filled + ▱ empty. */
export function bar(pct: number, width: number): string {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * width);
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, width - filled));
}

/** 1 when the wall-clock blink is "on" for the given period, else 0 (1 Hz breathing at 500 ms). */
export function blink(periodMs = 500): 0 | 1 {
  return (Math.floor(Date.now() / periodMs) % 2) as 0 | 1;
}
