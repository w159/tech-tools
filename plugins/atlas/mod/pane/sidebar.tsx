// Native-element sidebar: route, tasks per phase, team with a message field, gates.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
// Plan: docs/plans/2026-10-12-atlas-mod-native-sidebar.md ("chart room" theme).
import type { ClientElements, RenderElement } from 'claude-code';
import { routeCounts } from '../data/todos';
import { rowOf, type Segment } from '../runs';
import { chartRoom as C, glyph } from '../theme';
import { advisorRows, gateRows } from './sidebar-gates';
import { phaseGlyph, routeLines, taskRows } from './sidebar-route';
import { mates, teamRows } from './sidebar-team';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

/** A section frame: round border in a theme key when there is room, else just the title row and body. */
const section = (els: ClientElements, key: string, bordered: boolean, cols: number, title: Segment[], body: RenderElement[]): RenderElement =>
  els.Box({
    key, flexDirection: 'column', flexShrink: 0,
    ...(bordered ? { borderStyle: 'round', borderColor: C.border, width: cols } : {}),
    children: [rowOf(els, title, bordered ? cols - 2 : cols), ...body],
  });

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const gatesTone = (open: number) =>
  open ? { mark: '✗ ', color: C.fail, tail: `  ${open} open` } : { mark: '✓ ', color: C.ok, tail: '  all clear' };

const gatesTitle = (open: number): Segment[] => {
  const tone = gatesTone(open);
  return [{ t: tone.mark, color: tone.color, bold: true }, { t: 'Gates', bold: true }, { t: tone.tail, color: tone.color }];
};

const advisorTitle = (notes: number): Segment[] => [
  { t: `${glyph.star} `, color: C.warn }, { t: 'Advisor notes', bold: true }, { t: `  ${notes}`, color: C.muted },
];

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const cols = Math.max(10, model.columns - 1);
  // Below 40 columns the frames and portrait go first.
  const bordered = model.columns >= 40;
  const inner = bordered ? cols - 2 : cols;
  const s = model.snapshot;
  const phases = s.contract.todoPhases.map(String);
  const cur = Math.max(0, phases.indexOf(s.phase));
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const open = model.gates.reduce((n, g) => n + g.lines.filter((x) => !x.ok).length, 0);
  const advisor = advisorRows(els, model, on, inner);
  const sec = (key: string, title: Segment[], body: RenderElement[]) => section(els, key, bordered, cols, title, body);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    children: [
      sec('route', [
        { t: `${phaseGlyph(s, s.phase)} `, color: C.focus, bold: true },
        { t: 'Atlas', color: C.focus, bold: true },
        { t: `  ${s.phase}, ${done} of ${total} done` },
      ], [...routeLines(els, s, phases, cur, inner), ...taskRows(els, model, on, phases, inner)]),
      sec('team', [
        { t: 'Team', bold: true },
        { t: `  ${plural(mates(s).length - 1, 'member', 'members')}`, color: C.muted },
      ], teamRows(els, model, on, inner, bordered)),
      sec('gates', gatesTitle(open), gateRows(els, model, on, inner)),
      ...(advisor.notes ? [sec('advisor', advisorTitle(advisor.notes), advisor.rows)] : []),
    ],
  });
}
