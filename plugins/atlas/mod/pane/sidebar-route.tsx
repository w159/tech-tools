// Sidebar route section: compact waypoint line, one label row, then a mini-bar header and task rows per phase.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot, TodoGroup } from '../orchestra-types';
import { fitRuns, rowOf, type Segment } from '../runs';
import { barParts, chartRoom as C, fitText, glyph, textWidth } from '../theme';
import { scrub } from './chrome';
import { pad, type SidebarHandlers, type SidebarModel } from './sidebar-types';

type Todo = TodoGroup['items'][number];

const STATUS_STYLE: Record<string, { g: string; color: string }> = {
  completed: { g: '✓', color: C.ok },
  in_progress: { g: '◉', color: C.live },
  blocked: { g: '✗', color: C.fail },
};
const PENDING_STYLE = { g: '○', color: C.muted };
const statusOf = (s: string): { g: string; color: string } => STATUS_STYLE[s] ?? PENDING_STYLE;

export const phaseGlyph = (s: LiveSnapshot, id: string): string => s.contract.phases.find((p) => p.id === id)?.glyph ?? glyph.ring;

const SEGMENT_LEN = 4;

const waypointMark = (i: number, cur: number): Segment =>
  i === cur ? { t: '◉', color: C.focus, bold: true } : i < cur ? { t: '◆', color: C.ok } : { t: '○', color: C.muted };
const waypointRail = (i: number, cur: number): Segment =>
  i < cur ? { t: '━'.repeat(SEGMENT_LEN), color: C.ok } : { t: '─'.repeat(SEGMENT_LEN), color: C.muted };

/** `◆━━━━◆━━━━◉────○`: fixed-length rail segments, heavy up to the current phase, light after it. */
function waypointRuns(count: number, cur: number): Segment[] {
  return Array.from({ length: count }, (_, i): Segment[] =>
    i === count - 1 ? [waypointMark(i, cur)] : [waypointMark(i, cur), waypointRail(i, cur)]).flat();
}

/** Waypoint line plus one plain label row; the current phase is bold in the focus key. */
export function routeLines(els: ClientElements, phases: string[], cur: number, cols: number): RenderElement[] {
  if (phases.length === 0) return [];
  const labels: Segment[] = phases.flatMap((p, i) => [
    ...(i ? [{ t: ' ' }] : []),
    i === cur ? { t: p, color: C.focus, bold: true } : { t: p, color: C.muted },
  ]);
  return [rowOf(els, waypointRuns(phases.length, cur), cols), rowOf(els, labels, cols)];
}

// ---- tasks -------------------------------------------------------------------

const MINI_BAR = 6;
const OWNER_MAX = 12;
const ownerText = (it: Todo): string => (it.owner ? scrub(it.owner) : '');

/** `◉ implement ▰▰▱▱▱▱ 1/2`: the current phase reads in the focus key, the rest plain. */
function phaseHeader(els: ClientElements, s: LiveSnapshot, phase: string, pw: number, items: Todo[], cols: number): RenderElement {
  const doneN = items.filter((x) => x.status === 'completed').length;
  const [filled, empty] = barParts((doneN / items.length) * 100, MINI_BAR);
  const isCur = phase === s.phase;
  return rowOf(els, [
    { t: `${phaseGlyph(s, phase)} ${pad(phase, pw)} `, color: isCur ? C.focus : undefined, bold: true },
    { t: filled, color: C.ok }, { t: empty, color: C.muted }, { t: ` ${doneN}/${items.length}`, color: C.muted },
  ], cols);
}

function evidenceLine(els: ClientElements, it: Todo, cols: number): RenderElement {
  const ev = it.evidence ? scrub(it.evidence).replace(/\s+/g, ' ') : 'no evidence yet';
  return els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`     ${ev}`, cols) }) });
}

/** Every task shows its own status glyph (11.1.3) and owner; the row presses open its evidence. */
function taskSegments(it: Todo, cols: number): Segment[] {
  const st = statusOf(it.status);
  const owner = ownerText(it);
  const ownerW = Math.min(textWidth(owner), OWNER_MAX);
  const room = Math.max(1, cols - textWidth(`  ${st.g} `) - (ownerW ? ownerW + 1 : 0));
  const content = fitText(scrub(it.content).replace(/\s+/g, ' '), room);
  return [
    { t: '  ' },
    { t: st.g, color: st.color },
    { t: ' ' },
    { t: ownerW ? pad(content, room) : content, color: it.status === 'completed' ? C.muted : undefined },
    ...ownerSegments(owner, ownerW),
  ];
}

function ownerSegments(owner: string, ownerW: number): Segment[] {
  return ownerW ? [{ t: ` ${fitText(owner, OWNER_MAX)}`, color: C.muted }] : [];
}

function taskRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, it: Todo, cols: number): RenderElement[] {
  const key = `task:${it.id}`;
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, taskSegments(it, cols), cols) }),
    ...(m.ui.expanded === key ? [evidenceLine(els, it, cols)] : []),
  ];
}

/** A header and its task rows per phase, in phase order; phases without tasks are not listed. */
export function taskRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, phases: string[], cols: number): RenderElement[] {
  const groups = new Map<string, TodoGroup>(m.snapshot.todoGroups.map((g) => [g.phase, g]));
  const listed = phases.filter((p) => (groups.get(p)?.items.length ?? 0) > 0);
  if (listed.length === 0) return [rowOf(els, [{ t: 'nothing planned', color: C.faint }], cols)];
  const pw = Math.min(10, Math.max(...listed.map((p) => textWidth(p))));
  return listed.flatMap((phase) => {
    const items = groups.get(phase)!.items;
    return [phaseHeader(els, m.snapshot, phase, pw, items, cols), ...items.flatMap((it) => taskRow(els, m, on, it, cols))];
  });
}
