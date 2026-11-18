// panel-tabs.ts: panel-layout split (audit 4.3, stage S14): the tab strip, the ribbon row and the header rows.
import { workerTally } from '../../data/tally';
import { chipRun, tileOf } from '../../input/clickable';
import { gateCounts, gatesTotal } from '../../design/vocab';
import { capsule, cells, ribbon, UI_STATES, type Run, type Tone, type Ui, type UiState } from '../../design/atlas-ui';
import { lightRibbon } from '../board/board-model';
import { wordOf } from './pane/activity';
import { type PanelTab, label, type PanelWorker, dot, type PanelModel, countedGates, gatesOf, groupOk, groupPending, groupFailing, type PanelLine, rowWidth, line, fitRuns, r, BLANK } from './panel-shared';

/** Tabs in strip order (no key letters: a tab answers a click only). */
export const PANEL_TABS: readonly { id: PanelTab; label: string }[] = [
  { id: 'route', label: 'status' }, { id: 'team', label: 'team' }, { id: 'channel', label: 'channel' },
  { id: 'gates', label: 'gates' }, { id: 'core', label: 'core' },
];
/** The tab strip both hosts draw: the five views, then the board toggle (it opens the Board pane, it is not a view). The band's footer
 * buttons (mod/view/band/band.tsx BAND_BUTTONS) are this list. Each tab is a click chip named by its label alone. */
export const STRIP_TABS: readonly { id: PanelTab | 'board'; label: string }[] = [...PANEL_TABS, { id: 'board', label: 'board' }];
/** Cells a chip adds around its label (one space each side). */
export const CHIP_PAD = 2;
/** A strip tab as drawn: its id and its label (always the whole word, the same on every surface: no `chan`, no two-letter form). */
export type StripTab = { id: PanelTab | 'board'; label: string };
/** Cells of padding between the pane's left rule and the strip (both hosts draw it). */
export const STRIP_PAD = 1;
/** The strip's one shape (round 2, D14): a chip is its label with one cell of padding each side, one cell between chips, nothing before the first. It is the same at every width: a strip that does not fit folds its trailing tabs into `more ›`, it never changes the chips. */
export type StripForm = { pad: number; gap: number; lead: number };
const STRIP_FORM: StripForm = { pad: 1, gap: 1, lead: 0 };
/** The text a tab is drawn as: the label with its padding. */
export const chipText = (label: string, f: Pick<StripForm, 'pad'> = STRIP_FORM): string => `${' '.repeat(f.pad)}${label}${' '.repeat(f.pad)}`;
/** The `more` chip's press key (and the `expanded` key that opens the folded row). */
export const MORE_KEY = 'tabs:more';
/** The `more` chip's words: `more ›` (X7: a chip that navigates trails `›`; the chevrons `▸`/`▾` are for chips that expand in place). */
export const moreWord = (_open: boolean, ui: Pick<Ui, 'ascii'>): string => (ui.ascii ? 'more >' : 'more ›');
/** The second tab set's chip: it swaps the first set back in place. */
export const backWord = (ui: Pick<Ui, 'ascii'>): string => (ui.ascii ? '< back' : '‹ back');
/** AA5: the one short label, drawn when the whole words do not fit one row (`status team chan gates core board`): the order and the set of tabs never change with the width. */
export const SHORT_LABEL: Readonly<Record<string, string>> = { channel: 'chan' };
const stripTabs = (short = false): StripTab[] => STRIP_TABS.map((t): StripTab => ({ ...t, ...(short && SHORT_LABEL[t.label] ? { label: SHORT_LABEL[t.label]! } : {}) }));
const chipsWidth = (tabs: readonly { label: string }[], f: StripForm): number => f.lead + tabs.reduce((n, t, i) => n + (i ? f.gap : 0) + 2 * f.pad + cells(t.label), 0);
/** Tabs per strip row: as many as fit in `inner` cells, each costing its label plus `prefix` cells and `gap` cells between; the rest wrap. */
export function stripRows<T extends { label: string }>(items: readonly T[], inner: number, gap: number = 0, prefix: number = CHIP_PAD): T[][] {
  const rows: T[][] = [];
  let used = 0;
  for (const it of items) {
    const w = prefix + cells(it.label);
    if (!rows.length || (rows[rows.length - 1]!.length && used + gap + w > inner)) { rows.push([]); used = 0; }
    rows[rows.length - 1]!.push(it);
    used += (rows[rows.length - 1]!.length > 1 ? gap : 0) + w;
  }
  return rows;
}
/** The strip both hosts draw at `cols` cells (round 2, D14, AA5): every tab as a chip on one row where they fit (48 cells; 45 with the short `chan`), else the leading tabs that fit beside a `more ›` chip and the rest in `folded`
 * (shown on a second row while the `more` chip is open). `rows` is the visible row; `more` says the chip is there. The lit tab is filled; no key letter is drawn or bound. AA5: no tab is ever swapped for another (the strip keeps one order at every width; only a pane under 45 cells folds its trailing tabs, which the live docks of 110 and 150 never reach), and the pane header names the active tab. */
export function stripLayout(cols: number, _lit?: string): StripForm & { rows: StripTab[][]; folded: StripTab[]; more: boolean; /** Always true: no key prefix is drawn. */ bare: boolean } {
  const f = STRIP_FORM;
  const room = Math.max(1, cols);
  // AA5: all six tabs on one row in the one order: the whole words where they fit, the short labels where they do not; only a pane too narrow even for those folds its trailing tabs
  let words = stripTabs();
  if (chipsWidth(words, f) <= room) return { ...f, rows: [words], folded: [], more: false, bare: true };
  words = stripTabs(true);
  if (chipsWidth(words, f) <= room) return { ...f, rows: [words], folded: [], more: false, bare: true };
  const moreW = 2 * f.pad + cells('more ›');
  const backW = 2 * f.pad + cells('‹ back');
  let n = words.length - 1;
  // Round 3 (E8): one row always. The first set ends in `more ›`, the second (the folded tabs) in `‹ back`. The first set keeps as many tabs as fit; the folded set keeps as many of the rest as fit beside `‹ back` (a pane under ~36 cells cannot reach every tab).
  while (n > 1 && chipsWidth(words.slice(0, n), f) + f.gap + moreW > room) n--;
  const visible = words.slice(0, n); // AA5: the order never changes and the lit tab is never swapped in: the header names the active tab
  let folded = words.filter((t) => !visible.includes(t));
  while (folded.length > 1 && chipsWidth(folded, f) + f.gap + backW > room) folded = folded.slice(0, -1);
  return { ...f, rows: [visible], folded, more: true, bare: true };
}
// ---- header: ribbon and tab strip ---------------------------------------------------------------------------------

export const countWords = (workers: readonly PanelWorker[], ui: Ui): string => {
  const tally = workerTally(workers);
  const n = (s: UiState): number => tally[s];
  return UI_STATES.filter((s) => n(s)).map((s) => `${n(s)} ${wordOf(s)}`).join(` ${dot(ui)} `);
};
/** A channel as a person reads it: a generated id (`lc-opl0e60i`, a launch code, with or without its `@master` branch) is no name, so it reads `this run`; a named channel keeps its `#name` (critique 12). */
export const channelLabel = (name: string | undefined, fallback = 'channel'): string => (name && /^lc-[\w-]{4,}(@[\w./-]+)?$/i.test(name) ? 'this run' : `#${name ?? fallback}`);
/** The gates in the one vocabulary (mod/design/vocab.ts): denials summed over the groups that fired, `ok` or `N denied`; never a pass ratio. `fired` counts the groups that hold lines. */
export function gatesFigure(m: Pick<PanelModel, 'gates' | 'core'>): { text: string; tone: Tone; deny: number; fired: number } {
  const t = gatesTotal(countedGates(gatesOf(m)).map((g) => gateCounts({ ok: groupOk(g), pending: groupPending(g), lines: g.lines.length, pass: g.lines.length - groupFailing(g) })));
  return { text: t.text, tone: t.tone, deny: t.deny, fired: t.fired };
}
/** The ribbon's right-hand text: what the active tab counts, always with its word. */
function ribbonRight(m: PanelModel): string {
  if (m.tab === 'team') return m.lead ? '' : m.workers.length ? countWords(m.workers, m.ui) : ''; // with a lead the tally is the `workers` row under it: once, at every width (critique 14: `3 done` twice)
  if (m.tab === 'gates') { const g = gatesFigure(m); return g.fired ? g.text : ''; } // `ok` or `2 denied` at every width, never a pass ratio (round 2, D4)
  // the lit chip already says `status`: the ribbon's right-hand text is a figure (a count, a tally, a channel), never the tab's own name
  if (m.tab === 'channel') return m.channel && channelLabel(m.channel) !== 'this run' ? channelLabel(m.channel) : ''; // the head row says `this run` once; the ribbon names only a real channel
  return '';
}
const runsWidth = (runs: readonly Run[]): number => runs.reduce((n, x) => n + cells(x.t), 0);
/** The active tab's word in the header: `SIDEPANEL · status` (the route tab is the status view). */
const tabWord = (tab: PanelTab): string => PANEL_TABS.find((t) => t.id === tab)?.label ?? tab;
/** `view`: another view in the panel's ribbon (the board: `▸ BOARD  5 items`, critique 15 B5); absent: the SIDEPANEL ribbon of the lit tab. The pane's close is the host's own `✕` mark: no close chip here (round 2, D8). */
export function ribbonRow(m: PanelModel, view?: { title: string; right: string }): PanelLine {
  if (m.cols < 34) {
    const cap = capsule(m.ui);
    const fill = Math.max(0, m.cols - rowWidth(cap) - 1);
    return line(fitRuns([...cap, r(' '), m.ui.ascii ? r('-'.repeat(fill), 'muted') : r('─'.repeat(fill), 'dim')], m.cols));
  }
  const right = view ? view.right : ribbonRight(m);
  const fitsRight = right && m.cols >= 40 + cells(right);
  // The gates figure (`ok`, `2 denied`) never drops from the header while the capsule and title fit beside it.
  const keep = !view && m.tab === 'gates' && !!right && m.cols >= 32 + cells(right);
  // X7: the `▸` before the title is a breadcrumb (dim, not a control); a chevron elsewhere is a chip that expands or collapses.
  return line(lightRibbon(ribbon(m.cols, view?.title ?? `SIDEPANEL ${dot(m.ui)} ${tabWord(m.tab)}`, fitsRight || keep ? right : '', m.ui), m.ui).map((x) => (x.t === ' ▸ ' || x.t === ' > ' ? { ...x, tone: 'dim' as const } : x)));
}
/** The tab strip (round 2, D14): every tab as a ` label ` chip, the lit one filled with the accent, one cell between chips. A strip that does not fit ends in a `more ›` chip (key `tabs:more`)
 * that opens a second row with the folded tabs (`▾ more`); the chip is filled while the lit tab is one of the folded. */
export function tabRows(m: PanelModel): PanelLine[] {
  const lit: string = m.board ? 'board' : m.tab;
  const f = stripLayout(m.cols, lit);
  const gap = r(' '.repeat(f.gap));
  const tile = tileOf(m.ui);
  const chip = (t: StripTab): Run => { const text = chipText(t.label, f); return t.id === lit ? r(text, 'ink', { bold: true, bg: 'accent' }) : r(text, 'accent', { ...(tile ? { bgHex: tile } : {}) }); }; // the lit chip is filled, every other one is raised on a tile one step off the panel
  const strip = (tabs: readonly StripTab[]): Run[] => tabs.flatMap((t, i) => [...(i ? [gap] : []), chip(t)]);
  const open = m.expanded === MORE_KEY;
  const litFolded = f.folded.some((t) => t.id === lit);
  const more: Run[] = f.more ? [gap, { ...chipRun(moreWord(false, m.ui), m.ui, MORE_KEY), ...(litFolded ? { tone: 'ink' as const, bg: 'accent' as const, bgHex: undefined } : {}) }] : [];
  // One row always: `more ›` swaps the visible set for the folded tabs (and a `‹ back` chip) on the same row.
  if (f.more && open) return [line(fitRuns([...strip(f.folded), gap, chipRun(backWord(m.ui), m.ui, MORE_KEY)], m.cols))];
  return [line(fitRuns([...strip(f.rows[0]!), ...more], m.cols))];
}
/** Ribbon, blank, tab strip, rule, and (from 100 columns) a blank before the body; the 80-column design has none. */
export const headerRows = (m: PanelModel): PanelLine[] => [ribbonRow(m), BLANK, ...tabRows(m), ...(m.cols >= 100 ? [BLANK] : [])];
