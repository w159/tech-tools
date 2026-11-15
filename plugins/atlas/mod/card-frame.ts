// card-frame.ts: the health card (round X: critics/spec-x.md X4), as rows of runs. Pure.
// The card is drawn above the band row while the pane is closed. It is the status tab's own sections (statusActivityRows, statusContextRows, statusRunsRows, statusGatesRows, statusHooksRows: one kit, one set of
// builders) packed in columns: two equal columns from 120 cells (left ACTIVITY, CONTEXT, RUNS; right GATES, HOOKS), one below it. Columns are `u` usable cells wide with a 3-cell gutter; the second section of every column
// starts on the same row (a shorter first section is padded), and no cell is cut: a row that does not fit is shortened at its end by the kit, never mid-word by the column. The title is a chip that closes the card
// (`▾ HEALTH ───`; the band right under it already carries the pill), and so does the band's `▾ health` chip.
import { type Run, type Ui } from './atlas-ui';
import type { Health } from './idle-health';
import { frameKit, hookFeed, promptedOf, statusActivityRows, statusContextRows, statusGatesRows, statusHooksRows, statusRunsRows } from './status-frame';
import { textWidth } from './theme';

const GUTTER = 3; // blank cells between the two columns
/** Two columns from this width; below it one. */
export const CARD_COL2 = 120;
const ONE_COL_MAX = 76;
/** The press key of the card's title chip: the band's own health key, so one handler toggles the card from either place. */
export const CARD_KEY = 'band:health';

const cellsOf = (r: readonly Run[]): number => r.reduce((n, x) => n + textWidth(x.t), 0);

/** Columns of sections side by side, each cell padded to `width`. The second section of every column starts on one row: the first sections are padded to the tallest; later sections follow their own column. */
function pack(columns: readonly Run[][][][], width: number): Run[][] {
  const blank: Run[] = [];
  const second = Math.max(0, ...columns.map((c) => (c[0]?.length ?? 0) + 1));
  const laid = columns.map((secs) => secs.flatMap((sec, i) => {
    const pad = i === 1 ? Array.from({ length: Math.max(0, second - (secs[0]?.length ?? 0) - 1) }, () => blank) : [];
    return [...(i === 0 ? [] : [blank]), ...pad, ...sec];
  }));
  const n = Math.max(0, ...laid.map((c) => c.length));
  const space = (k: number): Run => ({ t: ' '.repeat(Math.max(0, k)), tone: 'text' });
  return Array.from({ length: n }, (_, i) => laid.flatMap((c, k) => {
    const r = c[i] ?? [];
    return k < laid.length - 1 ? [...r, space(width - cellsOf(r) + GUTTER)] : r;
  }));
}

/** The health card at `o.cols` cells: the title chip row, then the packed sections. */
export function cardFrame(h: Health, o: { cols: number; ui: Ui }): Run[][] {
  const cols = Math.max(8, o.cols);
  const two = cols >= CARD_COL2;
  const u = two ? Math.floor((cols - 4) / 2) - 1 : Math.max(10, Math.min(cols - 2, ONE_COL_MAX));
  const kit = frameKit(o.ui, u);
  const prompted = promptedOf('idle', h);
  const secs = [
    statusActivityRows(kit, h, 3),
    statusContextRows(kit, h),
    statusRunsRows(kit, h),
    statusGatesRows(kit, h, { gates: [], prompted }, false),
    statusHooksRows(kit, h),
  ];
  const [act, ctx, runs, gates, hooks] = secs as [Run[][], Run[][], Run[][], Run[][], Run[][]];
  const present = (xs: Run[][][]): Run[][][] => xs.filter((x) => x.length);
  const body = two ? pack([present([act, ctx, runs]), present([gates, hooks])], u + 1) : present([act, ctx, runs, gates, hooks]).flatMap((x, i) => (i ? [[] as Run[], ...x] : x));
  // The title is a chip that toggles the card (`▾ HEALTH` while it is open): the chip and the rule after it; the pill is the band's, right under it.
  const { on, sp, g, k } = kit;
  const open = o.ui.ascii ? 'v' : '▾';
  const label = ` ${open} HEALTH `;
  const title: Run[] = [sp(1), { t: label, tone: 'text', fg: k.chipFg, bgHex: k.chipBg, bold: true, press: CARD_KEY, hover: true }, sp(1), on(g('─', '-').repeat(Math.max(0, cols - 3 - textWidth(label))), k.rule, { tone: 'dim' })];
  return [title, ...body];
}
