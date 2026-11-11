// band.tsx: the AbovePrompt "Mission Control" band on Claude Code. A thin adapter over mission-layout.ts, the layout
// the omp mission panel draws too: it turns the snapshot, live workers and gate groups into a MissionModel, paints
// each layout run as a Segment in the shared tone palette, fills the board slot with the todo list and appends the
// key buttons to the footer. Pure: `register.ts` hands it the snapshot, workers, gates, columns, row budget and tick.
import type { ClientElements, RenderElement } from 'claude-code';
import { coreCells } from './core-row';
import type { CoreModel } from './data/core';
import type { LiveSnapshot } from './orchestra-types';
import { queuedMembers, workerStates, withOwnerStates, type LiveWorker } from './data/live';
import { ownTodos, planBasis, todoCounts } from './data/todos';
import { blockedCount } from './board-model';
import { gateTally, ranWorkers } from './data/runstate';
import { hostEnv, LINGER_MS, surfaceHex, uiFromEnv, type Ui, runHex } from './atlas-ui';
import type { MotionCtx, MotionItem } from './motion';
import { bandLines, bandMotionItems, isMessageKind, type Line, type MissionModel, type MissionWorker, type Run, type WorkerState, missionLines } from './mission-layout';
import type { GateGroup, SidebarView } from './pane/sidebar-types';
import { fitRuns, rowOf, type Segment } from './runs';
import { todoRows } from './todo-panel';
import { contractRail, railOf, type Rail } from './rail';
import { STRIP_TABS } from './panel-layout';
import { textWidth } from './theme';

export { planRows } from './mission-layout';

/** `lastPhase`: the last rail phase the caller rendered, lit while the snapshot phase is `blocked`. */
export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number; maxRows?: number; lastPhase?: string | null; todoExpanded?: boolean; core?: CoreModel | null; team?: string; leadName?: string; ui?: Ui; rich?: boolean; workersInHud?: boolean; eased?: { todo?: number; ctx?: number }; /** Motion view (mod/motion.ts); absent: the resting render. */ motion?: MotionCtx | undefined };
// `team` (omp: the team record's `<class>/<effort>`) is the header's scope label; `leadName` (omp: `lead-<sid6>`)
// names the lead in the message row. Both absent: not shown / `lead`. `ui` (theme, ASCII, colour depth) defaults to the
// environment; `rich` (ATLAS_BAND_RICH=1) draws the tall band when the rows allow. `workersInHud`: the HUD's Subagents
// block is on screen, so the band keeps its counts and lists no worker (a working worker with no tool yet counts as
// running there, as it does in the block). `eased`: the gauge values on screen while a figure glides (band-motion.ts).

const WAVE_GAP_MS = 10_000; // spawns further apart than this start a new wave
/** Brand mark: one cell (the U+25E2 triangles of the mockup draw 2 cells in Ghostty; theme.test.ts). */
export const MARK = '◆';
/** Footer button presses: open (or focus) the Atlas pane on a view, or open the Board pane (`toggleTodos`, the `o` key). Absent in fixtures that wire neither. */
export type BandHandlers = { openView(v: SidebarView): void; toggleTodos(): void };
/** The band's controls: hotkeys press only while the band holds the keyboard (ctrl+x, Tab, or a click), and are unique within it. */
export const BAND_BUTTONS: readonly { id: SidebarView | 'board'; key: string; label: string }[] = STRIP_TABS; // the side panel's own tab strip (route team channel gates core board)
/** How to give the band the keyboard; shown after the keys when it fits. */
export const BAND_HINT = 'ctrl+x tab';
const buttonWidth = (b: { label: string }): number => 3 + textWidth(b.label) + 2; // engine draws `k: label`, two cells between buttons
const KEYS_W = BAND_BUTTONS.reduce((n, b) => n + buttonWidth(b), 0);

/** `mcp__lean-ctx__ctx_shell` and `mcp__plugin_x_srv__tool` both read as the bare tool name. */
export const shortTool = (tool: string): string => tool.replace(/^mcp__.*__/, '');

/** The snapshot's rail (mod/rail.ts, the one rail every surface asks): ids, the lit step and its index. */
const railFor = (s: LiveSnapshot, lastPhase?: string | null): Rail => railOf(contractRail(s.contract), s.phase, lastPhase);

/** `HudInput.phases`: the rail ids and the lit index (`ids.length` once the run is done), the band's own rail for the HUD's rich form. */
export function hudPhases(s: LiveSnapshot, lastPhase?: string | null): { ids: string[]; active: number } {
  const r = railFor(s, lastPhase);
  return { ids: r.ids, active: r.index };
}

/** The lit step: the snapshot phase when it is on the rail (`done` for a finished run); for `blocked` (or any off-rail phase)
 * the last rail phase the caller saw, else the first, so a blocked reply never leaves the rail with nothing lit. */
export const railPhase = (s: LiveSnapshot, lastPhase?: string | null): string => railFor(s, lastPhase).phase;

// ---- model --------------------------------------------------------------------------

/** Spawn clusters among the run's workers, oldest first. ponytail: a 10 s gap heuristic, swap for the dispatch
 * batch id once the host exposes one. */
function waves(ws: readonly LiveWorker[]): LiveWorker[][] {
  const sorted = [...ws].sort((a, b) => a.startedAt - b.startedAt);
  return sorted.reduce<LiveWorker[][]>((acc, w, i) => {
    if (i === 0 || w.startedAt - sorted[i - 1]!.startedAt > WAVE_GAP_MS) acc.push([]);
    acc[acc.length - 1]!.push(w);
    return acc;
  }, []);
}

/** `<folder>@<branch>` of the board channel; without a board, the project folder. */
const boardOf = (s: LiveSnapshot): string => (s.channel ? s.channel.split('/')[0]! : (s.root ?? '').replace(/\/+$/, '').split('/').pop() || 'atlas');

/** The host lists a working worker, so it is running: with a tool in flight it draws the tool, between calls it draws `thinking`
 * (the state word is `running` either way; data/live.ts holds the one rule). A parked worker reads queued. */
function workerState(w: LiveWorker): WorkerState {
  if (w.state === 'working') return w.tool ? 'running' : 'thinking';
  return w.state === 'parked' ? 'queued' : w.state === 'blocked' ? 'waiting' : w.state === 'failed' ? 'failed' : 'done';
}

function missionWorker(w: LiveWorker, now: number): MissionWorker {
  const state = workerState(w);
  const tool = w.tool ?? w.lastTool;
  const end = state === 'done' || state === 'failed' ? w.since : now;
  return { name: w.name, role: w.role, state, tool: tool ? shortTool(tool) : undefined, target: w.target ?? undefined, secs: Math.max(0, Math.round((end - w.startedAt) / 1000)) };
}

const hhmm = (ts: number): string => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function lastRun(all: readonly LiveWorker[], now: number, owners: readonly string[]): MissionModel['lastRun'] {
  const wave = waves(all).pop();
  const ran = ranWorkers((wave ?? []).map((w) => w.name), owners); // the burst plus every dispatch that ran (the host forgets a finished worker)
  if (!wave) return ran.length ? { workers: ran.length, failed: 0 } : undefined;
  const end = Math.max(...wave.map((w) => (w.state === 'done' || w.state === 'failed' ? w.since : now)));
  return { workers: ran.length, secs: Math.max(0, Math.round((end - Math.min(...wave.map((w) => w.startedAt))) / 1000)), failed: all.filter((w) => w.state === 'failed').length }; // a failure of an earlier wave still counts: idle never reads `all ok` over a failed worker
}

function missionModel(b: BandModel & { maxRows: number }): MissionModel {
  const s = b.snapshot;
  const now = s.now;
  const all = b.live.filter((w) => w.state !== 'parked'); // parked workers are resting
  const active = all.filter((w) => w.state !== 'done');
  const lingering = all.filter((w) => w.state === 'done' && now - w.since <= LINGER_MS);
  const queued = queuedMembers(s).map((name): MissionWorker => ({ name, role: name.includes('-') ? name.replace(/-[^-]*$/, '') : undefined, state: 'queued', secs: 0 })); // dispatched, not listed by the host yet
  const shown = active.length || queued.length ? [...active, ...lingering] : []; // a finished worker lingers only while the wave runs
  const { done, total } = todoCounts(s); // the one count basis: header, HUD, board and side panel all read the same plan rows
  const tally = gateTally(b.gates); // the one gates figure: the side panel's `green of total` reads the same groups, the header contract included
  const named = (n: string): string => (b.leadName && n === 'lead' ? b.leadName : n); // comms collapse the lead's name to `lead`
  const last = [...s.comms].reverse().find((c) => isMessageKind(c.kind)); // joins and leaves are presence, not messages
  const working = active.filter((w) => w.state === 'working' || w.state === 'blocked');
  return {
    cols: Math.max(1, b.columns), maxRows: b.maxRows, tick: b.tick, now,
    project: boardOf(s), scope: b.team,
    phases: railFor(s, b.lastPhase).ids, phase: railPhase(s, b.lastPhase), blocked: s.phase === 'blocked',
    done, total, todoBlocked: blockedCount(planBasis(s.todos, s.sessionId), workerStates(s, b.live)),
    workers: [...shown.map((w) => missionWorker(w, now)), ...queued],
    note: last ? { from: named(last.from), to: named(last.to), text: last.text, at: hhmm(last.ts), kind: last.kind } : undefined,
    checks: tally.total ? tally.checks : null,
    elapsedSecs: working.length ? Math.round((now - Math.min(...working.map((w) => w.startedAt))) / 1000) : undefined,
    lastRun: lastRun(all, now, ownTodos(s.todos, s.sessionId).filter((t) => t.origin === 'dispatch' && t.owner).map((t) => t.owner!)),
    core: coreCells(b.core, Math.max(1, b.columns), b.ui),
    boardRows: b.todoExpanded && ownTodos(s.todos, s.sessionId).length ? ownTodos(s.todos, s.sessionId).length + 1 : 0,
    ctx: s.contextPct > 0 ? Math.min(1, s.contextPct / 100) : undefined,
    rich: b.rich ?? hostEnv().ATLAS_BAND_RICH === '1',
    ui: b.ui ?? uiFromEnv(),
    workersInHud: b.workersInHud, eased: b.eased, ...(b.motion ? { motion: b.motion } : {}),
  };
}

// ---- paint --------------------------------------------------------------------------

/** A run as a Segment: the live theme's tone colour on the run's own fill or the panel; with NO_COLOR only bold and strike remain. */
const seg = (x: Run, ui: Ui): Segment => {
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  return ui.color === 'none' ? { t: x.t, ...style } : { t: x.t, color: runHex(x, ui.theme, ui.color), bg: surfaceHex(x.bg ?? 'panel', ui), ...style };
};
const segs = (l: Line, ui: Ui): Segment[] => l.runs.map((x) => seg(x, ui));
const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : surfaceHex('panel', ui));

/** The band rows alone (no workers, footer or board), plain text per row: what the tier goldens compare. */
export function bandRows(m: MissionModel): string[] {
  return bandLines(m).map((l) => l.runs.map((x) => x.t).join(''));
}

/** The footer with its key buttons (a row of real clickable keys) and, when it fits, the focus hint after them. */
function keysRow(els: ClientElements, l: Line, cols: number, on: BandHandlers, ui: Ui): RenderElement {
  const bg = panelBg(ui);
  const mutedColor = ui.color === 'none' ? undefined : runHex({ tone: 'muted' }, ui.theme, ui.color);
  const left = segs(l, ui);
  const used = left.reduce((n, x) => n + textWidth(x.t), 0);
  const hint = used + KEYS_W + textWidth(BAND_HINT) + 3 <= cols ? BAND_HINT : '';
  const press = (id: SidebarView | 'board'): (() => void) => (id === 'board' ? on.toggleTodos : () => on.openView(id));
  const buttons = BAND_BUTTONS.map((b) => els.Button({
    key: `band:${b.id}`, plain: true, hotkey: b.key, label: b.label, onPress: press(b.id),
    children: [els.Text({ color: mutedColor, backgroundColor: bg, children: b.label })],
  }));
  const tail = hint ? `  ${hint} ` : ' ';
  const gap = cols - used - KEYS_W - textWidth(tail) + 2; // the last button carries no trailing two-cell gap
  const sep = (i: number): RenderElement => els.Text({ backgroundColor: bg, children: i ? '  ' : '' });
  return els.Box({
    flexDirection: 'row', flexShrink: 0,
    children: [...fitRuns(els, left, cols), els.Text({ backgroundColor: bg, children: ' '.repeat(Math.max(0, gap)) }), ...buttons.flatMap((b, i) => [sep(i), b]), els.Text({ color: mutedColor, backgroundColor: bg, children: tail })],
  });
}

type Row = Segment[] | RenderElement;
const panel = (els: ClientElements, rows: Row[], cols: number, ui: Ui): RenderElement =>
  els.Box({ flexDirection: 'column', flexShrink: 0, backgroundColor: panelBg(ui), children: rows.map((r) => (Array.isArray(r) ? rowOf(els, r, cols) : r)) });

/** Any MissionModel as the band tree (the shared-world goldens and the renderer feed models directly). */
export function missionTree(els: ClientElements, m: MissionModel, todoRows: (rows: number) => Segment[][] = () => [], on?: BandHandlers): RenderElement {
  const ui = m.ui ?? uiFromEnv();
  const rows: Row[] = missionLines(m).flatMap((l): Row[] => (l.board ? todoRows(l.board) : l.keys && on ? [keysRow(els, l, m.cols, on, ui)] : [segs(l, ui)]));
  return panel(els, rows, m.cols, ui);
}

/** Rows the HUD can have instead of the band's: the breathing blanks it draws at `b.maxRows` (rows of spaces only; a board slot or the key footer never counts),
 * plus the allotted rows it does not draw at all (an idle band stops short of its slot). */
/** What the Motion observes of the band: each state's agent count (the counts the header draws). */
export const bandCountItems = (b: BandModel): MotionItem[] => bandMotionItems(missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? uiFromEnv() }));

export function bandSpareRows(b: BandModel): number {
  const maxRows = b.maxRows ?? 12;
  if (maxRows < 1) return 0;
  const m = missionModel({ ...b, maxRows, ui: b.ui ?? uiFromEnv() });
  const lines = missionLines(m);
  const blanks = lines.filter((l) => !l.board && !l.keys && l.runs.every((x) => x.t.trim() === '')).length;
  const drawn = lines.reduce((n, l) => n + (l.board ?? 1), 0); // a board slot counts as the rows it holds
  return blanks + Math.max(0, maxRows - drawn);
}

export function bandTree(els: ClientElements, b: BandModel, on?: BandHandlers): RenderElement {
  const cols = Math.max(1, b.columns);
  const maxRows = b.maxRows ?? 12;
  const ui = b.ui ?? uiFromEnv();
  if (maxRows < 1) return panel(els, [], cols, ui); // the HUD can take the whole slot: draw nothing rather than a row past the budget
  const m = missionModel({ ...b, maxRows, ui });
  const idle = !m.workers.some((w) => w.state !== 'done' && w.state !== 'failed');
  const keys = !!on && idle && cols >= 80; // keys while idle; omp has none, a running band keeps its rows for workers
  const lines = missionLines({ ...m, keysWidth: keys ? KEYS_W : 0 });
  const rows: Row[] = lines.flatMap((l): Row[] => {
    if (l.board) return todoRows(withOwnerStates(ownTodos(b.snapshot.todos, b.snapshot.sessionId), workerStates(b.snapshot, b.live)), { cols, tick: b.tick, expanded: true, maxRows: l.board, now: Math.floor(b.snapshot.now / 1000), nowMs: b.snapshot.now, ui, rich: m.rich, motion: b.motion });
    if (l.keys && on) return [keysRow(els, l, cols, on, ui)];
    return [segs(l, ui)];
  });
  return panel(els, rows, cols, ui);
}
