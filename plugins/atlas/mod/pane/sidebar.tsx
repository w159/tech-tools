// Native-element sidebar: a tab bar (r route, t team, c channel, g gates) over exactly one view.
// The active tab is accented, the others muted; the gates tab says how many checks fail, in words.
// Plain column: the host pane draws the one frame.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
// Spec: docs/specs/2026-11-10_atlas-terminal-ui.md (Other surfaces).
import type { ClientElements, RenderElement } from 'claude-code';
import { openGateCount } from '../gates';
import { TONE_HEX as T } from '../mission-layout';
import { textWidth } from '../theme';
import { channelRows } from './sidebar-channel';
import { coreRows } from './sidebar-core';
import { routeRows } from './sidebar-route';
import { teamRows } from './sidebar-team';
import type { SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

const HINT_MIN_INNER = 60;
const GAP = '  ';
/** Only the keys the bar draws: r t c g always, o when the board toggle is wired. Hotkeys press while this pane holds the keyboard. */
const hintFor = (on: SidebarHandlers): string => `press r t c g${on.toggleTodos ? ' o' : ''} · Tab ↑↓ · Esc closes`;

type TabSpec = { v: SidebarView; key: string; name: string; failing: number };
/** The failing part of a tab: `1 failing` in full, just the count when the bar is tight (the tab name stays beside it). */
const failingText = (t: TabSpec, compact: boolean): string => (t.failing ? (compact ? ` ${t.failing}` : ` ${t.failing} failing`) : '');
const labelOf = (t: TabSpec, compact: boolean): string => `${t.name}${failingText(t, compact)}`;
/** The host draws a 3-cell `k: ` hotkey prefix before every button, so each tab costs its label plus HOTKEY_W. */
const HOTKEY_W = 3;
const stripWidth = (ts: TabSpec[], compact: boolean): number => ts.reduce((n, t) => n + textWidth(labelOf(t, compact)) + HOTKEY_W + textWidth(GAP), -textWidth(GAP));

/** The four view tabs and whether the failing count folds to a bare number to fit a docked 56-column pane.
 * `used` is the bar's width so far (labels, hotkey prefixes, gaps); `boardW` the board button's full width. */
function tabSpecs(open: number, inner: number, hasBoard: boolean): { tabs: TabSpec[]; compact: boolean; used: number; boardW: number } {
  const tabs: TabSpec[] = [
    { v: 'route', key: 'r', name: 'route', failing: 0 },
    { v: 'team', key: 't', name: 'team', failing: 0 },
    { v: 'channel', key: 'c', name: 'channel', failing: 0 },
    { v: 'gates', key: 'g', name: 'gates', failing: open },
  ];
  const boardW = hasBoard ? textWidth(GAP) + HOTKEY_W + textWidth('board') : 0;
  const compact = stripWidth(tabs, false) + boardW > inner;
  return { tabs, compact, used: stripWidth(tabs, compact), boardW };
}

/** The optional board toggle after the four tabs. */
function todosTab(els: ClientElements, on: SidebarHandlers): RenderElement[] {
  if (!on.toggleTodos) return [];
  return [els.Text({ children: GAP }), els.Button({ key: 'tab:todos', plain: true, hotkey: 'o', children: [els.Text({ color: T.muted, children: 'board' })], label: 'board', onPress: on.toggleTodos })];
}

/** The right-aligned hint, only when the pane is wide enough and the gap fits. */
function hintCells(els: ClientElements, inner: number, gap: number, hint: string): RenderElement[] {
  if (inner < HINT_MIN_INNER || gap < 2) return [];
  return [els.Text({ children: ' '.repeat(gap) }), els.Text({ color: T.dim, children: hint })];
}

function tabButtons(els: ClientElements, tabs: TabSpec[], compact: boolean, model: SidebarModel, on: SidebarHandlers): RenderElement[] {
  const children: RenderElement[] = [];
  tabs.forEach((t, i) => {
    const cur = t.v === model.ui.view;
    if (i) children.push(els.Text({ children: GAP }));
    children.push(els.Button({
      key: `tab:${t.v}`, plain: true, hotkey: t.key,
      children: [
        els.Text({ color: cur ? T.accent : T.muted, bold: cur, children: t.name }),
        ...(t.failing ? [els.Text({ color: T.bad, bold: true, children: failingText(t, compact) })] : []),
      ],
      label: labelOf(t, compact), onPress: () => on.setView(t.v),
    }));
  });
  return children;
}

/** The tab bar: four plain hotkey Buttons (the active one accent and bold, the rest muted), then a dim hint pushed to the right edge when there is room. */
function tabStrip(els: ClientElements, model: SidebarModel, on: SidebarHandlers, inner: number): RenderElement {
  const { tabs, compact, used, boardW } = tabSpecs(openGateCount(model.gates), inner, !!on.toggleTodos);
  const hint = hintFor(on);
  const gap = inner - used - textWidth(hint) - boardW;
  const children = [...tabButtons(els, tabs, compact, model, on), ...todosTab(els, on), ...hintCells(els, inner, gap, hint)];
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
