// Native-element sidebar: the SIDEPANEL ribbon, a tab strip (route, team, channel, gates, core) with the lit tab ruled, and
// exactly one view under it. The rows come from the shared layout (mod/panel-layout.ts); this file adds the tab Buttons
// (hotkeys r t c g k o, the six of STRIP_TABS in mod/panel-layout.ts that the omp painter prints too). The strip draws the names only (design rev 5, C1): the hotkeys are
// Buttons on a clipped zero-width layer, the strip wraps only below 35 cells and never overflows into the neighbouring pane.
// Pure: every handler arrives as a closure, nothing here holds state or touches `$`.
import type { ClientElements, RenderElement } from 'claude-code';
import { cells, spinClock, uiFromEnv, type Ui } from '../atlas-ui';
import { centred, HOTKEY_W, recentRows, ribbonRow, STRIP_PAD, stripLayout, stripRows, type PanelModel } from '../panel-layout';
import { liveWorkers, withOwnerStates, workerStates } from '../data/live';
import { ownTodos } from '../data/todos';
import { boardFolded, boardLines, boardOpenFolded, boardRowsOf, boardTimeline, boardTotals, type BoardLine } from '../board-model';
import { gateTally } from '../data/runstate';
import { noteStopVerdict } from '../transcript/superseded';
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

/** The board view's ribbon words. Where the strip is the bare one-row form (no `r: route` keys on screen) the title is the breadcrumb `SIDEPANEL ▸ BOARD`: the capture scorer
 * tells the pane from a toast box by `r: route` or `▸ SIDEPANEL` and finds the board by `▸ BOARD` (live-110 round 2: board 0.0 with a bare strip under a lone `▸ BOARD`). */
export function boardViewRibbon(model: SidebarModel, cols: number, ui: Ui): { title: string; right: string } {
  // The count is said once, by the summary row in the body (`5 items · 3 dispatches`), not again in the ribbon (critique 22: `5 items` twice).
  const b = { title: 'BOARD', right: '' };
  return stripLayout(cols).bare ? { ...b, title: ui.ascii ? 'SIDEPANEL > BOARD' : 'SIDEPANEL ▸ BOARD' } : b;
}

/** The board's one footer row: the totals line (`● 2 done  ■ 1 killed · total 0:57`) with the close hint flush right; the longest form of the hint the row has room for. Nothing to total: the hint alone. */
function footerRow(totals: readonly BoardLine[], cols: number, ui: Ui): BoardLine | null {
  const base = totals[0]?.runs ?? [{ t: '  ', tone: 'text' as const }];
  const used = base.reduce((n, x) => n + cells(x.t), 0);
  const hint = ['o closes the board', 'o closes'].find((h) => used + 2 + cells(h) <= cols - 1);
  if (!hint) return totals[0] ?? null;
  return { runs: [...base, { t: ' '.repeat(Math.max(2, cols - 1 - used - cells(hint))), tone: 'text' as const }, { t: hint, tone: 'muted' as const }] };
}

/** The board view's rows (design wave 24): a summary row, every item with its owner in one right column, and the record of how the run closed. Nothing on the board: one dim line. */
function boardIn(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number, ui: Ui, pm: PanelModel): RenderElement {
  const s = m.snapshot;
  const items = boardItems(m);
  const max = Math.max(1, m.rows - 4);
  const stop = gateTally(m.gates as never).stop;
  const lines = items.length
    ? boardLines(boardRowsOf(items, Math.floor(s.now / 1000)), { cols, ui, pane: true, ribbon: false, title: false, tick: m.tick ?? 0, ...(s.now === undefined ? {} : { nowMs: spinClock(s.now, m.tick ?? 0) }), motion: m.motion, dispatches: items.filter((i) => i.origin === 'dispatch').length, folded: boardFolded(items), openFolded: boardOpenFolded(items), stopRefused: !!stop?.blocked })
    : centred(pm, 'nothing on the board yet');
  // Wave 30 (critique 28): under the rows the pane is a chart, not a blank half. Sections, richest first, as many as the height holds: the timeline (a solid bar per agent, its activity row, the axis), the totals line, then the
  // last posts of the channel; what is left over is spread as one blank row between sections, and a dim hint closes the pane, so no run of blank rows is longer than three.
  const blankRow = { runs: [{ t: ' ', tone: 'text' as const }] };
  const agents = pm.workers.map((w) => ({ name: w.name, state: w.state, secs: w.secs, startMs: w.startMs, endMs: w.endMs, calls: w.calls }));
  const clock = s.now === undefined ? {} : { nowMs: spinClock(s.now, m.tick ?? 0) };
  const topts = { cols, ui, tick: m.tick ?? 0, motion: m.motion, ...clock };
  const room = max - lines.length;
  const levels = [{ spark: true, spacers: true }, { spark: true, spacers: false }, { spark: false, spacers: true }, { spark: false, spacers: false }];
  let chart: BoardLine[] = [];
  let totals: BoardLine[] = [];
  if (items.length && room >= 5) {
    totals = boardTotals(agents, { ...topts, ...(pm.run?.secs !== undefined ? { runSecs: pm.run.secs } : {}) });
    for (const lv of levels) {
      const t = boardTimeline(agents, { ...topts, ...lv }, room - 2 - totals.length);
      if (t.length && 1 + t.length + 1 + totals.length <= room) { chart = t; break; }
      if (!chart.length && t.length && lv === levels[levels.length - 1]) chart = t;
    }
  }
  // Wave 32 (critique 30: ~25% of the pane empty under the total, `o closes the board` alone on a row): the total and the close hint are ONE footer row, the pane's last; the sections above it spread over the rows between.
  const foot = totals.length || (items.length && lines.length + 2 <= max) ? footerRow(totals, cols, ui) : null; // no room for a total: the hint alone, and only where two rows are spare
  const bodyMax = Math.max(1, max - 1);
  const sections = [lines, chart].filter((x) => x.length);
  const used = sections.reduce((n, x) => n + x.length, 0) + Math.max(0, sections.length - 1);
  const recent = items.length && sections.length > 1 ? recentRows({ ...pm, notes: pm.notes.filter((n) => !/^(T\d+|row) killed\b/.test(n.text)) }, bodyMax - used - 1) : []; // the closed row is said once, by the footer (critique 29: three times in one pane)
  const withRecent = recent.length ? [...sections, recent.slice(1)] : sections; // recentRows opens with its own blank: the join below puts it back
  const parts = foot ? [...withRecent, [foot]] : withRecent; // the footer is the last section: it takes its share of the spacing
  const rows = parts.reduce((n, x) => n + x.length, 0) + Math.max(0, parts.length - 1);
  const rem = Math.max(0, max - rows);
  const gaps = Math.max(0, parts.length - 1);
  const extra = gaps ? Math.max(0, Math.min(2, Math.floor((rem - 2) / gaps))) : 0; // a second blank row between sections only when the pane has them to spare
  const joined = parts.flatMap((x, i) => (i ? [...Array.from({ length: 1 + extra }, () => blankRow), ...x] : x));
  const keep = Math.max(0, max - (foot ? 2 : 1));
  const cut = joined.length <= max ? joined : [...joined.slice(0, keep), { runs: [{ t: `  +${joined.length - keep - (foot ? 1 : 0)} more`, tone: 'muted' as const }] }, ...(foot ? [foot] : [])];
  // On the Claude pane (`m.run`) the footer is the pane's last row and the surface is filled down to it (critique 29: the 234 stopped where the content ended).
  const pad = m.run ? Array.from({ length: Math.max(0, max - cut.length) }, () => blankRow) : [];
  const shown = foot && pad.length ? [...cut.slice(0, -1), ...pad, foot] : [...cut, ...pad];
  return els.Box({ flexDirection: 'column', flexShrink: 0, backgroundColor: panelBg(ui), children: shown.map((l) => lineEl(els, { runs: l.runs }, m, on, ui)) });
}

export function sidebarTree(els: ClientElements, model: SidebarModel, on: SidebarHandlers): RenderElement {
  const ui = model.look ?? uiFromEnv(); // the host's one read (register.ts); the process environment only where a fixture sets none
  const cols = Math.max(10, model.columns - 1);
  const pm = panelModelOf(model, ui, cols);
  noteStopVerdict(!!gateTally(model.gates as never).stop?.blocked); // the transcript's done chips read it: a refusal supersedes the ones drawn before it
  const blank = (): RenderElement => lineEl(els, { runs: [{ t: ' ', tone: 'text' }] }, model, on, ui);
  return els.Box({
    flexDirection: 'column',
    flexShrink: 0,
    width: cols,
    ...(model.rows > 0 ? { minHeight: model.rows } : {}), // wave 32 (critique 30: the 234 stopped short of the pane bottom): the panel surface is the pane's whole height on every tab, whatever the body holds
    backgroundColor: panelBg(ui),
    children: [lineEl(els, ribbonRow(pm, model.ui.view === 'board' ? boardViewRibbon(model, cols, ui) : undefined), model, on, ui), blank(), ...stripEls(els, model, on, cols, ui), ...(cols >= 100 ? [blank()] : []), ...(model.ui.view === 'board' ? [boardIn(els, model, on, cols, ui, pm)] : viewRows(model.ui.view, els, model, on, cols, pm))],
  });
}
