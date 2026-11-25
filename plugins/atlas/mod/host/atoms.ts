// host/atoms.ts: atoms, shared constants and `$` adapters, and the one mutable state object S.
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import type { EngineInterface } from 'claude-code';
import { SnapshotBuilder } from '../data/snapshot';
import type { AtlasSnapshot, FsLike, SquadAgent } from '../contract';
import { type ClockHold, type KindHold, newKindHold, newRunClock, type RunClock } from '../view/band/band-motion';
import { noteUsage, type UsageKey } from './usage';
import { Motion } from '../motion/motion';
import type { TeamTool } from '../orchestra-types';
import type { WtRow } from '../data/orchestration';

export const PANE_ID = 'atlas';
// The auto open (first render with a viewport) is docked only and asks no keyboard; the band's `open` chip opens a
// 12-row pane on demand, takes focus, and Esc or the `close` chip closes it.
export const PANE_DOCK = { id: PANE_ID, title: 'Atlas', columns: 56 } as const;
export const PANE_ON_DEMAND = { id: PANE_ID, title: 'Atlas', rows: 12, closeOnEscape: true, focus: true } as const;
// The Board (key `o` in the band and the sidebar): its own pane, so the key always has somewhere to draw (L19: the old key
// only flipped an inline fold that needed spare band rows and drew nothing in a short slot).
export const BOARD_ID = 'atlas-board';
export const PANE_BOARD = { id: BOARD_ID, title: 'Board', rows: 14, closeOnEscape: true, focus: true } as const;

// X5: idle is never empty. The pane is opened at rest at every width: the engine places an unasked pane from 144 columns, an open behind the person's prompt (asked) from 110, so the rest-time open asks for it
// at every width (it draws at once from 144) and the first prompt asks again (it docks from 110). One rule, one pane, the status tab first.
const DOCK_ASKED_MIN_COLUMNS = 110;
export const DOCK_MIN_COLUMNS = 144; // the engine places an unasked pane only from 144 columns (UiOpenResult)

/** The rest-time open: a fullscreen terminal, whatever its width (below 144 the engine keeps the pane undrawn until a prompt asks for it). */
export const shouldDockRest = (v: { isFullscreen?: boolean; columns: number }): boolean => v.isFullscreen === true;

/** The pane the first prompt of a run may open: fullscreen and at least 110 columns wide (narrower, an asked pane would sit inline above the prompt). */
export const shouldDockAsked = (v: { isFullscreen?: boolean; columns: number } | undefined): boolean => v !== undefined && v.isFullscreen === true && v.columns >= DOCK_ASKED_MIN_COLUMNS;

/** Toast why a pane waits undrawn, once per open call. */
export function toastUnplaced($: EngineInterface, r: { isPlaced: boolean; reason?: string }): void {
	if (!r.isPlaced && r.reason) $.ui.toast(`atlas: ${r.reason}`, { timeoutMs: 6000 });
}

/** Messages already toasted this session; `--debug` is the only place the debug log shows, so a failure also needs one visible line. */
export const shownFailures = new Set<string>();
const MAX_FAILURE_CHARS = 200;

/** Debug-log a failure and toast it once per distinct message. Module level (a `$` closure inside register() is refused by the host); never throws. */
export function reportFailure($: EngineInterface, message: string, key: UsageKey = 'mod.error.other'): void {
	try {
		void noteUsage($, key); // counted before the once-per-message toast filter: a repeat is still a failure
		$.ui.log(message, { to: 'debug' });
		if (shownFailures.has(message)) return;
		shownFailures.add(message);
		$.ui.toast(message.slice(0, MAX_FAILURE_CHARS), { timeoutMs: 6000 });
	} catch {
		// reporting must never break the hook or boot that is already failing
	}
}

export const flipsOf = (raw: string): string[] => raw.split('\n').filter(Boolean);

export const BAND_SHOWN_MS = 2000; // a band drawn within this long is on screen

/** Every module-level variable more than one host module reads or writes. A module `let` cannot be assigned from an importing module, so they live on one object (never `$`). */
export const S: {
	beatFrame: number;
	sessionStartMs: number | null;
	pluginVersion: string | undefined;
	branchName: string | undefined;
	tmuxHere: boolean | undefined;
	usageWindow: number | null;
	bandDrawnMs: number;
	beatN: number;
	builder: SnapshotBuilder | null;
	wtAt: number;
	wtRows: WtRow[];
	lastRailPhase: string | null;
	muxStdout: string;
	muxAgents: (SquadAgent & TeamTool)[];
	muxFirstSeen: Record<string, number>;
	muxCalls: Record<string, { uses: number; calls: number[] }>;
	sessionUuid: string;
	nameMemo: Record<string, string>;
	gatesBusy: boolean;
	gatesSig: string;
	gatesDirty: boolean;
	gatesUrgent: boolean;
	verdictSig: string;
	gatesRunAt: number;
	lastViewport: { isFullscreen?: boolean; columns: number } | undefined;
	dockWanted: boolean;
	dockedAtRest: boolean;
	soundOn: () => boolean;
	tickTimer: { cancel(): void } | null;
	easeTimer: { cancel(): void } | null;
	motion: Motion | null;
	slotHeld: number;
	hostWorking: boolean;
	stopSeen: boolean;
	hostKnown: boolean;
	armedAt: number | null;
	runClock: RunClock;
	resumedAt: number | null;
	clockHeld: ClockHold;
	runOrigin: { key: number; ms: number } | null;
	lastBeatMs: number;
	frameTimer: { cancel(): void } | null;
	idleFlipped: boolean;
	stopRefused: boolean;
	blockedStreak: number;
	blockedAllow: boolean | null;
	kindHold: KindHold;
	heldKind: KindHold['kind'];
	shownKind: KindHold['kind'];
} = {
	/** The frame the last beat published: the band and the pane renders both read THIS value, so they never turn adjacent frames (critique 26: `⠸`/`⠼`, `◑`/`◓`). */
	beatFrame: 0,
	sessionStartMs: null, // wave 42: the idle health's `up 12:04`: the clock reading at this session's start
	pluginVersion: undefined, // read from plugin.json at boot
	branchName: undefined, // the git branch at boot; absent when git said nothing
	tmuxHere: undefined, // Z4: tmux answered `-V` at boot (the team tab's slot table says yes or no); absent before the probe
	usageWindow: null, // the model's context window from the last session.measure (the figure ctx % is a share of)
	bandDrawnMs: -Infinity, // the engine clock of the band's last render: the idle beat runs only while the band is on screen (a redraw each 200 ms is what keeps this fresh)
	beatN: 0, // beats since boot: the idle redraw rides every 2nd one (5 Hz)
	// ---- module caches left out of $.state ---------------------------------------
	// builder: a class instance with methods, not JSON (a reload leaves it null until
	//   the next session.start). herdrStdout / lastFingerprint: derived perf caches
	//   that refill on the next tick. gatesBusy: a run of atlas_gates.py is in flight.
	//   pendingDrift: a transient queue drained by the next handler that has `$`.
	builder: null,
	wtAt: -Infinity, // last atlas_wt.py status run (ms clock)
	wtRows: [],
	lastRailPhase: null, // last phase the band lit, kept through a blocked reply
	muxStdout: '',
	muxAgents: [],
	muxFirstSeen: {}, // team worker name -> first mux sight (ms), its lane's start
	muxCalls: {}, // team worker name -> pane-log tool_use count and call times (tool-call history)
	sessionUuid: '',
	/** raw host agent id -> display name, kept across rebuilds: a finished agent drops out of the host list but its id must keep resolving. */
	nameMemo: {},
	gatesBusy: false,
	gatesSig: '', // signature of the gate inputs at the last poll
	gatesDirty: false, // a gate input moved since the last run
	gatesUrgent: false, // the Stop verdict moved: the next run skips the GATES_MIN_MS gap
	verdictSig: '', // stat signature of stop-verdict.json at the last poll
	gatesRunAt: -Infinity, // ms clock of the last gate run
	lastViewport: undefined, // the last viewport the band render saw: the prompt hook has none of its own
	dockWanted: false, // set by the first AbovePrompt render with a viewport, acted on by dockTick (renders may not write)
	dockedAtRest: false, // the rest-time open was placed (drawn): the first prompt need not open it again
	soundOn: () => false,
	tickTimer: null,
	easeTimer: null, // running only while a gauge glides
	// ---- motion (mod/motion/motion.ts): row transitions and reveals ----------------------------------------------------------
	// The tick observes the snapshot (only when a rebuild produced a new one), the Motion keeps each row's window, and a timer
	// bumps the band's redraw atom only while a window is open: idle runs no timer and writes nothing. Renders read `motion.ctx`.
	motion: null,
	/** The module's hold across renders: a pure function of the run, reset when no run is on. Test seam: `resetSlotHold`. */
	slotHeld: 0,
	/** The host says a model turn is running (AbovePrompt `isWorking`, noted by the band's render). The tick reads it: a lead-only turn lists no worker, yet the spinner must run. */
	hostWorking: false,
	/** The host's Stop event was allowed (the turn is over): the band reads done on the render that event redraws, before the host's own `isWorking: false` arrives (wave 33). Cleared by the next prompt, or by the render that sees the host flag fall. */
	stopSeen: false,
	/** The band's render has seen the host's own turn flag at least once: before that `hostWorking === false` means unknown, not idle. */
	hostKnown: false,
	/** When the person's last prompt armed the next run clock (`$.clock.now()`); null once a run started from it or it went stale. The run starts at the prompt, not at a later event. */
	armedAt: null,
	/** The run clock (band-motion.ts): wall-clock start, end and frozen duration of Atlas's work, read by every render. */
	runClock: newRunClock(),
	/** When a Stop refusal or a worker's notification last started a host turn (`$.clock.now()`): that turn continues the run that just closed (band-motion resumeOk). A person's prompt clears it. */
	resumedAt: null,
	/** The largest run-clock figure the band or panel showed for the current run: the clock never steps back (band-motion holdClock). */
	clockHeld: null,
	/** The run's start in the snapshot's own clock, fixed the first time a render sees the run: the side panel stamps every event and every bar from it, so the channel tab and the events list read the same `+0:33` (truth 41). A new run starts over. */
	runOrigin: null,
	/** The last beat of the frame loop (`$.clock.now()`), for the watchdog; the loop itself, and whether the rest-to-idle redraw has been made for the current rest. */
	lastBeatMs: 0,
	frameTimer: null,
	idleFlipped: true,
	// Wave 36 (critique 35: one false `blocked` frame while the host still worked): the band reads blocked on the host's Stop event (the completion gate refused: `stopRefused`, or a recorded Stop verdict) or after two consecutive
	// host-idle renders that both computed blocked (data/runstate.ts stepBlocked); never while the host works. The band render updates these; the pane's own band model reads `blockedAllow`.
	stopRefused: false,
	blockedStreak: 0,
	blockedAllow: null,
	kindHold: newKindHold(), // state 38: the last non-idle band word, held 1 s before idle (band-motion stepKind)
	heldKind: null,
	/** The word the band drew on its last render (state 38 hold applied). While it reads `working` the frame loop keeps beating: a working glyph that is on screen must advance every frame, whatever holds the word (truth 41: stoprun-110-2 f0096-f0097 drew `⠹ working` twice for 1.81 s). */
	shownKind: null,
};

// ---- $-carrying top-level functions ----------------------------------------

/** FsLike adapter over the engine's `$.fs` (missing path => undefined, never throws). */
export function engineFs($: EngineInterface): FsLike {
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
export async function statSig($: EngineInterface, path: string): Promise<string> {
	try {
		const s = await $.fs.stat(path);
		return `${s.mtimeMs}:${s.size}`;
	} catch {
		return '-';
	}
}

/** Snapshot root, '' when no board is in view. */
export const rootOf = (snap: AtlasSnapshot | null): string => snap?.root || '';
