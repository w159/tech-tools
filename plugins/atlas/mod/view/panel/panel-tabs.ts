// panel-tabs.ts: panel-layout split (audit 4.3, stage S14): the tab strip, the header row and the rule under the strip.
// The redesign (mock.html `tabs`): the header is the `◆ ATLAS` pill, `project · branch` dim and the version flush right; the strip is the four tabs `health status gates channel`, the lit one a filled accent chip with an accent segment on the rule below,
// gates carrying its denial count (red) and channel its unread count (accent) as badges.
import { workerTally } from '../../data/tally';
import { chipRun } from '../../input/clickable';
import { gateCounts, gatesTotal } from '../../design/vocab';
import { cells, inkFor, UI_STATES, type Run, type Tone, type Ui, type UiState } from '../../design/atlas-ui';
import { wordOf } from './pane/activity';
import { type PanelTab, type PanelWorker, dot, type PanelModel, countedGates, gatesOf, groupOk, groupPending, groupFailing, type PanelLine, line, fitRuns, r, BLANK } from './panel-shared';

/** Tabs in strip order (no key letters: a tab answers a click only). The ids stay internal: `core` is the health view, `route` the status view. */
export const PANEL_TABS: readonly { id: PanelTab; label: string }[] = [
  { id: 'route', label: 'status' }, { id: 'core', label: 'health' }, { id: 'channel', label: 'channel' }, { id: 'bored', label: 'bored' },
];
/** The tab strip both hosts draw (the band's footer buttons, mod/view/band/band.tsx BAND_BUTTONS, are this list). Each tab is a click chip named by its label alone. */
export const STRIP_TABS: readonly { id: PanelTab | 'board'; label: string }[] = [...PANEL_TABS];
/** Cells a chip adds around its label (one space each side). */
export const CHIP_PAD = 2;
/** A strip tab as drawn: its id, its label (always the whole word where it fits) and its badge (a count beside the chip). */
export type StripTab = { id: PanelTab | 'board'; label: string; badge?: string };
/** Cells of padding between the pane's left rule and the strip (both hosts draw it). */
export const STRIP_PAD = 1;
/** The strip's one shape: a chip is its label with one cell of padding each side, two cells between chips, one before the first. A strip that does not fit folds its trailing tabs into `more ›`; it never changes the chips. */
export type StripForm = { pad: number; gap: number; lead: number };
const STRIP_FORM: StripForm = { pad: 1, gap: 2, lead: 1 };
/** The text a tab is drawn as: the label with its padding. */
export const chipText = (label: string, f: Pick<StripForm, 'pad'> = STRIP_FORM): string => `${' '.repeat(f.pad)}${label}${' '.repeat(f.pad)}`;
/** The `more` chip's press key (and the `expanded` key that opens the folded row). */
export const MORE_KEY = 'tabs:more';
/** The `more` chip's words: `more ›` (a chip that navigates trails `›`; the chevrons `▸`/`▾` are for chips that expand in place). */
export const moreWord = (_open: boolean, ui: Pick<Ui, 'ascii'>): string => (ui.ascii ? 'more >' : 'more ›');
/** The second tab set's chip: it swaps the first set back in place. */
export const backWord = (ui: Pick<Ui, 'ascii'>): string => (ui.ascii ? '< back' : '‹ back');
/** The one short label, drawn when the whole words do not fit one row: the order and the set of tabs never change with the width. */
export const SHORT_LABEL: Readonly<Record<string, string>> = { channel: 'chan' };
/** The badge text of a tab (` 2`, with its leading space), or none. */
const badgeText = (b: string | undefined): string => (b ? ` ${b}` : '');
const stripTabs = (short = false, badges: Readonly<Record<string, string>> = {}): StripTab[] =>
  STRIP_TABS.map((t): StripTab => ({ ...t, ...(short && SHORT_LABEL[t.label] ? { label: SHORT_LABEL[t.label]! } : {}), ...(badges[t.id] ? { badge: badges[t.id]! } : {}) }));
const chipsWidth = (tabs: readonly { label: string; badge?: string }[], f: StripForm): number => f.lead + tabs.reduce((n, t, i) => n + (i ? f.gap : 0) + 2 * f.pad + cells(t.label) + cells(badgeText(t.badge)), 0);
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
/** The strip both hosts draw at `cols` cells: every tab as a chip on one row where they fit, else the short labels, else the leading tabs that fit beside a `more ›` chip and the rest in `folded` (shown in place of them while the `more` chip is open).
 * `badges`: a count per tab id, drawn beside its chip. No tab is ever swapped for another; the pane header names the product, the lit chip the tab. */
export function stripLayout(cols: number, _lit?: string, badges: Readonly<Record<string, string>> = {}): StripForm & { rows: StripTab[][]; folded: StripTab[]; more: boolean; /** Always true: no key prefix is drawn. */ bare: boolean } {
  const f = STRIP_FORM;
  const room = Math.max(1, cols);
  let words = stripTabs(false, badges);
  if (chipsWidth(words, f) <= room) return { ...f, rows: [words], folded: [], more: false, bare: true };
  words = stripTabs(true, badges);
  if (chipsWidth(words, f) <= room) return { ...f, rows: [words], folded: [], more: false, bare: true };
  const moreW = 2 * f.pad + cells('more ›');
  const backW = 2 * f.pad + cells('‹ back');
  let n = words.length - 1;
  while (n > 1 && chipsWidth(words.slice(0, n), f) + f.gap + moreW > room) n--;
  const visible = words.slice(0, n);
  let folded = words.filter((t) => !visible.includes(t));
  while (folded.length > 1 && chipsWidth(folded, f) + f.gap + backW > room) folded = folded.slice(0, -1);
  return { ...f, rows: [visible], folded, more: true, bare: true };
}
// ---- header: pill row, tab strip, rule ---------------------------------------------------------------------------

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
/** The badges of the strip: health (core) its gate denial count, channel its unread count; a tab with nothing to count has none. */
export function stripBadges(m: Pick<PanelModel, 'gates' | 'core' | 'unread'>): Record<string, string> {
  const deny = gatesFigure(m).deny;
  return { ...(deny > 0 ? { core: String(deny) } : {}), ...(m.unread > 0 ? { channel: String(m.unread) } : {}) };
}
const badgeTone = (id: string): Tone => (id === 'core' ? 'bad' : 'accent'); // the denial count (red) sits on health, which now holds the gates
/** The tab the strip lights: the team view is the status one. */
const litOf = (tab: PanelTab): string => (tab === 'team' ? 'route' : tab);
/** `project`, `branch` as the header reads them: from the channel name (`tech-tools@main`) and the health's branch. */
function projectBranch(m: PanelModel): string {
  const ch = m.channel && channelLabel(m.channel) !== 'this run' ? m.channel : '';
  const [proj, br] = ch.split('@');
  return [proj, m.health?.branch ?? br].filter(Boolean).join(` ${dot(m.ui)} `);
}
/** The header row: the `◆ ATLAS` pill, `project · branch` dim, the version flush right and faint. */
export function ribbonRow(m: PanelModel): PanelLine {
  const ui = m.ui;
  const pill: Run = ui.ascii ? r('[ATLAS]', 'text', { bold: true }) : r(' ◆ ATLAS ', inkFor('accent', ui.theme, ui.color), { bg: 'accent', bold: true, chip: true });
  if (m.cols < 34) {
    const fill = Math.max(0, m.cols - cells(pill.t) - 2);
    return line(fitRuns([r(' '), pill, r(' '), r((ui.ascii ? '-' : '─').repeat(fill), 'dim')], m.cols));
  }
  const left: Run[] = [r(' '), pill, ...(projectBranch(m) ? [r(`  ${projectBranch(m)}`, 'muted')] : [])];
  const ver = m.health?.version ?? '';
  const used = left.reduce((n, x) => n + cells(x.t), 0);
  const room = m.cols - used - 1;
  return line(fitRuns([...left, ...(ver && room >= cells(ver) + 2 ? [r(' '.repeat(room - cells(ver))), r(ver, 'dim')] : [])], m.cols));
}
/** One piece of the strip row, with what the rule under it draws. */
export type StripSeg = { kind: 'lead' | 'gap' | 'chip' | 'more' | 'back'; text: string; tab?: StripTab; lit: boolean };
/** The strip row as pieces: the chips (with their badges), the gaps, and the `more ›` / `‹ back` chip when the tabs do not all fit. Both the omp rows and the Claude pane's buttons are built from it. */
export function stripSegs(m: Pick<PanelModel, 'cols' | 'ui' | 'tab' | 'expanded' | 'gates' | 'core' | 'unread'> & { board?: boolean }): { segs: StripSeg[]; layout: ReturnType<typeof stripLayout> } {
  const lit = m.board ? 'board' : litOf(m.tab); // the board the band opens is no tab: no chip is lit over it
  const f = stripLayout(m.cols, lit, stripBadges(m));
  const open = m.expanded === MORE_KEY;
  const chips = (tabs: readonly StripTab[]): StripSeg[] => tabs.flatMap((t, i): StripSeg[] => [...(i ? [{ kind: 'gap' as const, text: ' '.repeat(f.gap), lit: false }] : []), { kind: 'chip', text: chipText(t.label, f), tab: t, lit: t.id === lit }]);
  const lead: StripSeg = { kind: 'lead', text: ' '.repeat(f.lead), lit: false };
  const gap: StripSeg = { kind: 'gap', text: ' '.repeat(f.gap), lit: false };
  const litFolded = lit !== 'board' && !f.rows[0]!.some((t) => t.id === lit); // the lit tab is behind `more ›` (even one the folded row has no room to list)
  if (f.more && open) return { segs: [lead, ...chips(f.folded), gap, { kind: 'back', text: chipText(backWord(m.ui), f), lit: false }], layout: f };
  return { segs: [lead, ...chips(f.rows[0]!), ...(f.more ? [gap, { kind: 'more' as const, text: chipText(moreWord(false, m.ui), f), lit: litFolded }] : [])], layout: f };
}
/** The tab strip as one row of runs: the lit chip filled with the accent, the others in the sub tone, badges beside their chip. A strip that does not fit ends in `more ›` (key `tabs:more`) that swaps in the folded tabs and a `‹ back` chip. */
export function tabRows(m: PanelModel): PanelLine[] {
  const { segs } = stripSegs(m);
  const runs = segs.flatMap((s): Run[] => {
    if (s.kind === 'chip') return [s.lit ? r(s.text, 'ink', { bold: true, bg: 'accent' }) : r(s.text, 'sub'), ...(s.tab?.badge ? [r(badgeText(s.tab.badge), badgeTone(s.tab.id), { bold: true })] : [])];
    if (s.kind === 'more' || s.kind === 'back') return [{ ...chipRun(s.kind === 'more' ? moreWord(false, m.ui) : backWord(m.ui), m.ui, MORE_KEY), ...(s.lit ? { tone: 'ink' as const, bg: 'accent' as const, bgHex: undefined } : {}) }];
    return [r(s.text)];
  });
  return [line(fitRuns(runs, m.cols))];
}
/** The rule under the strip: faint across the pane, an accent segment under the lit chip. */
export function tabRule(m: PanelModel): PanelLine {
  const ui = m.ui;
  const { segs } = stripSegs(m);
  const heavy = ui.ascii ? '=' : '━';
  const light = ui.ascii ? '-' : '─';
  const runs: Run[] = segs.flatMap((s): Run[] => {
    const n = cells(s.text);
    const badge = s.tab?.badge ? cells(badgeText(s.tab.badge)) : 0; // the heavy segment is the chip; its badge sits on the light rule
    return s.kind === 'lead' ? [r(' '.repeat(n))] : [r((s.lit ? heavy : light).repeat(n), s.lit ? 'accent' : 'dim'), ...(badge ? [r(light.repeat(badge), 'dim')] : [])];
  });
  const used = runs.reduce((n, x) => n + cells(x.t), 0);
  return line(fitRuns([...runs, r(light.repeat(Math.max(0, m.cols - used - 1)), 'dim')], m.cols));
}
/** Header, blank, tab strip, rule: the four rows above every tab's body. */
export const headerRows = (m: PanelModel): PanelLine[] => [ribbonRow(m), BLANK, ...tabRows(m), tabRule(m)];
