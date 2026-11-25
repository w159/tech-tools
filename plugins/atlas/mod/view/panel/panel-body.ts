// panel-body.ts: panel-layout split (audit 4.3, stage S14): the BODIES table, clickable rows, fill and panelLines.
// The four tabs of the redesign draw from status-tab / health-tab / gates-tab / channel-chat; each builder owns its one-cell gutter, so the rows here are not shifted.
import { hasCore } from '../../data/core';
import { type Health } from '../../data/idle-health';
import { tabFrame, type TabId } from './tabs-frame';
import { footerLine } from './panel-rows-route';
import { chevron } from '../../input/clickable';
import { type Run } from '../../design/atlas-ui';
import { type PanelTab, type PanelModel, type PanelLine, BLANK, r, fitRuns, rowWidth, lineText } from './panel-shared';
import { emptyTab, SKEL } from './panel-rows-team';
import { coreBody } from './panel-rows-gates';
import { headerRows } from './panel-tabs';
import { statusRows } from './status-tab';
import { healthRows } from './health-tab';
import { gatesRows } from './gates-tab';
import { boredRows } from './bored-render';
import { chatRows } from './channel-chat';
import { head } from './tab-kit';

// ---- the panel ------------------------------------------------------------------------------------------------------------------------

/** Rows the pane has under its header (0: unknown, no limit). */
const roomOf = (m: PanelModel): number => (m.rows > 0 ? Math.max(1, m.rows - headerRows(m).length) : 0);
/** Health: the session figures, then (the old core tab's content) the contract, verdicts, offload and dispatch rows under a CORE heading. */
function healthBody(m: PanelModel): PanelLine[] {
  // The gates tab folded into health: the session figures, a blank, the gate rows, then CORE (the denial badge sits on this tab's chip)
  const gh = gatesRows(m);
  const room = roomOf(m);
  const hr = healthRows(m, room, room > 0 ? room - gh.length - 1 : Infinity); // the gates keep their rows on a short pane: the RUNS chart is what gives way
  const joined = [...hr, ...(hr.length && gh.length ? [BLANK] : []), ...gh];
  const hb = room > 0 && !hasCore(m.core) ? joined.slice(0, room) : joined; // nothing below the gates to scroll to: a pane shorter than its content cuts the tail
  if (!hasCore(m.core)) return hb.length ? hb : coreBody(m); // nothing measured and no core: the tab's own empty state (a ribbon and one fact on the Claude pane, one dim line elsewhere)
  const inner: PanelModel = m.run ? { ...m, cols: m.cols - 1 } : m; // the Claude pane's rows sit one cell in from the host's border
  const core = coreBody(inner).map((l) => (m.run && l.runs.length ? { ...l, runs: [r(' '), ...l.runs] } : l));
  // M6: the recorded routes (scope matrix and team files) read honestly: a read that failed says so, never a quiet empty list
  const routing = head(m, 'ROUTING', [], [r(m.read?.failed?.routes ? '  read failed' : `  ${m.core.routes.length} route${m.core.routes.length === 1 ? '' : 's'}`, m.read?.failed?.routes ? 'bad' : 'muted')]);
  return [...hb, ...(hb.length ? [BLANK] : []), head(m, 'CORE'), routing, ...core];
}
const BODIES: Record<PanelTab, (m: PanelModel) => PanelLine[]> = {
  route: (m) => statusRows(m, roomOf(m)), team: (m) => statusRows(m, roomOf(m)), core: healthBody, channel: (m) => chatRows(m, roomOf(m)), bored: (m) => boredRows(m, roomOf(m)),
};
/** Wave 43: a pressable row wears the one clickable look (mod/input/clickable.ts): its leading blank (the grid's focus cell, or the first of its lead spaces) is the accent chevron (`▸` closed, `▾` open) and every run
 * of the row takes the hover style. A row that already carries a clickRun (the chips) or is the message field is left as it is. */
function clickable(lines: PanelLine[], m: PanelModel): PanelLine[] {
  return lines.map((l) => {
    if (!l.press || l.press.kind === 'compose' || l.press.key.startsWith('fix:') || l.runs.length === 0 || l.runs.some((x) => x.press)) return l;
    const [first, ...rest] = l.runs as [Run, ...Run[]];
    const blank = first.t.length > 0 && first.t.trim() === '';
    // One caret idiom, `▸` closed and `▾` open, on expandable rows only (another worker row's caret is the quiet one); no hollow `▹`.
    const glyph = chevron(m.expanded === l.press.key, m.ui);
    const lead: Run[] = blank
      ? [l.press.kind === 'worker' ? { t: glyph, tone: 'sub' as const } : { t: glyph, tone: 'accent' as const, bold: true }, ...(first.t.length > 1 ? [{ ...first, t: first.t.slice(1) }] : [])]
      : [first];
    return { ...l, runs: [...lead, ...rest].map((x) => ({ ...x, hover: true })) };
  });
}
const BOARD_SKEL = ['item                state    owner', `○ T1 ${SKEL}   queued   ·······`, `○ T2 ${SKEL}   queued   ·······`];
/** The board with nothing on it (Claude pane): the live fact `0 items`, the dim skeleton and the pinned footer, in the pane's gutter. `rows`: the body rows the pane has under its header. The board is no tab of the strip: the band's board button opens it. */
export function boardEmptyRows(m: PanelModel, rows: number): PanelLine[] {
  const inner: PanelModel = { ...m, cols: m.cols - 1 };
  const body = emptyTab(inner, 'BOARD', '0 items', BOARD_SKEL);
  const foot = m.health ? footerLine(inner, m.health) : null;
  const all = foot && rows > body.length + 1 ? [...body, ...Array.from({ length: rows - body.length - 1 }, () => BLANK), foot] : body;
  return all.map((l) => (l.runs.length ? { ...l, runs: [r(' '), ...l.runs] } : l));
}
/** The one view the frame path (mod/view/panel/tabs-frame.ts) still draws: the board the band's button opens (it is no tab of the strip). */
export const frameTabOf = (m: Pick<PanelModel, 'run' | 'health' | 'board'>): TabId | null => (m.run && m.health && m.board ? 'board' : null);
function tabLines(m: PanelModel, tab: TabId, h: Health): PanelLine[] {
  const rows = tabFrame({
    tab, cols: m.cols, room: m.rows > 0 ? m.rows - headerRows(m).length : 0, ui: m.ui, kind: m.run?.kind ?? 'idle', health: h, gates: m.gates, lead: false,
    workers: m.workers.map((w) => ({ name: w.name, ...(w.role ? { role: w.role } : {}), state: w.state, ...(w.model ? { model: w.model } : {}), detail: w.detail, ...(w.secs !== undefined ? { secs: w.secs } : {}) })),
    ...(m.lead?.secs !== undefined || m.run?.secs !== undefined ? { leadSecs: m.lead?.secs ?? m.run?.secs } : {}),
    todos: m.todos.map((t) => ({ id: t.id, label: t.label, state: t.state, ...(t.owner ? { owner: t.owner } : {}), ...(t.detail ? { detail: t.detail } : {}), evidence: t.evidence ?? null })),
    notes: m.notes.map((n) => ({ at: n.at, from: n.from, ...(n.kind ? { kind: n.kind } : {}), text: n.text })),
    channel: m.channel ?? 'channel', people: m.people, recipient: m.recipient, core: m.core ?? null, flips: m.flips ?? [], ...(m.read ? { read: m.read } : {}),
  });
  return rows.map((x) => ({ runs: fitRuns(x.runs, m.cols), ...(x.press ? { press: x.press } : {}) }));
}
/** The active tab's body rows (no header). */
export function bodyLines(m: PanelModel): PanelLine[] {
  const framed = frameTabOf(m);
  if (framed && m.health) return tabLines(m, framed, m.health);
  return clickable(BODIES[m.tab](m), m);
}
/** Blank rows after a `bodyLen`-row body so header + body + fill is `rows` lines, on the Claude pane (`m.run`): the surface runs down to the foot row. Never negative: a body taller than the pane is untouched. */
export function fillRows(m: PanelModel, bodyLen: number): PanelLine[] {
  const n = m.run ? m.rows - headerRows(m).length - bodyLen : 0;
  if (n <= 0) return [];
  return Array.from({ length: n }, () => BLANK);
}
/** Every row of the panel: header, blank, tab strip, rule, then the active tab. */
export const panelLines = (m: PanelModel): PanelLine[] =>
  [...headerRows(m), ...bodyLines(m)].map((l) => (rowWidth(l.runs) > m.cols ? { ...l, runs: fitRuns(l.runs, m.cols) } : l));
/** Plain text rows, trailing spaces trimmed: what the goldens compare. */
export const panelText = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());
