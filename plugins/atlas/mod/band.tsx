// band.tsx: the AbovePrompt "Mission Control" band on Claude Code. A thin adapter over mission-layout.ts, the layout
// the omp mission panel draws too: it turns the snapshot, live workers and gate groups into a MissionModel, paints
// each layout run as a Segment in the shared tone palette, fills the board slot with the todo list and appends the
// key buttons to the footer. Pure: `register.ts` hands it the snapshot, workers, gates, columns, row budget and tick.
import type { ClientElements, RenderElement } from 'claude-code';
import { coreCells } from './core-row';
import type { CoreModel } from './data/core';
import type { LiveSnapshot } from './orchestra-types';
import { queuedMembers, workerStates, withOwnerStates, type LiveWorker } from './data/live';
import { isPlanItem, openRowName, ownPlan, ownTodos, planBasis, todoCounts } from './data/todos';
import { planProgress } from './hud';
import { openItems, openWork } from './data/core';
import { blockedCount } from './board-model';
import { gateTally, leadBusy, planBusy, ranWorkers, withCoreTally } from './data/runstate';
import { fillHex, hostEnv, LINGER_MS, spinClock, surfaceHex, uiFromEnv, type Ui, runHex } from './atlas-ui';
import type { MotionCtx, MotionItem } from './motion';
import type { UiState } from './atlas-ui';
import { bandLines, bandMotionItems, isMessageKind, runStateOf, type Line, type MissionModel, type MissionWorker, type Run, type WorkerState, missionLines } from './mission-layout';
import type { GateGroup, SidebarView } from './pane/sidebar-types';
import { fitRuns, rowOf, type Segment } from './runs';
import { todoRows } from './todo-panel';
import { contractRail, railOf, type Rail } from './rail';
import { STRIP_TABS } from './panel-layout';
import { textWidth } from './theme';

export { planRows } from './mission-layout';

/** `lastPhase`: the last rail phase the caller rendered, lit while the snapshot phase is `blocked`. */
export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number; maxRows?: number; lastPhase?: string | null; todoExpanded?: boolean; /** The host says a model turn is running (AbovePrompt `isWorking`): true from Enter, before any hook of the turn fires (the first prompt waits on SessionStart hooks), so the band never reads `idle` under a running spinner. */ working?: boolean; /** Seconds the current run of work has lasted (the shared tick counted in seconds): the `0:42` after `working`. */ workSecs?: number; /** Seconds the last run took: the `1:12` after `done`. */ ranSecs?: number; /** Seconds at rest since the last run ended (from IDLE_AFTER_SECS the finished band reads `idle`). */ restSecs?: number; core?: CoreModel | null; team?: string; leadName?: string; ui?: Ui; rich?: boolean; workersInHud?: boolean; /** The HUD draws an agent running (listed, resumed or queued): the band reads working whatever the host's turn flag says. */ agentsRunning?: boolean; eased?: { todo?: number; ctx?: number }; /** Motion view (mod/motion.ts); absent: the resting render. */ motion?: MotionCtx | undefined };
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
  return { name: w.name, role: w.role, state, tool: tool ? shortTool(tool) : undefined, target: w.target ?? undefined, secs: Math.max(0, Math.floor((end - w.startedAt) / 1000)), ...(state === 'done' || state === 'failed' ? { agoSecs: Math.max(0, Math.round((now - w.since) / 1000)) } : {}) };
}

const hhmm = (ts: number): string => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function lastRun(all: readonly LiveWorker[], now: number, owners: readonly string[]): MissionModel['lastRun'] {
  const wave = waves(all).pop();
  const ran = ranWorkers((wave ?? []).map((w) => w.name), owners); // the burst plus every dispatch that ran (the host forgets a finished worker)
  if (!wave) return ran.length ? { workers: ran.length, failed: 0 } : undefined;
  const end = Math.max(...wave.map((w) => (w.state === 'done' || w.state === 'failed' ? w.since : now)));
  return { workers: ran.length, secs: Math.max(0, Math.round((end - Math.min(...wave.map((w) => w.startedAt))) / 1000)), failed: all.filter((w) => w.state === 'failed').length }; // a failure of an earlier wave still counts: idle never reads `all ok` over a failed worker
}

/** Stop's open rows that the plan count does not carry, read from the snapshot the plan count reads (never the core model, which is rebuilt on its own slower tick and
 * trailed the plan: `5/5 · 1 open` under a full plan, critique 11). The core model only ever held plan rows, so it could not see the dispatch rows Stop counts. */
function openRows(s: LiveSnapshot, owners: ReadonlyMap<string, UiState>): { openWork: number; openDispatch: number; openDispatchTitle?: string } {
  const allRows = s.todos ?? [];
  const planOpen = planBasis(allRows, s.sessionId).filter((it) => it.status !== 'completed').length;
  // Wave 33: a dispatch row folds into its plan row while that row is open (same owner, or the worker named in its title): the T row carries the work, so every count stays on the plan's own /N. Once the lead closes the T row and leaves the dispatch row open, it is Stop's open row again.
  const carried = new Set(ownPlan(allRows, s.sessionId).filter((it) => it.status !== 'completed' && (it as { owner?: string }).owner).map((it) => (it as { owner?: string }).owner!));
  const isFolded = (it: object): boolean => (it as { origin?: string }).origin === 'dispatch' && carried.has((it as { owner?: string }).owner ?? '');
  const rows = allRows.filter((it) => !isFolded(it));
  const dispatch = rows.filter((it) => (it as { origin?: string }).origin === 'dispatch');
  // The row the reason names must agree with the TODO beside it: a dispatch row the board already draws done (its worker failed or was killed: `closed · worker killed`) is not what the band asks the lead to close.
  const shown = withOwnerStates(openItems(dispatch, s.sessionId) as { owner?: string }[], owners).filter((it) => it.ownerState !== 'failed');
  const title = openRowName(ownPlan(allRows, s.sessionId), shown[0]); // the first open dispatch row, by its plan row's title (T-id and title), else its agent
  return { openWork: planOpen + openWork(rows.filter((it) => !isPlanItem(it)), s.sessionId), openDispatch: openWork(dispatch, s.sessionId), ...(title ? { openDispatchTitle: title } : {}) };
}

function missionModel(b: BandModel & { maxRows: number }): MissionModel {
  const s = b.snapshot;
  const now = s.now;
  const all = b.live.filter((w) => w.state !== 'parked'); // parked workers are resting
  const active = all.filter((w) => w.state !== 'done');
  const lingering = all.filter((w) => w.state === 'done' && now - w.since <= LINGER_MS);
  const queued = queuedMembers(s).map((name): MissionWorker => ({ name, role: name.includes('-') ? name.replace(/-[^-]*$/, '') : undefined, state: 'queued', secs: 0 })); // dispatched, not listed by the host yet
  const shown = active.length || queued.length ? [...active, ...lingering] : []; // a finished worker lingers only while the wave runs
  const plan = planBasis(s.todos, s.sessionId);
  const owners = workerStates(s, b.live);
  const counted = todoCounts(s); // the one count basis: header, HUD, board and side panel all read the same plan rows
  // Wave 35: with plan rows the band reads the TODO title's own figure (hud.ts planProgress: the HUD's rows over the HUD's agents, a row whose agent ended settled to done), so `todo n/m` and the title can never disagree; a board of dispatch rows only keeps the plan count.
  const progress = ownPlan(s.todos ?? [], s.sessionId).length ? planProgress(ownTodos(s.todos ?? [], s.sessionId), b.live, s.squad, queuedMembers(s), now) : counted;
  const done = Math.min(counted.total, progress.done);
  const total = counted.total;
  const tally = gateTally(withCoreTally(b.gates, b.core)); // the one gates figure: the side panel's `green of total` reads the same groups, the header contract and the dispatch plan included
  const named = (n: string): string => (b.leadName && n === 'lead' ? b.leadName : n); // comms collapse the lead's name to `lead`
  const last = [...s.comms].reverse().find((c) => isMessageKind(c.kind)); // joins and leaves are presence, not messages
  const working = active.filter((w) => w.state === 'working' || w.state === 'blocked');
  const closedOwners = new Set(ownTodos(s.todos, s.sessionId).filter((t) => t.origin === 'dispatch' && t.owner && t.status === 'completed').map((t) => t.owner!));
  const closed = all.filter((w) => w.state === 'failed' && closedOwners.has(w.name)).length; // a failed worker whose dispatch row is closed reads `● 1 closed`, not `■ 1 failed`
  return {
    cols: Math.max(1, b.columns), maxRows: b.maxRows, tick: b.tick, now: spinClock(now, b.tick), // the one spinner clock: the band turns the frame the HUD and the panel turn (critique 19)
    project: boardOf(s), scope: b.team,
    phases: railFor(s, b.lastPhase).ids, phase: railPhase(s, b.lastPhase), blocked: s.phase === 'blocked', ...(tally.stop?.blocked ? { stopGates: tally.stop.gates.length ? tally.stop.gates : ['stop refused'] } : {}),
    done, total, ...openRows(s, owners), todoBlocked: blockedCount(plan, owners),
    // The host's own `isWorking: false` is the turn end: stale lead or plan marks do not keep the band working past it. An agent the host lists as running (a resumed native agent whose activity record still reads done)
    // or one the HUD draws running keeps it working at every width: the band never reads idle beside a turning spinner (wave 33).
    busy: !!b.agentsRunning || s.squad.some((a) => a.name !== 'lead' && a.state === 'running') || (b.working === false ? false : !!b.working || leadBusy(s) || planBusy(plan, owners)),
    queuedIdle: true,
    workers: [...shown.map((w) => missionWorker(w, now)), ...queued],
    note: last ? { from: named(last.from), to: named(last.to), text: last.text, at: hhmm(last.ts), kind: last.kind } : undefined,
    checks: tally.total ? tally.checks : null,
    elapsedSecs: working.length ? Math.round((now - Math.min(...working.map((w) => w.startedAt))) / 1000) : undefined,
    lastRun: lastRun(all, now, ownTodos(s.todos, s.sessionId).filter((t) => t.origin === 'dispatch' && t.owner).map((t) => t.owner!)),
    core: coreCells(b.core, Math.max(1, b.columns), b.ui, total),
    boardRows: b.todoExpanded && ownTodos(s.todos, s.sessionId).length ? ownTodos(s.todos, s.sessionId).length + 1 : 0,
    ctx: s.contextPct > 0 && b.ranSecs === undefined ? Math.min(1, s.contextPct / 100) : undefined, // after a run the turn footer prints `ctx N%`: the band says it once (critique 28)
    rich: b.rich ?? hostEnv().ATLAS_BAND_RICH === '1',
    ui: b.ui ?? uiFromEnv(),
    turnSecs: b.workSecs, ranSecs: b.ranSecs, ...(b.restSecs !== undefined ? { restSecs: b.restSecs } : {}), ...(closed ? { closed } : {}),
    workersInHud: b.workersInHud, eased: b.eased, bar: true, ...(b.motion ? { motion: b.motion } : {}),
  };
}

// ---- paint --------------------------------------------------------------------------

/** A run as a Segment: the live theme's tone colour on the run's own fill or the panel; with NO_COLOR only bold and strike remain. */
const seg = (x: Run, ui: Ui): Segment => {
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  if (ui.color === 'none') return { t: x.t, ...style };
  // A seam of the segmented bar (`▌`, `fg` a fill colour): both halves are fills, so the left half maps like one (never fitted to the panel's text contrast).
  const seam = x.t === '▌' && x.fg !== undefined;
  return { t: x.t, color: seam ? fillHex({ bgHex: x.fg }, ui) : runHex(x, ui.theme, ui.color), bg: fillHex(x, ui), ...style };
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
  const m = { ...missionModel({ ...b, maxRows, ui: b.ui ?? uiFromEnv() }), noWorkerRows: true }; // worker rows fill what the HUD leaves, so they are never counted as the band's reclaimable blanks
  const lines = missionLines(m);
  const blanks = lines.filter((l) => !l.board && !l.keys && l.runs.every((x) => x.t.trim() === '')).length;
  const drawn = lines.reduce((n, l) => n + (l.board ?? 1), 0); // a board slot counts as the rows it holds
  return blanks + Math.max(0, maxRows - drawn);
}

/** The band's lines and the model behind them. `on`: the handlers are wired. The idle footer then always holds its key row, so the row count of an idle band never depends on the width. */
function bandPlan(b: BandModel, on: boolean): { cols: number; ui: Ui; m: MissionModel; lines: Line[] } | null {
  const cols = Math.max(1, b.columns);
  const maxRows = b.maxRows ?? 12;
  const ui = b.ui ?? uiFromEnv();
  if (maxRows < 1) return null; // the HUD can take the whole slot: draw nothing rather than a row past the budget
  const m = missionModel({ ...b, maxRows, ui });
  const idle = !m.workers.some((w) => w.state !== 'done' && w.state !== 'failed');
  const keys = on && idle; // keys while idle; omp has none, a running band keeps its rows for workers. Under 80 columns the row stays and reads blank: the band never moves when the pane docks (critique 26: row 24 to 25)
  const lines = missionLines({ ...m, keysWidth: keys ? KEYS_W : 0, hintWidth: textWidth(BAND_HINT) + 3 });
  // The narrow form (one band row, no footer) still ends in the key row, blank under 80 columns: an idle band is as tall at 79 columns as at 80, so it never moves when the pane docks.
  if (keys && !lines.some((l) => l.keys) && lines.reduce((n, l) => n + (l.board ?? 1), 0) < maxRows) lines.push({ runs: [], keys: true });
  return { cols, ui, m, lines };
}

/** The board slot's rows: the todo list at the rows the layout gave it. */
const boardRowsOf = (b: BandModel, m: MissionModel, cols: number, ui: Ui, rows: number): Segment[][] =>
  todoRows(withOwnerStates(ownTodos(b.snapshot.todos, b.snapshot.sessionId), workerStates(b.snapshot, b.live)), { cols, tick: b.tick, expanded: true, maxRows: rows, now: Math.floor(b.snapshot.now / 1000), nowMs: spinClock(b.snapshot.now, b.tick), ui, rich: m.rich, motion: b.motion });

/** Rows the band draws for `b`: what the slot holds above the HUD (register.ts pads the slot to one height for the whole run from it). */
export function bandRowCount(b: BandModel, on = false): number {
  const plan = bandPlan(b, on);
  return plan ? plan.lines.reduce((n, l) => n + (l.board ? boardRowsOf(b, plan.m, plan.cols, plan.ui, l.board).length : 1), 0) : 0;
}

export function bandTree(els: ClientElements, b: BandModel, on?: BandHandlers): RenderElement {
  const plan = bandPlan(b, !!on);
  if (!plan) return panel(els, [], Math.max(1, b.columns), b.ui ?? uiFromEnv());
  const { cols, ui, m, lines } = plan;
  const rows: Row[] = lines.flatMap((l): Row[] => {
    if (l.board) return boardRowsOf(b, m, cols, ui, l.board);
    if (l.keys && on) return cols >= 80 ? [keysRow(els, l, cols, on, ui)] : [[seg({ t: ' '.repeat(cols), tone: 'text' }, ui)]];
    return [segs(l, ui)];
  });
  return panel(els, rows, cols, ui);
}

/** The band's first-row runs (text and tone) for a model: what the tree paints, for goldens and tone checks. */
export const bandRuns = (b: BandModel): Run[] => bandLines(missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? uiFromEnv() }))[0]?.runs ?? [];

/** The band's run state word (`working`, `done`, `idle`, `blocked`) for a model: the one rule the HUD's idle dimming and the side panel's phase read. */
export const bandKindOf = (b: BandModel) => runStateOf(missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? uiFromEnv() })).kind;
