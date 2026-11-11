// The Atlas Board on Claude Code (design rev 4): the data and the layout live in board-model.ts, shared with omp, and this
// file paints them as Segment rows. `boardTree` is the board pane (ribbon, header, one row per item); `todoRows` is the same
// rows without the ribbon, for the band's inline slot, capped by the row budget with a `+N more` row. Pure: rows in, Segments out.
import type { ClientElements, RenderElement } from 'claude-code';
import { hostEnv, surfaceHex, uiFromEnv, type Run, type Ui, runHex } from './atlas-ui';
import type { MotionCtx } from './motion';
import { boardBody, boardLines, boardRowsOf, type BoardLine, type BoardSource } from './board-model';
import { rowOf, type Segment } from './runs';
import { textWidth } from './theme';

/** `tick` is the spinner frame of the running row; `now` (epoch seconds) times the running item; `ui` defaults to the environment. */
export type TodoPanelOpts = { cols: number; tick: number; expanded: boolean; maxRows: number; now?: number; /** The snapshot clock in epoch ms (`now` is whole seconds): the spinner then turns the shared frame; absent: `tick`. */ nowMs?: number; ui?: Ui; rich?: boolean; motion?: MotionCtx | undefined };

/** A run as a Segment on the rev 4 panel; with NO_COLOR only bold and strike remain. */
export const runSegment = (x: Run, ui: Ui): Segment => {
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  return ui.color === 'none' ? { t: x.t, ...style } : { t: x.t, color: runHex(x, ui.theme, ui.color), bg: surfaceHex(x.bg ?? 'panel', ui), ...style };
};
/** The panel fill as drawn: in 256 colours the stable grey (index 234), not the raw hex the host turns into navy 17. */
const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : surfaceHex('panel', ui));
/** The line's Segments, then panel-coloured spaces to exactly `cols` cells (plain spaces with NO_COLOR). */
function rowOfLine(l: BoardLine, cols: number, ui: Ui): Segment[] {
  const parts = l.runs.map((x) => runSegment(x, ui));
  const gap = cols - parts.reduce((n, p) => n + textWidth(p.t), 0);
  const bg = panelBg(ui);
  return gap > 0 ? [...parts, { t: ' '.repeat(gap), ...(bg ? { bg } : {}) }] : parts;
}

/** Cut `rows` to `max`, the last kept row becoming `+N more` when something is left out. */
function capRows<T>(rows: readonly T[], max: number, more: (n: number) => T): T[] {
  if (rows.length <= max) return [...rows];
  const shown = rows.slice(0, Math.max(0, max - 1));
  return [...shown, more(rows.length - shown.length)];
}

/** The rich form (chips, elapsed gauge) follows the band's switch. */
const richEnv = (): boolean => hostEnv().ATLAS_BAND_RICH === '1';
const moreLine = (n: number): BoardLine => ({ runs: [{ t: `  +${n} more`, tone: 'muted' }] });

/** Board rows for the band's inline slot: [] without items or room, else the header and one row per item, at most `maxRows`. */
export function todoRows(items: readonly BoardSource[], o: TodoPanelOpts): Segment[][] {
  if (!items.length || o.maxRows < 1 || !o.expanded) return [];
  const ui = o.ui ?? uiFromEnv();
  const body = boardBody(boardRowsOf(items, o.now), { cols: o.cols, ui, rich: o.rich ?? richEnv(), tick: o.tick, ...(o.nowMs !== undefined ? { nowMs: o.nowMs } : {}), motion: o.motion });
  return capRows(body, o.maxRows, moreLine).map((l) => rowOfLine(l, o.cols, ui));
}

export type BoardTreeOpts = { cols: number; rows: number; tick: number; now?: number; /** The snapshot clock in epoch ms (`now` is whole seconds): the spinner then turns the shared frame; absent: `tick`. */ nowMs?: number; ui?: Ui; rich?: boolean; motion?: MotionCtx | undefined };

/** The board pane: the whole surface (ribbon, blank row, header, items), capped at `rows` with a `+N more` row. */
export function boardTree(els: ClientElements, items: readonly BoardSource[], o: BoardTreeOpts): RenderElement {
  const ui = o.ui ?? uiFromEnv();
  const at = { cols: o.cols, ui, rich: o.rich ?? richEnv(), tick: o.tick, ...(o.nowMs !== undefined ? { nowMs: o.nowMs } : {}), motion: o.motion };
  const lines = items.length ? boardLines(boardRowsOf(items, o.now), at) : [...boardLines([], at), { runs: [{ t: '  (no state)', tone: 'muted' as const }] }];
  const rows = capRows(lines, Math.max(1, o.rows), moreLine).map((l) => rowOf(els, rowOfLine(l, o.cols, ui), o.cols));
  return els.Box({ flexDirection: 'column', flexShrink: 0, backgroundColor: panelBg(ui), children: rows });
}
