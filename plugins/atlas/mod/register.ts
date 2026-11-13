// register.ts — the Atlas mod entrypoint (plan docs/plans/2026-10-09_atlas-mod.md §3).
// Declared by hooks/hooks.json "modules": ["./mod/register.ts"]. Kill switch:
// ATLAS_MOD=off turns every wired handler into a pass-through (register itself
// has no `$`: the flag is read at the first event, session.start). Harness
// constraints honored: static imports only, `$` flows only through top-level
// `function` declarations and handler parameters, and no ui.* call runs unless
// a person is at the prompt (hooks also run headless, surface null).
import { atom, read, update } from 'claude-code';
import type { ClientElements, EngineInterface, On, PluginOptions, RenderElement } from 'claude-code';
import { SnapshotBuilder } from './snapshot';
import type { AgentState, AtlasSnapshot, FsLike, SquadAgent } from './contract';
import { intentToArgv } from './intents';
import { bandTree, hudPhases, railPhase, type BandHandlers, type BandModel } from './band';
import { bandKind } from './pane/band-kind';
import { noteStopVerdict } from './transcript/superseded';
import { composeSlot, hudSlotCap, BAND_MIN_ROWS } from './slot';
import { allSettled, ARM_MS, beatStale, easedNow, FRAME_MS, gaugeTargets, newRunClock, finalSecsOf, restSecsOf, retargetAll, stepRun, workSecsOf, type GaugeMoves, type RunClock } from './band-motion';
import { hudAgents, hudCompactRows, hudFloorRows, hudListsAgents, hudRows, hudWantRows, isAlive, isRunning, namedAgents, segmentOf } from './hud';
import { rowOf, type Segment } from './runs';
import { activeCount, liveWorkers, queuedMembers, withOwnerStates, workerStates } from './data/live';
import { sidebarTree, type GateGroup, type SidebarHandlers } from './pane/sidebar';
import type { GateLine } from './pane/sidebar-types';
import { boardTree } from './todo-panel';
import { leadChannelName } from './data/root';
import { crewSig } from './data/crew';
import { ownTodos, planBasis } from './data/todos';
import { asksUser, gateTally, leadBusy, planBusy, stopRefusal, withCoreTally } from './data/runstate';
import { gatesError, headerGroup, openGateCount, parseGates } from './gates';
import { coreModel, hasCore, type CoreModel, type ReportNote } from './data/core';
import { coreReport } from './core-row';
import { registerRouting, registerCompletion } from './routing';
import { disciplinePrompt, reinforceLine, registerDiscipline, type DisciplineDeps } from './discipline';
import { drawnHeaderTally, forgetDrawnHeaders, headerPhaseOf, noteHeaderPattern, registerRestyle } from './restyle';
import { isOlder, registerNotify } from './notify';
import { forgetPlaced, placeFinished } from './transcript/placed';
import { EASE_FRAMES, EASE_MS, holdSpinFrame, sharedSpinFrame, type Ui } from './atlas-ui';
import { IDLE_AFTER_SECS } from './mission-layout';
import { clearLook, lookOf } from './look';
import { Motion, MotionDriver, reducedMotion } from './motion';
import { motionFeed } from './motion-feed';
import { ownRows, paneExit, paneTool, parseMuxStatus, teamsOf } from './data/mux';
import type { LiveSnapshot, TeamTool } from './orchestra-types';
import { descriptionName, EMPTY_ORCH, onComplete, parseWt, pushCall, type SpawnMeta, type WtRow } from './data/orchestration';

const POLL_MS = 500; // the poll of the cheap stat fingerprint; a rebuild runs only when it moved
const WT_MS = 5000;
const MUX_MS = 5000;
const HERDR_MS = 5000;
const GATES_MS = 30_000; // the backstop run; a change to a gate file runs the gates on the next poll instead
const GATES_MIN_MS = 5000; // the shortest gap between two gate runs (a hook writes the gate DB on every tool call; a run spawns python)
const PANE_ID = 'atlas';
// The auto open (first render with a viewport) is docked only and asks no keyboard; /atlas-cc opens a
// 12-row pane on demand, takes focus, and Esc closes it.
const PANE_DOCK = { id: PANE_ID, title: 'Atlas', columns: 56 } as const;
const PANE_ON_DEMAND = { id: PANE_ID, title: 'Atlas', rows: 12, closeOnEscape: true, focus: true } as const;
// The Board (key `o` in the band and the sidebar): its own pane, so the key always has somewhere to draw (L19: the old key
// only flipped an inline fold that needed spare band rows and drew nothing in a short slot).
export const BOARD_ID = 'atlas-board';
const PANE_BOARD = { id: BOARD_ID, title: 'Board', rows: 14, closeOnEscape: true, focus: true } as const;
/** How long the Stop hook waits after it wrote the refusal: one redraw frame and a margin. */
export const STOP_SETTLE_MS = FRAME_MS + 40;
const TICK_MS = 250; // the slow tick: gauges, motion and the Stop verdict (the spinner has its own beat, FRAME_MS in band-motion.ts, and waits for none of this)
const EASE_STEP_MS = Math.round(EASE_MS / EASE_FRAMES); // a gauge glide redraws at its frame rate, only until it lands
const DOCK_MIN_COLUMNS = 144; // the engine places an unasked pane only from 144 columns (UiOpenResult); below that it waits undrawn
const DOCK_ASKED_MIN_COLUMNS = 110; // an open made behind the person's prompt is "asked": the engine docks it beside a fullscreen transcript from 110 columns

/** The pane opens by itself only docked: a fullscreen terminal wide enough to leave the transcript its room. */
export const shouldDock = (v: { isFullscreen?: boolean; columns: number }): boolean => v.isFullscreen === true && v.columns >= DOCK_MIN_COLUMNS;

/** The pane the first prompt of a run may open: fullscreen and at least 110 columns wide (narrower, an asked pane would sit inline above the prompt). */
export const shouldDockAsked = (v: { isFullscreen?: boolean; columns: number } | undefined): boolean => v !== undefined && v.isFullscreen === true && v.columns >= DOCK_ASKED_MIN_COLUMNS;

/** Toast why a pane waits undrawn, once per open call. */
const toastUnplaced = ($: EngineInterface) => (r: { isPlaced: boolean; reason?: string }): void => {
	if (!r.isPlaced && r.reason) $.ui.toast(`atlas: ${r.reason}`, { timeoutMs: 6000 });
};

/** Messages already toasted this session; `--debug` is the only place the debug log shows, so a failure also needs one visible line. */
const shownFailures = new Set<string>();
const MAX_FAILURE_CHARS = 200;

/** Debug-log a failure and toast it once per distinct message. Module level (a `$` closure inside register() is refused by the host); never throws. */
function reportFailure($: EngineInterface, message: string): void {
	try {
		$.ui.log(message, { to: 'debug' });
		if (shownFailures.has(message)) return;
		shownFailures.add(message);
		$.ui.toast(message.slice(0, MAX_FAILURE_CHARS), { timeoutMs: 6000 });
	} catch {
		// reporting must never break the hook or boot that is already failing
	}
}

// ---- session state ($.state: per-session, versioned, survives module reload) --
// Contract in types/index.d.ts. Render hooks read these (a write redraws exactly
// the readers); only handlers and ticks write, never a render hook. The scan
// that validates `$.state` keys needs each atom declared in the file that reads
// it, so routing.ts, notify.ts and restyle.tsx re-declare the few they read.
// usage: null = 'not measured yet' (rendered `--`); 0 stays a legitimate value.

const isModOn = atom({ plugin: 'atlas', key: 'isModOn' } as const, true); // ATLAS_MOD kill switch, set at session.start
const isInteractive = atom({ plugin: 'atlas', key: 'isInteractive' } as const, false);
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);
const usageState = atom({ plugin: 'atlas', key: 'usage' } as const, { tokens: null, contextPct: null });
const taskAgentsState = atom({ plugin: 'atlas', key: 'taskAgents' } as const, []);
const orchState = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH);
const killedState = atom({ plugin: 'atlas', key: 'killed' } as const, []); // ids/names a TaskStop ended (discipline.ts's tool.call hook writes it)
const headerPhaseState = atom({ plugin: 'atlas', key: 'headerPhase' } as const, null);
const paneOpenedState = atom({ plugin: 'atlas', key: 'paneOpened' } as const, false); // herdrTick stays idle until the pane has been opened
// Sidebar UI state and gate data: handlers write, the Pane render hook reads.
const recipientState = atom({ plugin: 'atlas', key: 'sidebarRecipient' } as const, null);
const expandedState = atom({ plugin: 'atlas', key: 'sidebarExpanded' } as const, null);
const draftState = atom({ plugin: 'atlas', key: 'sidebarDraft' } as const, '');
/** The frame the last beat published: the band and the pane renders both read THIS value, so they never turn adjacent frames (critique 26: `⠸`/`⠼`, `◑`/`◓`). */
let beatFrame = 0;
const spinnerTickState = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0); // written by restyle's ticker; renders only read it
const gaugeState = atom({ plugin: 'atlas', key: 'bandGauges' } as const, null as GaugeMoves | null); // the band gauges' glide, retargeted by the tick when a figure moves
const easeTickState = atom({ plugin: 'atlas', key: 'easeTick' } as const, 0); // bumped by the ease timer so the band redraws each frame of a glide
const lastHeaderState = atom({ plugin: 'atlas', key: 'lastHeader' } as const, null);
const gatesState = atom({ plugin: 'atlas', key: 'gates' } as const, []);
const viewState = atom({ plugin: 'atlas', key: 'atlasView' } as const, 'route'); // docs and the tab strip list route first
const coreState = atom({ plugin: 'atlas', key: 'core' } as const, null); // CoreModel or null; written by coreTick, read by the band and pane renders
const headerTallyState = atom({ plugin: 'atlas', key: 'headerTally' } as const, { ok: 0, total: 0 }); // main-agent answers that opened with the ATLAS header, of all answers

// ---- module caches left out of $.state ---------------------------------------
// builder: a class instance with methods, not JSON (a reload leaves it null until
//   the next session.start). herdrStdout / lastFingerprint: derived perf caches
//   that refill on the next tick. gatesBusy: a run of atlas_gates.py is in flight.
//   pendingDrift: a transient queue drained by the next handler that has `$`.
let builder: SnapshotBuilder | null = null;
let herdrStdout = '';
let lastFingerprint = '';
let rebuildRun: Promise<void> | null = null; // the rebuild in flight (see rebuild)
let rebuildFollow: Promise<void> | null = null; // the one queued run behind it
let rebuildSeq = 0; // stamped on each snapshot; never reset, so a re-boot's snapshots stay newer than any late write
let wtAt = -Infinity; // last atlas_wt.py status run (ms clock)
let wtRows: WtRow[] = [];
let lastRailPhase: string | null = null; // last phase the band lit, kept through a blocked reply
let muxStdout = '';
let muxAgents: (SquadAgent & TeamTool)[] = [];
let muxFirstSeen: Record<string, number> = {}; // team worker name -> first mux sight (ms), its lane's start
let muxCalls: Record<string, { uses: number; calls: number[] }> = {}; // team worker name -> pane-log tool_use count and call times (tool-call history)
let sessionUuid = '';
/** raw host agent id -> display name, kept across rebuilds: a finished agent drops out of the host list but its id must keep resolving. */
let nameMemo: Record<string, string> = {};
let gatesBusy = false;
let gatesSig = ''; // signature of the gate inputs at the last poll
let gatesDirty = false; // a gate input moved since the last run
let gatesUrgent = false; // the Stop verdict moved: the next run skips the GATES_MIN_MS gap
let verdictSig = ''; // stat signature of stop-verdict.json at the last poll
let gatesRunAt = -Infinity; // ms clock of the last gate run
let pendingDrift: string[] = [];
let paneChecked = false; // the unasked pane open is decided once per session
let lastViewport: { isFullscreen?: boolean; columns: number } | undefined; // the last viewport the band render saw: the prompt hook has none of its own
let promptDockDone = false; // the first prompt of the session asked for the docked pane (once)
let paneClosedByPerson = false; // the person closed the pane by hand: no later prompt reopens it
let modOnNow = false; // isModOn, mirrored for a hook that must open the pane before any await
let dockWanted = false; // set by the first AbovePrompt render with a viewport, acted on by dockTick (renders may not write)
let coreSeen: Set<string> | null = null; // verdict `id:status` seen by the last coreTick; null until its first (baseline) read
let coreFinished: Record<string, boolean> = {}; // worker -> its offload had finished at the last coreTick
let coreFiles: Record<string, { key: string; text: string }> = {}; // core inputs keyed by path, re-read only when size or mtime moved
let coreTouched = new Set<string>(); // paths read by the build in progress; the rest are evicted after it
let coreFindingsOk = true; // findings.json was readable in the last buildCore
let soundOn: () => boolean = () => false;
let tickTimer: { cancel(): void } | null = null;
let easeTimer: { cancel(): void } | null = null; // running only while a gauge glides
/** Retarget the band gauges to the snapshot's figures; when one moved, start the glide timer (it stops itself on landing). */
async function easeTick($: EngineInterface, snap: LiveSnapshot): Promise<void> {
	const now = await $.clock.now();
	const cur = await read($, gaugeState);
	const next = retargetAll(cur, gaugeTargets(snap), now);
	if (next === cur) return;
	await update($, gaugeState, () => next);
	if (cur === null || easeTimer) return; // a first sight does not glide
	easeTimer = $.clock.every(EASE_STEP_MS, () => {
		void (async () => {
			const g = await read($, gaugeState);
			await update($, easeTickState, (n) => n + 1);
			if (!g || allSettled(g, await $.clock.now())) {
				easeTimer?.cancel();
				easeTimer = null;
			}
		})().catch(() => undefined);
	});
}

// ---- motion (mod/motion.ts): row transitions and reveals ----------------------------------------------------------
// The tick observes the snapshot (only when a rebuild produced a new one), the Motion keeps each row's window, and a timer
// bumps the band's redraw atom only while a window is open: idle runs no timer and writes nothing. Renders read `motion.ctx`.
let motion: Motion | null = null;
let motionDriver: MotionDriver | null = null;
async function motionTick($: EngineInterface, snap: LiveSnapshot): Promise<void> {
	if (!motionDriver) {
		motion = new Motion(!reducedMotion({ ATLAS_REDUCED_MOTION: await $.env.get('ATLAS_REDUCED_MOTION').catch(() => undefined), NO_COLOR: await $.env.get('NO_COLOR').catch(() => undefined) }));
		motionDriver = new MotionDriver(motion, (ms, fn) => $.clock.every(ms, fn), async () => void (await update($, easeTickState, (n) => n + 1)), () => $.clock.now());
	}
	const now = await $.clock.now();
	// Wave 34: the feed's band reads the run state the render reads (host turn, run clock, live agents), so the done fade steps 231, 151, 114 once and never restarts (114, 151, 114).
	const agents = hudAgents(liveWorkers(snap, snap.now), snap.squad, queuedMembers(snap));
	const run: Partial<BandModel> = {
		...([...agents, ...namedAgents(ownTodos(snap.todos ?? [], snap.sessionId), agents)].some(isAlive) ? { agentsRunning: true } : {}),
		working: hostKnown ? hostWorking : runClock.startMs !== null,
		...(restSecsOf(runClock, now) !== undefined ? { restSecs: restSecsOf(runClock, now)! } : {}),
	};
	await motionDriver.step(snap, async () => motionFeed(snap, await gateGroups($), await read($, coreState), (await lookOf($)).ui, run));
}
/** A spawn-recorded agent the host list does not (yet) contain is only presumed gone after this long. */
const SPAWN_GRACE_MS = 15_000;

// ---- pure helpers (no $) ----------------------------------------------------

/** `<cwd>` basename: the folder half of `<folder>@<branch>`. */
function folderOf(cwd: string): string {
	const stripped = cwd.replace(/\/+$/, '');
	const cut = stripped.lastIndexOf('/');
	return cut < 0 ? stripped : stripped.slice(cut + 1);
}

// The one header parser lives in restyle.tsx; re-exported so existing importers keep working.
export { headerPhaseOf };

/** The header tally as the transcript draws it: every assistant text that opens with the ATLAS header renders a chip, not only the turn's final
 * answer (the one `turn.complete` carries). `msgs` is the lead transcript; `answer` counts once even when the host has not appended it yet. */
export function headerTallyOf(msgs: readonly { role: string; text: string }[], answer: string, snapshot: AtlasSnapshot | null): { ok: number; total: number } {
	const texts = msgs.filter((m) => m.role === 'assistant' && typeof m.text === 'string' && m.text.trim() !== '').map((m) => m.text);
	if (answer.trim() !== '' && texts.at(-1)?.trim() !== answer.trim()) texts.push(answer);
	return { ok: texts.filter((t) => headerPhaseOf(t, snapshot) !== null).length, total: texts.length };
}

/** AgentStatus (d.ts EngineInterface $.agent.list) -> band AgentState. */
const LIST_STATE: Record<string, AgentState> = {
	pending: 'spawning',
	running: 'running',
	waiting: 'input',
	idle: 'idle',
	completed: 'finished',
	failed: 'failed',
	killed: 'dead',
};

/** Host statuses that end a worker, as the turn.complete reason its report is filed under. */
const HOST_DONE: Record<string, string> = { completed: 'answer', failed: 'error', killed: 'error' };

/** Readable persona label for a host agent type (`atlas:explorer` -> explorer). */
const typeLabel = (type: string): string => type.replace(/^atlas:/, '').toLowerCase();

/** First 3 words of an Agent call's description as a label (`list the mod pane` -> `list-the-mod`); '' when none. */
const slugOf = (task: string | undefined): string =>
	(task ?? '').toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 3).join('-') ?? '';

type ListedRow = { id: string; teammateId?: string; description?: string; type?: string; status: string };

/** One squad row per host list row, keyed by the row's unique agent id (never by position). `taken` is the
 * id -> label memo of earlier rebuilds: a label another id already holds gets this id's ordinal (`#2`), so a worker
 * that dropped out of the list can never share a name (and so an activity/lifecycle key) with a new one. */
export function mapListed(
	listed: readonly ListedRow[],
	taskAgents: readonly SquadAgent[],
	meta: Record<string, SpawnMeta> = {},
	taken: Record<string, string> = {},
): { id: string; agent: SquadAgent }[] {
	const used = new Set<string>();
	const personas = listed.map((a) => personaOf(a, taskAgents.find((t) => t.name === a.id), meta[a.id]));
	return listed.map((a, i) => {
		const recorded = taskAgents.find((t) => t.name === a.id);
		const spawned = meta[a.id];
		const persona = personas[i]!;
		const crowded = personas.filter((p) => p === persona).length > 1; // two of one role: the task tells them apart
		const task = (typeof a.description === 'string' && a.description !== '' ? a.description : recorded?.task) || undefined;
		const base = baseLabel(a, spawned, persona, task, crowded);
		const heldByOther = (label: string): boolean => Object.entries(taken).some(([id, held]) => id !== a.id && held === label);
		// A true collision reads as a short ordinal (`alpha-explorer #2`), never a host id.
		let name = base;
		for (let n = 2; used.has(name) || heldByOther(name); n++) name = `${base} #${n}`;
		used.add(name);
		return {
			id: a.id,
			agent: {
				name,
				persona,
				state: LIST_STATE[a.status] ?? 'running',
				source: 'task' as const,
				...(task !== undefined ? { task } : {}),
				...(spawned?.model ? { model: spawned.model } : {}),
			},
		};
	});
}

/** Label for a host agent type; '' for a missing type or the generic `teammate`. */
const listedLabel = (type: string | undefined): string => (typeof type === 'string' && type !== 'teammate' ? typeLabel(type) : '');

/** First non-empty text, else ''. */
const firstText = (...parts: (string | undefined)[]): string => parts.find((p) => !!p) ?? '';

const GENERIC_PERSONAS = new Set(['unknown', 'general-purpose']);

const recordedPersona = (recorded: SquadAgent | undefined): string => (recorded && recorded.persona !== 'unknown' ? recorded.persona : '');

/** Persona label for one listed row. The type recorded at agent.spawn (`atlas:explorer`) is the source of truth; the name-keyed record and the list's own type are fallbacks. */
function personaOf(a: ListedRow, recorded: SquadAgent | undefined, spawned: SpawnMeta | undefined): string {
	return firstText(listedLabel(spawned?.type), recordedPersona(recorded), listedLabel(a.type), 'unknown');
}

const teammateName = (teammateId: string | undefined): string | undefined => teammateId?.split('@')[0];

/** Display label before duplicate-suffixing: spawn name, teammate name, a specific persona, the task slug, then weaker fallbacks. */
function baseLabel(a: ListedRow, spawned: SpawnMeta | undefined, persona: string, task: string | undefined, crowded = false): string {
	return firstText(
		spawned?.name,
		teammateName(a.teammateId),
		descriptionName(task),
		GENERIC_PERSONAS.has(persona) || crowded ? '' : persona,
		slugOf(task),
		persona === 'unknown' ? '' : persona,
		listedLabel(a.type),
		a.id.slice(0, 6),
	);
}

/** Sync the squad's task agents with the host's own agent list (ground truth,
 * catches spawns the agent.spawn hook missed); spawn-recorded entries not yet
 * listed stay as the instant fallback. The host id (`a142cc7b…`) is never the
 * display name: persona recorded at spawn, else the agent type, labels the row and
 * the Agent call's description is its task; the id shows (6 chars) only as a last
 * resort and as a suffix to keep duplicate labels distinct. Liveness is the host list's
 * status alone (the lead being idle says nothing: background agents outlive its turn); a
 * recorded entry the host does not list is finished only once its spawn (meta.at) is older
 * than SPAWN_GRACE_MS at `now`. Never throws. */
export function syncAgentsFromList(
	listed: readonly ListedRow[],
	taskAgents: readonly SquadAgent[],
	meta: Record<string, SpawnMeta> = {},
	now?: number,
	taken: Record<string, string> = {},
	killed: readonly string[] = [],
): SquadAgent[] {
	const known = new Set(listed.map((a) => a.id));
	const live: readonly string[] = ['spawning', 'running', 'idle', 'input', 'stuck'];
	// A TaskStop-ed worker is failed on every surface: never finished by the unlisted-after-grace rule, and failed even where the host list still shows it running.
	const killedNames = new Set([...killed, ...killed.map((id) => taken[id]).filter((n): n is string => n !== undefined)]);
	const rest = taskAgents
		.filter((t) => !known.has(t.name))
		.map((t) => {
			if (killedNames.has(t.name)) return live.includes(t.state) ? { ...t, state: 'failed' as const } : t;
			const at = meta[t.name]?.at;
			return now !== undefined && at !== undefined && now - at > SPAWN_GRACE_MS && live.includes(t.state) ? { ...t, state: 'finished' as const } : t;
		});
	const mapped = mapListed(listed, taskAgents, meta, taken).map((m) =>
		killed.includes(m.id) && live.includes(m.agent.state) ? { ...m.agent, state: 'failed' as const } : m.agent,
	);
	return [...mapped, ...rest].slice(-64);
}

// ---- $-carrying top-level functions ----------------------------------------

/** FsLike adapter over the engine's `$.fs` (missing path => undefined, never throws). */
function engineFs($: EngineInterface): FsLike {
	return {
		read: async (path) => $.fs.read(path).catch(() => undefined),
		stat: async (path) => {
			const s = await $.fs.stat(path).catch(() => undefined);
			return s === undefined ? undefined : { size: s.size, mtimeMs: s.mtimeMs };
		},
		exists: (path) => $.fs.exists(path),
		list: async (path) => (await $.fs.list(path)).map((entry) => entry.name),
	};
}

/** `<path>` signature `mtime:size`, '-' when missing. */
async function statSig($: EngineInterface, path: string): Promise<string> {
	try {
		const s = await $.fs.stat(path);
		return `${s.mtimeMs}:${s.size}`;
	} catch {
		return '-';
	}
}

export type HudState = { maxRows: number; wanted: number; shown: number; fullscreen: boolean; starved?: boolean };
/** `.atlas/.run/statusline-rows.json`: the rows the status line printed last and the rows its full grid would take. */
export type StatuslineRows = { ts: number; rows: number; fullRows: number };
const STATUSLINE_ROWS_FRESH_MS = 15_000;

/** Reads the status line's row report; null when missing, malformed or older than 15 s. */
export async function readStatuslineRows($: EngineInterface, root: string | null | undefined): Promise<StatuslineRows | null> {
	try {
		if (root === undefined || root === null || root === '') return null;
		const text = await $.fs.read(`${root.replace(/\/+$/, '')}/.atlas/.run/statusline-rows.json`);
		const doc = JSON.parse(text) as Partial<StatuslineRows>;
		const { ts, rows, fullRows } = doc;
		if (![ts, rows, fullRows].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
		const age = (await $.clock.now()) - (ts as number);
		return age >= 0 && age < STATUSLINE_ROWS_FRESH_MS ? { ts: ts as number, rows: rows as number, fullRows: fullRows as number } : null;
	} catch {
		return null;
	}
}

/** The AbovePrompt tree, in the one order the slot draws it: the band (with its worker rows) FIRST, then the breathing blank, then the HUD box, then whatever the next hook draws.
 * When the host clips a tree taller than the slot it keeps the top rows and prints `n more` for the rest (index.d.ts, AbovePrompt `maxRows` and `scroll.bodyRows`; inline,
 * `maxRows` is the terminal's height, so the mod cannot know how many rows will survive): a clip then eats the HUD's last rows and never the band (critique 23, live-150-1 f0053, f0055). */
export function atlasSlot(els: ClientElements, parts: { band: RenderElement; gapRow: readonly RenderElement[]; hud: readonly RenderElement[]; pad?: readonly RenderElement[]; lead?: number; below: RenderElement }): RenderElement {
	const lower = [...parts.hud, ...(parts.pad ?? [])]; // `pad`: blank rows under the HUD that keep the slot one height through a run
	return els.Box({ flexDirection: 'column', flexShrink: 0, children: [...(parts.lead ? [els.Box({ height: parts.lead, flexShrink: 0, children: [] })] : []), parts.band, ...parts.gapRow, ...(lower.length > 0 ? [els.Box({ flexDirection: 'column', flexShrink: 0, children: lower })] : []), parts.below] });
}

export { fitHudToBand, hudGapRows, hudSlotCap, slotHold } from './slot';
/** The module's hold across renders: a pure function of the run, reset when no run is on. Test seam: `resetSlotHold`. */
let slotHeld = 0;
export const resetSlotHold = (): void => { slotHeld = 0; };

/** True when the HUD cannot get `wanted` rows even with the status line at its full height. The status line's rows come out of the same capped slot as the HUD, so the current `maxRows` is measured with the line compact; add back what the full grid would take before judging, or the answer flips as soon as the line shrinks. */
export function hudStarvedAtFullLine(maxRows: number, wanted: number, shownAt: (maxRows: number) => number, report: StatuslineRows | null): boolean {
	const extra = report === null ? 0 : Math.max(0, report.fullRows - report.rows);
	return shownAt(Math.max(0, maxRows - extra)) < wanted;
}
/** Rows below the AbovePrompt slot in the inline renderer: prompt box (3), the status line (its reported rows, 5 when unknown), mode line and a blank (2), the blank row Claude Code draws between the content and the prompt's top rule (1), and Claude Code's own agent list ("main" plus one row per running agent). */
export function inlineBelowRows(statusRows: number | null, running: number): number {
	return 3 + (statusRows ?? 5) + 2 + 1 + (running > 0 ? 1 + running : 0);
}

/** The row budget for the HUD and band: the slot's `maxRows` in fullscreen; inline that slot is the whole terminal, so the rows below it come off the viewport height and the smaller wins. */
export function effectiveRows(maxRows: number, viewport: { rows: number; isFullscreen?: boolean } | undefined, statusRows: number | null, running: number): number {
	if (viewport === undefined || viewport.isFullscreen === true || !Number.isFinite(viewport.rows)) return maxRows;
	return Math.max(0, Math.min(maxRows, viewport.rows - inlineBelowRows(statusRows, running)));
}
const HUD_STATE_REFRESH_MS = 5000; // while starved the file is rewritten at least this often so the status line's freshness check holds
let lastHudSig: string | undefined;
let lastHudWriteMs = 0;
/** Test seam: forget the last written state. */
export const resetHudStateSig = (): void => { lastHudSig = undefined; lastHudWriteMs = 0; };

/** Writes `.atlas/.run/hud-state.json` ({ts, maxRows, wanted, shown, fullscreen, starved}) for the Claude Code status line: it shrinks to one row while `starved` (the HUD short of rows even with the full status line). Skips an unchanged state, except a starved one is rewritten every 5 s; temp file + mv, fail soft, never throws out of render. */
export async function publishHudState($: EngineInterface, root: string | null | undefined, state: HudState): Promise<void> {
	try {
		if (root === undefined || root === null || root === '') return;
		const now = await $.clock.now();
		const starved = state.starved ?? state.shown < state.wanted;
		const sig = `${root}|${state.maxRows}|${state.wanted}|${state.shown}|${state.fullscreen}|${starved}`;
		if (sig === lastHudSig && !(starved && now - lastHudWriteMs >= HUD_STATE_REFRESH_MS)) return;
		lastHudSig = sig;
		lastHudWriteMs = now;
		const path = `${root.replace(/\/+$/, '')}/.atlas/.run/hud-state.json`;
		await $.fs.write(`${path}.tmp`, JSON.stringify({ ts: now, ...state, starved }));
		await $.process.run(['mv', '-f', `${path}.tmp`, path]);
	} catch {
		lastHudSig = undefined;
	}
}

/** Todos + channels + board note-file fingerprint: what a rebuild is due on. */
async function dataFingerprint($: EngineInterface): Promise<string> {
	// The host's agent list moves without any data file changing (a subagent
	// finishing writes nothing), so its id:status pairs belong in the fingerprint,
	// or the pane keeps showing a finished agent as running.
	const agentSig = await Promise.resolve()
		.then(() => $.agent.list())
		// A running subagent's transcript tail moves with no data file: re-bucket every 5 s while any runs.
		.then(async (rows) => `${rows.map((a) => `${a.id}:${a.status}`).join(',')}${rows.some((a) => a.status === 'running') ? `@${Math.floor((await $.clock.now()) / MUX_MS)}` : ''}`)
		.catch(() => '-');
	// Usage, header phase and header misses move on session.measure / turn.complete
	// with no file change; they feed the snapshot, so they belong here too.
	const liveSig = `${JSON.stringify(await read($, usageState))}:${await read($, headerPhaseState)}`;
	// Tool calls, moods and comms move on events with no file change; a 5 s bucket
	// keeps the elapsed counters fresh while anything is working.
	const orch = await read($, orchState);
	const acts = Object.entries(orch.activity);
	const orchSig = `${orch.comms.length}:${acts.map(([k, a]) => `${k}=${a.tool ?? ''}${a.toolCount}${a.mood}`).join(',')}:${acts.some(([, a]) => a.tool !== null) ? Math.floor((await $.clock.now()) / 5000) : 0}`;
	const root = (await read($, snapshotState))?.root;
	if (root === undefined || root === null || root === '') return `no-root|${agentSig}|${liveSig}`;
	const base = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	const parts = [agentSig, liveSig, orchSig, await statSig($, `${base}/todos.json`), await statSig($, `${base}/channels.json`), await statSig($, `${base}/findings.json`)];
	try {
		const files = await $.fs.list(`${base}/board`);
		for (const file of files) parts.push(`${file.name}=${await statSig($, `${base}/board/${file.name}`)}`);
	} catch {
		parts.push('no-board');
	}
	parts.push(await crewSig(engineFs($), root));
	return parts.join('|');
}

/** `atlas_wt.py status` rows, re-run at most every WT_MS (git is the slow part). */
async function worktrees($: EngineInterface, now: number): Promise<WtRow[]> {
	if (now - wtAt >= WT_MS) {
		wtAt = now;
		const root = (await read($, snapshotState))?.root;
		const out = root ? await $.process.run(['python3', `${$.plugin.root}/scripts/atlas_wt.py`, '--root', root, 'status']).catch(() => undefined) : undefined;
		wtRows = out?.exitCode === 0 ? parseWt(out.stdout) : [];
	}
	return wtRows;
}

/** Snapshot root, '' when no board is in view. */
const rootOf = (snap: AtlasSnapshot | null): string => snap?.root || '';

/**
 * Rebuild the snapshot from disk + live state; never throws. Serialized: one run in flight, every request that arrives
 * meanwhile (rebuild, mux, herdr and core ticks, the file watcher) shares ONE follow-up run, so two runs never resolve out of
 * order and the last write is always the newest build.
 */
export function rebuild($: EngineInterface): Promise<void> {
	if (rebuildRun === null) {
		const run: Promise<void> = rebuildOnce($).finally(() => {
			if (rebuildRun === run) rebuildRun = null;
		});
		rebuildRun = run;
		return run;
	}
	rebuildFollow ??= rebuildRun.then(() => {
		rebuildFollow = null;
		return rebuild($);
	});
	return rebuildFollow;
}

async function rebuildOnce($: EngineInterface): Promise<void> {
	if (builder === null) return;
	const seq = ++rebuildSeq;
	let listed: { id: string; status: string }[] = [];
	const names: Record<string, string> = {};
	try {
		const rows = await $.agent.list();
		listed = rows.map((a) => ({ id: a.id, status: a.status }));
		const { meta } = await read($, orchState);
		const spawnNow = await $.clock.now();
		const killedIds = await read($, killedState);
		await update($, taskAgentsState, (agents) => {
			// the same rows the squad gets, keyed by host id: a label belongs to one id, never to a list position
			for (const m of mapListed(rows, agents, meta, nameMemo)) names[m.id] = m.agent.name;
			return syncAgentsFromList(rows, agents, meta, spawnNow, nameMemo, killedIds);
		});
		Object.assign(nameMemo, names);
		// A worker the host lists as finished whose own turn.complete never reached us (or carried no
		// agentId): report it by the host row's id, never by guessing a running worker.
		const gone = rows.filter((a) => HOST_DONE[a.status] !== undefined);
		if (gone.length > 0) {
			await update($, orchState, (o) =>
				gone.reduce(
					(acc, a) =>
						acc.stage[a.id] === undefined || acc.stage[a.id] === 'reported'
							? acc
							: onComplete(acc, a.id, { reason: HOST_DONE[a.status] ?? 'answer', answer: '', tokens: 0 }, spawnNow),
					o,
				),
			);
		}
	} catch {
		// no agent list in this harness: keep spawn-recorded agents
	}
	try {
		const now = await $.clock.now();
		const snap = await builder.build({
			headerPhase: await read($, headerPhaseState),
			taskAgents: await read($, taskAgentsState),
			mux: muxAgents,
			herdrStdout,
			usage: await read($, usageState),
			now,
			orch: await read($, orchState),
			names: { ...nameMemo },
			listed,
			wt: await worktrees($, now),
		});
		// The snapshot write redraws the band, pane and restyles that read it. Stamped; an older build never replaces a newer one.
		const stamped = { ...snap, seq };
		const prior: { snap: AtlasSnapshot | null } = { snap: null };
		await update($, snapshotState, (cur) => { prior.snap = cur; return cur && isOlder(cur, stamped) ? cur : stamped; });
		noteHeaderPattern(stamped.contract.headerFirstLinePattern); // the chip draws from this copy, with no state read (restyle.tsx)
		// A worker that finished in this build gets its transcript card now, from the tick that moved its HUD row (critique 14 B3: the host's own row
		// came 5 s later, when the lead took the notification up). An older build never places one.
		if (!prior.snap || !isOlder(prior.snap, stamped)) await placeFinished($, prior.snap, stamped);
		// The board keeps its last good rows; say why they may be stale.
		if (builder.todoError !== undefined) reportFailure($, `atlas: todos.json is ${builder.todoError}, showing the last good board`);
	} catch (err) {
		reportFailure($, `atlas: rebuild failed: ${String(err)}`);
		lastFingerprint = ''; // the poll recorded this build's fingerprint before it ran: forget it so the next tick retries instead of waiting for another file change
		// keep the last good snapshot
	}
}

/** The unasked docked open the first render asked for, done from a tick where `$.state` writes are allowed. */
export async function dockTick($: EngineInterface): Promise<void> {
	if (!dockWanted) return;
	dockWanted = false;
	await update($, paneOpenedState, () => true);
	void $.ui.open(PANE_DOCK).then(toastUnplaced($));
}

/** Signature of what atlas_gates.py reads: the board files under <root>/.atlas/.run and the gate DB (ATLAS_DB, else
 * $ATLAS_HOME/atlas.db, else ~/.atlas/atlas.db) with its WAL, where the hooks record every check. */
async function gatesSigOf($: EngineInterface, root: string): Promise<string> {
	const run = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	// $.env.get takes a literal name (the engine lists the variables a module reads), so each read is spelled out.
	const home = (await $.env.get('ATLAS_HOME').catch(() => undefined)) || undefined;
	const user = (await $.env.get('HOME').catch(() => undefined)) || undefined;
	const db = (await $.env.get('ATLAS_DB').catch(() => undefined)) || (home ? `${home}/atlas.db` : user ? `${user}/.atlas/atlas.db` : '');
	const paths = [`${run}/todos.json`, `${run}/findings.json`, ...(db ? [db, `${db}-wal`] : [])];
	return (await Promise.all(paths.map((p) => statSig($, p)))).join('|');
}

/** The gate groups with this session's Stop verdict (`stop-verdict.json`, completion_gate_core's record) written into the completion group as the `stop-verdict` line
 * atlas_gates.py would print: `Last Stop blocked` with the recorded plain words as its detail, or `Last Stop allowed`. A record without this session leaves the groups as they are. */
export function withStopVerdict(groups: readonly GateGroup[], text: string, session: string): GateGroup[] {
	let rec: { blocked?: unknown; why?: unknown } | undefined;
	try {
		rec = (JSON.parse(text) as { sessions?: Record<string, { blocked?: unknown; why?: unknown }> }).sessions?.[session];
	} catch {
		return [...groups];
	}
	if (!rec) return [...groups];
	const why = (Array.isArray(rec.why) ? rec.why : []).map((x) => String(x).trim()).filter(Boolean);
	const line: GateLine = rec.blocked === true ? { id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: why.join(', ') || 'gate' } : { id: 'stop-verdict', label: 'Last Stop allowed', ok: true };
	if (!groups.some((g) => g.id === 'completion')) return [...groups, { id: 'completion', title: 'Completion gate', lines: [line] }];
	return groups.map((g) => (g.id === 'completion' ? { ...g, lines: [...g.lines.filter((l) => l.id !== 'stop-verdict'), line] } : g));
}

/** One stat of the Stop verdict file. When it moved, the verdict is read and written into the gate groups on THIS call (the band flips to BLOCKED on the refusal's own frame, not
 * after the atlas_gates.py run that follows), and the full run is queued as urgent. Called every poll and, while Atlas works, every spinner tick. */
async function verdictPoll($: EngineInterface, root: string): Promise<void> {
	if (root === '' || sessionUuid === '') return;
	const path = `${root.replace(/\/+$/, '')}/.atlas/.run/stop-verdict.json`;
	const vsig = await statSig($, path);
	const moved = verdictSig !== '' && vsig !== verdictSig;
	verdictSig = vsig;
	if (!moved) return;
	gatesUrgent = gatesDirty = true;
	const text = await $.fs.read(path).catch(() => undefined);
	if (text === undefined) return;
	const groups = await read($, gatesState);
	const next = withStopVerdict(groups, text, sessionUuid);
	if (JSON.stringify(next) !== JSON.stringify(groups)) await update($, gatesState, () => next);
}

/** POLL_MS tick: a change to a gate file marks the gates stale; they re-run on this poll once GATES_MIN_MS has passed since
 * the last run (never wait out the 30 s backstop to show a check that just failed). The run starts here and is not awaited:
 * the tick must not wait on a python run (gatesBusy keeps a second one from starting). */
async function gatesPoll($: EngineInterface): Promise<void> {
	const root = rootOf(await read($, snapshotState));
	if (root === '' || sessionUuid === '') return;
	const sig = await gatesSigOf($, root);
	if (gatesSig !== '' && sig !== gatesSig) gatesDirty = true; // the first sight only records
	gatesSig = sig;
	// The Stop verdict is the one file that is not throttled: a refusal must reach the band on the poll that sees it. One stat per poll.
	await verdictPoll($, root);
	if (gatesDirty && !gatesBusy && (gatesUrgent || (await $.clock.now()) - gatesRunAt >= GATES_MIN_MS)) void runGates($).catch(() => undefined);
}

/** POLL_MS tick: rebuild only when the data files moved. */
export async function rebuildTick($: EngineInterface): Promise<void> {
	await dockTick($);
	if (builder === null) return;
	await gatesPoll($).catch(() => undefined);
	const fingerprint = await dataFingerprint($);
	if (fingerprint === lastFingerprint && (await read($, snapshotState)) !== null) return;
	lastFingerprint = fingerprint;
	await rebuild($);
}

/** 5 s tick: herdr pane status, only once the pane was opened. */
async function herdrTick($: EngineInterface): Promise<void> {
	if (!(await read($, paneOpenedState)) || (await read($, snapshotState)) === null) return;
	const out = await $.process
		.run(['python3', `${$.plugin.root}/scripts/atlas_herdr.py`, 'status'])
		.catch(() => undefined);
	if (out === undefined || out.stdout === herdrStdout) return;
	herdrStdout = out.stdout;
	await rebuild($);
}

/** 5 s tick: atlas_mux.py status of the lead channel's run (`--run` is the channel's last segment) and of each
 * spawn-team team on that channel (a team registers under its team id); rebuilds when the output or a pane tool moved. */
async function muxTick($: EngineInterface): Promise<void> {
	const snap = await read($, snapshotState);
	const root = rootOf(snap);
	if (root === '' || snap === null) return;
	// No early return on zero runs: a reaped team (record archived, no board channel) must clear its lanes, not freeze them.
	const { runs, own } = await muxRuns($, root, snap);
	const outs = await Promise.all(runs.map((r) => muxStatus($, root, r.id)));
	const agents = await withPaneTools($, root, ownRows(outs.flatMap((o, i) => parseMuxStatus(o, runs[i]!.members)), own));
	const sig = `${outs.join('\n')}|${agents.map((a) => `${a.tool ?? ''}${a.lastTool ?? ''}${a.target ?? ''}${a.uses ?? ''}`).join(',')}`;
	if (sig === muxStdout) return;
	muxStdout = sig;
	muxAgents = agents;
	await rebuild($);
}

/** `--root` is a `status` option: before the subcommand argparse rejects it (exit 2), which kept every mux row out. */
async function muxStatus($: EngineInterface, root: string, run: string): Promise<string> {
	const out = await $.process.run(['python3', `${$.plugin.root}/scripts/atlas_mux.py`, 'status', '--run', run, '--root', root]).catch(() => undefined);
	return out?.exitCode === 0 ? out.stdout : '';
}

/** Status runs: the board channel's, plus each `.atlas/.run/teams/<id>.json` team on the board channel or on this
 * session's lead channel (`<folder>@<branch>/lead-<session6>`, which the board channel need not be). `own`: the
 * worker names this session may show (team members and board members). */
async function muxRuns($: EngineInterface, root: string, snap: AtlasSnapshot): Promise<{ runs: { id: string; members: string[] }[]; own: Set<string> }> {
	const dir = `${root.replace(/\/+$/, '')}/.atlas/.run/teams`;
	const names = (await $.fs.list(dir).catch(() => [])).map((e) => e.name).filter((n) => n.endsWith('.json'));
	const records = await Promise.all(names.map(async (name) => ({ name, text: (await $.fs.read(`${dir}/${name}`).catch(() => undefined)) ?? '' })));
	const board = snap.channel ?? '';
	const teams = teamsOf(records, [board, `lead-${snap.sessionId.slice(0, 6)}`]);
	const runs = [...(board ? [{ id: board.split('/').pop() ?? board, members: [] }] : []), ...teams];
	return { runs, own: new Set([...teams.flatMap((t) => t.members), ...snap.members.map((m) => m.name)]) };
}

/** Tool uses that appeared in a pane log since the last read become calls at `now` (the first read is the baseline). */
function paneCalls(name: string, uses: number, now: number): number[] {
	const prev = (muxCalls[name] ??= { uses, calls: [] });
	for (let n = prev.uses; n < uses; n++) prev.calls = pushCall(prev.calls, now);
	prev.uses = uses;
	return prev.calls;
}

/** Running team workers get their tool / last tool / target from their pane log (the pane feed writes stream-json there)
 * and a first-seen start, so the lane's age counts up. ponytail: reads each running worker's whole log every MUX_MS;
 * tail-read if logs grow past a few MB. */
async function withPaneTools($: EngineInterface, root: string, agents: SquadAgent[]): Promise<(SquadAgent & TeamTool)[]> {
	const logs = `${root.replace(/\/+$/, '')}/.atlas/.run/logs`;
	const now = await $.clock.now();
	return Promise.all(
		agents.map(async (a) => {
			const startedAt = (muxFirstSeen[a.name] ??= now);
			if (a.state !== 'running') return a;
			const log = (await $.fs.read(`${logs}/${a.name}.log`).catch(() => undefined)) ?? '';
			const pane = paneTool(log);
			return { ...a, state: paneExit(log) ?? a.state, startedAt, ...pane, calls: paneCalls(a.name, pane.uses ?? 0, now) };
		}),
	);
}

/** Current branch of `cwd` (fall back to 'main' outside a repo). */
async function gitBranch($: EngineInterface, cwd: string): Promise<string> {
	try {
		const out = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']);
		const branch = out.stdout.trim();
		return branch === '' ? 'main' : branch;
	} catch {
		return 'main';
	}
}

/** Gate groups from one atlas_gates.py run; a nonzero exit or bad JSON becomes a single error group. */
function groupsFromRun(out: { exitCode: number; stdout: string; stderr: string }): GateGroup[] {
	try {
		if (out.exitCode !== 0) throw new Error(out.stderr.trim().split('\n').pop() || `exit ${out.exitCode}`);
		return parseGates(out.stdout);
	} catch (err) {
		return [gatesError(err instanceof Error ? err.message : String(err))];
	}
}

/** Run atlas_gates.py and store its groups; a missing script, nonzero exit or bad JSON becomes an error group. Skips when a run is in flight. */
async function runGates($: EngineInterface): Promise<void> {
	if (gatesBusy || sessionUuid === '') return;
	const root = rootOf(await read($, snapshotState));
	if (root === '') return;
	gatesBusy = true;
	gatesRunAt = await $.clock.now();
	gatesDirty = false;
	gatesUrgent = false;
	try {
		const out = await $.process
			.run(['python3', `${$.plugin.root}/scripts/atlas_gates.py`, '--session', sessionUuid, '--root', root, '--json'])
			.catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }));
		const groups = groupsFromRun(out);
		await update($, gatesState, () => groups);
	} finally {
		gatesBusy = false;
	}
}

/** Board root and channel for the note intent. */
const noteContext = (snapshot: AtlasSnapshot | null): { root: string; channel: string | null } => ({ root: rootOf(snapshot), channel: snapshot?.channel ?? null });

/** Argv for posting `note` to `who` through the note intent, or the toast text explaining why not. */
function noteArgv($: EngineInterface, who: string, note: string, snapshot: AtlasSnapshot | null): { argv: string[] } | { error: string } {
	const ctx = noteContext(snapshot);
	const res = intentToArgv({ t: 'note', channel: ctx.channel ?? '', to: who, text: note }, { pluginRoot: $.plugin.root, ...ctx });
	if (!res.ok) return { error: res.error };
	return res.kind === 'cli' ? { argv: res.argv } : { error: 'no board in view' };
}

/** Post the draft to the selected member (the lead when none) through the same note intent /atlas-say uses. */
async function sendNote($: EngineInterface, text: string): Promise<void> {
	const note = text.trim();
	if (note === '') return;
	const who = (await read($, recipientState)) ?? 'lead';
	const built = noteArgv($, who, note, await read($, snapshotState));
	if ('error' in built) {
		$.ui.toast(`atlas: ${built.error}`, { timeoutMs: 6000 });
		return; // the draft stays
	}
	const out = await $.process.run(built.argv);
	if (out.exitCode !== 0) {
		$.ui.toast(`atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}`, { timeoutMs: 6000 });
		return;
	}
	await update($, draftState, () => '');
	$.ui.toast(`Sent to ${who}`, { timeoutMs: 3000 });
	void rebuild($);
}

/** Run a handler's async work, reporting a failure as a toast instead of an unhandled rejection. */
const guardedBy = ($: EngineInterface) => (fn: () => Promise<unknown>): void => {
	fn().catch((err: unknown) => $.ui.toast(`atlas: ${String(err)}`, { timeoutMs: 6000 }));
};

/** Closures for the sidebar view: each writes $.state (never the render hook) and reports failures as toasts. */
function sidebarHandlers($: EngineInterface, surface: 'terminal'): SidebarHandlers {
	const guarded = guardedBy($);
	return {
		selectRecipient: (name) => guarded(() => update($, recipientState, (cur) => (cur === name ? null : name))),
		toggle: (key) => guarded(() => update($, expandedState, (cur) => (cur === key ? null : key))),
		draftChange: (text) => guarded(() => update($, draftState, () => text)),
		send: (text) => guarded(() => sendNote($, text)),
		focus: (key) => guarded(() => $.ui.focus({ requestId: PANE_ID, key })),
		setView: (v) => guarded(() => update($, viewState, () => v)),
		toggleTodos: () => guarded(() => openBoard($)),
		expand: (key) =>
			guarded(async () => {
				await update($, expandedState, () => key);
				await $.ui.focus({ requestId: PANE_ID, key });
			}),
		copy: (text) =>
			guarded(async () => {
				const res = await $.ui.copy({ text, surface });
				$.ui.toast(res.isCopied ? 'Copied' : 'Copy failed', { timeoutMs: 3000 });
			}),
	};
}

/** Open (or retitle and focus) the Board pane; the press behind it is what the engine counts as asked, so it is placed at any width. */
export async function openBoard($: EngineInterface): Promise<void> {
	// A second pane opens as a tab BEHIND the shown one (`focus` is only a request the host refuses while a pane holds the
	// keys), so with the Atlas pane shown the board draws inside it (view `board`); `o` again returns to the route.
	const panes = await (async () => $.ui.panes())().catch(() => []); // a surface that lists none leaves the open below as it was
	if (panes.some((p) => p.id === PANE_ID && p.isShown)) {
		await update($, viewState, (cur) => (cur === 'board' ? 'route' : 'board'));
		void rebuild($);
		return;
	}
	toastUnplaced($)(await $.ui.open(PANE_BOARD));
	void rebuild($); // the board draws the snapshot; refresh it so a press never shows a stale list
}

/** Band footer presses: open (or focus) the pane on a view, as /atlas-cc does, or open the Board pane. */
function bandHandlers($: EngineInterface): BandHandlers {
	const guarded = guardedBy($);
	return {
		openView: (v) =>
			guarded(async () => {
				// Open first, before any await: the engine counts the open as asked (placed at any width) only while the press is behind it.
				const opened = $.ui.open(PANE_ON_DEMAND);
				await update($, viewState, () => v);
				await update($, paneOpenedState, () => true);
				toastUnplaced($)(await opened);
			}),
		toggleTodos: () => guarded(() => openBoard($)),
	};
}

// ---- the Atlas core -----------------------------------------------------------

/** A fresh session: the next coreTick is a baseline again. */
export function resetCore(): void {
	gatesSig = '';
	gatesDirty = false;
	gatesUrgent = false;
	verdictSig = '';
	gatesRunAt = -Infinity;
	coreSeen = null;
	coreFinished = {};
	coreFiles = {};
	coreTouched = new Set();
	coreFindingsOk = true;
}

/** `<path>` text, re-read only when its size or mtime moved; null when missing or unreadable. */
async function readCached($: EngineInterface, path: string): Promise<string | null> {
	const st = await $.fs.stat(path).catch(() => undefined);
	if (st === undefined) return null;
	coreTouched.add(path);
	const key = `${st.size}:${st.mtimeMs}`;
	const hit = coreFiles[path];
	if (hit?.key === key) return hit.text;
	const text = await $.fs.read(path).catch(() => undefined);
	if (text === undefined) return null;
	coreFiles[path] = { key, text };
	return text;
}

const parses = (text: string): boolean => {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
};

/** `readCached`, '' when missing. */
const readGrown = async ($: EngineInterface, path: string): Promise<string> => (await readCached($, path)) ?? '';

const namesIn = async ($: EngineInterface, dir: string, keep: (name: string) => boolean): Promise<string[]> =>
	(await $.fs.list(dir).catch(() => [])).map((e) => e.name).filter(keep).sort();

/** Board `report` notes (ts in epoch seconds) from .atlas/.run/board/*.jsonl. */
function reportsOf(text: string): ReportNote[] {
	return text.split('\n').flatMap((line): ReportNote[] => {
		try {
			const n = JSON.parse(line) as { kind?: unknown; owner?: unknown; text?: unknown; ts?: unknown };
			return n.kind === 'report' && typeof n.owner === 'string' && typeof n.text === 'string' ? [{ owner: n.owner, text: n.text, at: (typeof n.ts === 'number' ? n.ts : 0) * 1000 }] : [];
		} catch {
			return [];
		}
	});
}

/** The lead's transcript rows; empty when the host gives none. */
async function leadMessages($: EngineInterface): Promise<{ role: string; text: string }[]> {
	try {
		const rows = await $.session.messages();
		return Array.isArray(rows) ? (rows as { role: string; text: string }[]) : [];
	} catch {
		return [];
	}
}

/** The core model from the run scratch under the snapshot root; null without a board root. Reads only. */
export async function buildCore($: EngineInterface): Promise<CoreModel | null> {
	const snap = await read($, snapshotState);
	const root = snap?.root || '';
	if (snap === null || root === '') return null;
	const base = `${root.replace(/\/+$/, '')}/.atlas/.run`;
	coreTouched = new Set();
	const teams = await Promise.all((await namesIn($, `${base}/teams`, (n) => n.endsWith('.json'))).map(async (name) => ({ name, text: await readGrown($, `${base}/teams/${name}`) })));
	const logNames = await namesIn($, `${base}/logs`, (n) => n.endsWith('.log') && n !== 'atlas_mux.log');
	const logs: Record<string, string> = {};
	for (const n of logNames) logs[n.replace(/\.log$/, '')] = await readGrown($, `${base}/logs/${n}`);
	const boards = await namesIn($, `${base}/board`, (n) => n.endsWith('.jsonl'));
	const reports = (await Promise.all(boards.map(async (n) => reportsOf(await readGrown($, `${base}/board/${n}`))))).flat();
	const findings = await readCached($, `${base}/findings.json`);
	coreFindingsOk = findings !== null && (findings.trim() === '' || parses(findings)); // a partial write keeps the seen set
	const matrix = await readGrown($, `${$.plugin.root}/contracts/scope-matrix.json`);
	for (const path of Object.keys(coreFiles)) if (!coreTouched.has(path)) delete coreFiles[path];
	return coreModel({
		findings: findings ?? '',
		teams,
		matrix,
		logs,
		reports,
		todos: planBasis(snap.todos ?? [], snap.sessionId), // the plan the band counts: no dispatch rows, advisor notes or other sessions' rows
		header: ((t, d) => ({ ok: Math.max(t.ok, d.ok), total: Math.max(t.total, d.total) }))(await read($, headerTallyState), drawnHeaderTally()), // the transcript draws a chip per text block; turn.complete counts one answer per turn
		openGates: openGateCount(await gateGroups($)),
			// same channels teamsOf gets in muxRuns; dispatches are the orchestration spawn rows this mod already holds
			channels: [snap.channel ?? '', `lead-${(snap.sessionId ?? '').slice(0, 6)}`], // a snapshot without a session id (older fixtures) matches no lead channel
			dispatches: Object.values((await read($, orchState)).meta),
	});
}

/** What moved since the last read: a refuted verdict plays its sound. No host toast for a verdict or an offload that finished (critique 16 C2: the host box over
 * the transcript came back in the stop runs); the core tab says it. The first read does nothing. */
function coreToasts($: EngineInterface, m: CoreModel, seen: Set<string> | null): void {
	if (seen === null) return;
	for (const v of m.verdicts) {
		if (seen.has(`${v.id}:${v.status}`)) continue;
		if (v.status === 'rejected' && soundOn()) void $.audio.play({ asset: 'mod/fx/fail.wav' }).catch(() => {});
	}
}

/** MUX_MS tick (interactive sessions, never from a render): rebuild the core, toast what moved, store it when it changed. */
export async function coreTick($: EngineInterface): Promise<void> {
	try {
		if (!(await read($, isModOn)) || !(await read($, isInteractive))) return;
		const built = await buildCore($);
		if (built === null) return;
		const first = coreSeen === null;
		coreToasts($, built, coreSeen);
		if (coreFindingsOk) coreSeen = new Set(built.verdicts.map((v) => `${v.id}:${v.status}`)); // a missing findings.json keeps the seen set
		coreFinished = Object.fromEntries(built.offload.workers.map((w) => [w.name, w.finished]));
		const model = hasCore(built) ? built : null;
		if (JSON.stringify(model) === JSON.stringify(await read($, coreState)) && !first) return;
		await update($, coreState, () => model);
	} catch (err) {
		reportFailure($, `atlas: core tick failed: ${String(err)}`);
	}
}

/** Script groups plus the header group built from the last answer. */
async function gateGroups($: EngineInterface): Promise<GateGroup[]> {
	return [...(await read($, gatesState)).filter((g) => g.id !== 'header'), headerGroup(await read($, lastHeaderState))];
}

// A /clear raises session.end (reason 'clear') and no session.start, yet resets the
// session's $.state atoms and changes the session id, so the classic SessionStart
// (source 'clear') below runs the same boot again. `booted` keeps the interactive
// flag across the clear (module scope survives it, the atoms do not); `wired` keeps
// commands and the long-lived timers from being registered a second time.
let booted: { interactive: boolean } | null = null;
/** The host says a model turn is running (AbovePrompt `isWorking`, noted by the band's render). The tick reads it: a lead-only turn lists no worker, yet the spinner must run. */
let hostWorking = false;
/** The host's Stop event was allowed (the turn is over): the band reads done on the render that event redraws, before the host's own `isWorking: false` arrives (wave 33). Cleared by the next prompt, or by the render that sees the host flag fall. */
let stopSeen = false;
/** Test seam: the Stop event's mark. */
export const turnEnded = (): boolean => stopSeen;
/** The turn runs when the host says so and its Stop event has not ended it. */
export const hostTurnRunning = (isWorking: boolean | undefined, stopped: boolean): boolean => isWorking === true && !stopped;
/** The band's render has seen the host's own turn flag at least once: before that `hostWorking === false` means unknown, not idle. */
let hostKnown = false;
/** When the person's last prompt armed the next run clock (`$.clock.now()`); null once a run started from it or it went stale. The run starts at the prompt, not at a later event. */
let armedAt: number | null = null;
/** The run clock (band-motion.ts): wall-clock start, end and frozen duration of Atlas's work, read by every render. */
let runClock: RunClock = newRunClock();
/** The last beat of the frame loop (`$.clock.now()`), for the watchdog; the loop itself, and whether the rest-to-idle redraw has been made for the current rest. */
let lastBeatMs = 0;
let frameTimer: { cancel(): void } | null = null;
let idleFlipped = true;

// ---- the blocked flip ------------------------------------------------------------------------------------------------------------
// The panel and the band read the same snapshot and gate groups, so a Stop refusal reaches both on the data's own write. An earlier build held the panel back for 250 ms and drew the rail's last phase
// in the meantime (BLOCKED_HOLD_MS, maskBlocked): that drew a phase the snapshot did not hold, and with a finished plan it drew `done` over a band that read `working` (critique 27, stoprun-150-46d4825c-1
// f0109:6 to f0114:6). The panel now draws the snapshot as it is; this only asks for one more redraw when the blocked state changes, since the panel is not otherwise drawn again when nothing else moves.
let blockedDrawn = false;
/** Test seam: forget the last blocked state drawn. */
export const resetBlockedMark = (): void => { blockedDrawn = false; };
/** Look at the blocked state (the snapshot's phase, the Stop verdict) and redraw when it changed. Called on every beat, tick and poll. */
async function observeBlocked($: EngineInterface): Promise<void> {
	const snap = await read($, snapshotState);
	if (!snap) return;
	const gates = await gateGroups($);
	const blocked = snap.phase === 'blocked' || gateTally(withCoreTally(gates, await read($, coreState))).stop?.blocked === true;
	if (blocked !== blockedDrawn) {
		blockedDrawn = blocked;
		await update($, easeTickState, (n) => n + 1);
	}
}


/** Atlas is working right now: the host turn is running, a worker is live, the lead is mid-turn on its own work, or a plan row runs. The one rule the tick and the band share. */
export function isWorkingNow(snap: LiveSnapshot, host: boolean, hostIdle = false): boolean {
	if (host) return true;
	const live = liveWorkers(snap, snap.now);
	// Wave 34: the band reads `working` exactly when this is true (a squad agent the host lists running counts: the band draws its spinner, so the loop must keep turning it); a queued dispatch never does.
	if (hostIdle) return activeCount(live) > 0 || snap.squad.some((a) => a.name !== 'lead' && a.state === 'running'); // the host says its turn is over: a stale lead tool or plan row no longer holds the run open, only a worker still running does
	return activeCount(live) > 0 || leadBusy(snap) || planBusy(planBasis(snap.todos ?? [], snap.sessionId), workerStates(snap, live));
}

/** One beat of the frame loop: step the run clock, and redraw (one frame, the counter is the shared frame index of every surface) while Atlas works, on the beat a run ends,
 * and once when a finished run rests long enough to read `idle`. It reads the snapshot but waits for no store update, poll or timer of any other kind. */
async function frameBeat($: EngineInterface): Promise<void> {
	const now = await $.clock.now();
	lastBeatMs = now;
	const snap = await read($, snapshotState);
	if (!snap) return;
	const working = isWorkingNow(snap as LiveSnapshot, hostWorking, hostKnown && !hostWorking);
	const before = runClock;
	if (armedAt !== null && now - armedAt > ARM_MS) armedAt = null; // a prompt that started no work arms nothing
	runClock = stepRun(runClock, working, now, { hostIdle: hostKnown && !hostWorking, promptMs: armedAt }); // the host's own turn end ends the run on this beat; the grace stays for fixtures without the flag
	if (before.startMs === null && runClock.startMs !== null) armedAt = null; // the run took the prompt's time as its start
	const ended = before.startMs !== null && runClock.startMs === null;
	if (ended) idleFlipped = false;
	const rest = restSecsOf(runClock, now);
	const flip = !idleFlipped && rest !== undefined && rest >= IDLE_AFTER_SECS;
	if (flip) idleFlipped = true;
	// The Stop verdict is read on the beat, not only on the slower tick, and BEFORE the tick bump: the bump is what redraws the band (the panel also redraws on the gate write itself), so a verdict
	// read after it left the band drawing the old gates for one more beat (critique 25, stoprun-150-3 f0106: `phase blocked` in the panel, `working` in the band; the band flipped at f0107).
	if (working && hostKnown && !verdictBusy) {
		verdictBusy = true;
		try { await verdictFast($, snap as LiveSnapshot); } finally { verdictBusy = false; }
	}
	if (working || runClock.startMs !== null || ended || flip) await update($, spinnerTickState, (n) => { beatFrame = n + 1; return n + 1; });
	await observeBlocked($); // after the bump: the band's redraw is already asked for when the panel's clock starts
}
let verdictBusy = false;
/** (Re)start the frame loop. `$.clock.every` ends when the host refuses a period, so the slow tick and the poll call this when the beat went stale. */
function armFrameLoop($: EngineInterface): void {
	frameTimer?.cancel();
	frameTimer = $.clock.every(FRAME_MS, () => {
		void frameBeat($).catch(() => undefined);
	});
}
/** The watchdog: a loop that stopped beating is armed again. */
async function ensureFrameLoop($: EngineInterface): Promise<void> {
	if (!tickTimer) return; // the session ended: nothing re-arms the loop behind it
	if (!frameTimer || beatStale(lastBeatMs, await $.clock.now())) {
		lastBeatMs = await $.clock.now();
		armFrameLoop($);
	}
}
/** The spinner tick's look at the Stop verdict: the fast path of gatesPoll, plus the urgent gate run it queues (gatesPoll would start it on the next 500 ms poll). */
async function verdictFast($: EngineInterface, snap: LiveSnapshot): Promise<void> {
	await verdictPoll($, rootOf(snap));
	if (gatesDirty && gatesUrgent && !gatesBusy) void runGates($).catch(() => undefined);
}
let wired = false;
async function boot($: EngineInterface, cwd: string, interactive: boolean): Promise<void> {
	shownFailures.clear(); // a new session may toast its failures again
	forgetPlaced(); // and its finish cards are its own
	try {
		booted = { interactive };
		const modOn = (await $.env.get('ATLAS_MOD').catch(() => undefined)) !== 'off';
		await update($, isModOn, () => modOn);
		// A fresh session is unmeasured again, whatever an earlier one measured,
		// and its agents are its own.
		await update($, usageState, () => ({ tokens: null, contextPct: null }));
		await update($, taskAgentsState, () => []);
		await update($, paneOpenedState, () => false);
		paneChecked = false;
		dockWanted = false;
		promptDockDone = false;
		paneClosedByPerson = false;
		modOnNow = modOn;
		clearLook();
		easeTimer?.cancel();
		easeTimer = null;
		await update($, gaugeState, () => null);
		if (!modOn) return;
		await update($, isInteractive, () => interactive);
		builder = new SnapshotBuilder(engineFs($), $.plugin.root);
		const sessionId = await $.session.id();
		sessionUuid = sessionId;
		nameMemo = {};
		muxStdout = '';
		muxAgents = [];
		muxFirstSeen = {};
		muxCalls = {};
		resetCore();
		await update($, headerTallyState, () => ({ ok: 0, total: 0 }));
		forgetDrawnHeaders(); // a new session starts its own tally
		const envRoot = await $.env.get('ATLAS_PROJECT_ROOT');
		await builder.init(cwd, { ATLAS_PROJECT_ROOT: envRoot }, sessionId, folderOf(cwd), await gitBranch($, cwd));
		await rebuild($);
		if (interactive) {
			if (!wired) {
				wired = true;
				await $.command.register({ name: 'atlas-cc', description: 'Open and focus the Atlas sidebar' });
				await $.command.register({ name: 'atlas-say', description: 'Post a note to the lead channel', argumentHint: '<message>' });
				await $.command.register({ name: 'atlas-core', description: 'Show the Atlas core: contract, verdicts, offload, routes' });
				await $.command.register({ name: 'atlas-todo', description: 'Add a todo to the board', argumentHint: '<text>' });
				$.clock.every(POLL_MS, () => {
					void rebuildTick($);
					void ensureFrameLoop($).catch(() => undefined); // a second watchdog: the poll is an interval of its own
				});
				$.clock.every(HERDR_MS, () => {
					void herdrTick($);
				});
				$.clock.every(MUX_MS, () => {
					void muxTick($);
					void coreTick($);
				});
				$.clock.every(GATES_MS, () => {
					void runGates($);
				});
			}
			void runGates($);
			void coreTick($);
			// The frame loop: the spinner and the run clock beat on their own `$.clock.every`, never behind a store update (an idle session writes nothing; see frameBeat).
			lastBeatMs = await $.clock.now();
			armFrameLoop($);
			// The slow tick: gauges, motion and the Stop verdict, plus the loop's watchdog.
			tickTimer?.cancel();
			tickTimer = $.clock.every(TICK_MS, () => {
				void (async () => {
					await ensureFrameLoop($);
					const snap = await read($, snapshotState);
					if (!snap) return;
					await easeTick($, snap as LiveSnapshot);
					await motionTick($, snap as LiveSnapshot);
					if (isWorkingNow(snap as LiveSnapshot, hostWorking)) await verdictFast($, snap as LiveSnapshot); // the Stop hook runs inside a busy turn: read its write on this tick
				})().catch(() => undefined);
			});
		}
	} catch (err) {
		// a failed boot must not block the session
		reportFailure($, `atlas: boot failed: ${String(err)}`);
	}
}

// ---- entrypoint -------------------------------------------------------------

/** The first prompt of a run opens the docked pane where the engine would not (unasked it waits for 144 columns; an open behind the
 * person's prompt is asked and docks from 110). Once per session, never after a by-hand close, never when the band's own dock
 * check already docked it (150), never below 110 or inline. `ui.open` is called before any await: only then is the prompt behind it.
 * Called from the mod's one prompt.submit hook: the host refuses a second unmatched prompt.submit hook and drops the whole mod. */
async function dockOnPrompt($: EngineInterface): Promise<void> {
	if (booted?.interactive === true && modOnNow && !promptDockDone && !paneClosedByPerson && !paneChecked && shouldDockAsked(lastViewport)) {
		promptDockDone = true;
		const opened = $.ui.open(PANE_DOCK);
		try {
			await update($, paneOpenedState, () => true);
			toastUnplaced($)(await opened);
		} catch (err) {
			reportFailure($, `atlas: opening the pane failed: ${String(err)}`);
		}
	}
}

export async function register(on: On, options: PluginOptions): Promise<void> {
	// Sibling registrars, wired by their real signatures. Persona routing pins
	// model/effort and records spawned agents and turn completions; the
	// prompt reinforce line reads the live contract; restyles and turn-boundary
	// notifications read the snapshot from $.state themselves. (register has no
	// `$`, so drift logs queue and a handler drains them.)
	registerRouting(on, {
		getPersonas: (snapshot) => snapshot?.personas ?? [],
		logDrift: (msg) => {
			pendingDrift.push(msg);
		},
	});
	registerCompletion(on);
	const disciplineDeps: DisciplineDeps = {
		reinforce: (snapshot) =>
			snapshot?.contract.headerFirstLinePattern
				? reinforceLine(snapshot.contract.headerTemplate, snapshot.phase)
				: null,
	};
	registerDiscipline(on, disciplineDeps);
	// The one prompt.submit hook (the host refuses a second unmatched one and drops the mod): the pane opens first, before any await.
	on('prompt.submit', async ($, e, next) => {
		stopSeen = false; // a new prompt (or a background task's notification) starts a new turn
		const opening = dockOnPrompt($);
		if ((e as { origin?: { kind?: string } }).origin?.kind !== 'task-notification') armedAt = await $.clock.now().catch(() => null); // a background task's notification is not the person's prompt: it starts no run
		await update($, headerPhaseState, () => null).catch(() => undefined); // a person's prompt starts new work: the last reply's header phase is not this run's (a turn.start also fires for subagents and Stop-hook continuations, which keep it)
		const out = disciplinePrompt($, e, next, disciplineDeps);
		await opening;
		return out;
	});

	registerRestyle(on); // its turn.start only starts the turn clock; the header phase drops at prompt.submit
	registerNotify(on, { soundEnabled: () => options.atlas_mod_sound === true });
	soundOn = () => options.atlas_mod_sound === true;
	// A reload drops the old copy's timers and commands, so the next boot wires them afresh.
	booted = null;
	wired = false;

	// Session boot: read the kill switch, resolve the board, build the first
	// snapshot, start timers and register commands — interactive sessions only;
	// headless (-p / SDK) stays inert.
	on('session.start', async ($, e, next) => {
		await boot($, e.cwd, e.isInteractive);
		return next(e);
	});
	on('classic.SessionStart', async ($, e, next) => {
		if (e.source === 'clear' && booted !== null) await boot($, e.cwd, booted.interactive);
		return next(e);
	});

	// A refused Stop is blocked on the update that carries it (critique 28): the completion gate answers `block`, and this hook writes the refusal into the gate groups and bumps the band's
	// ticks before the host draws its Stop error. The verdict file poll that follows replaces the line with the recorded one.
	on('classic.Stop', async ($, e, next) => {
		const r = await next(e);
		if (!(r && typeof (r as { block?: unknown }).block === 'string') && (await read($, isModOn))) {
			// An allowed Stop is the turn's end: the band, the HUD and the panel read done on the render this write asks for, and the hook holds its return one frame so that render is on screen before the host's prompt returns
			// (wave 33: `working 0:57` stayed one frame past the returned prompt). Agents still running keep the band working (agentsRunning); the lead's stale marks do not.
			stopSeen = true;
			hostWorking = false;
			await update($, spinnerTickState, (n) => n + 1);
			await update($, easeTickState, (n) => n + 1);
			try { await $.clock.sleep(STOP_SETTLE_MS); } catch { /* a refused wait only skips the settle */ }
		}
		if (r && typeof (r as { block?: unknown }).block === 'string') {
			const text = (r as { block: string }).block;
			if (await read($, isModOn)) {
				await update($, gatesState, (g) => stopRefusal(g, text));
				noteStopVerdict(true); // the DONE chips drawn so far are struck on the update that carries the refusal, not on the next pane render (critique 29: an unstruck `done all finished` under the Stop error)
				await update($, spinnerTickState, (n) => n + 1);
				await update($, easeTickState, (n) => n + 1);
				// The write redraws the band at the redraw rate (one frame, FRAME_MS); the host prints its Stop error the moment this hook returns. Hold the return one frame so the band reads blocked
				// before the error is on screen, not a frame after it (critique 29: stoprun-150 f0102 error on rows 16-17, band `working`; blocked at f0103).
				try { await $.clock.sleep(STOP_SETTLE_MS); } catch { /* a refused wait only skips the settle */ }
			}
		}
		return r;
	});

	// Usage figures (tokens / context fill), pushed after each turn.
	on('session.measure', async ($, e, next) => {
		if (await read($, isModOn)) {
			await update($, usageState, (usage) => ({
				tokens: e.context.tokens ?? usage.tokens,
				contextPct: e.context.percent ?? usage.contextPct,
			}));
		}
		return next(e);
	});

	// Header phase from the last main-loop ANSWER (reason 'answer': the matcher
	// keeps this a distinct registration beside routing.ts's un-matchered
	// turn.complete drift counter); task agents finish per turn; queued
	// routing-drift lines reach the debug log here, where `$` exists.
	on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
		try {
			if (!(await read($, isModOn))) return next(e);
			for (const msg of pendingDrift.splice(0)) $.ui.log(msg, { to: 'debug' });
			if (e.agentId === undefined) {
				const phase = headerPhaseOf(e.answer, await read($, snapshotState));
				const declared = asksUser(e.answer) ? ('blocked' as const) : phase; // critique 18 A4: a reply that waits on the person is the blocked phase, whatever its header says
				await update($, headerPhaseState, (prev) => declared ?? prev); // critique 17 A5: a reply with no header line leaves the lead's last declared phase; null reset the route to `research 1/5` beside a DONE chip
				const seen = headerTallyOf(await leadMessages($), e.answer, await read($, snapshotState));
				await update($, headerTallyState, (t) => ({ ok: Math.max(seen.ok, t.ok + +(phase !== null)), total: Math.max(seen.total, t.total + 1) })); // never below the per-turn count: a compacted transcript only shrinks `seen`
				void runGates($);
			} else {
				const agentId = e.agentId;
				await update($, taskAgentsState, (agents) =>
					agents.map((agent) => (agent.name === agentId || agent.name === nameMemo[agentId] ? { ...agent, state: 'finished' as const } : agent)),
				);
			}
		} catch {
			// a drift check never blocks the answer
		}
		return next(e);
	});

	// The band above the prompt: bordered section (terminal + interactive only).
	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, isModOn)) || !(await read($, isInteractive))) return next(e);
		// Unasked, the pane docks only beside a fullscreen transcript wide enough for it; checked once, at the first render that knows the viewport.
		// Drawing is pure: the engine denies a $.state write made while ui.render dispatches (the hook is then
		// skipped and the band never draws). The render only notes the wish; dockTick opens the pane.
		// A terminal that starts below the floor (110 columns) and is widened later docks at the render that first fits;
		// the check ends once it docked, so a pane the person closed stays closed.
		lastViewport = e.viewport ? { isFullscreen: e.viewport.isFullscreen, columns: e.viewport.columns } : undefined;
		if (!paneChecked && e.viewport) {
			dockWanted = shouldDock(e.viewport);
			paneChecked = dockWanted;
		}
		const snapshot = await read($, snapshotState);
		if (snapshot === null) return next(e);
		const gates = await gateGroups($);
		lastRailPhase = railPhase(snapshot, lastRailPhase); // a blocked reply keeps the phase lit before it
		const els = $.ui.resolve(e);
		const columns = e.props.bodyColumns; // measured live: with the docked pane open, viewport.columns is the transcript's own width (143) and bodyColumns is that less the engine's five (138)
		const live = liveWorkers(snapshot, snapshot.now); // one clock for the band, the HUD, the board and the pane
		if (e.props.isWorking === false) stopSeen = false; // the host's flag fell: its own word is the turn's end again
		const turnOn = hostTurnRunning(e.props.isWorking, stopSeen);
			hostWorking = turnOn; // noted for the tick: the host's turn runs even when no worker is listed
		hostKnown = typeof e.props.isWorking === 'boolean';
		// The HUD takes what the band leaves (the band keeps BAND_MIN_ROWS), and never less than its compact form: the band shrinks first.
		// The HUD draws the TODO tree and the Subagents block (rev 4 design); below 80 columns the block gives way to the band's counts.
		const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
		const hudIn = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, lastRailPhase) };
		const look = await lookOf($);
		const tick = Math.max(await read($, spinnerTickState), beatFrame);
		const clockNow = await $.clock.now();
		const release = holdSpinFrame(tick); const frame = sharedSpinFrame() ?? tick; // every surface of this render turns frame `tick`: one index for the band, the HUD rows, the SUBAGENTS header and the pane
		try {
		const motionCtx = motion?.ctx(); // the frame clock the motion driver stamped: the HUD, the band and the pane draw one frame, never a render apart
		const hudView = { cols: columns, tick: frame, ui: look.ui, rich: look.rich, now: snapshot.now, motion: motionCtx }; // the board's clock too: one `claimed_at`, one elapsed
		const hudOn = (await $.env.get('ATLAS_HUD').catch(() => undefined)) !== 'off'; // ATLAS_HUD=off: no TODO / Subagents rows
		const running = agents.some(isRunning);
		const runningCount = agents.filter(isRunning).length;
		const report = await readStatuslineRows($, snapshot.root);
		const slotRows = e.props.maxRows ?? 0;
		const budget = e.props.maxRows === undefined ? 0 : effectiveRows(slotRows, e.viewport, report?.rows ?? null, runningCount); // no slot reported: nothing to cap
		await read($, easeTickState); // a glide bumps it each frame: the band redraws with the value `easedNow` gives for this instant
		const glide = await read($, gaugeState);
		const eased = glide ? easedNow(glide, await $.clock.now()) : undefined;
		const core = await read($, coreState);
		const bandIn = (hudRowsDrawn: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates, working: turnOn || (e.props.isWorking !== false && !stopSeen && runClock.startMs !== null), ...(workSecsOf(runClock, clockNow) !== undefined ? { workSecs: workSecsOf(runClock, clockNow)! } : {}), ...(finalSecsOf(runClock) !== undefined ? { ranSecs: finalSecsOf(runClock)! } : {}), ...(restSecsOf(runClock, clockNow) !== undefined ? { restSecs: restSecsOf(runClock, clockNow)! } : {}), columns, tick: frame, ui: look.ui, rich: look.rich, workersInHud: hudListsAgents(hudRowsDrawn), eased, maxRows, lastPhase: lastRailPhase, core, motion: motionCtx, leadName: snapshot.sessionId ? leadChannelName(snapshot.sessionId, '', '')[0] : undefined });
		const agentsListed = agents.length > 0;
		const want = hudWantRows(hudIn, columns, snapshot.now);
		const runOn = e.props.isWorking === true || runClock.startMs !== null; // the run lasts until its clock closes: the host turn ending a beat before it (a Stop retry, f0129 of stoprun-150-46d4825c-1) must not drop the hold
		const plan = composeSlot({ budget, hasSlot: e.props.maxRows !== undefined, hudOn, runOn, columns, hudIn, hudView, running, agentsListed, orchestrated: snapshot.phaseSource === 'header' || hudIn.todos.length > 0 || agents.length > 0, now: snapshot.now, bandIn, held: slotHeld });
		slotHeld = plan.held;
		const hud = plan.hud;
		const wanted = hudOn ? hudRows(hudIn, { ...hudView, maxRows: 1_000 }).length : 0;
		const compact = hudCompactRows(hudIn, columns);
		const floor = hudFloorRows(hudIn, columns, snapshot.now);
		const shownAt = (cap: number): number => hudOn ? hudRows(hudIn, { ...hudView, maxRows: hudSlotCap(cap, compact, floor, BAND_MIN_ROWS, running, agentsListed, want) }).length : 0;
		const inline = e.viewport !== undefined && e.viewport.isFullscreen !== true;
		void publishHudState($, snapshot.root, {
			maxRows: budget,
			wanted,
			shown: hud.length,
			fullscreen: e.viewport?.isFullscreen === true,
			// fullscreen: the status line shares the slot, so add back what its full grid would take; inline it sits below the slot, so judge with the full grid taken off the viewport
			starved: inline ? shownAt(effectiveRows(slotRows, e.viewport, report?.fullRows ?? null, runningCount)) < wanted : hudStarvedAtFullLine(slotRows, wanted, shownAt, report),
		});
		const band = bandTree(els, plan.band, bandHandlers($));
		// One blank row between the band and the HUD (A3), in the HUD's own panel fill.
		const blankRow = (): RenderElement => rowOf(els, [segmentOf({ t: ' '.repeat(columns), tone: 'text' }, look.ui)], columns);
		const gapRow = Array.from({ length: plan.gap }, blankRow);
		const pad = plan.pad > 0 ? [els.Box({ height: plan.pad, flexShrink: 0, children: [] })] : []; // rows the HUD does not use: empty and unfilled, under the block (never a 234 slab)
		return atlasSlot(els, { band, gapRow, hud: hud.map((r) => rowOf(els, r, columns)), pad, lead: plan.lead, below: await next(e) });
		} finally {
			release();
		}
	});

	// The Atlas sidebar: a native tree, so its elements join the engine's focus ring.
	on('ui.render', { component: 'Pane' }, async ($, e, next) => {
		if (e.surface !== 'terminal' || (e.requestId !== PANE_ID && e.requestId !== BOARD_ID) || !(await read($, isModOn))) return next(e);
		const snapshot = await read($, snapshotState);
		if (snapshot === null) return next(e);
		const look = await lookOf($);
		await read($, easeTickState); // a transition bumps it each frame: the pane redraws mid-transition too
		const paneMotion = motion?.ctx();
		const paneTick = Math.max(await read($, spinnerTickState), beatFrame);
		const releasePane = holdSpinFrame(paneTick); // the same frame index as the band's render
		const paneFrame = sharedSpinFrame() ?? paneTick; // a render already drawing keeps its frame: the pane turns that one
		try {
		if (e.requestId === BOARD_ID) {
			return boardTree($.ui.resolve(e), withOwnerStates(ownTodos(snapshot.todos ?? [], snapshot.sessionId), workerStates(snapshot, liveWorkers(snapshot, snapshot.now))), {
				cols: e.props.bodyColumns, rows: e.props.scroll.bodyRows, tick: paneFrame, now: Math.floor(snapshot.now / 1000), ui: look.ui, rich: look.rich, motion: paneMotion,
			});
		}
		const paneGates = await gateGroups($);
		const paneCore = await read($, coreState);
		const paneNow = await $.clock.now();
		// The band's own run state and run clock (wave 31, critique 29): the panel's phase row and every total on it read what the band reads, built from the band's own inputs.
		const paneLive = liveWorkers(snapshot, snapshot.now);
		const paneAgents = hudAgents(paneLive, snapshot.squad, queuedMembers(snapshot));
		const bandB: BandModel = { snapshot, live: paneLive, gates: paneGates, ...([...paneAgents, ...namedAgents(ownTodos(snapshot.todos ?? [], snapshot.sessionId), paneAgents)].some(isAlive) ? { agentsRunning: true } : {}), working: hostKnown ? hostWorking : runClock.startMs !== null, ...(workSecsOf(runClock, paneNow) !== undefined ? { workSecs: workSecsOf(runClock, paneNow)! } : {}), ...(finalSecsOf(runClock) !== undefined ? { ranSecs: finalSecsOf(runClock)! } : {}), ...(restSecsOf(runClock, paneNow) !== undefined ? { restSecs: restSecsOf(runClock, paneNow)! } : {}), columns: 120, tick: paneFrame, ui: look.ui, rich: look.rich, lastPhase: lastRailPhase, core: paneCore, leadName: snapshot.sessionId ? leadChannelName(snapshot.sessionId, '', '')[0] : undefined };
		const elapsedMs = runClock.startMs !== null ? paneNow - runClock.startMs : runClock.ranMs !== undefined && runClock.endedMs !== undefined ? runClock.ranMs + (paneNow - runClock.endedMs) : undefined;
		const runSecs = runClock.startMs !== null ? workSecsOf(runClock, paneNow) : finalSecsOf(runClock);
		return sidebarTree($.ui.resolve(e), {
			snapshot,
			look: look.ui,
			gates: paneGates,
			core: paneCore,
			run: { kind: bandKind(bandB), ...(runSecs !== undefined ? { secs: runSecs } : {}), ...(elapsedMs !== undefined ? { startMs: snapshot.now - elapsedMs } : {}) },
			ui: { recipient: await read($, recipientState), expanded: await read($, expandedState), draft: await read($, draftState), view: await read($, viewState) },
			columns: e.props.bodyColumns,
			rows: e.props.scroll.bodyRows,
			tick: paneFrame,
			motion: paneMotion,
		}, sidebarHandlers($, e.surface));
		} finally {
			releasePane();
		}
	});

	// A tree this plugin drew was refused: surface it in the debug log and once as a toast.
	on('ui.fault', ($, e, next) => {
		reportFailure($, `atlas: ${e.component} ${e.module} ${e.phase}: ${e.reason}`);
		return next(e);
	});

	// /atlas-cc — open the sidebar and give it the keyboard; it stays until the person closes it.
	on('command.run', { command: 'atlas-cc' }, async ($) => {
		await update($, paneOpenedState, () => true);
		toastUnplaced($)(await $.ui.open(PANE_ON_DEMAND));
		void rebuild($);
		return {};
	});

	// /atlas-core — the four pillars as text; computed fresh, no UI needed.
	on('command.run', { command: 'atlas-core' }, async ($) => {
		const model = await buildCore($).catch(() => null);
		return { text: coreReport(hasCore(model) ? model : null) };
	});

	// Session over: the spinner clock and any gauge glide stop.
	on('session.end', (_$, e, next) => {
		tickTimer?.cancel();
		tickTimer = null;
		frameTimer?.cancel();
		frameTimer = null;
		runClock = newRunClock(); // a new session starts its work clock from nothing
		armedAt = null;
		hostKnown = false;
		idleFlipped = true;
		easeTimer?.cancel();
		easeTimer = null;
		return next(e);
	});

	// The person closed the pane (Esc or the close mark): /atlas-cc opens it again next time.
	on('ui.close', async ($, e, next) => {
		if (e.id === PANE_ID) {
			if (e.origin?.kind === 'person') paneClosedByPerson = true; // a close by hand is final for the session: the prompt hook never reopens it
			await update($, paneOpenedState, () => false);
			await update($, viewState, () => 'route'); // reopen on the first tab, not the last one used
		}
		return next(e);
	});

	// /atlas-say <message> — post a note to the lead channel.
	on('command.run', { command: 'atlas-say' }, async ($, e) => {
		const text = e.args.trim();
		if (text === '') return { text: 'usage: /atlas-say <message>' };
		const snapshot = await read($, snapshotState);
		const res = intentToArgv(
			{ t: 'note', channel: snapshot?.channel ?? '', to: 'lead', text },
			{ pluginRoot: $.plugin.root, root: snapshot?.root ?? '', channel: snapshot?.channel ?? null },
		);
		if (!res.ok || res.kind !== 'cli') return { text: `atlas: ${res.ok ? 'no board in view' : res.error}` };
		const out = await $.process.run(res.argv);
		void rebuild($);
		return { text: out.exitCode === 0 ? 'sent' : `atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}` };
	});

	// /atlas-todo <text> — add a todo at the current phase.
	on('command.run', { command: 'atlas-todo' }, async ($, e) => {
		const text = e.args.trim();
		if (text === '') return { text: 'usage: /atlas-todo <text>' };
		const snapshot = await read($, snapshotState);
		const out = await $.process.run([
			'python3',
			`${$.plugin.root}/scripts/atlas_todo.py`,
			'add',
			'--root',
			snapshot?.root ?? '',
			text,
			'--phase',
			snapshot?.phase ?? 'research',
		]);
		void rebuild($);
		return { text: out.exitCode === 0 ? 'added' : `atlas: ${out.stderr.trim() || `exit ${out.exitCode}`}` };
	});
}
