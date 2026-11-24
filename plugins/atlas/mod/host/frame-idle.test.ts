// Idle cost: at rest the frame loop stops and the slow tick stretches to IDLE_TICK_MS; work restarts both within one frame.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface } from 'claude-code';
import { armFrameLoop, armTick, ensureFrameLoop, framesWanted, IDLE_TICK_MS, TICK_MS, wakeLoops } from './frame';
import { FRAME_MS, newRunClock } from '../view/band/band-motion';
import { S } from './atoms';
import { memState } from '../test_helpers';

type Timer = { ms: number; fn: () => void; live: boolean };
function fakeEngine(snapshot: unknown) {
	const timers: Timer[] = [];
	let now = 1_900_000_000_000;
	const $ = {
		clock: {
			now: async () => now,
			every: (ms: number, fn: () => void) => { const t: Timer = { ms, fn, live: true }; timers.push(t); return { cancel: () => { t.live = false; } }; },
		},
		state: memState({ 'atlas/snapshot': snapshot }),
	} as unknown as EngineInterface;
	const live = (ms: number): Timer[] => timers.filter((t) => t.live && t.ms === ms);
	/** Advance the fake clock and fire every live timer once per period elapsed. */
	const advance = async (totalMs: number): Promise<void> => {
		for (let t = 50; t <= totalMs; t += 50) {
			now += 50;
			timers.filter((x) => x.live && t % x.ms === 0).forEach((x) => x.fn());
			for (let i = 0; i < 200; i++) await Promise.resolve();
		}
	};
	return { $, live, advance };
}

const reset = (): void => {
	S.frameTimer?.cancel(); S.frameTimer = null; S.tickTimer?.cancel(); S.tickTimer = null;
	S.runClock = newRunClock(); S.armedAt = null; S.shownKind = null; S.idleFlipped = false; S.hostWorking = false; S.hostKnown = false;
};

describe('idle frame loop', () => {
	test('nothing wants frames at rest', () => {
		reset();
		expect(framesWanted(null, 1)).toBe(false);
	});

	test('an armed prompt, an open run and a drawn working word each want frames', () => {
		reset();
		S.armedAt = 1; expect(framesWanted(null, 1)).toBe(true); S.armedAt = null;
		S.shownKind = 'working'; expect(framesWanted(null, 1)).toBe(true); S.shownKind = null;
		S.runClock = { ...newRunClock(), startMs: 1 }; expect(framesWanted(null, 1)).toBe(true);
		reset();
	});

	test('the watchdog starts no frame timer at rest and ten seconds pass with zero frame callbacks', async () => {
		reset();
		const e = fakeEngine(null);
		armTick(e.$, async () => { await ensureFrameLoop(e.$); });
		expect(e.live(TICK_MS).length).toBe(1);
		await e.advance(10_000);
		expect(e.live(FRAME_MS).length).toBe(0);
		// the tick found nothing animating and stretched itself
		expect(e.live(TICK_MS).length).toBe(0);
		expect(e.live(IDLE_TICK_MS).length).toBe(1);
		reset();
	});

	test('a wake restarts the frame loop and the fast tick at once, and the beat that finds rest stops the loop again', async () => {
		reset();
		const e = fakeEngine(null);
		armTick(e.$, async () => undefined);
		await e.advance(5_000); // idle tick at 5 s
		expect(e.live(IDLE_TICK_MS).length).toBe(1);
		S.armedAt = 1_900_000_005_000;
		await wakeLoops(e.$);
		expect(e.live(FRAME_MS).length).toBe(1);
		expect(e.live(TICK_MS).length).toBe(1);
		expect(e.live(IDLE_TICK_MS).length).toBe(0);
		reset();
	});

	test('armFrameLoop beats at the frame rate', () => {
		reset();
		const e = fakeEngine(null);
		armFrameLoop(e.$);
		expect(e.live(FRAME_MS).length).toBe(1);
		reset();
	});
});
