// Atlas mod theme: brand glyphs, colour arithmetic and the bar gauge.
// Glyphs, width helpers and the bar gauge. Colours live in atlas-ui.ts (PALETTES, the round 3 palette): this module draws none.

import type { AgentState } from './contract';

/** Single-cell glyphs used across the mod surfaces. Every value is ONE code point that
 * renders 1 cell in Ghostty/iTerm/kitty: ASCII, box drawing and geometric shapes.
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

const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);

/** #rrggbb between a (t=0) and b (t=1), t clamped. */
export function mix(a: string, b: string, t: number): string {
 const k = Math.max(0, Math.min(1, t));
 const [x, y] = [rgbOf(a), rgbOf(b)];
 return `#${x.map((v, i) => Math.round(v + ((y[i] ?? 0) - v) * k).toString(16).padStart(2, '0')).join('')}`;
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

/** 1 when the wall-clock blink is "on" for the given period, else 0 (1 Hz breathing at 500 ms). */
export function blink(periodMs = 500, nowMs: number = Date.now()): 0 | 1 {
 return (Math.floor(nowMs / periodMs) % 2) as 0 | 1;
}

/** The one spinner: the circle quarters (the same four marks atlas-ui SPIN_FRAMES draws; the capture scorer maps only these on rows). */
const SPIN = ['◐', '◓', '◑', '◒'] as const;

/** Spinner frame for an animation counter (any integer). One set for every phase: the old per-phase tables (braille, stars, arcs) are gone, so two spinner families
 * never share a screen. `_phase` is kept for callers that still pass one and is ignored. */
export function spin(frame: number, _phase?: string): string {
 return SPIN[((Math.floor(frame) % SPIN.length) + SPIN.length) % SPIN.length]!
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

/** The one done mark: every surface (band, HUD, board, side panel, omp) takes it from here. */
export const DONE_GLYPH = '✓';
const CONTRACT_GLYPH: Record<string, string> = { '🔍': '◎', '💡': '◇', '🧪': '⚗', '📋': '☰', '🔧': '⚒', '✅': DONE_GLYPH, '🏁': '⚑', '⛔': '■' };

/** Map an operating-contract phase emoji to a single-cell glyph; other single-cell glyphs pass through, anything else becomes '·'. */
export function contractGlyph(raw: string): string {
 return CONTRACT_GLYPH[raw] ?? (textWidth(raw) === 1 ? raw : glyph.dot);
}

/** `12s`, `4m12s`, `1h2m`. */
export function formatDuration(ms: number): string {
 const s = Math.max(0, Math.round(ms / 1000))
 if (s < 60) return `${s}s`
 const m = Math.floor(s / 60)
 if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
 return `${Math.floor(m / 60)}h${m % 60}m`
}
