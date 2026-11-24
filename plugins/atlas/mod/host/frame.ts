// host/frame.ts: run clock, frame beat, blocked flip and motion ticks.
// Split out of mod/register.ts (plan docs/plans/2026-11-18_atlas-mod-reorg-plan.md section 7); no behavior change.
import { atom, type EngineInterface, read, update } from 'claude-code';
import type { BandModel } from '../view/band/band';
import type { HealthIn } from '../data/idle-health';
import { hookStats } from './hook-log';
import { noteRunEnd, pulseOf } from '../data/pulse';
import { flushHistory, noteHistoryCtx, noteHistoryGates, noteHistoryRun } from '../data/history';
import { gateCounts } from '../design/vocab';
import { allSettled, ARM_MS, beatDue, beatStale, FRAME_MS, type GaugeMoves, gaugeTargets, newKindHold, readRun, restSecsOf, resumeOk, retargetAll, runKey, runLive, stepRun } from '../view/band/band-motion';
import { hudAgents, isAlive, namedAgents } from '../view/hud/hud';
import { activeCount, liveWorkers, queuedMembers, workerStates } from '../data/live';
import type { GateGroup } from '../view/panel/pane/sidebar';
import { leadChannelName } from '../data/root';
import { ownTodos, planBasis } from '../data/todos';
import { gateTally, leadBusy, planBusy, withCoreTally } from '../data/runstate';
import type { CoreModel } from '../data/core';
import { cardsDue, placeFinished } from '../view/transcript/placed';
import { EASE_FRAMES, EASE_MS, type Ui } from '../design/atlas-ui';
import { IDLE_AFTER_SECS } from '../view/band/mission-layout';
import { lookOf } from '../design/look';
import { Motion, MotionDriver, reducedMotion } from '../motion/motion';
import { motionFeed } from './motion-feed';
import type { LiveSnapshot } from '../orchestra-types';
import { BAND_SHOWN_MS, rootOf, S } from './atoms';
import { runGates, verdictPoll } from './poll';
import { gateGroups } from './core-tick';

/** How long the Stop hook waits after it wrote the refusal: one redraw frame and a margin. */
export const STOP_SETTLE_MS = FRAME_MS + 40;
export const IDLE_TICK_MS = 5000; // the slow tick at rest
export const TICK_MS = 250; // the slow tick: gauges, motion and the Stop verdict (the spinner has its own beat, FRAME_MS in band-motion.ts, and waits for none of this)
const EASE_STEP_MS = Math.round(EASE_MS / EASE_FRAMES); // a gauge glide redraws at its frame rate, only until it lands

const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);

const spinnerTickState = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0); // written by restyle's ticker; renders only read it
const gaugeState = atom({ plugin: 'atlas', key: 'bandGauges' } as const, null as GaugeMoves | null); // the band gauges' glide, retargeted by the tick when a figure moves
const easeTickState = atom({ plugin: 'atlas', key: 'easeTick' } as const, 0); // bumped by the ease timer so the band redraws each frame of a glide

const coreState = atom({ plugin: 'atlas', key: 'core' } as const, null); // CoreModel or null; written by coreTick, read by the band and pane renders

/** Retarget the band gauges to the snapshot's figures; when one moved, start the glide timer (it stops itself on landing). */
export async function easeTick($: EngineInterface, snap: LiveSnapshot): Promise<void> {
	const now = await $.clock.now();
	const cur = await read($, gaugeState);
	const next = retargetAll(cur, gaugeTargets(snap), now);
	if (next === cur) return;
	await update($, gaugeState, () => next);
	if (cur === null || S.easeTimer) return; // a first sight does not glide
	S.easeTimer = $.clock.every(EASE_STEP_MS, () => {
		void (async () => {
			const g = await read($, gaugeState);
			await update($, easeTickState, (n) => n + 1);
			if (!g || allSettled(g, await $.clock.now())) {
				S.easeTimer?.cancel();
				S.easeTimer = null;
			}
		})().catch(() => undefined);
	});
}

let motionDriver: MotionDriver | null = null;
export async function motionTick($: EngineInterface, snap: LiveSnapshot): Promise<void> {
	if (!motionDriver) {
		S.motion = new Motion(!reducedMotion({ ATLAS_REDUCED_MOTION: await $.env.get('ATLAS_REDUCED_MOTION').catch(() => undefined), NO_COLOR: await $.env.get('NO_COLOR').catch(() => undefined) }));
		motionDriver = new MotionDriver(S.motion, (ms, fn) => $.clock.every(ms, fn), async () => void (await update($, easeTickState, (n) => n + 1)), () => $.clock.now());
	}
	const now = await $.clock.now();
	// Wave 34: the feed's band reads the run state the render reads (host turn, run clock, live agents), so the done fade steps 231, 151, 114 once and never restarts (114, 151, 114).
	const agents = hudAgents(liveWorkers(snap, snap.now), snap.squad, queuedMembers(snap));
	const run: Partial<BandModel> = {
		...([...agents, ...namedAgents(ownTodos(snap.todos ?? [], snap.sessionId), agents)].some(isAlive) ? { agentsRunning: true } : {}),
		...(S.hostKnown && S.hostWorking && !runLive(S.runClock, S.armedAt !== null, resumedNow(now)) ? { hostOnly: true } : {}),
		working: S.hostKnown ? S.hostWorking && runLive(S.runClock, S.armedAt !== null, resumedNow(now)) : S.runClock.startMs !== null,
		...(restSecsOf(S.runClock, now) !== undefined ? { restSecs: restSecsOf(S.runClock, now)! } : {}),
	};
	await motionDriver.step(snap, async () => motionFeed(snap, await gateGroups($), await read($, coreState), (await lookOf($)).ui, run));
}

/** Test seam: the Stop event's mark. */
export const turnEnded = (): boolean => S.stopSeen;
/** The turn runs when the host says so and its Stop event has not ended it. */
export const hostTurnRunning = (isWorking: boolean | undefined, stopped: boolean): boolean => isWorking === true && !stopped;

export const originOf = (snapNow: number, clockNow: number): number | undefined => {
	const key = runKey(S.runClock);
	if (key === undefined) return undefined;
	if (S.runOrigin === null || S.runOrigin.key !== key) S.runOrigin = { key, ms: snapNow - (clockNow - key) };
	return S.runOrigin.ms;
};
const resumedNow = (now: number): boolean => resumeOk(S.runClock, S.resumedAt, now);
/** Every surface reads the run's seconds through band-motion readRun: one total, set when the run closes and never raised after (truth 41). */
export const heldWork = (now: number): number | undefined => { const r = readRun(S.clockHeld, S.runClock, now); S.clockHeld = r.hold; return r.work; };
export const heldFinal = (): number | undefined => { const r = readRun(S.clockHeld, S.runClock); S.clockHeld = r.hold; return r.final; };

// ---- the blocked flip ------------------------------------------------------------------------------------------------------------
// The panel and the band read the same snapshot and gate groups, so a Stop refusal reaches both on the data's own write. An earlier build held the panel back for 250 ms and drew the rail's last phase
// in the meantime (BLOCKED_HOLD_MS, maskBlocked): that drew a phase the snapshot did not hold, and with a finished plan it drew `done` over a band that read `working` (critique 27, stoprun-150-46d4825c-1
// f0109:6 to f0114:6). The panel now draws the snapshot as it is; this only asks for one more redraw when the blocked state changes, since the panel is not otherwise drawn again when nothing else moves.
let blockedDrawn = false;

/** Test seam: forget the debounce. */
export const resetBlockedDebounce = (): void => { S.stopRefused = false; S.blockedStreak = 0; S.blockedAllow = null; S.kindHold = newKindHold(); S.heldKind = null; S.shownKind = null; };
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

/** Truth 41: the run state of the band, built ONE way for the band's render and the side panel's (critique 40: `⠸ working` under `● done`, `done 0:47` against `0:48`). Both pass what they read; the state kind, the three clock figures and the
 * spinner frame come out of the same functions, so for one now the glyph, the word and the clock are identical. */
export function runBandModel(i: { snapshot: LiveSnapshot; live: BandModel['live']; gates: GateGroup[]; core: CoreModel | null; agentsAlive: boolean; isWorking: boolean | undefined; clockNow: number; look: { ui: Ui; rich: boolean }; health?: HealthIn }): Pick<BandModel, 'health' | 'snapshot' | 'live' | 'gates' | 'core' | 'agentsRunning' | 'hostOnly' | 'working' | 'workSecs' | 'ranSecs' | 'restSecs' | 'ui' | 'rich' | 'lastPhase' | 'leadName' | 'blockedConfirmed' | 'heldKind'> {
	const turnOn = hostTurnRunning(i.isWorking, S.stopSeen);
	const runOn = runLive(S.runClock, S.armedAt !== null, resumedNow(i.clockNow));
	const work = heldWork(i.clockNow);
	const ran = heldFinal();
	const rest = restSecsOf(S.runClock, i.clockNow);
	return {
		snapshot: i.snapshot, live: i.live, gates: i.gates, core: i.core,
		...(i.health ? { health: i.health } : {}),
		...(i.agentsAlive ? { agentsRunning: true } : {}),
		...(turnOn && !runOn ? { hostOnly: true } : {}),
		working: (turnOn && runOn) || (i.isWorking !== false && !S.stopSeen && S.runClock.startMs !== null),
		...(work !== undefined ? { workSecs: work } : {}), ...(ran !== undefined ? { ranSecs: ran } : {}), ...(rest !== undefined ? { restSecs: rest } : {}),
		ui: i.look.ui, rich: i.look.rich, lastPhase: S.lastRailPhase, leadName: i.snapshot.sessionId ? leadChannelName(i.snapshot.sessionId, '', '')[0] : undefined,
		...(S.blockedAllow === false ? { blockedConfirmed: false } : {}), ...(S.heldKind ? { heldKind: S.heldKind } : {}),
	};
}

/** Y1a: write the persisted history (the context percents of this session's measures first); a run end forces it, the slow tick writes it at most every 10 s when it changed. */
export async function syncHistory($: EngineInterface, now: number, force = false): Promise<void> {
	const pcts = pulseOf(now).ctx.map((c) => c.pct);
	noteHistoryCtx(pcts, now);
	await flushHistory($, rootOf(await read($, snapshotState)), now, force);
}

/** One beat of the frame loop: step the run clock, and redraw (one frame, the counter is the shared frame index of every surface) while Atlas works, on the beat a run ends,
 * and once when a finished run rests long enough to read `idle`. It reads the snapshot but waits for no store update, poll or timer of any other kind. */
async function frameBeat($: EngineInterface): Promise<void> {
	const now = await $.clock.now();
	S.lastBeatMs = now;
	const snap = await read($, snapshotState);
	if (!snap) return;
	const working = isWorkingNow(snap as LiveSnapshot, S.hostWorking, S.hostKnown && !S.hostWorking);
	const before = S.runClock;
	if (S.armedAt !== null && now - S.armedAt > ARM_MS) S.armedAt = null; // a prompt that started no work arms nothing
	S.runClock = stepRun(S.runClock, working, now, { hostIdle: S.hostKnown && !S.hostWorking, promptMs: S.armedAt, resumed: resumedNow(now) }); // the host's own turn end ends the run on this beat; the grace stays for fixtures without the flag
	if (before.startMs === null && S.runClock.startMs !== null) { S.armedAt = null; S.resumedAt = null; } // the run took the prompt's time as its start
	const ended = before.startMs !== null && S.runClock.startMs === null;
	if (ended) S.idleFlipped = false;
	const rest = restSecsOf(S.runClock, now);
	const flip = !S.idleFlipped && rest !== undefined && rest >= IDLE_AFTER_SECS;
	if (flip) S.idleFlipped = true;
	// The Stop verdict is read on the beat, not only on the slower tick, and BEFORE the tick bump: the bump is what redraws the band (the panel also redraws on the gate write itself), so a verdict
	// read after it left the band drawing the old gates for one more beat (critique 25, stoprun-150-3 f0106: `phase blocked` in the panel, `working` in the band; the band flipped at f0107).
	if (working && S.hostKnown && !verdictBusy) {
		verdictBusy = true;
		try { await verdictFast($, snap as LiveSnapshot); } finally { verdictBusy = false; }
	}
	if (ended) {
		const ranSecs = Math.floor((S.runClock.ranMs ?? now - before.startMs!) / 1000);
		noteRunEnd(ranSecs, !S.stopRefused, now); // the run's own seconds and verdict join the pulse's `runs` row
		noteHistoryRun({ secs: ranSecs, ok: !S.stopRefused, tools: hookStats(now, 0, before.startMs!).runTools ?? 0, at: now }); // Y1a: and the persisted history
		try { // AA4: the gate counts at the run's end, shown as `prev` rows by the next session's idle GATES
			const checks = gateTally(withCoreTally(await gateGroups($), await read($, coreState))).checks;
			noteHistoryGates(checks.map((c) => { const n = gateCounts(c); return { id: c.id, pass: n.pass, deny: n.total - n.pass }; }));
		} catch { /* the history keeps what it had */ }
		void syncHistory($, now, true).catch(() => undefined);
	}
	S.beatN++;
	const idleLive = !working && now - S.bandDrawnMs <= BAND_SHOWN_MS; // the band is on screen and nothing works: it breathes and its `up` clock ticks on every 2nd beat (5 Hz)
	if (beatDue({ working, shown: S.shownKind, open: S.runClock.startMs !== null, ended, flip, idleLive, idleBeat: S.beatN })) await update($, spinnerTickState, (n) => { S.beatFrame = n + 1; return n + 1; });
	await observeBlocked($); // after the bump: the band's redraw is already asked for when the panel's clock starts
	if (cardsDue()) await placeFinished($, snap as LiveSnapshot, snap as LiveSnapshot); // the run card and the blocked card, on the beat after the band drew the state they name
	if (!framesWanted(snap as LiveSnapshot, now)) { S.frameTimer?.cancel(); S.frameTimer = null; } // at rest: no timer until wakeLoops or the poll's watchdog finds work
}
let verdictBusy = false;

/** Something on screen moves or is about to change: a working turn or agent, the working word still drawn, an open run clock, a prompt just armed, or a finished run that has not yet flipped to `idle`.
 * At rest none of these hold, and the frame loop and the fast tick stop (an idle session spent ~60 CPU-s a minute on 10 redraws a second of an unchanging band). The idle breath is not kept alive: it is the one thing that moved at rest. */
export function framesWanted(snap: LiveSnapshot | null, now: number): boolean {
	if (S.runClock.startMs !== null || S.armedAt !== null || S.shownKind === 'working') return true;
	if (restSecsOf(S.runClock, now) !== undefined && !S.idleFlipped) return true;
	return snap !== null && isWorkingNow(snap, S.hostWorking, S.hostKnown && !S.hostWorking);
}

/** (Re)start the frame loop. `$.clock.every` ends when the host refuses a period, so the slow tick and the poll call this when the beat went stale. */
export function armFrameLoop($: EngineInterface): void {
	S.frameTimer?.cancel();
	S.frameTimer = $.clock.every(FRAME_MS, () => {
		void frameBeat($).catch(() => undefined);
	});
}
/** The watchdog: a loop that stopped beating is armed again, and a stopped loop is armed once something wants frames. */
export async function ensureFrameLoop($: EngineInterface): Promise<void> {
	if (!S.tickTimer) return; // the session ended: nothing re-arms the loop behind it
	const now = await $.clock.now();
	if (!S.frameTimer ? framesWanted((await read($, snapshotState)) as LiveSnapshot | null, now) : beatStale(S.lastBeatMs, now)) {
		S.lastBeatMs = now;
		armFrameLoop($);
	}
}
/** A hook event or a host turn says work starts: restart the frame loop and the fast tick now, not at the next slow tick. */
export async function wakeLoops($: EngineInterface): Promise<void> {
	if (!S.tickTimer) return;
	if (!S.frameTimer) { S.lastBeatMs = await $.clock.now(); armFrameLoop($); }
	if (tickMs !== TICK_MS) armTick($, undefined, TICK_MS);
}

/** The slow tick runs at TICK_MS while anything animates and every IDLE_TICK_MS at rest; its body is the caller's (it reads gauges, motion and the Stop verdict). */
let tickBody: (() => Promise<void>) | null = null;
let tickMs = TICK_MS;
export function armTick($: EngineInterface, body?: () => Promise<void>, ms = TICK_MS): void {
	if (body) tickBody = body;
	tickMs = ms;
	S.tickTimer?.cancel();
	S.tickTimer = $.clock.every(ms, () => {
		void (async () => {
			await tickBody?.();
			const want = S.frameTimer || S.easeTimer ? TICK_MS : IDLE_TICK_MS;
			if (S.tickTimer && want !== tickMs) armTick($, undefined, want);
		})().catch(() => undefined);
	});
}
/** The spinner tick's look at the Stop verdict: the fast path of gatesPoll, plus the urgent gate run it queues (gatesPoll would start it on the next 500 ms poll). */
export async function verdictFast($: EngineInterface, snap: LiveSnapshot): Promise<void> {
	await verdictPoll($, rootOf(snap));
	if (S.gatesDirty && S.gatesUrgent && !S.gatesBusy) void runGates($).catch(() => undefined);
}
