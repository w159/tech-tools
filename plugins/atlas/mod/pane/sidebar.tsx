// Native-element sidebar: the SIDEPANEL ribbon, a tab strip (route, team, channel, gates, core) with the lit tab ruled, and
// exactly one view under it. The rows come from the shared layout (mod/panel-layout.ts); this file adds the tab Buttons
// (hotkeys r t c g k, o for the board when wired), which the host draws as `k: label`, so the strip budgets 3 cells a tab
// and wraps onto a second row when it does not fit: it never overflows into the neighbouring pane.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
import type { ClientElements, RenderElement } from 'claude-code';
import { cells, uiFromEnv, type Ui } from '../atlas-ui';
import { PANEL_TABS, ribbonRow, type PanelTab } from '../panel-layout';
import { panelModelOf } from './sidebar-model';
import { lineEl, panelBg, runEl, viewRows } from './sidebar-paint';
import type { SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

const HOTKEY_W = 3;
type Item = { id: PanelTab | 'board'; key: string; label: string };

/** Tabs per strip row: as many as fit in `inner` cells with a two-cell gap, each costing its label plus the host's `k: ` prefix. */
export function stripRows(items: readonly Item[], inner: number): Item[][] {
  const rows: Item[][] = [];
  let used = 0;
  for (const it of items) {
    const w = HOTKEY_W + it.label.length;
    if (!rows.length || (rows[rows.length - 1]!.length && used + 2 + w > inner)) { rows.push([]); used = 0; }
    rows[rows.length - 1]!.push(it);
    used += (rows[rows.length - 1]!.length > 1 ? 2 : 0) + w;
  }
  return rows;
}

function stripEls(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number, ui: Ui): RenderElement[] {
  const items: Item[] = [...PANEL_TABS, ...(on.toggleTodos ? [{ id: 'board' as const, key: 'o', label: 'board' }] : [])];
  const bg = panelBg(ui);
  const gap = (n: number): RenderElement => els.Text({ backgroundColor: bg, children: ' '.repeat(n) });
  const rule = ui.ascii ? '-' : '━';
  return stripRows(items, inner).flatMap((row, ri): RenderElement[] => {
    const tabs = row.flatMap((it, i): RenderElement[] => {
      const on_ = it.id === m.ui.view;
      const press = it.id === 'board' ? () => on.toggleTodos?.() : () => on.setView(it.id as SidebarView);
      // The lit tab is bold, the rest explicitly not: a host that restyles Buttons reads the flag, not its absence.
      const label = { ...runEl(els, on_ ? { t: it.label, tone: 'text', bold: true } : { t: it.label, tone: 'muted' }, ui) } as RenderElement & { props: Record<string, unknown> };
      label.props = { ...label.props, bold: on_ };
      return [...(i ? [gap(2)] : []), els.Button({ key: it.id === 'board' ? 'tab:todos' : `tab:${it.id}`, plain: true, hotkey: it.key, children: [label], label: it.label, onPress: press })];
    });
    const under = row.flatMap((it, i): RenderElement[] => [
      ...(i ? [gap(2)] : []), gap(HOTKEY_W),
      it.id === m.ui.view ? runEl(els, { t: rule.repeat(cells(it.label)), tone: 'accent' }, ui) : gap(it.label.length),
    ]);
    const lit = row.some((it) => it.id === m.ui.view);
    return [
      els.Box({ key: ri ? `tabs:${ri}` : 'tabs', flexDirection: 'row', flexShrink: 0, backgroundColor: bg, children: tabs }),
      ...(lit ? [els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: bg, children: under })] : []),
    ];
  });
}

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const ui = uiFromEnv();
  const cols = Math.max(10, model.columns - 1);
  const pm = panelModelOf(model, ui, cols);
  const blank = (): RenderElement => lineEl(els, { runs: [{ t: ' ', tone: 'text' }] }, model, on, ui);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    width: cols,
    backgroundColor: panelBg(ui),
    children: [lineEl(els, ribbonRow(pm), model, on, ui), blank(), ...stripEls(els, model, on, cols, ui), blank(), ...viewRows(model.ui.view, els, model, on, cols)],
  });
}
