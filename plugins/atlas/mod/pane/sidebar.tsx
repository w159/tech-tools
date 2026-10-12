// Native-element sidebar: route, tasks, team with a message field, gates. Frameless sections
// separated by one blank line. Pure: every handler arrives as a closure, nothing here holds
// state or touches `$`. Plan: docs/plans/2026-10-12-atlas-mod-native-sidebar.md ("chart room" theme).
import type { ClientElements, RenderElement } from 'claude-code';
import { routeCounts } from '../data/todos';
import { rowOf, type Segment } from '../runs';
import { chartRoom as C } from '../theme';
import { advisorRows, gateRows, openGates } from './sidebar-gates';
import { routeLines, taskRows } from './sidebar-route';
import { teamRows, teamSummary } from './sidebar-team';
import { headRow, type SidebarHandlers, type SidebarModel } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

/** Title row, then the body; the blank separator row comes from the caller. */
const section = (els: ClientElements, key: string, title: RenderElement, body: RenderElement[]): RenderElement =>
  els.Box({ key, flexDirection: 'column', flexShrink: 0, children: [title, ...body] });

const gap = (els: ClientElements): RenderElement => rowOf(els, [{ t: ' ' }], 1);

const bold = (t: string): Segment => ({ t, bold: true });

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const cols = Math.max(10, model.columns - 1);
  const s = model.snapshot;
  const phases = s.contract.todoPhases.map(String);
  const cur = Math.max(0, phases.indexOf(s.phase));
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const open = openGates(model.gates);
  const advisor = advisorRows(els, model, on, cols);
  const sections = [
    section(els, 'route', rowOf(els, [{ t: 'Atlas', color: C.focus, bold: true }, { t: `  ${s.phase}, ${done} of ${total} done` }], cols),
      [...routeLines(els, phases, cur, cols), gap(els), ...taskRows(els, model, on, phases, cols)]),
    section(els, 'team', headRow(els, [bold('Team')], { t: teamSummary(s), color: C.muted }, cols), teamRows(els, model, on, cols)),
    section(els, 'gates', headRow(els, [bold('Gates')],
      open ? { t: `${open} open`, color: C.fail } : { t: 'all clear', color: C.ok }, cols), gateRows(els, model, on, cols)),
    ...(advisor.notes ? [section(els, 'advisor', headRow(els, [bold('Advisor notes')], { t: String(advisor.notes), color: C.muted }, cols), advisor.rows)] : []),
  ];
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    children: sections.flatMap((sec, i) => (i ? [gap(els), sec] : [sec])),
  });
}
