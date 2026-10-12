// Sidebar gates frame (status strip, collapsible groups, fix lines) and advisor notes.
import type { ClientElements, RenderElement } from 'claude-code';
import { fitRuns, rowOf, type Segment } from '../runs';
import { chartRoom as C, fitText } from '../theme';
import { scrub } from './chrome';
import type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

const groupOk = (g: GateGroup): boolean => !g.error && g.lines.every((x) => x.ok);
const okMark = (ok: boolean): { g: string; color: string } => (ok ? { g: '✓', color: C.ok } : { g: '✗', color: C.fail });

/** A dimmed detail line under an expanded item. */
const noteLine = (els: ClientElements, text: string, cols: number): RenderElement =>
  els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`     ${text}`, cols) }) });

const stripRuns = (g: GateGroup): Segment[] => {
  const mark = okMark(groupOk(g));
  return [{ t: mark.g, color: mark.color }, { t: ` ${scrub(g.title)}  `, color: C.muted }];
};

const openCount = (g: GateGroup): number => g.lines.filter((x) => !x.ok).length;

function groupRow(els: ClientElements, on: SidebarHandlers, g: GateGroup, isOpen: boolean, cols: number): RenderElement {
  const gkey = `group:${g.id}`;
  const bad = openCount(g);
  return els.Button({
    key: gkey, plain: true, onPress: () => on.toggle(gkey),
    children: fitRuns(els, [
      { t: isOpen ? '▾ ' : '▸ ', color: C.muted },
      { t: scrub(g.title) },
      { t: bad ? `  ${bad} open` : '  clear', color: bad ? C.fail : C.ok },
    ], cols),
  });
}

function lineRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, ln: GateLine, cols: number): RenderElement[] {
  const key = `gate:${ln.id}`;
  const isOpen = m.ui.expanded === key;
  const mark = okMark(ln.ok);
  const parts: Segment[] = [{ t: `  ${mark.g} `, color: mark.color }, { t: scrub(ln.label) }];
  const onPress = () => (isOpen && ln.fix ? on.copy(ln.fix) : on.toggle(key));
  const extra = isOpen ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  return [
    els.Button({ key, plain: true, onPress, children: fitRuns(els, parts, cols) }),
    ...extra.map((t) => noteLine(els, scrub(t), cols)),
  ];
}

const unavailableRow = (els: ClientElements, g: GateGroup, cols: number): RenderElement[] =>
  g.error ? [rowOf(els, [{ t: ` ${g.title} unavailable: ${scrub(g.error)}`, color: C.muted }], cols)] : [];

/** The group is open while it or one of its lines is the expanded key. */
const groupIsOpen = (expanded: string | null, g: GateGroup): boolean =>
  expanded === `group:${g.id}` || g.lines.some((ln) => expanded === `gate:${ln.id}`);

/** One group: an optional unavailable line, then a summary row that opens into its lines. */
function groupRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, g: GateGroup, cols: number): RenderElement[] {
  const unavailable = unavailableRow(els, g, cols);
  if (g.lines.length === 0) return unavailable;
  const isOpen = groupIsOpen(m.ui.expanded, g);
  const body = isOpen ? g.lines.flatMap((ln) => lineRows(els, m, on, ln, cols)) : [];
  return [...unavailable, groupRow(els, on, g, isOpen, cols), ...body];
}

export function gateRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): RenderElement[] {
  const strip = m.gates.length ? [rowOf(els, m.gates.flatMap(stripRuns), cols)] : [];
  return [...strip, ...m.gates.flatMap((g) => groupRows(els, m, on, g, cols))];
}

// ---- advisor notes -----------------------------------------------------------

const ADVISOR_SHOWN = 2;

function noteRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, n: { id: string; content: string }, cols: number): RenderElement[] {
  const key = `advisor:${n.id}`;
  const text = scrub(n.content).replace(/\s+/g, ' ');
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, [{ t: '  ' }, { t: text }], cols) }),
    ...(m.ui.expanded === key ? [noteLine(els, text, cols)] : []),
  ];
}

const advisorNotes = (m: SidebarModel) => m.snapshot.todoGroups.find((g) => g.phase === 'advisor')?.items ?? [];

const moreRow = (els: ClientElements, on: SidebarHandlers, hidden: number, cols: number): RenderElement[] =>
  hidden > 0
    ? [els.Button({ key: 'advisor:more', plain: true, onPress: () => on.toggle('advisor:more'), children: fitRuns(els, [{ t: `  +${hidden} more`, color: C.muted }], cols) })]
    : [];

export function advisorRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): { notes: number; rows: RenderElement[] } {
  const notes = advisorNotes(m);
  const shown = m.ui.expanded === 'advisor:more' ? notes : notes.slice(0, ADVISOR_SHOWN);
  const rows = [...shown.flatMap((n) => noteRows(els, m, on, n, cols)), ...moreRow(els, on, notes.length - shown.length, cols)];
  return { notes: notes.length, rows };
}
