// host/rest.ts: the one rest decision. At rest no repeating timer of the mod fires (the poll, herdr, mux and gates timers and the slow tick are
// cancelled) and nothing is spawned or read; any engine event the mod sees wakes them again, once. While awake each check still runs only for
// what is live (poll.ts: wt, mux and herdr gate their own work). The frame loop and gauge glide stop themselves and keep the session awake while they run.
import { atom, type EngineInterface, read } from 'claude-code';
import type { LiveSnapshot } from '../orchestra-types';
import { S } from './atoms';
import { armTick, ensureFrameLoop, framesWanted, isWorkingNow, sleepTick, TICK_MS } from './frame';
import { onHookNoted } from './hook-log';
import { coreTick } from './core-tick';
import { GATES_MS, HERDR_MS, herdrTick, IDLE_AFTER_MS, IDLE_BACKOFF_MS, idleSkip, MUX_MS, muxTick, noteAwake, POLL_MS, pollBusy, quietMs, rebuildTick, runGates } from './poll';

const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null);

let timers: { cancel(): void }[] = [];
let enabled = false;
let armGen = 0; // a late poll step of an earlier arming must not put a later arming to sleep

/** Something on screen or in flight needs the timers: a host turn, an armed prompt, the frame loop or a glide, a pending dock, a gate run, a live poll subject. */
const inUse = (): boolean => [S.hostWorking, S.armedAt !== null, !!S.frameTimer, !!S.easeTimer, S.dockWanted, S.gatesBusy, pollBusy()].some(Boolean);
// function declarations: the host load check follows `$` only into those
async function awake($: EngineInterface): Promise<boolean> {
	return inUse() || (await quietMs($)) < IDLE_AFTER_MS;
}
const animating = (snap: LiveSnapshot, now: number): boolean => framesWanted(snap, now) || isWorkingNow(snap, S.hostWorking, S.hostKnown && !S.hostWorking);

/** True when nothing is running and nothing moved for IDLE_AFTER_MS: nothing in use, no live agent or worker, no animation left to draw. */
async function atRest($: EngineInterface): Promise<boolean> {
	if (await awake($)) return false;
	const snap = (await read($, snapshotState)) as LiveSnapshot | null;
	return snap === null || !animating(snap, await $.clock.now());
}

function sleep(end = false): void {
	for (const t of timers) t.cancel();
	timers = [];
	sleepTick(end);
}

/** The poll tick doubles as the rest check: it runs, then decides whether it was the last one. */
async function pollStep($: EngineInterface, gen: number): Promise<void> {
	await rebuildTick($).catch(() => undefined);
	void ensureFrameLoop($).catch(() => undefined); // a second watchdog: the poll is an interval of its own
	if ((await atRest($).catch(() => false)) && gen === armGen) sleep();
}

function arm($: EngineInterface, withTick = false): void {
	if (timers.length > 0) return;
	const gen = ++armGen;
	timers = [
		$.clock.every(POLL_MS, () => void pollStep($, gen)),
		$.clock.every(HERDR_MS, () => void herdrTick($).catch(() => undefined)),
		$.clock.every(MUX_MS, () => {
			void muxTick($).catch(() => undefined);
			void idleSkip($, 'core', IDLE_BACKOFF_MS).then((skip) => (skip ? undefined : coreTick($))).catch(() => undefined);
		}),
		$.clock.every(GATES_MS, () => {
			if (S.hostWorking) void runGates($); // the backstop runs only while a turn does; Stop / turn.complete mark the gates stale themselves
		}),
	];
	if (withTick && S.tickTimer === null) armTick($, undefined, TICK_MS); // its first run settles the period (TICK_MS while anything animates)
}

/** Boot: arm the timers and wake them on every recorded hook event. */
export function watch($: EngineInterface): void {
	enabled = true;
	onHookNoted(() => wake($));
	arm($);
}

/** An engine event the mod sees (a hook, a render, a command): arm whatever sleeps. A no-op while awake or after session.end. */
export function wake($: EngineInterface, quiet = false): void {
	if (!enabled) return;
	if (timers.length === 0) arm($, true);
	if (quiet) void noteAwake($).catch(() => undefined); // an event with no hook-log stamp restarts the quiet window itself
}

/** A reload (register runs again) drops the old copy's timers: forget them so the next boot arms its own. */
export function resetWatch(): void {
	enabled = false;
	onHookNoted(null);
	for (const t of timers) t.cancel();
	timers = [];
}

/** Session end: cancel everything, wake nothing until the next boot. */
export function stopWatch(): void {
	enabled = false;
	onHookNoted(null);
	sleep(true);
}
