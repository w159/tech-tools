// Native-element sidebar: route, tasks per phase, team with a message field, gates.
// Bordered sections when the pane is wide enough, plain title rows below 40 columns.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
// Plan: docs/plans/2026-10-12-atlas-mod-native-sidebar.md ("chart room" theme).
import type { ClientElements, RenderElement } from 'claude-code';
import { routeCounts } from '../data/todos';
import { rowOf, type Segment } from '../runs';
import { chartRoom as C, glyph } from '../theme';
import { openGateCount } from '../gates';
import { advisorRows, gateJumpKey, gateRows } from './sidebar-gates';
import { phaseGlyph, routeLines, taskRows } from './sidebar-route';
import { teamRows, teamSummary } from './sidebar-team';
import { headRow, hotkeyHead, type SidebarHandlers, type SidebarModel } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel } from './sidebar-types';

const BORDER_MIN_COLUMNS = 40;

/** A section frame: round border in a theme key when there is room, else just the title row and body. */
const section = (els: ClientElements, key: string, bordered: boolean, cols: number, title: RenderElement, body: RenderElement[]): RenderElement =>
  els.Box({
    key, flexDirection: 'column', flexShrink: 0,
    ...(bordered ? { borderStyle: 'round', borderColor: C.border, width: cols } : {}),
    children: [title, ...body],
  });

const bold = (t: string): Segment => ({ t, bold: true });

function gatesHead(els: ClientElements, model: SidebarModel, on: SidebarHandlers, inner: number): RenderElement {
  const open = openGateCount(model.gates);
  const jump = gateJumpKey(model.gates);
  return hotkeyHead(els, [open ? { t: '✗ ', color: C.fail, bold: true } : { t: '✓ ', color: C.ok, bold: true }, bold('Gates')],
    open ? { t: `${open} open`, color: C.fail } : { t: 'all clear', color: C.ok },
    { key: 'g', label: 'gates', onPress: () => jump && on.expand(jump) }, inner);
}

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const cols = Math.max(10, model.columns - 1);
  const bordered = model.columns >= BORDER_MIN_COLUMNS;
  const inner = bordered ? cols - 2 : cols;
  const s = model.snapshot;
  const phases = s.contract.todoPhases.map(String);
  const cur = Math.max(0, phases.indexOf(s.phase));
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const advisor = advisorRows(els, model, on, inner);
  const sec = (key: string, title: RenderElement, body: RenderElement[]) => section(els, key, bordered, cols, title, body);
  const head = (left: Segment[], right: Segment | null) => headRow(els, left, right, inner);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    children: [
      sec('route', rowOf(els, [
        { t: `${phaseGlyph(s, s.phase)} `, color: C.focus, bold: true },
        { t: 'Atlas', color: C.focus, bold: true },
        { t: `  ${s.phase}, ${done} of ${total} done` },
      ], inner), [...routeLines(els, phases, cur, inner), ...taskRows(els, model, on, phases, inner)]),
      sec('team', hotkeyHead(els, [bold('Team')], { t: teamSummary(s), color: C.muted },
        { key: 'm', label: 'message', onPress: () => on.focus('msg') }, inner), teamRows(els, model, on, inner, bordered)),
      sec('gates', gatesHead(els, model, on, inner), gateRows(els, model, on, inner)),
      ...(advisor.notes ? [sec('advisor', head([{ t: `${glyph.star} `, color: C.warn }, bold('Advisor notes')], { t: String(advisor.notes), color: C.muted }), advisor.rows)] : []),
    ],
  });
}
