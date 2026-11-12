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
import { boardRibbon, boardRowsOf } from '../board-model';
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
  const { rows, gap: stripGap, bare } = stripLayout(inner, m.ui.view); // the widest label form that fits one row (mod/panel-layout.ts); the rule is as wide as the drawn label
  const prefix = bare ? 0 : HOTKEY_W;
  return rows.flatMap((row, ri): RenderElement[] => {
    const pressOf = (it: { id: string }) => (it.id === 'board' ? () => on.toggleTodos?.() : () => on.setView(it.id as SidebarView));
    const keyOf = (it: { id: string }): string => (it.id === 'board' ? 'tab:todos' : `tab:${it.id}`);
    const tabs = row.flatMap((it, i): RenderElement[] => {
      const on_ = it.id === m.ui.view;
      // The lit tab is bold, the rest explicitly not: a host that restyles Buttons reads the flag, not its absence.
      const label = { ...runEl(els, on_ ? { t: it.label, tone: 'text', bold: true } : { t: it.label, tone: 'muted' }, ui) } as RenderElement & { props: Record<string, unknown> };
      label.props = { ...label.props, bold: on_ };
      // Bare strip (a narrow pane): the host draws `k: ` only for a Button that has a hotkey, so these carry none; the keys live on the zero-width layer below.
      return [...(i ? [gap(stripGap)] : []), els.Button({ key: keyOf(it), plain: true, ...(bare ? {} : { hotkey: it.key }), children: [label], label: it.label, onPress: pressOf(it) })];
    });
    // The keys of a bare strip: the same hotkey Buttons the wide strip draws, in a clipped zero-width box that paints nothing.
    const keys = bare ? [els.Box({ key: `tabkeys:${ri}`, position: 'absolute', top: 0, left: 0, width: 0, height: 1, overflow: 'hidden', flexDirection: 'row', children: row.map((it) => els.Button({ key: `${keyOf(it)}:key`, plain: true, hotkey: it.key, label: it.label, onPress: pressOf(it) })) })] : [];
    const under = [gap(STRIP_PAD), ...row.flatMap((it, i): RenderElement[] => [
      ...(i ? [gap(stripGap)] : []), ...(prefix ? [gap(prefix)] : []),
      it.id === m.ui.view ? runEl(els, { t: rule.repeat(cells(it.label)), tone: 'accent' }, ui) : gap(cells(it.label)),
    ])];
    const lit = row.some((it) => it.id === m.ui.view);
    return [
      els.Box({ key: ri ? `tabs:${ri}` : 'tabs', flexDirection: 'row', flexShrink: 0, backgroundColor: bg, children: [gap(STRIP_PAD), ...tabs, ...keys] }),
      ...(lit ? [els.Box({ flexDirection: 'row', flexShrink: 0, backgroundColor: bg, children: under })] : []),
    ];
  });
}

/** The `o` tab: the board (mod/todo-panel.tsx) drawn inside the Atlas pane, which is the pane the host shows (a second pane opens behind it). */
function boardItems(m: SidebarModel) {
  const s = m.snapshot;
  return withOwnerStates(ownTodos(s.todos ?? [], s.sessionId), workerStates(s, liveWorkers(s, s.now)));
}

function boardIn(els: ClientElements, m: SidebarModel, cols: number, ui: Ui): RenderElement {
  const s = m.snapshot;
  const items = boardItems(m);
  return boardTree(els, items, { ribbon: false, title: false, cols, rows: Math.max(1, m.rows - 4), tick: m.tick ?? 0, now: Math.floor(s.now / 1000), ...(s.now === undefined ? {} : { nowMs: spinClock(s.now, m.tick ?? 0) }), ui, motion: m.motion });
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
    children: [lineEl(els, ribbonRow(pm, model.ui.view === 'board' ? boardRibbon(boardRowsOf(boardItems(model), Math.floor(model.snapshot.now / 1000))) : undefined), model, on, ui), blank(), ...stripEls(els, model, on, cols, ui), ...(cols >= 100 ? [blank()] : []), ...(model.ui.view === 'board' ? [boardIn(els, model, cols, ui)] : viewRows(model.ui.view, els, model, on, cols, pm))],
  });
}
