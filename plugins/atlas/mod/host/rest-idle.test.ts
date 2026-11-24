// The rest gate: at rest no mod timer fires, nothing spawns, no file is read; an event wakes the poll; the quiet turn end puts it back to sleep.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface } from 'claude-code';
import { makeSnapshot, memState } from '../test_helpers';
import { newRunClock } from '../view/band/band-motion';
import { IDLE_AFTER_SECS } from '../view/band/mission-layout';
import { S } from './atoms';
import { armTick, TICK_MS } from './frame';
import { noteHook, resetHookLog } from './hook-log';
import { IDLE_AFTER_MS, POLL_MS, resetPollIdle } from './poll';
import { stopWatch, wake, watch } from './rest';

type Timer = { ms: number; fn: () => void; live: boolean };

/** A LiveSnapshot with nothing live: no agent, todo or member, and an empty activity map. */
const quiet = () => {
	const snap = makeSnapshot({ root: '/r', phase: 'done', todos: [], squad: [], members: [] });
	// no header pattern: restyle keeps the last one it saw for the whole process, and other test files draw headers
	return { ...snap, contract: { ...snap.contract, headerFirstLinePattern: '' }, activity: {} };
};

/** A counting stub engine on a fake clock: every timer callback, process spawn and fs touch is tallied. */
function countingEngine() {
	const timers: Timer[] = [];
	const n = { fires: 0, runs: 0, fs: 0, builds: 0 };
	let now = 1_900_000_000_000;
	let elapsed = 0;
	let mtime = 1;
	const state = memState({ 'atlas/snapshot': quiet() });
	const touch = <T>(v: T) => async () => { n.fs++; return v; };
	const $ = {
		state,
		plugin: { root: '/p' },
		agent: { list: async () => [] },
		env: { get: async () => undefined },
		clock: {
			now: async () => now,
			every: (ms: number, fn: () => void) => {
				const t: Timer = { ms, live: true, fn: () => { n.fires++; fn(); } };
				timers.push(t);
				return { cancel: () => { t.live = false; } };
			},
		},
		process: { run: async () => { n.runs++; return { exitCode: 0, stdout: '', stderr: '' }; } },
		fs: {
			stat: async () => { n.fs++; return { size: 1, mtimeMs: mtime }; },
			list: touch([] as unknown[]), read: touch(undefined), exists: touch(false),
		},
	} as unknown as EngineInterface;
	const live = (): number => timers.filter((t) => t.live).length;
	const advance = async (total: number, step = 50): Promise<void> => {
		for (let t = 0; t < total; t += step) {
			now += step;
			elapsed += step;
			timers.filter((x) => x.live && elapsed % x.ms === 0).forEach((x) => x.fn());
			for (let i = 0; i < 60; i++) await Promise.resolve();
		}
	};
	return { $, n, live, advance, now: () => now, moveFile: () => { mtime++; } };
}

function fresh() {
	stopWatch();
	resetPollIdle();
	resetHookLog();
	S.frameTimer = null; S.tickTimer = null; S.easeTimer = null;
	S.runClock = newRunClock(); S.armedAt = null; S.shownKind = null; S.idleFlipped = true;
	S.hostWorking = false; S.hostKnown = false; S.dockWanted = false; S.gatesBusy = false; S.sessionUuid = 's1';
	S.builder = { build: async () => quiet(), todoError: undefined } as unknown as typeof S.builder;
	const e = countingEngine();
	return e;
}

/** The host modules keep module-level state: a test leaves none behind for the next file. */
const guarded = (fn: () => Promise<void>) => async (): Promise<void> => {
	try { await fn(); } finally { stopWatch(); resetPollIdle(); resetHookLog(); S.builder = null; S.sessionUuid = ''; S.hostWorking = false; }
};

describe('rest gate', () => {

	test('(a) at rest for ten minutes: zero timer callbacks, zero spawns, zero file reads', guarded(async () => {
		const e = fresh();
		noteHook('session.start', e.now());
		watch(e.$);
		armTick(e.$, async () => undefined, TICK_MS);
		await e.advance(IDLE_AFTER_MS + 5_000); // the quiet window passes, then the poll decides
		expect(e.live()).toBe(0); // the poll, herdr, mux, gates and slow-tick timers are all cancelled
		const before = { ...e.n };
		await e.advance(600_000, 500);
		expect(e.n.fires - before.fires).toBe(0);
		expect(e.n.runs - before.runs).toBe(0);
		expect(e.n.fs - before.fs).toBe(0);
	}));

	test('(b) a prompt.submit wakes the poll within one interval and the band rebuilds', guarded(async () => {
		const e = fresh();
		noteHook('session.start', e.now());
		watch(e.$);
		await e.advance(IDLE_AFTER_MS + 5_000);
		expect(e.live()).toBe(0);
		let builds = 0;
		S.builder = { build: async () => { builds++; return quiet(); }, todoError: undefined } as unknown as typeof S.builder;
		S.hostWorking = true; // the band's render of the working turn
		noteHook('prompt.submit', e.now()); // the hook-log listener wakes the timers
		expect(e.live()).toBeGreaterThan(0);
		e.moveFile(); // the board moved
		await e.advance(POLL_MS + 100);
		expect(builds).toBeGreaterThan(0);
	}));

	test('(c) when the turn ends and nothing is live, the timers stop again once the band has flipped to idle', guarded(async () => {
		const e = fresh();
		noteHook('session.start', e.now());
		watch(e.$);
		await e.advance(IDLE_AFTER_MS + 5_000);
		S.hostWorking = true;
		wake(e.$, true);
		await e.advance(20_000);
		expect(e.live()).toBeGreaterThan(0); // a working turn keeps every check on
		S.hostWorking = false; // the turn ended
		noteHook('turn.complete', e.now());
		await e.advance(IDLE_AFTER_MS + 2 * POLL_MS + 1_000);
		expect(e.live()).toBeGreaterThan(0); // the finished run's `done` clock still ages until the band flips to idle
		await e.advance(IDLE_AFTER_SECS * 1000 + IDLE_AFTER_MS);
		expect(e.live()).toBe(0);
	}));
});
