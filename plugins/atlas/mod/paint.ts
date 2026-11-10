// Truecolor paint primitives for the filled surfaces (band, worker cards, reply pills): every run
// carries its own fg and bg from the Mocha palette, so the surface paints its own background.
// Pure: they return Segments (runs.ts) that rowOf lays out; widths are terminal cells.
import type { Segment } from './runs';
import { MOCHA as M, textWidth } from './theme';

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

/** Adjacent runs with the same style fold into one, so per-cell runs cost a few Text nodes. */
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
