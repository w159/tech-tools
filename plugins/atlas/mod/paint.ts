// Truecolor paint primitives for the filled surfaces (band, worker cards, reply pills): every run
// carries its own fg and bg from the Mocha palette, so the surface paints its own background.
// Pure: they return Segments (runs.ts) that rowOf lays out; widths are terminal cells.
import type { Segment } from './runs';
import { MOCHA as M, mix, textWidth } from './theme';

/** A run on the panel background. */
export const seg = (t: string, color?: string, bg: string = M.panel, bold?: boolean): Segment => ({ t, color, bg, bold });

/** Filled chip: ` text ` in dark text on `bg`. */
export const chip = (text: string, bg: string): Segment => ({ t: ` ${text} `, color: M.base, bg, bold: true });

const widthOf = (parts: readonly Segment[]): number => parts.reduce((n, p) => n + textWidth(p.t), 0);

/** Pad a row with panel spaces to exactly `cols` (rowOf cuts anything past it). */
export const padRow = (parts: Segment[], cols: number, bg: string = M.panel): Segment[] => {
  const gap = cols - widthOf(parts);
  return gap > 0 ? [...parts, { t: ' '.repeat(gap), bg }] : parts;
};

/** Left parts, then right parts flush to the far edge; the right side drops when it does not fit. */
export function spread(left: Segment[], right: Segment[], cols: number, bg: string = M.panel): Segment[] {
  const gap = cols - widthOf(left) - widthOf(right);
  return gap >= 1 ? [...left, { t: ' '.repeat(gap), bg }, ...right] : padRow(left, cols, bg);
}

/** Adjacent runs with the same style fold into one, so a per-cell gradient costs a few Text nodes. */
export function merge(cells: readonly Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (sameStyle(c, last)) out[out.length - 1] = { ...c, t: last!.t + c.t };
    else out.push({ ...c });
  }
  return out;
}
const sameStyle = (a: Segment, b?: Segment): boolean => !!b && a.color === b.color && a.bg === b.bg && a.bold === b.bold;

const STEP = 3; // gradient colour changes every 3 cells: smooth to the eye, a third of the Text nodes

/** Colour at cell i of n along a -> b, quantized to STEP cells. */
const ramp = (a: string, b: string, i: number, n: number): string => mix(a, b, (Math.floor(i / STEP) * STEP) / Math.max(1, n - 1));

/** Full-width title bar: text over a horizontal truecolor gradient; `right` sits flush right when it fits. */
export function gradientBar(left: string, right: string, cols: number, a: string, b: string, fg: string = M.base): Segment[] {
  const head = ` ${left}`;
  const room = cols - textWidth(head) - textWidth(right);
  const line = room >= 2 ? head + ' '.repeat(room) + right : head + ' '.repeat(Math.max(0, cols - textWidth(head)));
  return merge([...line].slice(0, cols).map((ch, i) => ({ t: ch, color: fg, bg: ramp(a, b, i, cols), bold: true })));
}

const EIGHTHS = ' ▏▎▍▌▋▊▉█';

/** Smooth bar: `frac` of `width` cells in eighth blocks, coloured a -> b, on the secondary panel. */
export function eighthBar(frac: number, width: number, a: string, b: string): Segment[] {
  const cells = Math.max(0, Math.min(1, frac)) * width;
  const whole = Math.floor(cells);
  const part = Math.floor((cells - whole) * 8);
  return merge(Array.from({ length: width }, (_, i) => {
    const ch = barCell(i, whole, part);
    return { t: ch, color: ch === ' ' ? M.dim : ramp(a, b, i, width), bg: M.panel2 };
  }));
}
/** Cell i of a bar with `whole` full cells and a `part`/8 cell after them. */
const barCell = (i: number, whole: number, part: number): string => (i < whole ? '█' : i === whole ? EIGHTHS[part] ?? ' ' : ' ');

const SPARK = '▁▂▃▄▅▆▇█';

/** Sparkline of per-bucket counts: 0 is a dim floor, 1..4+ climb two steps each. */
export const sparkline = (counts: readonly number[], color: string): Segment[] =>
  merge(counts.map((n) => (n ? seg(SPARK[Math.min(7, n * 2 - 1)] ?? '█', color) : seg('▁', M.dim))));

const NICK_HUES = [M.pink, M.peach, M.yellow, M.green, M.teal, M.sky, M.blue, M.violet];

/** A nick's stable colour: its code point sum into the palette. */
export const nickColor = (name: string): string => NICK_HUES[[...name].reduce((n, ch) => n + (ch.codePointAt(0) ?? 0), 0) % NICK_HUES.length] ?? M.violet;
