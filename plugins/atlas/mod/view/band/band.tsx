// band.tsx: the AbovePrompt "Mission Control" band on Claude Code. A thin adapter over mission-layout.ts, the layout
// the omp mission panel draws too: it turns the snapshot, live workers and gate groups into a MissionModel, paints
// each layout run as a Segment in the shared tone palette, fills the board slot with the todo list and appends the
// key buttons to the footer. Pure: `register.ts` hands it the snapshot, workers, gates, columns, row budget and tick.
import type { ClientElements, RenderElement } from 'claude-code';
import { coreCells } from './core-row';
import type { CoreModel } from '../../data/core';
import type { LiveSnapshot } from '../../orchestra-types';
import { endedAt, queuedMembers, workerStates, withOwnerStates, type LiveWorker } from '../../data/live';
import { isPlanItem, openRowName, ownPlan, ownTodos, planBasis, todoCounts } from '../../data/todos';
import { agentTally, hudAgents, planProgress } from '../hud/hud';
import { openItems, openWork } from '../../data/core';
import { blockedCount } from '../board/board-model';
import { deniedCalls } from '../../design/vocab';
import { gateTally, leadBusy, planBusy, ranWorkers, STOP_LINE, withCoreTally } from '../../data/runstate';
import { fillHex, LINGER_MS, preImage, spinClock, surfaceHex, xtermHex, type Ui, runHex } from '../../design/atlas-ui'; import { lookUi, lookRich } from '../../design/look';
import { noteBandFrame, sharedSpinFrame, type MotionCtx, type MotionItem } from '../../motion/motion';
import type { UiState } from '../../design/atlas-ui';
import { bandLines, bandMotionItems, isMessageKind, runStateOf, type Line, type BandKind, type MissionModel, type MissionWorker, type Run, type WorkerState, missionLines, healthStripBg } from './mission-layout';
import type { GateGroup, SidebarView } from '../panel/pane/sidebar-types';
import { fitRuns, rowOf, type Segment } from '../../design/runs';
import { contractRail, railOf, type Rail } from '../../design/rail';
import { chipText, STRIP_TABS } from '../panel/panel-layout';
import { fitText, textWidth } from '../../design/theme';
import { chipStyle, hoverStyle } from '../../input/clickable';
import type { Health, HealthIn } from '../../data/idle-health';

export { planRows } from './mission-layout';

/** `lastPhase`: the last rail phase the caller rendered, lit while the snapshot phase is `blocked`. */
export type BandModel = { /** Wave 42: idle health inputs (uptime, version, branch, tokens, whether the card is open); absent: the band draws no health. */ health?: HealthIn; /** Wave 40: the host turn is on but no run is live (a slash command after a finished run): the band reads `working` with a spinner and no clock, and the closed run is left as it was. */ hostOnly?: boolean; /** State 38: the word held for 1 s before idle (band-motion stepKind). */ heldKind?: BandKind; snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number; maxRows?: number; lastPhase?: string | null; todoExpanded?: boolean; /** The host says a model turn is running (AbovePrompt `isWorking`): true from Enter, before any hook of the turn fires (the first prompt waits on SessionStart hooks), so the band never reads `idle` under a running spinner. */ working?: boolean; /** Seconds the current run of work has lasted (the shared tick counted in seconds): the `0:42` after `working`. */ workSecs?: number; /** Seconds the last run took: the `1:12` after `done`. */ ranSecs?: number; /** Seconds at rest since the last run ended (from IDLE_AFTER_SECS the finished band reads `idle`). */ restSecs?: number; core?: CoreModel | null; team?: string; leadName?: string; ui?: Ui; rich?: boolean; workersInHud?: boolean; /** Wave 36 (debounce): false holds back a blocked verdict that is not confirmed yet (register.ts stepBlocked); absent or true: the band reads it as computed. */ blockedConfirmed?: boolean; /** The HUD draws an agent running (listed, resumed or queued): the band reads working whatever the host's turn flag says. */ agentsRunning?: boolean; eased?: { todo?: number; ctx?: number }; /** Motion view (mod/motion/motion.ts); absent: the resting render. */ motion?: MotionCtx | undefined };
// `team` (omp: the team record's `<class>/<effort>`) is the header's scope label; `leadName` (omp: `lead-<sid6>`)
// names the lead in the message row. Both absent: not shown / `lead`. `ui` (theme, ASCII, colour depth) defaults to the
// environment; `rich` (ATLAS_BAND_RICH=1) draws the tall band when the rows allow. `workersInHud`: the HUD's Subagents
// block is on screen, so the band keeps its counts and lists no worker (a working worker with no tool yet counts as
// running there, as it does in the block). `eased`: the gauge values on screen while a figure glides (band-motion.ts).

const WAVE_GAP_MS = 10_000; // spawns further apart than this start a new wave
/** Brand mark: one cell (the U+25E2 triangles of the mockup draw 2 cells in Ghostty; theme.test.ts). */
export const MARK = '◆';
/** Press handlers: `openView` opens (or focuses) the Atlas pane on a view (the gates pill and the `▸ health` chip, both on the health tab, and the footer tabs); `toggleTodos` opens the Board pane. */
export type BandHandlers = { openView(v: SidebarView): void; toggleTodos(): void; /** Whether the Atlas pane is open (the render reads it from state): the one-row bar draws `open`, or the tab chips and `close`; absent in fixtures that wire no pane controls (the bar then draws none). */ paneOpen?: boolean; /** Closes the Atlas pane; absent: the bar draws no `close` chip. */ closePane?(): void };
/** The band's controls: click chips, one per tab of the side panel's strip (wave 43: no key letters are drawn or bound). */
export const BAND_BUTTONS: readonly { id: SidebarView | 'board'; label: string }[] = STRIP_TABS; // the side panel's own tab strip (wave 36: the first tab, still the `r` key, reads `status`, as its header does)
const buttonWidth = (b: { label: string }): number => textWidth(chipText(b.label)); // a chip is its label with a space each side
const LEFT_MIN = 24; // cells the bar's own runs keep before the control tabs may draw
const KEYS_W = BAND_BUTTONS.reduce((n, b) => n + buttonWidth(b), 0) + BAND_BUTTONS.length - 1; // one cell between chips: each is its own tile

/** `mcp__lean-ctx__ctx_shell` and `mcp__plugin_x_srv__tool` both read as the bare tool name. */
export const shortTool = (tool: string): string => tool.replace(/^mcp__.*__/, '');

/** The snapshot's rail (mod/design/rail.ts, the one rail every surface asks): ids, the lit step and its index. */
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
function openRows(s: LiveSnapshot, owners: ReadonlyMap<string, UiState>): { openWork: number; openDispatch: number; failedDispatch?: number; openDispatchTitle?: string } {
  const allRows = s.todos ?? [];
  const planOpen = planBasis(allRows, s.sessionId).filter((it) => it.status !== 'completed').length;
  // Wave 33: a dispatch row folds into its plan row while that row is open (same owner, or the worker named in its title): the T row carries the work, so every count stays on the plan's own /N. Once the lead closes the T row and leaves the dispatch row open, it is Stop's open row again.
  const carried = new Set(ownPlan(allRows, s.sessionId).filter((it) => it.status !== 'completed' && (it as { owner?: string }).owner).map((it) => (it as { owner?: string }).owner!));
  const isFolded = (it: object): boolean => (it as { origin?: string }).origin === 'dispatch' && carried.has((it as { owner?: string }).owner ?? '');
  const rows = allRows.filter((it) => !isFolded(it));
  const dispatch = rows.filter((it) => (it as { origin?: string }).origin === 'dispatch');
  // The row the reason names must agree with the TODO beside it: a dispatch row the board already draws done (its worker failed or was killed: `closed · worker killed`) is not what the band asks the lead to close.
  // Wave 37: a dispatch whose worker ended failed or was killed is not open: the plan segment counts it as failed (`■1`), so no band reads `1 dispatch open` for it.
  const shown = withOwnerStates(openItems(dispatch, s.sessionId) as { owner?: string }[], owners).filter((it) => it.ownerState !== 'failed');
  const title = openRowName(ownPlan(allRows, s.sessionId), shown[0]); // the first open dispatch row, by its plan row's title (T-id and title), else its agent
  const failedOpen = withOwnerStates(openItems(dispatch, s.sessionId) as { owner?: string }[], owners).length - shown.length; // still open in the store (Stop counts them), but the worker ended: failed, not open
  return { openWork: planOpen + openWork(rows.filter((it) => !isPlanItem(it)), s.sessionId), openDispatch: shown.length, ...(failedOpen > 0 ? { failedDispatch: failedOpen } : {}), ...(title ? { openDispatchTitle: title } : {}) };
}

/** A declared block's reason, when the plan holds one: the evidence of its first blocked row (`needs your approval on the schema change`); none when no blocked row says why. */
const blockedWhyOf = (plan: readonly { status: string; evidence?: string | null }[]): { blockedWhy?: string } => {
  const why = plan.find((t) => t.status === 'blocked' && (t.evidence ?? '').trim() !== '')?.evidence?.replace(/\s+/g, ' ').trim();
  return why ? { blockedWhy: why } : {};
};

/** The wall clock a run ended, `9:27 PM`, from the snapshot clock less the seconds at rest. */

/** Idle health (wave 42): the one model the band, the HUD card and the panel rows read. Only figures the mod holds; context 0 and absent tokens are unknown, never printed. */
/** The longest gate note the health detail carries (a line's own words); a longer one is left to the gates tab. */
const GATE_NOTE_MAX = 32;
function healthOf(b: BandModel, s: LiveSnapshot, tally: ReturnType<typeof gateTally>, progress: { done: number; total: number }, groups: readonly GateGroup[]): Health {
  const h = b.health!;
  const all = b.live.filter((w) => w.state !== 'parked');
  const wave = lastRun(all, s.now, ownTodos(s.todos, s.sessionId).filter((t) => t.origin === 'dispatch' && t.owner).map((t) => t.owner!));
  const total = todoCounts(s).total;
  const ran = b.ranSecs ?? wave?.secs;
  const workers = all.filter((w) => w.state === 'done' || w.state === 'failed').map((w) => ({ name: w.name, state: w.state, secs: Math.max(0, Math.round((endedAt(w, s.now) - w.startedAt) / 1000)) }));
  const group = (id: string): GateGroup | undefined => groups.find((g) => g.id === id);
  const check = (c: ReturnType<typeof gateTally>['checks'][number]): Health['gates']['checks'][number] => {
    const g = group(c.id);
    const lines = g?.lines.filter((l) => l.id !== STOP_LINE) ?? [];
    const first = lines.find((l) => !l.ok) ?? lines[0];
    const said = first ? `${first.label}${first.detail ? `: ${first.detail}` : ''}`.replace(/\s+/g, ' ').trim() : '';
    const note = said.length <= GATE_NOTE_MAX ? said : ''; // a long gate sentence is the gates tab's to show: here it would only be cut
    return { id: c.id, ok: c.ok, ...(c.pending ? { pending: true as const } : {}), ...(g ? { title: g.title, lines: lines.length, pass: lines.filter((l) => l.ok).length } : {}), ...(note ? { note } : {}) };
  };
  return {
    gates: { total: tally.total, green: tally.green, checks: tally.checks.map(check), denied: deniedCalls(groups) },
    ...(h.denyAgeSecs !== undefined ? { denyAgeSecs: h.denyAgeSecs } : {}),
    ...(s.contextPct > 0 ? { ctxPct: s.contextPct } : {}),
    ...(typeof h.tokens === 'number' && h.tokens > 0 ? { tokens: h.tokens } : {}),
    ...(typeof h.window === 'number' && h.window > 0 ? { window: h.window } : {}),
    ...(h.hooks ? { hooks: h.hooks } : {}),
    ...(h.pulse ? { pulse: h.pulse } : {}),
    ...(h.hist ? { hist: h.hist } : {}),
    ...(h.tmux !== undefined ? { tmux: h.tmux } : {}),
    ...(h.upSecs !== undefined ? { upSecs: h.upSecs } : {}),
    ...(h.branch ? { branch: h.branch } : {}),
    ...(h.version ? { version: h.version } : {}),
    ...(ran !== undefined ? { last: { secs: ran, done: Math.min(total, progress.done), total, agents: wave?.workers ?? 0, failed: wave?.failed ?? 0, ...(workers.length ? { workers } : {}), ...(b.restSecs !== undefined ? { endedAgo: Math.max(0, Math.round(b.restSecs)) } : {}) } } : {}),
    ...(h.open ? { open: true } : {}),
    ...(h.panel ? { panel: true } : {}),
  };
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
    phases: railFor(s, b.lastPhase).ids, phase: railPhase(s, b.lastPhase), todoPhases: s.contract.todoPhases, leadPhase: s.phase, blocked: s.phase === 'blocked', ...(s.phase === 'blocked' ? blockedWhyOf(plan) : {}), ...(tally.stop?.blocked ? { stopGates: tally.stop.gates.length ? tally.stop.gates : ['stop refused'] } : {}),
    done, total, ...openRows(s, owners), todoBlocked: blockedCount(plan, owners),
    // The host's own `isWorking: false` is the turn end: stale lead or plan marks do not keep the band working past it. An agent the host lists as running (a resumed native agent whose activity record still reads done)
    // or one the HUD draws running keeps it working at every width: the band never reads idle beside a turning spinner (wave 33).
    busy: !!b.agentsRunning || s.squad.some((a) => a.name !== 'lead' && a.state === 'running') || !!b.hostOnly || (b.working === false ? false : !!b.working || leadBusy(s) || planBusy(plan, owners)),
    queuedIdle: true,
    workers: [...shown.map((w) => missionWorker(w, now)), ...queued],
    tally: agentTally(hudAgents(b.live, s.squad, queuedMembers(s)), ownTodos(s.todos ?? [], s.sessionId)), // state 38: the SUBAGENTS title's own counts
    note: last ? { from: named(last.from), to: named(last.to), text: last.text, at: hhmm(last.ts), kind: last.kind } : undefined,
    checks: tally.total ? tally.checks : null,
    elapsedSecs: working.length ? Math.round((now - Math.min(...working.map((w) => w.startedAt))) / 1000) : undefined,
    lastRun: lastRun(all, now, ownTodos(s.todos, s.sessionId).filter((t) => t.origin === 'dispatch' && t.owner).map((t) => t.owner!)),
    core: coreCells(b.core, Math.max(1, b.columns), b.ui, total),
    ctx: s.contextPct > 0 && b.ranSecs === undefined ? Math.min(1, s.contextPct / 100) : undefined, // after a run the turn footer prints `ctx N%`: the band says it once (critique 28)
    rich: b.rich ?? lookRich(),
    ui: b.ui ?? lookUi(),
    turnSecs: b.hostOnly ? undefined : b.workSecs, ranSecs: b.ranSecs, ...(b.hostOnly ? { hostOnly: true } : {}), ...(b.restSecs !== undefined ? { restSecs: b.restSecs } : {}), ...(closed ? { closed } : {}),
    ...(b.health ? { health: healthOf(b, s, tally, progress, withCoreTally(b.gates, b.core)) } : {}),
    eased: b.eased, bar: true, ...(b.blockedConfirmed === false ? { holdBlocked: true } : {}), ...(b.heldKind ? { heldKind: b.heldKind } : {}), ...(b.motion ? { motion: b.motion } : {}),
  };
}

// ---- paint --------------------------------------------------------------------------

/** Fills whose xterm index the 256-colour table cannot reach by nearest match (97 and 54 are not stable: the host maps their own hex to another index): the wordmark pill and its idle breathing steps (band-motion IDLE_RAMP_256). In 256 colours the host is handed
 * the index's pre-image, so its own downsampler lands on exactly 97 (54 on latte). Other modes keep the hex. */
const PINNED_256: ReadonlyMap<string, number> = new Map([[xtermHex(97), 97], [xtermHex(54), 54], [xtermHex(98), 98], [xtermHex(135), 135], [xtermHex(141), 141], [xtermHex(55), 55], [xtermHex(91), 91], [xtermHex(177), 177], [xtermHex(183), 183]]);
const pinned = (hex: string, ui: Ui): string | undefined => (ui.color === '256' && PINNED_256.has(hex) ? preImage(PINNED_256.get(hex)!) : undefined);

/** A run as a Segment: the live theme's tone colour on the run's own fill or the panel; with NO_COLOR only bold and strike remain. */
const seg = (x: Run, ui: Ui): Segment => {
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  if (ui.color === 'none') return { t: x.t, ...style };
  // A seam of the segmented bar (`▌`, `fg` a fill colour): both halves are fills, so the left half maps like one (never fitted to the panel's text contrast).
  const seam = x.t === '▌' && x.fg !== undefined;
  const capFg = x.fg === undefined ? undefined : pinned(x.fg, ui);
  return { t: x.t, color: seam ? pinned(x.fg!, ui) ?? fillHex({ bgHex: x.fg }, ui) : capFg ?? runHex(x, ui.theme, ui.color), bg: (x.bgHex === undefined ? undefined : pinned(x.bgHex, ui)) ?? fillHex(x, ui), ...style };
};
const segs = (l: Line, ui: Ui): Segment[] => l.runs.map((x) => seg(x, ui));
const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : surfaceHex('panel', ui));

/** The band rows alone (no workers, footer or board), plain text per row: what the tier goldens compare. */
export function bandRows(m: MissionModel): string[] {
  return bandLines(m).map((l) => l.runs.map((x) => x.t).join(''));
}

/** A row that holds clickable runs: the runs around a control are Texts, a control is a Button of one Text with the hover style. The gates pill and the `▸ health` chip both open the pane on its health tab
 * (band-frame.ts keys); a chip of several pieces keys each `<key>#<n>` and the hover scope is the key before the `#`, so the whole chip lights together. */
function pressRow(els: ClientElements, l: Line, cols: number, on: BandHandlers, ui: Ui, tail: { chips: RenderElement[]; width: number } = { chips: [], width: 0 }): RenderElement {
  const ss = segs(l, ui);
  const room0 = Math.max(1, cols - tail.width); // the control chips keep their cells: the left runs are fitted first, so the row never wraps
  let left = room0;
  const children = l.runs.flatMap((x, i): RenderElement[] => {
    const sg = ss[i]!;
    const room = left;
    if (tail.width > 0 && room <= 0) return []; // the control chips took the cells: a run past the room is dropped, not drawn as a bare `…`
    left -= textWidth(sg.t);
    if (!x.press) return fitRuns(els, [sg], room);
    return [els.Button({ key: x.press, plain: true, onPress: () => on.openView('core'), children: [els.Text({ color: sg.color, backgroundColor: sg.bg, bold: true, hover: hoverStyle(ui, x.press.split('#')[0]!), children: fitText(sg.t, room) })] })];
  });
  if (tail.chips.length === 0) return els.Box({ flexDirection: 'row', flexShrink: 0, children });
  const used = Math.min(room0, ss.reduce((n, x) => n + textWidth(x.t), 0));
  const fill = ss[ss.length - 1]?.bg ?? panelBg(ui);
  return els.Box({ flexDirection: 'row', flexShrink: 0, children: [...children, els.Text({ backgroundColor: fill, children: ' '.repeat(Math.max(0, cols - tail.width - used)) }), ...tail.chips] });
}

/** One clickable chip: accent, bold, lit under the pointer (the footer's tabs and the one-row bar's controls share it). */
function chipButton(els: ClientElements, key: string, label: string, onPress: () => void, ui: Ui, bg: string | undefined): RenderElement {
  const accent = ui.color === 'none' ? undefined : runHex({ tone: 'accent' }, ui.theme, ui.color);
  const tile = chipStyle(ui);
  return els.Button({
    key, plain: true, label, onPress,
    children: [els.Text({ color: accent, backgroundColor: tile.backgroundColor ?? bg, ...(tile.underline ? { underline: true } : {}), bold: true, hover: hoverStyle(ui, key), children: chipText(label) })],
  });
}

/** The one-row bar's control group, always at its right end: pane closed: `open`; pane open: the tab chips (when LEFT_MIN cells stay for the left runs, unless the footer key row draws them) and `close`.
 * Press `open` = the pane on its first tab, with focus (PANE_ON_DEMAND); in fullscreen the host docks it, on the main screen it is drawn inline above the prompt. */
function controlChips(els: ClientElements, cols: number, on: BandHandlers, ui: Ui, tabs: boolean): { chips: RenderElement[]; width: number } {
  const bg = panelBg(ui);
  const gap = (): RenderElement => els.Text({ backgroundColor: bg, children: ' ' });
  const press = (id: SidebarView | 'board'): (() => void) => (id === 'board' ? on.toggleTodos : () => on.openView(id));
  const parts: RenderElement[] = [];
  let width = 1; // one cell of margin after the last chip
  const add = (key: string, label: string, onPress: () => void): void => {
    if (parts.length) { parts.push(gap()); width += 1; }
    parts.push(chipButton(els, key, label, onPress, ui, bg));
    width += textWidth(chipText(label));
  };
  if (!on.paneOpen) add('band:open', 'open', () => on.openView(BAND_BUTTONS[0]!.id as SidebarView));
  else {
    if (tabs && cols - KEYS_W - 9 >= LEFT_MIN) for (const b of BAND_BUTTONS) add(`band:${b.id}`, b.label, press(b.id));
    if (on.closePane) add('band:close', 'close', on.closePane);
  }
  return { chips: [...parts, gap()], width };
}

/** The footer with its tab chips (a row of real clickable chips, accent and bold, lit under the pointer). */
function keysRow(els: ClientElements, l: Line, cols: number, on: BandHandlers, ui: Ui): RenderElement {
  const bg = panelBg(ui);
  const strip = l.edge && ui.color !== 'none' ? healthStripBg(ui) : undefined; // under the band the chips sit on the band's own last fill, to its right edge
  const left = segs(l, ui);
  const used = left.reduce((n, x) => n + textWidth(x.t), 0);
  const press = (id: SidebarView | 'board'): (() => void) => (id === 'board' ? on.toggleTodos : () => on.openView(id));
  const buttons = BAND_BUTTONS.flatMap((b, i) => [...(i ? [els.Text({ backgroundColor: strip ?? bg, children: ' ' })] : []), chipButton(els, `band:${b.id}`, b.label, press(b.id), ui, bg)]);
  if (l.edge) {
    // Expert round 4: under the health band the chips are the band's own second row: left-aligned from its left edge, on the band's last fill, to the right edge.
    const fill = strip ?? bg;
    return els.Box({ flexDirection: 'row', flexShrink: 0, children: [...buttons, els.Text({ backgroundColor: fill, children: ' '.repeat(Math.max(0, cols - KEYS_W)) })] });
  }
  const gap = cols - used - KEYS_W - 1; // one cell of margin after the last chip
  return els.Box({
    flexDirection: 'row', flexShrink: 0,
    children: [...fitRuns(els, left, cols), els.Text({ backgroundColor: bg, children: ' '.repeat(Math.max(0, gap)) }), ...buttons, els.Text({ backgroundColor: bg, children: ' ' })],
  });
}

type Row = Segment[] | RenderElement;
const panel = (els: ClientElements, rows: Row[], cols: number, ui: Ui): RenderElement =>
  els.Box({ flexDirection: 'column', flexShrink: 0, backgroundColor: panelBg(ui), children: rows.map((r) => (Array.isArray(r) ? rowOf(els, r, cols) : r)) });

/** Any MissionModel as the band tree (the shared-world goldens and the renderer feed models directly). */
export function missionTree(els: ClientElements, m: MissionModel, todoRows: (rows: number) => Segment[][] = () => [], on?: BandHandlers): RenderElement {
  const ui = m.ui ?? lookUi();
  const rows: Row[] = missionLines(m).flatMap((l): Row[] => (l.keys && on ? [keysRow(els, l, m.cols, on, ui)] : on && l.runs.some((x) => x.press) ? [pressRow(els, l, m.cols, on, ui)] : [segs(l, ui)]));
  return panel(els, rows, m.cols, ui);
}

/** Rows the HUD can have instead of the band's: the breathing blanks it draws at `b.maxRows` (rows of spaces only; a board slot or the key footer never counts),
 * plus the allotted rows it does not draw at all (an idle band stops short of its slot). */
/** What the Motion observes of the band: each state's agent count (the counts the header draws). */
export const bandCountItems = (b: BandModel): MotionItem[] => bandMotionItems(missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? lookUi() }));

export function bandSpareRows(b: BandModel): number {
  const maxRows = b.maxRows ?? 12;
  if (maxRows < 1) return 0;
  const m = { ...missionModel({ ...b, maxRows, ui: b.ui ?? lookUi() }), noWorkerRows: true }; // worker rows fill what the HUD leaves, so they are never counted as the band's reclaimable blanks
  const lines = missionLines(m);
  const blanks = lines.filter((l) => !l.board && !l.keys && l.runs.every((x) => x.t.trim() === '')).length;
  const drawn = lines.reduce((n, l) => n + (l.board ?? 1), 0); // a board slot counts as the rows it holds
  return blanks + Math.max(0, maxRows - drawn);
}

/** The band's lines and the model behind them. `on`: the handlers are wired. The idle footer then always holds its key row, so the row count of an idle band never depends on the width. */
function bandPlan(b: BandModel, on: boolean): { cols: number; ui: Ui; m: MissionModel; lines: Line[]; keysW: number } | null {
  const cols = Math.max(1, b.columns);
  const maxRows = b.maxRows ?? 12;
  const ui = b.ui ?? lookUi();
  if (maxRows < 1) return null; // the HUD can take the whole slot: draw nothing rather than a row past the budget
  const m0 = missionModel({ ...b, maxRows, ui });
  const m: MissionModel = m0.health ? { ...m0, health: { ...m0.health, ...(on ? { button: true } : {}) } } : m0;
  const idle = !m.workers.some((w) => w.state !== 'done' && w.state !== 'failed');
  const keys = on && idle && !m.health; // round 2 (D9): with health the band is one row and the tabs live only in the panel: no key row at any width (no orphan row under the band)
  // keys while idle; omp has none, a running band keeps its rows for workers. Under 80 columns the row stays and reads blank: the band never moves when the pane docks (critique 26: row 24 to 25)
  const keysW = keys ? KEYS_W : 0;
  const lines = missionLines({ ...m, keysWidth: keysW });
  // The narrow form (one band row, no footer) still ends in the key row, blank under 80 columns: an idle band is as tall at 79 columns as at 80, so it never moves when the pane docks.
  if (keys && !lines.some((l) => l.keys) && lines.reduce((n, l) => n + (l.board ?? 1), 0) < maxRows) lines.push({ runs: [], keys: true });
  return { cols, ui, m, lines, keysW };
}

/** Rows the band draws for `b`: what the slot holds above the HUD (register.ts pads the slot to one height for the whole run from it). */
export function bandRowCount(b: BandModel, on = false): number {
  const plan = bandPlan(b, on);
  return plan ? plan.lines.length : 0;
}

const isBandHead = (l: Line): boolean => !l.board && !l.keys;

/** The one-row bar ends in its controls: the control chips and the plan's lines with the first row laid out again in the columns they leave. */
function withControls(els: ClientElements, plan: NonNullable<ReturnType<typeof bandPlan>>, on?: BandHandlers): { tail: ReturnType<typeof controlChips> | undefined; lines: Line[] } {
  const { cols, ui, m, keysW } = plan;
  const tail = on?.paneOpen !== undefined ? controlChips(els, cols, on, ui, !(cols >= 80 && plan.lines.some((l) => l.keys))) : undefined;
  const head = tail ? missionLines({ ...m, cols: cols - tail.width, keysWidth: keysW }).find(isBandHead) : undefined;
  return { tail, lines: head ? plan.lines.map((l, i) => (i === plan.lines.findIndex(isBandHead) ? head : l)) : plan.lines };
}

export function bandTree(els: ClientElements, b: BandModel, on?: BandHandlers): RenderElement {
  const plan = bandPlan(b, !!on);
  if (!plan) return panel(els, [], Math.max(1, b.columns), b.ui ?? lookUi());
  const { cols, ui, m } = plan;
  // The one-row bar ends in its controls: the first row is laid out again in the columns they leave, so its slots are shed whole from the end (frame spec), never cut mid-chip.
  const { tail, lines } = withControls(els, plan, on);
  // State 38: note the spinner frame and the clock the band is drawing right now (motion.ts bandFrame).
  const kind = runStateOf(m).kind;
  noteBandFrame(m.now === undefined ? m.tick : sharedSpinFrame(m.now), kind === 'working' ? (m.hostOnly ? null : m.turnSecs ?? m.elapsedSecs ?? 0) : kind === 'blocked' ? m.ranSecs ?? m.lastRun?.secs ?? m.turnSecs ?? null : m.ranSecs ?? m.lastRun?.secs ?? null, m.now, kind);
  const first = lines.findIndex(isBandHead);
  const rows: Row[] = lines.flatMap((l, i): Row[] => bandRowsOf(els, b, plan, l, on, i === first ? tail : undefined));
  return panel(els, rows, cols, ui);
}

/** One band line as rows. `tail`: the control chips, passed only for the first (head) row. */
function bandRowsOf(els: ClientElements, b: BandModel, plan: NonNullable<ReturnType<typeof bandPlan>>, l: Line, on: BandHandlers | undefined, tail: ReturnType<typeof controlChips> | undefined): Row[] {
  const { cols, ui, m } = plan;
  if (on && tail) return [pressRow(els, l, cols, on, ui, tail)]; // the one-row bar always ends in its controls
  if (l.keys && on) return cols >= 80 ? [keysRow(els, l, cols, on, ui)] : [[seg({ t: ' '.repeat(cols), tone: 'text' }, ui)]];
  if (on && l.runs.some((x) => x.press)) return [pressRow(els, l, cols, on, ui)];
  return [segs(l, ui)];
}

/** The band's first-row runs (text and tone) for a model: what the tree paints, for goldens and tone checks. `on`: with the handlers wired (the `▸ health` chip present). */
export function bandRuns(b: BandModel, on = false): Run[] {
  const m = missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? lookUi() });
  return bandLines(on && m.health ? { ...m, health: { ...m.health, button: true } } : m)[0]?.runs ?? []; // `on`: the handlers are wired, so the health chip is drawn
}

/** The band's run state word (`working`, `done`, `idle`, `blocked`) for a model: the one rule the HUD's idle dimming and the side panel's phase read. */
export const bandKindOf = (b: BandModel) => runStateOf(missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? lookUi() })).kind;

/** The blocked band's own reason and clock, as it prints them (`stop refused`, `1 failed`; the clock the lead segment shows): the blocked card says the same words (transcript/placed.ts noteBlocked). null when the band does not read blocked. */
export function bandBlockedOf(b: BandModel): { reason: string; secs?: number } | null {
  const m = missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? lookUi() });
  const st = runStateOf(m);
  if (st.kind !== 'blocked') return null;
  const secs = m.ranSecs ?? m.lastRun?.secs ?? m.turnSecs;
  return { reason: st.reason.long, ...(secs !== undefined ? { secs } : {}) };
}

/** Wave 42: the idle health the band, the HUD card and the side panel share (band.tsx builds it from the band's own inputs); undefined when the caller passed none. */
export function bandHealth(b: BandModel): Health | undefined {
  return missionModel({ ...b, maxRows: b.maxRows ?? 12, ui: b.ui ?? lookUi() }).health;
}
