// card-frame.ts: the health card (round X: critics/spec-x.md X4), as rows of runs. Pure.
// The card is drawn above the band row while the pane is closed. It is the status tab's own sections (statusActivityRows, statusContextRows, statusRunsRows, statusGatesRows, statusHooksRows: one kit, one set of
// builders) packed in columns: Z7: the status tab's order (ACTIVITY, CONTEXT, RUNS, GATES, HOOKS) at both widths: two equal columns from 120 cells split it left (ACTIVITY, CONTEXT, RUNS) and right (GATES, HOOKS), one column below it. Columns are `u` usable cells wide with a 3-cell gutter; the second section of every column
// starts on the same row (a shorter first section is padded), and no cell is cut: a row that does not fit is shortened at its end by the kit, never mid-word by the column. The title is a chip that closes the card
// (`▾ HEALTH ───`; the band right under it already carries the pill), and so does the band's `▾ health` chip.
import { type Run, type Ui } from './atlas-ui';
import type { Health } from './data/idle-health';
import { CARD_MORE_KEY, frameKit, moreRow, promptedOf, statusActivityRows, statusContextRows, statusGatesRows, statusHooksRows, statusRunsRows } from './status-frame';
import { textWidth } from './theme';

const GUTTER = 3; // blank cells between the two columns
/** Two columns from this width; below it one. */
export const CARD_COL2 = 120;
const ONE_COL_MAX = 76;
/** AA2: the widest a table section (GATES, HOOKS) is drawn, in usable cells. */
export const TABLE_MAX = 48;
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

/** The health card at `o.cols` cells: the title chip row, then the packed sections. Y2a, Z7: with `o.maxRows` (the rows the host gives the card: its slot budget less the band's row) the card keeps whole sections only, dropping from the end of the status tab's order (HOOKS, GATES, RUNS, CONTEXT, ACTIVITY), and ends in a chip `+N more ›` (key `card:more`, opens the status view) when any went. */
export function cardFrame(h: Health, o: { cols: number; ui: Ui; maxRows?: number }): Run[][] {
  const cols = Math.max(8, o.cols);
  const two = cols >= CARD_COL2;
  const u = two ? Math.floor((cols - 4) / 2) - 1 : Math.max(10, Math.min(cols - 2, ONE_COL_MAX));
  const kit = frameKit(o.ui, u);
  const tableKit = frameKit(o.ui, Math.min(u, TABLE_MAX)); // AA2: a table is never wider than 48 cells, so a value sits next to its label
  const prompted = promptedOf('idle', h);
  const secs = {
    act: statusActivityRows(kit, h, 3),
    ctx: statusContextRows(kit, h),
    runs: statusRunsRows(kit, h),
    gates: statusGatesRows(tableKit, h, { gates: [], prompted }, false),
    hooks: statusHooksRows(tableKit, h),
  };
  type Key = keyof typeof secs;
  const DROP: readonly Key[] = ['hooks', 'gates', 'runs', 'ctx', 'act']; // Z7: the order sections give way is the reverse of the status tab's, so a short card shows a prefix of ACTIVITY, CONTEXT, RUNS, GATES, HOOKS, never a gap in it
  const present = (xs: Run[][][]): Run[][][] => xs.filter((x) => x.length);
  const lay = (kept: ReadonlySet<Key>): Run[][] => {
    const pick = (...ks: Key[]): Run[][][] => present(ks.filter((k) => kept.has(k)).map((k) => secs[k]));
    return two ? pack([pick('act', 'ctx', 'runs'), pick('gates', 'hooks')], u + 1) : pick('act', 'ctx', 'runs', 'gates', 'hooks').flatMap((x, i) => (i ? [[] as Run[], ...x] : x));
  };
  const all = new Set<Key>(['act', 'ctx', 'runs', 'gates', 'hooks']);
  let kept = new Set(all);
  let body = lay(kept);
  const limit = o.maxRows !== undefined && o.maxRows > 0 ? o.maxRows : Infinity;
  const gone = (): Key[] => [...all].filter((k) => !kept.has(k) && secs[k].length > 0);
  for (const k of DROP) {
    if (1 + body.length + (gone().length ? 1 : 0) <= limit) break;
    kept = new Set([...kept].filter((x) => x !== k));
    body = lay(kept);
  }
  if (Number.isFinite(limit) && 1 + body.length + (gone().length ? 1 : 0) > limit) body = body.slice(0, Math.max(0, limit - 1 - (gone().length ? 1 : 0))); // a budget under one section: nothing whole fits
  const more: Run[][] = gone().length ? [moreRow(kit, gone().length, 'status', CARD_MORE_KEY)] : [];
  // The title is a chip that toggles the card (`▾ HEALTH` while it is open): the chip and the rule after it; the pill is the band's, right under it.
  const { on, sp, g, k } = kit;
  const open = o.ui.ascii ? 'v' : '▾';
  const label = ` ${open} HEALTH `;
  const title: Run[] = [sp(1), { t: label, tone: 'text', fg: k.chipFg, bgHex: k.chipBg, bold: true, press: CARD_KEY, hover: true }, sp(1), on(g('─', '-').repeat(Math.max(0, cols - 3 - textWidth(label))), k.rule, { tone: 'dim' })];
  return [title, ...body, ...more];
}
