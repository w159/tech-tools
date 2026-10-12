// Sidebar route frame: phase waypoints with names, then tasks per phase.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot, TodoGroup } from '../orchestra-types';
import { fitRuns, rowOf, type Segment } from '../runs';
import { barParts, chartRoom as C, fitText, glyph, textWidth } from '../theme';
import { scrub } from './chrome';
import { pad, type SidebarHandlers, type SidebarModel } from './sidebar-types';

type Todo = TodoGroup['items'][number];

const statusOf = (s: string): { g: string; color: string } =>
  s === 'completed' ? { g: '✓', color: C.ok } : s === 'in_progress' ? { g: '◉', color: C.live } : { g: '○', color: C.muted };

export const phaseGlyph = (s: LiveSnapshot, id: string): string => s.contract.phases.find((p) => p.id === id)?.glyph ?? glyph.ring;

const stateColor = (i: number, cur: number): string => (i === cur ? C.focus : i < cur ? C.ok : C.muted);
const waypoint = (g: string, i: number, cur: number): Segment => ({ t: g, color: stateColor(i, cur), bold: i === cur, inverse: i === cur });
const rail = (len: number, travelled: boolean): Segment =>
  ({ t: (travelled ? '━' : '─').repeat(Math.max(0, len)), color: travelled ? C.ok : C.muted });

/** Waypoint glyphs joined by travelled (heavy) or pending (light) rail segments. */
function waypointRuns(gl: string[], at: number[], cur: number): Segment[] {
  return gl.flatMap((g, i) => i === gl.length - 1
    ? [waypoint(g, i, cur)]
    : [waypoint(g, i, cur), rail(at[i + 1]! - at[i]! - textWidth(g), i < cur)]);
}

export function routeLines(els: ClientElements, s: LiveSnapshot, phases: string[], cur: number, cols: number): RenderElement[] {
  const n = phases.length;
  if (n === 0) return [];
  const gl = phases.map((p) => phaseGlyph(s, p));
  const gw = Math.max(...gl.map(textWidth));
  const w = Math.max(n * (gw + 1), cols) - (gw - 1);
  const at = phases.map((_, i) => (n === 1 ? 0 : Math.round((i * (w - 1)) / (n - 1))));
  return [rowOf(els, waypointRuns(gl, at, cur), cols), rowOf(els, nameRun(phases, at, cur, cols), cols)];
}

/** Column where a name of width `w` starts, centered on `center` but clear of the previous name; null when it cannot fit. */
function nameStart(w: number, center: number, end: number, hasPrev: boolean, cols: number): number | null {
  const min = end + (hasPrev ? 1 : 0);
  const start = Math.min(Math.max(center - Math.floor((w - 1) / 2), min), cols - w);
  return start < min || start < 0 ? null : start;
}

const nameSeg = (name: string, isCur: boolean): Segment => ({ t: name, color: isCur ? C.focus : C.muted, bold: isCur });

function placeNames(phases: string[], at: number[], cur: number, cols: number, idx: number[]): Segment[] | null {
  const out: Segment[] = [];
  let end = 0;
  for (const i of idx) {
    const w = textWidth(phases[i]!);
    const start = nameStart(w, at[i]!, end, out.length > 0, cols);
    if (start === null) return null;
    if (start > end) out.push({ t: ' '.repeat(start - end) });
    out.push(nameSeg(phases[i]!, i === cur));
    end = start + w;
  }
  return out;
}

/** Each name centered under its waypoint; when neighbours would collide or overflow, only the current name is placed. */
function nameRun(phases: string[], at: number[], cur: number, cols: number): Segment[] {
  return placeNames(phases, at, cur, cols, phases.map((_, i) => i))
    ?? placeNames(phases, at, cur, cols, [cur])
    ?? [{ t: phases[cur] ?? '', color: C.focus, bold: true }];
}

// ---- tasks (inside the route frame) ------------------------------------------

const MINI_BAR = 6;
const OWNER_MAX = 12;

function phaseHeader(els: ClientElements, pg: string, phase: string, pw: number, items: Todo[], cols: number): RenderElement {
  const label = `${pg} ${pad(phase, pw)} `;
  if (items.length === 0) return rowOf(els, [{ t: label, color: C.muted }, { t: 'nothing planned', color: C.faint }], cols);
  const doneN = items.filter((x) => x.status === 'completed').length;
  const [on1, off1] = barParts((doneN / items.length) * 100, MINI_BAR);
  return rowOf(els, [
    { t: label, color: C.focus, bold: true },
    { t: on1, color: C.ok }, { t: off1, color: C.muted }, { t: ` ${doneN}/${items.length}`, color: C.muted },
  ], cols);
}

const ownerText = (it: Todo): string => (it.owner ? scrub(it.owner) : '');

function taskParts(it: Todo, content: string, room: number, owner: string): Segment[] {
  const st = statusOf(it.status);
  return [
    { t: '  ' },
    { t: st.g, color: st.color },
    { t: ' ' },
    { t: pad(content, room), color: it.status === 'completed' ? C.muted : undefined },
    ...(owner ? [{ t: ` ${fitText(owner, OWNER_MAX)}`, color: C.muted }] : []),
  ];
}

function evidenceLine(els: ClientElements, it: Todo, cols: number): RenderElement {
  const ev = it.evidence ? scrub(it.evidence).replace(/\s+/g, ' ') : 'no evidence yet';
  return els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`     ${ev}`, cols) }) });
}

function taskRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, it: Todo, cols: number): RenderElement[] {
  const owner = ownerText(it);
  const ownerW = Math.min(textWidth(owner), OWNER_MAX);
  const room = Math.max(1, cols - textWidth(`  ${statusOf(it.status).g} `) - (ownerW ? ownerW + 1 : 0));
  const content = fitText(scrub(it.content).replace(/\s+/g, ' '), room);
  const key = `task:${it.id}`;
  const parts = taskParts(it, content, room, ownerW ? owner : '');
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, parts, cols) }),
    ...(m.ui.expanded === key ? [evidenceLine(els, it, cols)] : []),
  ];
}

export function taskRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, phases: string[], cols: number): RenderElement[] {
  const groups = new Map<string, TodoGroup>(m.snapshot.todoGroups.map((g) => [g.phase, g]));
  const pw = Math.min(10, Math.max(...phases.map((p) => p.length)));
  return phases.flatMap((phase) => {
    const items = groups.get(phase)?.items ?? [];
    return [phaseHeader(els, phaseGlyph(m.snapshot, phase), phase, pw, items, cols), ...items.flatMap((it) => taskRow(els, m, on, it, cols))];
  });
}
