// card-frame.ts: the health card of the approved frame spec (critics/mock-final.md section 6, frames H1-H5), as rows of runs. Pure.
// The card is drawn above the band row while the pane is closed. It is the pane's own sections (ACTIVITY, CONTEXT, RUNS, GATES, HOOKS from status-frame.ts, one kit, one set of builders) packed in columns:
// three at 44 cells (from 142 columns), two at 46 (from 97), else one. Its title is a chip that closes it (`◖ ◆ ATLAS ◗ ▾ HEALTH`), and so does the band's `▾ health` chip; no state line (the band owns it).
// Packing: three columns hold ACTIVITY and CONTEXT, then GATES and RUNS, then HOOKS alone (one row shorter than the tallest column, never fewer than one row); two columns hold ACTIVITY, CONTEXT and RUNS,
// then GATES and HOOKS (HOOKS fills down to the foot of the first column, never fewer than one row). A section is whole or absent; one blank row separates the sections of a column.
import { lightRibbon } from './board-model';
import { ribbon as titleRibbon, runsCells, type Run, type Ui } from './atlas-ui';
import type { Health } from './idle-health';
import { activityRows, contextRows, frameKit, gatesRows, hookFeed, hooksRows, promptedOf, runsRows } from './status-frame';

const GUTTER = 3; // blank cells between two columns (the next column's own gutter cell follows)
export const CARD_COL3 = 142;
export const CARD_COL2 = 97;
/** The press key of the card's title chip: the band's own health key, so one handler toggles the card from either place. */
export const CARD_KEY = 'band:health';

/** Rows as columns side by side: each padded to `width` cells, a short column leaves blank cells. */
function join(columns: readonly Run[][][], width: number): Run[][] {
  const n = Math.max(0, ...columns.map((c) => c.length));
  const blank = (k: number): Run => ({ t: ' '.repeat(k), tone: 'text' });
  return Array.from({ length: n }, (_, i) => columns.flatMap((c, k) => {
    const r = c[i] ?? [];
    const gap = Math.max(0, width - runsCells(r));
    return k < columns.length - 1 ? [...r, blank(gap + GUTTER)] : r;
  }));
}

/** The health card at `o.cols` cells: the fixed title row, then the packed sections. */
export function cardFrame(h: Health, o: { cols: number; ui: Ui }): Run[][] {
  const cols = Math.max(8, o.cols);
  const n = cols >= CARD_COL3 ? 3 : cols >= CARD_COL2 ? 2 : 1;
  const u = n === 3 ? 44 : n === 2 ? 46 : Math.max(10, Math.min(cols - 1, 62));
  const kit = frameKit(o.ui, u);
  const blank: Run[] = [];
  const stack = (secs: readonly Run[][][]): Run[][] => secs.filter((s) => s.length).flatMap((s, i) => (i ? [blank, ...s] : s));
  const act = activityRows(kit, h);
  const ctx = contextRows(kit, h);
  const runs = runsRows(kit, h);
  const gates = gatesRows(kit, h, { gates: [], prompted: promptedOf('idle', h) }, false);
  const feed = hookFeed(h);
  const hooks = (rows: number): Run[][] => hooksRows(kit, h, feed, rows);
  let body: Run[][];
  if (n === 3) {
    const left = stack([act, ctx]);
    const mid = stack([gates, runs]);
    const tall = Math.max(left.length, mid.length);
    body = join([left, mid, hooks(Math.max(1, tall - 2))], u + 1);
  } else if (n === 2) {
    const left = stack([act, ctx, runs]);
    const upper = stack([gates]).length + 1; // GATES, the blank row, then the HOOKS ribbon
    body = join([left, stack([gates, hooks(Math.max(1, left.length - upper - 1))])], u + 1);
  } else {
    body = stack([act, ctx, runs, gates, hooks(Math.min(feed.length, 5))]);
  }
  // M: the title is a chip that toggles the card (`▾ HEALTH` while it is open): the chevron and the word both press the band's health key.
  const open = o.ui.ascii ? 'v' : '▾';
  const title = lightRibbon(titleRibbon(cols + 1, 'HEALTH', '', o.ui), o.ui).slice(0, -1).map((x): Run => (x.t === ' ▸ ' || x.t === ' > ' ? { ...x, t: ` ${open} `, tone: 'accent', bold: true, press: CARD_KEY, hover: true } : x.t === 'HEALTH' ? { ...x, press: CARD_KEY, hover: true } : x)); // the rule runs to the last cell (the shared ribbon ends in a margin cell)
  return [title, ...body];
}
