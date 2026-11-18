// Styled-run helpers shared by the band and the sidebar: lay runs left to right in a cell
// budget and adapt sprite-library runs. Pure; colours are theme keys except sprite runs,
// which always carry both fg and bg so they read on any terminal theme.
import type { ClientElements, RenderElement } from 'claude-code';
import { fitText, textWidth } from './theme';

export type Segment = { t: string; color?: string; bg?: string; bold?: boolean; inverse?: boolean; strike?: boolean; /** A clickable run (mod/input/clickable.ts): drawn as a Button with this key when the row is given a press handler (rowOf). */ press?: string; hover?: true };

/** Lay runs inside `cols` cells; the run that overflows is cut with an ellipsis. */
export function fitRuns(els: ClientElements, parts: Segment[], cols: number): RenderElement[] {
  const out: RenderElement[] = [];
  let left = Math.max(1, cols);
  for (const p of parts) {
    if (left <= 0) break;
    const t = fitText(p.t, left);
    left -= textWidth(t);
    out.push(els.Text({ color: p.color, backgroundColor: p.bg, bold: p.bold, inverse: p.inverse, strikethrough: p.strike, children: t }));
  }
  return out;
}

/** A row of runs; with `on`, a run that carries `press` is a plain Button of one Text (the hover style from `on.hover`) and a press calls `on.press(key)`. */
export const rowOf = (els: ClientElements, parts: Segment[], cols: number, on?: { press: (key: string) => void; hover: (key: string) => object }): RenderElement => {
  if (!on || !parts.some((p) => p.press)) return els.Box({ flexDirection: 'row', flexShrink: 0, children: fitRuns(els, parts, cols) });
  let left = Math.max(1, cols);
  const children = parts.flatMap((p): RenderElement[] => {
    const room = left;
    left -= textWidth(fitText(p.t, Math.max(0, room)));
    if (!p.press) return fitRuns(els, [p], room);
    const key = p.press;
    return [els.Button({ key, plain: true, onPress: () => on.press(key), children: [els.Text({ color: p.color, backgroundColor: p.bg, bold: p.bold, inverse: p.inverse, strikethrough: p.strike, ...(p.hover ? { hover: on.hover(key) } : {}), children: fitText(p.t, Math.max(1, room)) })] })];
  });
  return els.Box({ flexDirection: 'row', flexShrink: 0, children });
};

