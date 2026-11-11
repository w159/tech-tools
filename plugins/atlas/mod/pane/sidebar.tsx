// Native-element sidebar: the SIDEPANEL ribbon, a tab strip (route, team, channel, gates, core) with the lit tab ruled, and
// exactly one view under it. The rows come from the shared layout (mod/panel-layout.ts); this file adds the tab Buttons
// (hotkeys r t c g k o, the six of STRIP_TABS in mod/panel-layout.ts that the omp painter prints too), which the host draws as
// `k: label`, so the strip budgets 3 cells a tab, takes a shorter label form (`chan`, then two letters) when the pane is narrow and wraps only below that: it never overflows into the neighbouring pane.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
import type { ClientElements, RenderElement } from 'claude-code';
import { cells, spinClock, uiFromEnv, type Ui } from '../atlas-ui';
import { HOTKEY_W, ribbonRow, STRIP_PAD, stripLayout, stripRows } from '../panel-layout';
import { liveWorkers, withOwnerStates, workerStates } from '../data/live';
import { ownTodos } from '../data/todos';
import { boardTree } from '../todo-panel';
import { panelModelOf } from './sidebar-model';
import { lineEl, panelBg, runEl, viewRows } from './sidebar-paint';
import type { SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

export type { GateGroup, GateLine, SidebarHandlers, SidebarModel, SidebarView } from './sidebar-types';

export { stripRows };

function stripEls(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number, ui: Ui): RenderElement[] {
  const bg = panelBg(ui);
  const gap = (n: number): RenderElement => els.Text({ backgroundColor: bg, children: ' '.repeat(n) });
  const rule = ui.ascii ? '-' : '━';
  const { rows, gap: stripGap } = stripLayout(inner, m.ui.view); // the widest label form that fits one row (mod/panel-layout.ts); the rule is as wide as the drawn label
  return rows.flatMap((row, ri): RenderElement[] => {
    const tabs = row.flatMap((it, i): RenderElement[] => {
      const on_ = it.id === m.ui.view;
      const press = it.id === 'board' ? () => on.toggleTodos?.() : () => on.setView(it.id as SidebarView);
      // The lit tab is bold, the rest explicitly not: a host that restyles Buttons reads the flag, not its absence.
      const label = { ...runEl(els, on_ ? { t: it.label, tone: 'text', bold: true } : { t: it.label, tone: 'muted' }, ui) } as RenderElement & { props: Record<string, unknown> };
      label.props = { ...label.props, bold: on_ };
      return [...(i ? [gap(stripGap)] : []), els.Button({ key: it.id === 'board' ? 'tab:todos' : `tab:${it.id}`, plain: true, hotkey: it.key, children: [label], label: it.label, onPress: press })];
    });
    const under = [gap(STRIP_PAD), ...row.flatMap((it, i): RenderElement[] => [
      ...(i ? [gap(stripGap)] : []), gap(HOTKEY_W),
      it.id === m.ui.view ? runEl(els, { t: rule.repeat(cells(it.label)), tone: 'accent' }, ui) : gap(cells(it.label)),
    ])];
    const lit = row.some((it) => it.id === m.ui.view);
    return [
      els.Box({ key: ri ? `tabs:${ri}` : 'tabs', flexDirection: 'row', flexShrink: 0, backgroundColor: bg, children: [gap(STRIP_PAD), ...tabs] }),
      ...(lit ? [els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: bg, children: under })] : []),
    ];
  });
}

/** The `o` tab: the board (mod/todo-panel.tsx) drawn inside the Atlas pane, which is the pane the host shows (a second pane opens behind it). */
function boardIn(els: ClientElements, m: SidebarModel, cols: number, ui: Ui): RenderElement {
  const s = m.snapshot;
  const items = withOwnerStates(ownTodos(s.todos ?? [], s.sessionId), workerStates(s, liveWorkers(s, s.now)));
  return boardTree(els, items, { ribbon: false, cols, rows: Math.max(1, m.rows - 4), tick: m.tick ?? 0, now: Math.floor(s.now / 1000), ...(s.now === undefined ? {} : { nowMs: spinClock(s.now, m.tick ?? 0) }), ui, motion: m.motion });
}

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const ui = model.look ?? uiFromEnv(); // the host's one read (register.ts); the process environment only where a fixture sets none
  const cols = Math.max(10, model.columns - 1);
  const pm = panelModelOf(model, ui, cols);
  const blank = (): RenderElement => lineEl(els, { runs: [{ t: ' ', tone: 'text' }] }, model, on, ui);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    width: cols,
    backgroundColor: panelBg(ui),
    children: [lineEl(els, ribbonRow(pm), model, on, ui), blank(), ...stripEls(els, model, on, cols, ui), ...(cols >= 100 ? [blank()] : []), ...(model.ui.view === 'board' ? [boardIn(els, model, cols, ui)] : viewRows(model.ui.view, els, model, on, cols, pm))],
  });
}
