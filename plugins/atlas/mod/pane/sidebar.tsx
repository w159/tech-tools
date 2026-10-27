// Native-element sidebar: a hotkey tab strip (r route, t team, c channel, g core) over exactly one view.
// Plain column: the host pane draws the one frame.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
// Plan: docs/plans/2026-10-13_atlas-command-center-redesign.md §3.
import type { ClientElements, RenderElement } from 'claude-code';
import { openGateCount } from '../gates';
import { textWidth } from '../theme';
import { channelRows } from './sidebar-channel';
import { coreRows } from './sidebar-core';
import { routeRows } from './sidebar-route';
import { teamRows } from './sidebar-team';
import type { SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

const HINT_MIN_INNER = 60;
/** Only the keys the strip draws: r t c g always, o when the board toggle is wired. Hotkeys press while this pane holds the keyboard. */
const hintFor = (on: SidebarHandlers): string => `press r t c g${on.toggleTodos ? ' o' : ''} · Tab ↑↓ · Esc closes`;

const stripWidth = (ts: { label: string }[]): number => ts.reduce((n, t) => n + textWidth(t.label) + 6, -3);
const coreLabels = (open: number): { label: string; short: string } => (open ? { label: `◈ core ✗${open}`, short: `core ✗${open}` } : { label: '◈ core', short: 'core' });
type TabSpec = { v: SidebarView; key: string; label: string; short: string };

/** The four view tabs and the board label, glyphs dropped when five buttons with them overflow a docked 56-column pane.
 * `used` is the strip's width so far (labels, `k: ` prefixes, separators); `boardW` the board button's full width. */
function tabSpecs(open: number, inner: number, hasBoard: boolean): { tabs: TabSpec[]; board: string; used: number; boardW: number } {
  const tabs: TabSpec[] = [
    { v: 'route', key: 'r', label: '◎ route', short: 'route' },
    { v: 'team', key: 't', label: '● team', short: 'team' },
    { v: 'channel', key: 'c', label: '✉ channel', short: 'channel' },
    { v: 'gates', key: 'g', ...coreLabels(open) },
  ];
  const compact = stripWidth(tabs) + 13 * +hasBoard > inner;
  const shown = tabs.map((t) => ({ ...t, label: compact ? t.short : t.label }));
  const board = ['▤ board', 'board'][+compact]!;
  return { tabs: shown, board, used: stripWidth(shown), boardW: (6 + textWidth(board)) * +hasBoard };
}

/** The optional board toggle after the four tabs. */
function todosTab(els: ClientElements, on: SidebarHandlers, board: string): RenderElement[] {
  if (!on.toggleTodos) return [];
  return [els.Text({ dimColor: true, children: ' │ ' }), els.Button({ key: 'tab:todos', plain: true, hotkey: 'o', dimColor: true, children: [els.Text({ children: board })], label: board, onPress: on.toggleTodos })];
}

/** The right-aligned hint, only when the pane is wide enough and the gap fits. */
function hintCells(els: ClientElements, inner: number, gap: number, hint: string): RenderElement[] {
  if (inner < HINT_MIN_INNER || gap < 2) return [];
  return [els.Text({ children: ' '.repeat(gap) }), els.Text({ dimColor: true, children: hint })];
}

function tabButtons(els: ClientElements, tabs: TabSpec[], model: SidebarModel, on: SidebarHandlers): RenderElement[] {
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
  const { tabs, board, used, boardW } = tabSpecs(openGateCount(model.gates), inner, !!on.toggleTodos);
  const hint = hintFor(on);
  const gap = inner - used - textWidth(hint) - boardW; // the board button: separator 3, `o: ` 3, label
  const children = [...tabButtons(els, tabs, model, on), ...todosTab(els, on, board), ...hintCells(els, inner, gap, hint)];
  return els.Box({ key: 'tabs', flexDirection: 'row', flexShrink: 0, children });
}

const VIEWS = { route: routeRows, team: teamRows, channel: channelRows, gates: coreRows } as const;

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const cols = Math.max(10, model.columns - 1);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    width: cols,
    children: [tabStrip(els, model, on, cols), ...VIEWS[model.ui.view](els, model, on, cols)],
  });
}
