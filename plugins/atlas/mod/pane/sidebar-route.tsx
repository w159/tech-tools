// Sidebar route section: compact waypoint line, one label row, then one row per task.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot, TodoGroup } from '../orchestra-types';
import { fitRuns, rowOf, type Segment } from '../runs';
import { chartRoom as C, fitText, glyph, textWidth } from '../theme';
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

const OWNER_MAX = 12;
const ownerText = (it: Todo): string => (it.owner ? scrub(it.owner) : '');

function evidenceLine(els: ClientElements, it: Todo, cols: number): RenderElement {
  const ev = it.evidence ? scrub(it.evidence).replace(/\s+/g, ' ') : 'no evidence yet';
  return els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`     ${ev}`, cols) }) });
}

const ownerSuffix = (owner: string, ownerW: number): Segment[] =>
  ownerW ? [{ t: ` ${fitText(owner, OWNER_MAX)}`, color: C.muted }] : [];

type TaskView = { it: Todo; mark: string; markColor: string; label: string; pw: number; cols: number };

function taskSegments(v: TaskView): Segment[] {
  const owner = ownerText(v.it);
  const ownerW = Math.min(textWidth(owner), OWNER_MAX);
  const lead = `${v.mark} ${pad(v.label, v.pw)} `;
  const room = Math.max(1, v.cols - textWidth(lead) - (ownerW ? ownerW + 1 : 0));
  const content = fitText(scrub(v.it.content).replace(/\s+/g, ' '), room);
  return [
    { t: `${v.mark} `, color: v.markColor },
    { t: `${pad(v.label, v.pw)} `, color: C.muted },
    { t: ownerW ? pad(content, room) : content, color: v.it.status === 'completed' ? C.muted : undefined },
    ...ownerSuffix(owner, ownerW),
  ];
}

/** First task of a phase shows its status glyph and the phase name; later ones show `·` in the status colour. */
function taskRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, v: Omit<TaskView, 'mark' | 'markColor' | 'label'> & { phase: string; first: boolean }): RenderElement[] {
  const st = statusOf(v.it.status);
  const key = `task:${v.it.id}`;
  const view: TaskView = { it: v.it, mark: v.first ? st.g : '·', markColor: st.color, label: v.first ? v.phase : '', pw: v.pw, cols: v.cols };
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, taskSegments(view), v.cols) }),
    ...(m.ui.expanded === key ? [evidenceLine(els, v.it, v.cols)] : []),
  ];
}

/** One row per task in phase order; phases without tasks are not listed. */
export function taskRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, phases: string[], cols: number): RenderElement[] {
  const groups = new Map<string, TodoGroup>(m.snapshot.todoGroups.map((g) => [g.phase, g]));
  const listed = phases.filter((p) => (groups.get(p)?.items.length ?? 0) > 0);
  if (listed.length === 0) return [rowOf(els, [{ t: 'nothing planned', color: C.faint }], cols)];
  const pw = Math.min(10, Math.max(...listed.map((p) => textWidth(p))));
  return listed.flatMap((phase) =>
    groups.get(phase)!.items.flatMap((it, i) => taskRow(els, m, on, { it, phase, first: i === 0, pw, cols })));
}
