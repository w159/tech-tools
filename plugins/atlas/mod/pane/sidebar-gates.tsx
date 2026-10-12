// Sidebar gates section (one row per gate item, fix lines on expand) and advisor notes.
import type { ClientElements, RenderElement } from 'claude-code';
import { fitRuns, rowOf, type Segment } from '../runs';
import { chartRoom as C, fitText } from '../theme';
import { scrub } from './chrome';
import type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

const okMark = (ok: boolean): { g: string; color: string } => (ok ? { g: '✓', color: C.ok } : { g: '✗', color: C.fail });

/** A dimmed detail line under an expanded item. */
const noteLine = (els: ClientElements, text: string, cols: number): RenderElement =>
  els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`     ${text}`, cols) }) });

export const openGates = (gates: GateGroup[]): number => gates.reduce((n, g) => n + g.lines.filter((x) => !x.ok).length, 0);

function lineRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, ln: GateLine, cols: number): RenderElement[] {
  const key = `gate:${ln.id}`;
  const isOpen = m.ui.expanded === key;
  const mark = okMark(ln.ok);
  const parts: Segment[] = [{ t: `${mark.g} `, color: mark.color }, { t: scrub(ln.label) }];
  const onPress = () => (isOpen && ln.fix ? on.copy(ln.fix) : on.toggle(key));
  const extra = isOpen ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  return [
    els.Button({ key, plain: true, onPress, children: fitRuns(els, parts, cols) }),
    ...extra.map((t) => noteLine(els, scrub(t), cols)),
  ];
}

const unavailableRow = (els: ClientElements, g: GateGroup, cols: number): RenderElement[] =>
  g.error ? [rowOf(els, [{ t: `${g.title} unavailable: ${scrub(g.error)}`, color: C.muted }], cols)] : [];

/** One flat list: every gate item is its own row; a source that failed to read adds one dimmed line. */
export function gateRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): RenderElement[] {
  return m.gates.flatMap((g) => [...unavailableRow(els, g, cols), ...g.lines.flatMap((ln) => lineRows(els, m, on, ln, cols))]);
}

// ---- advisor notes -----------------------------------------------------------

const ADVISOR_SHOWN = 2;

function noteRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, n: { id: string; content: string }, cols: number): RenderElement[] {
  const key = `advisor:${n.id}`;
  const text = scrub(n.content).replace(/\s+/g, ' ');
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, [{ t: text }], cols) }),
    ...(m.ui.expanded === key ? [noteLine(els, text, cols)] : []),
  ];
}

const advisorNotes = (m: SidebarModel) => m.snapshot.todoGroups.find((g) => g.phase === 'advisor')?.items ?? [];

const moreRow = (els: ClientElements, on: SidebarHandlers, hidden: number, cols: number): RenderElement[] =>
  hidden > 0
    ? [els.Button({ key: 'advisor:more', plain: true, onPress: () => on.toggle('advisor:more'), children: fitRuns(els, [{ t: `+${hidden} more`, color: C.muted }], cols) })]
    : [];

export function advisorRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): { notes: number; rows: RenderElement[] } {
  const notes = advisorNotes(m);
  const shown = m.ui.expanded === 'advisor:more' ? notes : notes.slice(0, ADVISOR_SHOWN);
  const rows = [...shown.flatMap((n) => noteRows(els, m, on, n, cols)), ...moreRow(els, on, notes.length - shown.length, cols)];
  return { notes: notes.length, rows };
}
