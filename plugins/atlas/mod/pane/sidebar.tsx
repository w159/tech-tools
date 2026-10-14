// Native-element sidebar: a hotkey tab strip (r route, t team, c channel, g gates) over exactly one view.
// Plain column: the host pane draws the one frame.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
// Plan: docs/plans/2026-10-13-atlas-command-center-redesign.md §3.
import type { ClientElements, RenderElement } from 'claude-code';
import { openGateCount } from '../gates';
import { textWidth } from '../theme';
import { gateRows } from './sidebar-gates';
import { channelRows } from './sidebar-channel';
import { routeRows } from './sidebar-route';
import { teamRows } from './sidebar-team';
import type { SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

const HINT_MIN_INNER = 60;
const HINT = 'r t c g tabs · ↑↓ Enter';

type Tab = { v: SidebarView; key: string; label: string };

const tabList = (open: number): Tab[] => [
  { v: 'route', key: 'r', label: '◎ route' },
  { v: 'team', key: 't', label: '● team' },
  { v: 'channel', key: 'c', label: '✉ channel' },
  { v: 'gates', key: 'g', label: open ? `✗ ${open}` : '✓ gates' },
];

/** The optional board toggle after the four tabs. */
function todosTab(els: ClientElements, on: SidebarHandlers): RenderElement[] {
  if (!on.toggleTodos) return [];
  return [els.Text({ dimColor: true, children: ' │ ' }), els.Button({ key: 'tab:todos', plain: true, hotkey: 'o', dimColor: true, children: [els.Text({ children: '▤ board' })], label: '▤ board', onPress: on.toggleTodos })];
}

/** The right-aligned hint, only when the pane is wide enough and the gap fits. */
function hintCells(els: ClientElements, inner: number, gap: number): RenderElement[] {
  if (inner < HINT_MIN_INNER || gap < 1) return [];
  return [els.Text({ children: ' '.repeat(gap) }), els.Text({ dimColor: true, children: HINT })];
}

function tabButtons(els: ClientElements, tabs: Tab[], model: SidebarModel, on: SidebarHandlers): RenderElement[] {
  const children: RenderElement[] = [];
  tabs.forEach((t, i) => {
    const cur = t.v === model.ui.view;
    if (i) children.push(els.Text({ dimColor: true, children: ' │ ' }));
    children.push(els.Button({
      key: `tab:${t.v}`, plain: true, hotkey: t.key, dimColor: !cur,
      children: cur ? [els.Text({ bold: true, inverse: true, children: t.label })] : [els.Text({ children: t.label })],
      label: t.label, onPress: () => on.setView(t.v),
    }));
  });
  return children;
}

/** The tab strip: four plain hotkey Buttons (the current one bold), then a dim hint pushed to the right edge when there is room. */
function tabStrip(els: ClientElements, model: SidebarModel, on: SidebarHandlers, inner: number): RenderElement {
  const tabs = tabList(openGateCount(model.gates));
  const used = tabs.reduce((n, t) => n + textWidth(t.label) + 6, -3);
  const gap = inner - used - textWidth(HINT) - (on.toggleTodos ? 12 : 0);
  const children = [...tabButtons(els, tabs, model, on), ...todosTab(els, on), ...hintCells(els, inner, gap)];
  return els.Box({ key: 'tabs', flexDirection: 'row', flexShrink: 0, children });
}

const VIEWS = { route: routeRows, team: teamRows, channel: channelRows, gates: gateRows } as const;

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const cols = Math.max(10, model.columns - 1);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    width: cols,
    children: [tabStrip(els, model, on, cols), ...VIEWS[model.ui.view](els, model, on, cols)],
  });
}
