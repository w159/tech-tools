// host/hooks.ts: boot and hook registration (every `on(event)` stays in register()).
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import { atom, type EngineInterface, type On, type PluginOptions, read, type RenderElement, update } from 'claude-code';
import { SnapshotBuilder } from '../data/snapshot';
import { bandBlockedOf, bandHealth, bandKindOf, type BandModel, bandTree, hudPhases, railPhase } from '../view/band/band';
import { bandKind } from '../view/panel/pane/band-kind';
import { noteStopVerdict } from '../view/transcript/superseded';
import { composeSlot } from '../view/band/slot';
import { healthCardRows } from '../view/hud/hud-surface';
import { CARD_MORE_KEY } from '../view/hud/status-frame';
import { healthLine } from '../data/idle-health';
import { hookDone, hookStamp, noteHook, resetHookLog } from './hook-log';
import { noteBilling, noteMeasure, resetPulse } from '../data/pulse';
import { healthStripRows, STRIP_ROWS, stripWanted } from '../view/hud/strip-frame';
import { loadHistory } from '../data/history';
import { easedNow, type GaugeMoves, newRunClock, stepKind } from '../view/band/band-motion';
import { hudAgents, hudListsAgents, hudRows, isAlive, isRunning, namedAgents, segmentOf } from '../view/hud/hud';
import { rowOf, type Segment } from '../design/runs';
import { liveWorkers, queuedMembers, withOwnerStates, workerStates } from '../data/live';
import { sidebarTree } from '../view/panel/pane/sidebar';
import { boardTree } from '../view/board/todo-panel';
import { ownTodos } from '../data/todos';
import { asksUser, gateTally, stepBlocked, stopRefusal, withCoreTally } from '../data/runstate';
import { hasCore } from '../data/core';
import { coreReport } from '../view/band/core-row';
import { noteUsage } from './usage';
import { registerCompletion, registerRouting } from '../input/routing';
import { type DisciplineDeps, disciplinePrompt, registerDiscipline, reinforceLine } from './discipline';
import { forgetDrawnHeaders, headerPhaseOf, registerRestyle } from '../view/transcript/restyle';
import { registerNotify } from './notify';
import { forgetPlaced, noteBlocked, noteRunFinal } from '../view/transcript/placed';
import { holdSpinFrame, sharedSpinFrame } from '../design/atlas-ui';
import { clearLook, lookOf } from '../design/look';
import { hoverStyle } from '../input/clickable';
import type { LiveSnapshot } from '../orchestra-types';
import { BOARD_ID, engineFs, flipsOf, PANE_DOCK, PANE_ID, reportFailure, rootOf, S, shouldDockAsked, shouldDockRest, shownFailures, toastUnplaced } from './atoms';
import { folderOf, headerTallyOf } from './agents';
import { GATES_MS, gitBranch, HERDR_MS, herdrTick, MUX_MS, muxTick, noteNotified, POLL_MS, probeTmux, rebuild, rebuildTick, runGates } from './poll';
import { buildCore, coreTick, gateGroups, leadMessages, resetCore } from './core-tick';
import { atlasSlot, bandHandlers, effectiveRows, healthInOf, publishHudState, readStatuslineRows, sidebarHandlers } from './handlers';
import { armFrameLoop, armTick, easeTick, ensureFrameLoop, heldFinal, heldWork, hostTurnRunning, isWorkingNow, motionTick, originOf, runBandModel, STOP_SETTLE_MS, syncHistory, verdictFast, wakeLoops } from './frame';
import { resetReads } from '../data/readinfo';

const isModOn = atom({ plugin: 'atlas', key: 'isModOn' } as const, true); // ATLAS_MOD kill switch, set at session.start
const isInteractive = atom({ plugin: 'atlas', key: 'isInteractive' } as const, false);
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);
const usageState = atom({ plugin: 'atlas', key: 'usage' } as const, { tokens: null, contextPct: null });
const taskAgentsState = atom({ plugin: 'atlas', key: 'taskAgents' } as const, []);

const headerPhaseState = atom({ plugin: 'atlas', key: 'headerPhase' } as const, null);
const paneOpenedState = atom({ plugin: 'atlas', key: 'paneOpened' } as const, false); // herdrTick stays idle until the pane has been opened

const recipientState = atom({ plugin: 'atlas', key: 'sidebarRecipient' } as const, null);
const expandedState = atom({ plugin: 'atlas', key: 'sidebarExpanded' } as const, null);
const draftState = atom({ plugin: 'atlas', key: 'sidebarDraft' } as const, '');

const flipState = atom({ plugin: 'atlas', key: 'sidebarFlips' } as unknown as { readonly plugin: 'atlas'; readonly key: 'sidebarDraft' }, '');

const spinnerTickState = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0); // written by restyle's ticker; renders only read it
const gaugeState = atom({ plugin: 'atlas', key: 'bandGauges' } as const, null as GaugeMoves | null); // the band gauges' glide, retargeted by the tick when a figure moves
const easeTickState = atom({ plugin: 'atlas', key: 'easeTick' } as const, 0); // bumped by the ease timer so the band redraws each frame of a glide

const gatesState = atom({ plugin: 'atlas', key: 'gates' } as const, []);
const viewState = atom({ plugin: 'atlas', key: 'atlasView' } as const, 'route'); // docs and the tab strip list route first
const coreState = atom({ plugin: 'atlas', key: 'core' } as const, null); // CoreModel or null; written by coreTick, read by the band and pane renders
const headerTallyState = atom({ plugin: 'atlas', key: 'headerTally' } as const, { ok: 0, total: 0 }); // main-agent answers that opened with the ATLAS header, of all answers

let pendingDrift: string[] = [];

let paneChecked = false; // the rest-time pane open is decided once per session

let promptDockDone = false; // the first prompt of the session asked for the docked pane (once)
let paneClosedByPerson = false; // the person closed the pane by hand: no later prompt reopens it
let modOnNow = false; // isModOn, mirrored for a hook that must open the pane before any await

// A /clear raises session.end (reason 'clear') and no session.start, yet resets the
// session's $.state atoms and changes the session id, so the classic SessionStart
// (source 'clear') below runs the same boot again. `booted` keeps the interactive
// flag across the clear (module scope survives it, the atoms do not); `wired` keeps
// commands and the long-lived timers from being registered a second time.
let booted: { interactive: boolean } | null = null;

/** The host's own turn flag as the last band render read it (`undefined` before it said). The panel derives the turn from this and `stopSeen` on its own render, so a Stop event reaches both surfaces together (truth 41). */
let hostFlag: boolean | undefined;

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
		S.usageWindow = null;
		await update($, taskAgentsState, () => []);
		await update($, paneOpenedState, () => false);
		paneChecked = false;
		S.dockWanted = false;
		S.dockedAtRest = false;
		promptDockDone = false;
		paneClosedByPerson = false;
		modOnNow = modOn;
		clearLook();
		S.easeTimer?.cancel();
		S.easeTimer = null;
		await update($, gaugeState, () => null);
		if (!modOn) return;
		await update($, isInteractive, () => interactive);
		S.builder = new SnapshotBuilder(engineFs($), $.plugin.root);
		S.sessionStartMs = await $.clock.now(); // wave 42: the idle health's uptime counts from here
		resetHookLog();
		resetPulse();
		resetReads();
		noteHook('session.start', S.sessionStartMs);
		S.healthOpenNow = false;
		S.bandDrawnMs = -Infinity;
		S.beatN = 0;
		S.pluginVersion = await $.fs.read(`${$.plugin.root.replace(/\/+$/, '')}/.claude-plugin/plugin.json`).then((text) => { const v = (JSON.parse(text) as { version?: unknown }).version; return typeof v === 'string' ? v : undefined; }).catch(() => undefined);
		const sessionId = await $.session.id();
		S.sessionUuid = sessionId;
		S.nameMemo = {};
		S.muxStdout = '';
		S.muxAgents = [];
		S.muxFirstSeen = {};
		S.muxCalls = {};
		resetCore();
		await update($, headerTallyState, () => ({ ok: 0, total: 0 }));
		forgetDrawnHeaders(); // a new session starts its own tally
		const envRoot = await $.env.get('ATLAS_PROJECT_ROOT');
		await S.builder.init(cwd, { ATLAS_PROJECT_ROOT: envRoot }, sessionId, folderOf(cwd), await gitBranch($, cwd));
		await rebuild($);
		await loadHistory($, rootOf(await read($, snapshotState)), S.sessionStartMs); // Y1a: the earlier sessions' runs, hook latencies and minutes, or an empty history
		if (interactive) {
			await probeTmux($); // Z4: headless sessions run no process but the branch probe
			if (!wired) {
				wired = true;
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
			S.lastBeatMs = await $.clock.now();
			armFrameLoop($);
			// The slow tick: gauges, motion and the Stop verdict, plus the loop's watchdog.
			// TICK_MS while anything animates, IDLE_TICK_MS at rest; wakeLoops (hook events, a working host turn) brings it back at once.
			armTick($, async () => {
				await ensureFrameLoop($);
				const snap = await read($, snapshotState);
				if (!snap) return;
				await easeTick($, snap as LiveSnapshot);
				await motionTick($, snap as LiveSnapshot);
				await syncHistory($, await $.clock.now());
				if (isWorkingNow(snap as LiveSnapshot, S.hostWorking)) await verdictFast($, snap as LiveSnapshot); // the Stop hook runs inside a busy turn: read its write on this tick
			});
		}
	} catch (err) {
		// a failed boot must not block the session
		reportFailure($, `atlas: boot failed: ${String(err)}`, 'mod.error.boot');
	}
}

// ---- entrypoint -------------------------------------------------------------

/** The first prompt of a run opens the docked pane where the engine would not (unasked it waits for 144 columns; an open behind the
 * person's prompt is asked and docks from 110). Once per session, never after a by-hand close, never below 110 or inline. `ui.open` is called before any await: only then is the prompt behind it.
 * Called from the mod's one prompt.submit hook: the host refuses a second unmatched prompt.submit hook and drops the whole mod. */
async function dockOnPrompt($: EngineInterface): Promise<void> {
	if (booted?.interactive === true && modOnNow && !promptDockDone && !paneClosedByPerson && !S.dockedAtRest && shouldDockAsked(S.lastViewport)) {
		promptDockDone = true;
		const opened = $.ui.open(PANE_DOCK);
		void noteUsage($, 'mod.open.dock');
		try {
			await update($, paneOpenedState, () => true);
			toastUnplaced($, await opened);
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
		S.stopSeen = false; // a new prompt (or a background task's notification) starts a new turn
		S.stopRefused = false;
		const opening = dockOnPrompt($);
		void wakeLoops($).catch(() => undefined);
		const at = await hookStamp($);
		noteHook('prompt.submit', at);
		if ((e as { origin?: { kind?: string } }).origin?.kind !== 'task-notification') { S.armedAt = await $.clock.now().catch(() => null); S.resumedAt = null; } // a background task's notification is not the person's prompt: it starts no run
		else { S.resumedAt = await $.clock.now().catch(() => null); await noteNotified($, (e as { text?: string }).text ?? ''); } // the notification that draws the card also ends the worker in the HUD rows, on this very render
		await update($, headerPhaseState, () => null).catch(() => undefined); // a person's prompt starts new work: the last reply's header phase is not this run's (a turn.start also fires for subagents and Stop-hook continuations, which keep it)
		await hookDone($, 'prompt.submit', at); // N1: the mod's own work before it hands the prompt on
		const out = disciplinePrompt($, e, next, disciplineDeps);
		await opening;
		return out;
	});

	registerRestyle(on); // its turn.start only starts the turn clock; the header phase drops at prompt.submit
	registerNotify(on, { soundEnabled: () => options.atlas_mod_sound === true });
	S.soundOn = () => options.atlas_mod_sound === true;
	// A reload drops the old copy's timers and commands, so the next boot wires them afresh.
	booted = null;
	wired = false;

	// Session boot: read the kill switch, resolve the board, build the first
	// snapshot, start timers and register commands — interactive sessions only;
	// headless (-p / SDK) stays inert.
	on('session.start', async ($, e, next) => {
		await boot($, e.cwd, e.isInteractive); // boot time is the session's setup, not a hook's work: no N1 latency sample, so a slow boot never paints the hook p50 amber at idle
		return next(e);
	});
	on('classic.SessionStart', async ($, e, next) => {
		if (e.source === 'clear' && booted !== null) await boot($, e.cwd, booted.interactive);
		return next(e);
	});

	// A refused Stop is blocked on the update that carries it (critique 28): the completion gate answers `block`, and this hook writes the refusal into the gate groups and bumps the band's
	// ticks before the host draws its Stop error. The verdict file poll that follows replaces the line with the recorded one.
	on('classic.Stop', async ($, e, next) => {
		const at = await hookStamp($);
		noteHook('classic.Stop', at);
		await hookDone($, 'classic.Stop', at);
		const r = await next(e);
		if (!(r && typeof (r as { block?: unknown }).block === 'string') && (await read($, isModOn))) {
			// An allowed Stop is the turn's end: the band, the HUD and the panel read done on the render this write asks for, and the hook holds its return one frame so that render is on screen before the host's prompt returns
			// (wave 33: `working 0:57` stayed one frame past the returned prompt). Agents still running keep the band working (agentsRunning); the lead's stale marks do not.
			S.stopSeen = true;
			S.hostWorking = false;
			await update($, spinnerTickState, (n) => n + 1);
			await update($, easeTickState, (n) => n + 1);
			try { await $.clock.sleep(STOP_SETTLE_MS); } catch { /* a refused wait only skips the settle */ }
		}
		if (r && typeof (r as { block?: unknown }).block === 'string') {
			const text = (r as { block: string }).block;
			if (await read($, isModOn)) {
				S.stopRefused = true; // the Stop event: the band may read blocked on this render
				S.resumedAt = await $.clock.now().catch(() => null); // the host goes on with the refusal as its next turn: that turn is this run's (band-motion resumeOk)
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
		const at = await hookStamp($);
		noteHook('session.measure', at);
		if (at !== undefined) noteMeasure(e, at);
		if (typeof e.context.window === 'number') S.usageWindow = e.context.window;
		if (await read($, isModOn)) {
			await update($, usageState, (usage) => ({
				tokens: e.context.tokens ?? usage.tokens,
				contextPct: e.context.percent ?? usage.contextPct,
			}));
		}
		await hookDone($, 'session.measure', at);
		return next(e);
	});

	// Header phase from the last main-loop ANSWER (reason 'answer': the matcher
	// keeps this a distinct registration beside routing.ts's un-matchered
	// turn.complete drift counter); task agents finish per turn; queued
	// routing-drift lines reach the debug log here, where `$` exists.
	on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
		let at: number | undefined;
		try {
			if (e.agentId === undefined) noteHook('turn.complete', (at = await hookStamp($)));
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
					agents.map((agent) => (agent.name === agentId || agent.name === S.nameMemo[agentId] ? { ...agent, state: 'finished' as const } : agent)),
				);
			}
		} catch {
			// a drift check never blocks the answer
		}
		await hookDone($, 'turn.complete', at);
		return next(e);
	});

	// The band above the prompt: bordered section (terminal + interactive only).
	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, isModOn)) || !(await read($, isInteractive))) return next(e);
		// X5: the pane opens at rest (dockTick) and again at the first prompt (dockOnPrompt). Drawing is pure: the engine denies a $.state write made while ui.render dispatches (the hook is then skipped and the band never
		// draws), so the render only notes the wish; dockTick opens the pane. A terminal widened later is checked again until the open is made once; a pane the person closed stays closed.
		S.lastViewport = e.viewport ? { isFullscreen: e.viewport.isFullscreen, columns: e.viewport.columns } : undefined;
		if (!paneChecked && !paneClosedByPerson && e.viewport) {
			S.dockWanted = shouldDockRest(e.viewport);
			paneChecked = S.dockWanted;
		}
		const snapshot = await read($, snapshotState);
		if (snapshot === null) return next(e);
		const gates = await gateGroups($);
		S.lastRailPhase = railPhase(snapshot, S.lastRailPhase); // a blocked reply keeps the phase lit before it
		const els = $.ui.resolve(e);
		const columns = e.props.bodyColumns; // measured live: with the docked pane open, viewport.columns is the transcript's own width (143) and bodyColumns is that less the engine's five (138)
		const live = liveWorkers(snapshot, snapshot.now); // one clock for the band, the HUD, the board and the pane
		if (e.props.isWorking === false) S.stopSeen = false; // the host's flag fell: its own word is the turn's end again
		const turnOn = hostTurnRunning(e.props.isWorking, S.stopSeen);
			S.hostWorking = turnOn; // noted for the tick: the host's turn runs even when no worker is listed
			if (turnOn && !S.frameTimer) void wakeLoops($).catch(() => undefined); // a working turn on screen needs its spinner beat
		S.hostKnown = typeof e.props.isWorking === 'boolean';
		hostFlag = e.props.isWorking;
		// The HUD takes what the band leaves (the band keeps BAND_MIN_ROWS), and never less than its compact form: the band shrinks first.
		// The HUD draws the TODO tree and the Subagents block (rev 4 design); below 80 columns the block gives way to the band's counts.
		const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
		const hudIn = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, S.lastRailPhase) };
		const look = await lookOf($);
		const tick = Math.max(await read($, spinnerTickState), S.beatFrame);
		const clockNow = await $.clock.now();
		const release = holdSpinFrame(tick); const frame = sharedSpinFrame() ?? tick; // every surface of this render turns frame `tick`: one index for the band, the HUD rows, the SUBAGENTS header and the pane
		try {
		const motionCtx = S.motion?.ctx(); // the frame clock the motion driver stamped: the HUD, the band and the pane draw one frame, never a render apart
		const hudView = { cols: columns, tick: frame, ui: look.ui, rich: look.rich, now: snapshot.now, clock: clockNow, motion: motionCtx }; // wave 40: the band's clock too, so SUBAGENTS TIME matches the band; the board's clock too: one `claimed_at`, one elapsed
		const hudOn = (await $.env.get('ATLAS_HUD').catch(() => undefined)) !== 'off'; // ATLAS_HUD=off: no TODO / Subagents rows
		const running = agents.some(isRunning);
		const runningCount = agents.filter(isRunning).length;
		const report = await readStatuslineRows($, snapshot.root);
		if (report) noteBilling(report.billing); // a fresh report decides; a stale one keeps the last (a login's billing does not change mid-session)
		const slotRows = e.props.maxRows ?? 0;
		const budget = e.props.maxRows === undefined ? 0 : effectiveRows(slotRows, e.viewport, report?.rows ?? null, runningCount); // no slot reported: nothing to cap
		await read($, easeTickState); // a glide bumps it each frame: the band redraws with the value `easedNow` gives for this instant
		const glide = await read($, gaugeState);
		const eased = glide ? easedNow(glide, await $.clock.now()) : undefined;
		const core = await read($, coreState);
		const agentsAlive = [...agents, ...namedAgents(hudIn.todos, agents)].some(isAlive);
		const healthIn = await healthInOf($, clockNow);
		const bandIn = (hudRowsDrawn: Segment[][], maxRows: number | undefined): BandModel => ({ ...runBandModel({ snapshot, live, gates, core, agentsAlive, isWorking: e.props.isWorking, clockNow, look, health: healthIn }), columns, tick: frame, workersInHud: hudListsAgents(hudRowsDrawn), eased, maxRows, motion: motionCtx });
		// The blocked debounce: ask the band what it computes with nothing held back, then tell it whether it may read blocked.
		const probe = bandKindOf({ ...bandIn([], 1), blockedConfirmed: true }) === 'blocked';
		const step = stepBlocked(S.blockedStreak, probe, turnOn, S.stopRefused || gateTally(withCoreTally(gates, core)).stop?.blocked === true);
		S.blockedStreak = step.streak;
		S.blockedAllow = step.allow;
		S.heldKind = null;
		const kStep = stepKind(S.kindHold, bandKindOf(bandIn([], 1)), clockNow);
		S.kindHold = kStep.hold;
		S.heldKind = kStep.shown !== 'idle' ? kStep.shown : null;
		S.shownKind = kStep.shown;
		// State 38: the run card and the band flip on the same render, on the band's final clock.
		const finalNow = S.runClock.startMs === null && kStep.shown === 'done' ? heldFinal() ?? null : null;
		noteRunFinal(finalNow); // truth 39: the run card is placed on the next beat, never inside this render, so it cannot land a frame before the band that reads done
		noteBlocked(kStep.shown === 'blocked' ? bandBlockedOf(bandIn([], 1)) : null);
		const agentsListed = agents.length > 0;
		const runOn = e.props.isWorking === true || S.runClock.startMs !== null; // the run lasts until its clock closes: the host turn ending a beat before it (a Stop retry, f0129 of stoprun-150-46d4825c-1) must not drop the hold
		const health = bandHealth(bandIn([], 1)); // wave 42: the idle health, from the band's own inputs
		const healthLn = health ? healthLine(health, look.ui) : '';
		const healthCard = health && healthIn.open ? healthCardRows(health, { cols: columns, ui: look.ui, ...(e.props.maxRows !== undefined && budget > 1 ? { maxRows: budget - 1 } : {}) }).map((row) => row.filter((x) => x.t !== '').map((x) => segmentOf(x, look.ui))) : undefined;
		// Y1d: below the pane's rest width an idle session gets the two-row health strip above the band (never beside the open pane or the open card); it takes its rows off the budget first
		const stripOn = health !== undefined && e.props.maxRows !== undefined && budget >= STRIP_ROWS + 2 && stripWanted({ cols: columns, kind: S.shownKind, panel: healthIn.panel === true, open: healthIn.open === true });
		const plan = composeSlot({ budget: stripOn ? budget - STRIP_ROWS : budget, hasSlot: e.props.maxRows !== undefined, hudOn, runOn, columns, hudIn, hudView: { ...hudView, ...(healthLn ? { healthLine: healthLn } : {}) }, ...(healthCard ? { healthCard } : {}), running, agentsListed, orchestrated: snapshot.phaseSource === 'header' || hudIn.todos.length > 0 || agents.length > 0, now: snapshot.now, bandIn, held: S.slotHeld });
		S.slotHeld = plan.held;
		const hud = plan.hud;
		const wanted = hudOn ? hudRows(hudIn, { ...hudView, maxRows: 1_000 }).length : 0;
		void publishHudState($, snapshot.root, {
			maxRows: budget,
			wanted,
			shown: hud.length,
			fullscreen: e.viewport?.isFullscreen === true,
		});
		const handlers = { ...bandHandlers($), paneOpen: await read($, paneOpenedState) }; // the one-row bar draws `open` or `close` by it
		const hudPress = { press: (key: string): void => { if (key === 'band:health') handlers.toggleHealth?.(); else if (key === CARD_MORE_KEY) handlers.openView('route'); }, hover: (key: string): object => hoverStyle(look.ui, key) }; // the card's `▾ hide` chip toggles the card like the band's `▸ health`
		S.bandDrawnMs = clockNow;
		const band = bandTree(els, plan.band, handlers);
		// One blank row between the band and the HUD (A3), in the HUD's own panel fill.
		const blankRow = (): RenderElement => rowOf(els, [segmentOf({ t: ' '.repeat(columns), tone: 'text' }, look.ui)], columns);
		const gapRow = Array.from({ length: plan.gap }, blankRow);
		const pad = plan.pad > 0 ? [els.Box({ height: plan.pad, flexShrink: 0, children: [] })] : []; // rows the HUD does not use: empty and unfilled, under the block (never a 234 slab)
		const strip = stripOn && health ? healthStripRows(health, { cols: columns, ui: look.ui }).map((row) => rowOf(els, row.filter((x) => x.t !== '').map((x) => segmentOf(x, look.ui)), columns, hudPress)) : [];
		return atlasSlot(els, { strip, band, gapRow, hud: hud.map((r) => rowOf(els, r, columns, hudPress)), pad, lead: plan.lead, below: await next(e) });
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
		const paneMotion = S.motion?.ctx();
		const paneTick = Math.max(await read($, spinnerTickState), S.beatFrame);
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
		const bandB: BandModel = { ...runBandModel({ snapshot, live: paneLive, gates: paneGates, core: paneCore, agentsAlive: [...paneAgents, ...namedAgents(ownTodos(snapshot.todos ?? [], snapshot.sessionId), paneAgents)].some(isAlive), isWorking: hostFlag, clockNow: paneNow, look, health: await healthInOf($, paneNow) }), columns: 120, tick: paneFrame };
		const originMs = originOf(snapshot.now, paneNow);
		const runSecs = heldWork(paneNow);
		return sidebarTree($.ui.resolve(e), {
			snapshot,
			clock: paneNow,
			look: look.ui,
			gates: paneGates,
			core: paneCore,
			...(bandHealth(bandB) ? { health: bandHealth(bandB) } : {}),
			run: { kind: bandKind(bandB), frame: paneFrame, ...(runSecs !== undefined ? { secs: runSecs } : {}), ...(originMs !== undefined ? { startMs: originMs } : {}) },
			ui: { recipient: await read($, recipientState), expanded: await read($, expandedState), draft: await read($, draftState), view: await read($, viewState), flips: flipsOf(await read($, flipState)) },
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
		reportFailure($, `atlas: ${e.component} ${e.module} ${e.phase}: ${e.reason}`, 'mod.error.fault');
		return next(e);
	});

	// /atlas-core — the four pillars as text; computed fresh, no UI needed.
	on('command.run', { command: 'atlas-core' }, async ($) => {
		void noteUsage($, 'mod.command.atlas-core');
		const model = await buildCore($).catch(() => null);
		return { text: coreReport(hasCore(model) ? model : null) };
	});

	// Session over: the spinner clock and any gauge glide stop.
	on('session.end', (_$, e, next) => {
		S.tickTimer?.cancel();
		S.tickTimer = null;
		S.frameTimer?.cancel();
		S.frameTimer = null;
		S.clockHeld = null;
		S.shownKind = null;
		S.runOrigin = null;
		S.resumedAt = null;
		S.runClock = newRunClock(); // a new session starts its work clock from nothing
		S.armedAt = null;
		S.hostKnown = false;
		S.idleFlipped = true;
		S.easeTimer?.cancel();
		S.easeTimer = null;
		return next(e);
	});

	// The person closed the pane (Esc or the close mark): the band's `open` chip opens it again.
	on('ui.close', async ($, e, next) => {
		if (e.id === PANE_ID) {
			if (e.origin?.kind === 'person') paneClosedByPerson = true; // a close by hand is final for the session: the prompt hook never reopens it
			await update($, paneOpenedState, () => false);
			await update($, viewState, () => 'route'); // reopen on the first tab, not the last one used
		}
		return next(e);
	});

	// /atlas-todo <text> — add a todo at the current phase.
	on('command.run', { command: 'atlas-todo' }, async ($, e) => {
		void noteUsage($, 'mod.command.atlas-todo');
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
