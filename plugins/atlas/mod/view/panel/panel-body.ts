// panel-body.ts: panel-layout split (audit 4.3, stage S14): the BODIES table, fill, pinned footer and panelLines.
import { type Health } from '../../data/idle-health';
import { chevron } from '../../input/clickable';
import { type Run } from '../../design/atlas-ui';
import { tabFrame, type TabId } from './tabs-frame';
import { type PanelTab, type PanelModel, type PanelLine, BLANK, r, fitRuns, rowWidth, lineText } from './panel-shared';
import { routeBody, footerLine } from './panel-rows-route';
import { teamBody, channelBody, SKEL, emptyTab } from './panel-rows-team';
import { gatesBody, coreBody } from './panel-rows-gates';
import { headerRows } from './panel-tabs';

// ---- the panel ------------------------------------------------------------------------------------------------------------------------

const BODIES: Record<PanelTab, (m: PanelModel) => PanelLine[]> = { route: routeBody, team: teamBody, channel: channelBody, gates: gatesBody, core: coreBody };
/** The active tab's body rows (no header). */
/** Room to spare on a tall pane: the team, gates and channel tabs put a blank row between items (an item is a pressable row with its detail rows, or one note) when the whole body still fits a pane of 48 rows or more (a short pane keeps its rows tight). */
const AIRY: ReadonlySet<PanelTab> = new Set<PanelTab>(['team', 'gates', 'channel']);
function airy(m: PanelModel, lines: PanelLine[]): PanelLine[] {
  const starts = (l: PanelLine, i: number): boolean => i > 0 && (m.tab === 'channel' ? true : !!l.press);
  const gaps = lines.filter(starts).length;
  if (m.rows < 48 || !AIRY.has(m.tab) || !gaps || lines.length + gaps > m.rows - headerRows(m).length - 1) return lines;
  return lines.flatMap((l, i) => (starts(l, i) ? [BLANK, l] : [l]));
}
/** Wave 43: a pressable row wears the one clickable look (mod/input/clickable.ts): its leading blank (the grid's focus cell, or the first of its lead spaces) is the accent chevron (`▸` closed, `▾` open) and every run
 * of the row takes the hover style. A row that already carries a clickRun (the health rows) is left as it is. */
function clickable(lines: PanelLine[], m: PanelModel): PanelLine[] {
  return lines.map((l) => {
    if (!l.press || l.runs.length === 0 || l.runs.some((x) => x.press)) return l;
    const [first, ...rest] = l.runs as [Run, ...Run[]];
    const blank = first.t.length > 0 && first.t.trim() === '';
    // Round 3 (E8): one caret idiom, `▸` closed and `▾` open, on expandable rows only (the recipient's row keeps its focus `▸`, bold accent, in the same cell; another worker row's caret is the quiet one); no hollow `▹`.
    const glyph = chevron(m.expanded === l.press.key, m.ui);
    const lead: Run[] = blank
      ? [l.press.kind === 'worker' ? { t: glyph, tone: 'sub' as const } : { t: glyph, tone: 'accent' as const, bold: true }, ...(first.t.length > 1 ? [{ ...first, t: first.t.slice(1) }] : [])]
      : [first];
    return { ...l, runs: [...lead, ...rest].map((x) => ({ ...x, hover: true })) };
  });
}
/** The footer on the last body row of a Claude pane tab (the status tab pins its own): blank rows hold it down; a tab with no spare row for it keeps its body. */
function pinFooter(m: PanelModel, lines: PanelLine[]): PanelLine[] {
  const foot = m.health ? footerLine(m, m.health) : null;
  const room = m.rows - headerRows(m).length - (m.tab === 'team' || m.tab === 'channel' ? 1 : 0); // the message field is the pane's last row on team and channel
  if (!foot || m.rows <= 0 || lines.length + 1 > room) return lines;
  return [...lines, ...Array.from({ length: room - lines.length - 1 }, () => BLANK), foot];
}
const BOARD_SKEL = ['item                state    owner', `○ T1 ${SKEL}   queued   ·······`, `○ T2 ${SKEL}   queued   ·······`];
/** The board with nothing on it (Claude pane): the ribbon, the live fact `0 items`, the dim skeleton and the pinned footer, in the pane's gutter. `rows`: the body rows the pane has under its header. */
export function boardEmptyRows(m: PanelModel, rows: number): PanelLine[] {
  const inner: PanelModel = { ...m, cols: m.cols - 1 };
  const body = emptyTab(inner, 'BOARD', '0 items', BOARD_SKEL);
  const foot = m.health ? footerLine(inner, m.health) : null;
  const all = foot && rows > body.length + 1 ? [...body, ...Array.from({ length: rows - body.length - 1 }, () => BLANK), foot] : body;
  return all.map((l) => (l.runs.length ? { ...l, runs: [r(' '), ...l.runs] } : l));
}
/** The tab the frame path draws (spec section 5: gates, team, chat, core, board): the Claude pane with the mod's health, on any tab but the status one. */
export const frameTabOf = (m: Pick<PanelModel, 'run' | 'health' | 'tab' | 'board'>): TabId | null => (m.run && m.health ? (m.board ? 'board' : m.tab === 'route' ? null : m.tab === 'channel' ? 'channel' : m.tab) : null);
/** A frame tab as panel rows (mod/view/panel/tabs-frame.ts): each row draws its own gutter; a row that expands in place carries a `flip` press, the chat compose chip a `compose` one. */
function tabLines(m: PanelModel, tab: TabId, h: Health): PanelLine[] {
  const rows = tabFrame({
    tab, cols: m.cols, room: m.rows > 0 ? m.rows - headerRows(m).length : 0, ui: m.ui, kind: m.run?.kind ?? 'idle', health: h, gates: m.gates, lead: m.cols < 100,
    workers: m.workers.map((w) => ({ name: w.name, ...(w.role ? { role: w.role } : {}), state: w.state, ...(w.model ? { model: w.model } : {}), detail: w.detail, ...(w.secs !== undefined ? { secs: w.secs } : {}) })),
    ...(m.lead?.secs !== undefined || m.run?.secs !== undefined ? { leadSecs: m.lead?.secs ?? m.run?.secs } : {}),
    todos: m.todos.map((t) => ({ id: t.id, label: t.label, state: t.state, ...(t.owner ? { owner: t.owner } : {}), ...(t.detail ? { detail: t.detail } : {}), evidence: t.evidence ?? null })),
    notes: m.notes.map((n) => ({ at: n.at, from: n.from, ...(n.kind ? { kind: n.kind } : {}), text: n.text })),
    channel: m.channel ?? 'channel', people: m.people, recipient: m.recipient, core: m.core ?? null, flips: m.flips ?? [], ...(m.read ? { read: m.read } : {}), ...(m.read ? { read: m.read } : {}),
  });
  return rows.map((x) => ({ runs: fitRuns(x.runs, m.cols), ...(x.press ? { press: x.press } : {}) }));
}
/** The Claude pane's rows sit one cell in from the host's border (the gutter); the caret of an expandable row is the first cell after it. The status view draws its own gutter. */
export function bodyLines(m: PanelModel): PanelLine[] {
  const framed = frameTabOf(m);
  if (framed && m.health) return tabLines(m, framed, m.health);
  if (!m.run || (m.tab === 'route' && m.health)) return airy(m, clickable(BODIES[m.tab](m), m));
  const inner = { ...m, cols: m.cols - 1 };
  const g: PanelModel = { ...inner, rows: m.rows - (headerRows(m).length - headerRows(inner).length) };
  return pinFooter(g, airy(g, clickable(BODIES[m.tab](g), g))).map((l) => (l.runs.length ? { ...l, runs: [r(' '), ...l.runs] } : l));
}
/** Tabs whose body ends where its data does: they carry the panel surface down to the pane's foot row. */
const FILLED_OLD: ReadonlySet<PanelTab> = new Set<PanelTab>(['team', 'channel', 'core']);
/** The Claude pane (`m.run`) fills every tab to its foot row. */
const FILLED: ReadonlySet<PanelTab> = new Set<PanelTab>(['route', 'team', 'channel', 'gates', 'core']);
/** Tabs with a message field on the foot row; the others fill the pane to its last row (wave 31, critique 29: the 234 surface stopped where the content ended). */
const FOOTED: ReadonlySet<PanelTab> = new Set<PanelTab>(['team', 'channel', 'core']);
/** Blank rows after a `bodyLen`-row body so header + body + fill is `rows - 1` lines, the one foot row staying free (on team and channel the
 * message field is that row). Only on a tab that has fewer rows than the pane; never negative, so a body taller than the pane is untouched. */
export function fillRows(m: PanelModel, bodyLen: number): PanelLine[] {
  const n = (m.run ? FILLED : FILLED_OLD).has(m.tab) ? m.rows - (FOOTED.has(m.tab) ? 1 : 0) - headerRows(m).length - bodyLen : 0;
  if (n <= 0) return [];
  return Array.from({ length: n }, () => BLANK); // wave 43: no key hint row; the spare rows are the pane's own surface
}
/** Every row of the panel: ribbon, blank, tab strip, rule, blank, then the active tab. */
export const panelLines = (m: PanelModel): PanelLine[] =>
  [...headerRows(m), ...bodyLines(m)].map((l) => (rowWidth(l.runs) > m.cols ? { ...l, runs: fitRuns(l.runs, m.cols) } : l));
/** Plain text rows, trailing spaces trimmed: what the goldens compare. */
export const panelText = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());
