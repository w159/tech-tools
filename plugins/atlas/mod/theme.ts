// Atlas mod theme: brand glyphs, colour helpers and the bar gauge.
// Every colour traces to BRAND (contract.ts); helpers never hardcode a hex.
// Brand tokens mirror scripts/dashboard_ui/css/tokens.css.

import { BRAND, type AgentState, type PhaseId } from './contract';

/** Single-cell glyphs used across the mod surfaces. Every value is ONE code point that
 * renders 1 cell in Ghostty/iTerm/kitty: ASCII, box drawing, geometric shapes and braille.
 * Never add the wide hexagon block (U+2B00-2BFF), U+25E2..25E5 triangles, emoji or anything East Asian Wide;
 * theme.test.ts enforces an allowlist of ranges. */
export const glyph = {
 brand: '◆',
 diamond: '◆',
 hollow: '◇',
 rail: '━',
 dash: '┄',
 play: '▶',
 tri: '▸',
 disc: '●',
 ring: '○',
 square: '■',
 fill: '▰',
 empty: '▱',
 star: '✦',
 starDim: '✧',
 spark: '˚',
 dot: '·',
 bar: '│',
} as const;

/** State glyph per squad agent state (width-safe). */
export const STATE_GLYPH = {
 spawning: glyph.tri,
 running: glyph.play,
 idle: glyph.ring,
 input: glyph.hollow,
 stuck: glyph.square,
 parked: glyph.dot,
 finished: glyph.disc,
 failed: glyph.square,
 dead: glyph.dot,
} as const satisfies Record<AgentState, string>;

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

/** Bar split: [filled, empty] strings, pct clamped 0-100, width cells total. */
export function barParts(pct: number, width: number): [string, string] {
 const p = Math.max(0, Math.min(100, pct));
 const filled = Math.round((p / 100) * width);
 return [glyph.fill.repeat(filled), glyph.empty.repeat(Math.max(0, width - filled))];
}

/** Bar gauge: pct (0-100, clamped) across width cells, ▰ filled + ▱ empty. */
export function bar(pct: number, width: number): string {
 return barParts(pct, width).join('');
}

/** Fill colour for a percentage meter: ok under 60, input (amber) under 85, fail above. */
export function meterColor(pct: number): string {
 return pct >= 85 ? BRAND.fail : pct >= 60 ? BRAND.input : BRAND.ok;
}

/** 1 when the wall-clock blink is "on" for the given period, else 0 (1 Hz breathing at 500 ms). */
export function blink(periodMs = 500): 0 | 1 {
 return (Math.floor(Date.now() / periodMs) % 2) as 0 | 1;
}

/** Braille spinner frames (one cell each). */
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** Spinner frame for an animation counter (any integer). */
export function spin(frame: number): string {
 return SPIN[Math.abs(Math.floor(frame)) % SPIN.length] ?? SPIN[0];
}
/** Inclusive code point span. */
export type Span = readonly [number, number];

const inSpan = (cp: number) => (span: Span): boolean => cp >= span[0] && cp <= span[1];

/** Display width of one code point from zero-width and double-width span tables (zero wins, else 1). */
export function rangeWidth(cp: number, zero: readonly Span[], wide: readonly Span[]): 0 | 1 | 2 {
 if (zero.some(inSpan(cp))) return 0;
 return wide.some(inSpan(cp)) ? 2 : 1;
}

const ZERO_WIDTH: readonly Span[] = [[0, 31], [0x7f, 0x9f], [0x300, 0x36f], [0x200b, 0x200f], [0xfe0f, 0xfe0f]];
const WIDE: readonly Span[] = [
 [0x1100, 0x115f], [0x2b00, 0x2bff], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f],
 [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
];

/** Display width of one code point: 0 control/combining/zero-width, 2 East Asian Wide/emoji, else 1 (ambiguous = 1). */
const cpWidth = (cp: number): number => rangeWidth(cp, ZERO_WIDTH, WIDE);

const charWidth = (ch: string): number => cpWidth(ch.codePointAt(0) ?? 0);

/** A host agent id shown raw (`aa42eb`, `a529730494759bac3`): 6-32 hex chars with a digit; never a worker's display name. */
export const isRawId = (s: string): boolean => /^a?[0-9a-f]{6,32}$/i.test(s) && /\d/.test(s);

/** Terminal cell width of a string (East Asian Wide = 2, ambiguous = 1). */
export function textWidth(text: string): number {
 let n = 0;
 for (const ch of text) n += charWidth(ch);
 return n;
}

/** Longest prefix of text (on code point boundaries) whose cell width stays within limit. */
function prefixWithin(text: string, limit: number): string {
 let out = '';
 let used = 0;
 for (const ch of text) {
  used += charWidth(ch);
  if (used > limit) break;
  out += ch;
 }
 return out;
}

/** Cut text to at most n cells on a code point boundary, '…' marking a cut. */
export function fitText(text: string, n: number): string {
 if (n <= 0) return '';
 if (textWidth(text) <= n) return text;
 return `${prefixWithin(text, n - 1)}…`;
}

/** "Chart room" sidebar palette as semantic roles over the host theme keys, so it reads on
 * light and dark terminals alike. Body text takes no colour at all (terminal default). */
export const chartRoom = {
 muted: 'subtle',
 faint: 'inactive',
 focus: 'claude',
 live: 'suggestion',
 ok: 'success',
 fail: 'error',
 warn: 'warning',
 border: 'promptBorder',
} as const;

/** Backdrop for sprite cells that carry only a foreground: sprites are self-contained
 * (fg + bg), so they stay legible whatever the terminal theme is. */
export const spriteTile = '#1b1f27';

const CONTRACT_GLYPH: Record<string, string> = { '🔍': '◎', '💡': '◇', '🧪': '⚗', '📋': '☰', '🔧': '⚒', '✅': '✓', '🏁': '⚑', '⛔': '■' };

/** Map an operating-contract phase emoji to a single-cell glyph; other single-cell glyphs pass through, anything else becomes '·'. */
export function contractGlyph(raw: string): string {
 return CONTRACT_GLYPH[raw] ?? (textWidth(raw) === 1 ? raw : glyph.dot);
}
