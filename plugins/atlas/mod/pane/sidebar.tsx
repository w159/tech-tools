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
/** Only the keys the strip draws: r t c g always, o when the board toggle is wired. Hotkeys press while this pane holds the keyboard. */
const hintFor = (on: SidebarHandlers): string => `press r t c g${on.toggleTodos ? ' o' : ''} · Tab ↑↓ · Esc closes`;

type TabSpec = { v: SidebarView; key: string; label: string; short: string };

/** The four view tabs and the board label, glyphs dropped when five buttons with them overflow a docked 56-column pane.
 * `used` is the strip's width so far (labels, `k: ` prefixes, separators); `boardW` the board button's full width. */
function tabSpecs(open: number, inner: number, hasBoard: boolean): { tabs: TabSpec[]; board: string; used: number; boardW: number } {
  const tabs: TabSpec[] = [
    { v: 'route', key: 'r', label: '◎ route', short: 'route' },
    { v: 'team', key: 't', label: '● team', short: 'team' },
    { v: 'channel', key: 'c', label: '✉ channel', short: 'channel' },
    { v: 'gates', key: 'g', label: open ? `✗ ${open}` : '✓ gates', short: open ? `gates ✗${open}` : 'gates' },
  ];
  const width = (ts: TabSpec[]): number => ts.reduce((n, t) => n + textWidth(t.label) + 6, -3);
  const glyphW = width(tabs) + (hasBoard ? 13 : 0);
  const compact = glyphW > inner;
  if (compact) tabs.forEach((t) => { t.label = t.short; });
  const board = compact ? 'board' : '▤ board';
  return { tabs, board, used: width(tabs), boardW: hasBoard ? 6 + textWidth(board) : 0 };
}

/** The tab strip: four plain hotkey Buttons (the current one bold), then a dim hint pushed to the right edge when there is room. */
function tabStrip(els: ClientElements, model: SidebarModel, on: SidebarHandlers, inner: number): RenderElement {
  const { tabs, board, used, boardW } = tabSpecs(openGateCount(model.gates), inner, !!on.toggleTodos);
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
  if (on.toggleTodos) {
    children.push(els.Text({ dimColor: true, children: ' │ ' }), els.Button({ key: 'tab:todos', plain: true, hotkey: 'o', dimColor: true, children: [els.Text({ children: board })], label: board, onPress: on.toggleTodos }));
  }
  const HINT = hintFor(on);
  const gap = inner - used - textWidth(HINT) - boardW; // the board button: separator 3, `o: ` 3, label
  if (inner >= HINT_MIN_INNER && gap >= 2) {
    children.push(els.Text({ children: ' '.repeat(gap) }), els.Text({ dimColor: true, children: HINT }));
  }
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
