// Sidebar gates view: one summary row per gate group, expandable into its lines.
import type { ClientElements, RenderElement } from 'claude-code';
import { groupOpenCount } from '../gates';
import { fitRuns, type Segment } from '../runs';
import { chartRoom as C, fitText } from '../theme';
import { scrub } from './chrome';
import type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

const okMark = (ok: boolean): { g: string; color: string } => (ok ? { g: '✓', color: C.ok } : { g: '✗', color: C.fail });

/** A dimmed detail line under an expanded item. */
const noteLine = (els: ClientElements, text: string, cols: number): RenderElement =>
  els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`     ${text}`, cols) }) });

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

const groupOk = (g: GateGroup): boolean => groupOpenCount(g) === 0;
const groupKey = (g: GateGroup): string => `group:${g.id}`;
const oneLine = (t: string | undefined): string => (t ? scrub(t).replace(/\s+/g, ' ') : '');

/** `✗ completion  2 open  <first fix>` / `✓ header  ok  <detail>`; an unavailable source says so instead. */
function groupRow(els: ClientElements, on: SidebarHandlers, g: GateGroup, cols: number): RenderElement {
  const bad = groupOpenCount(g);
  const mark = okMark(groupOk(g));
  const first = g.lines.find((ln) => !ln.ok) ?? g.lines[0];
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : oneLine(bad ? first?.fix ?? first?.label : first?.detail);
  return els.Button({
    key: groupKey(g), plain: true, onPress: () => on.toggle(groupKey(g)),
    children: fitRuns(els, [
      { t: `${mark.g} `, color: mark.color },
      { t: scrub(g.title) },
      { t: bad ? `  ${bad} open` : '  ok', color: bad ? C.fail : C.ok },
      { t: tail ? `  ${tail}` : '', color: C.muted },
    ], cols),
  });
}

/** The group is open while it or one of its lines is the expanded key. */
const groupIsOpen = (expanded: string | null, g: GateGroup): boolean =>
  expanded === groupKey(g) || g.lines.some((ln) => expanded === `gate:${ln.id}`);

/** One group: a summary row that opens into every line Button. */
function groupRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, g: GateGroup, cols: number): RenderElement[] {
  const isOpen = groupIsOpen(m.ui.expanded, g);
  return [groupRow(els, on, g, cols), ...(isOpen ? g.lines.flatMap((ln) => lineRows(els, m, on, ln, cols)) : [])];
}

/** One row per gate group; Enter expands a group to all its lines. */
export function gateRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  return m.gates.flatMap((g) => groupRows(els, m, on, g, inner));
}
