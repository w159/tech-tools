// Styled-run helpers shared by the band and the sidebar: lay runs left to right in a cell
// budget and adapt sprite-library runs. Pure; colours are theme keys except sprite runs,
// which always carry both fg and bg so they read on any terminal theme.
import type { ClientElements, RenderElement } from 'claude-code';
import { fitText, textWidth } from './theme';

export type Segment = { t: string; color?: string; bg?: string; bold?: boolean; inverse?: boolean };

/** Lay runs inside `cols` cells; the run that overflows is cut with an ellipsis. */
export function fitRuns(els: ClientElements, parts: Segment[], cols: number): RenderElement[] {
  const out: RenderElement[] = [];
  let left = Math.max(1, cols);
  for (const p of parts) {
    if (left <= 0) break;
    const t = fitText(p.t, left);
    left -= textWidth(t);
    out.push(els.Text({ color: p.color, backgroundColor: p.bg, bold: p.bold, inverse: p.inverse, children: t }));
  }
  return out;
}

export const rowOf = (els: ClientElements, parts: Segment[], cols: number): RenderElement =>
  els.Box({ flexDirection: 'row', flexShrink: 0, children: fitRuns(els, parts, cols) });

