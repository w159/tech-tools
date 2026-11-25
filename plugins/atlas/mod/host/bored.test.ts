// The bored controller: starts the stream on entering the tab, bumps seq per chunk, stops on leaving, errors on a bad exit.
import { describe, expect, test } from 'claude-code/testing';
import { read, type EngineInterface } from 'claude-code';
import { memState } from '../test_helpers';
import { type BoredSpawn, boredState, resetBored, setViewState, startBored, stopBored } from './bored';

type Step = { value: { stream: 'stdout' | 'stderr'; text: string }; done: false } | { value: { code: number | null; signal: string | null }; done: true };

/** A hand-driven stream: push() answers the waiting pull, and return() is counted. */
function fakeStream() {
	const queue: Step[] = [];
	let waiter: ((s: Step) => void) | null = null;
	const out = {
		returned: 0,
		pulls: 0,
		push(s: Step) { if (waiter) { const w = waiter; waiter = null; w(s); } else queue.push(s); },
		chunk(text: string, stream: 'stdout' | 'stderr' = 'stdout') { out.push({ value: { stream, text }, done: false }); },
		end(code: number | null) { out.push({ value: { code, signal: null }, done: true }); },
		next: () => { out.pulls++; const q = queue.shift(); return q ? Promise.resolve(q) : new Promise<Step>((res) => { waiter = res; }); },
		return: () => { out.returned++; return Promise.resolve({ value: undefined, done: true }); },
	};
	return out;
}

function engine() {
	const timers: { fn: () => void; live: boolean }[] = [];
	const $ = {
		state: memState(),
		clock: { every: (_ms: number, fn: () => void) => { const t = { fn, live: true }; timers.push(t); return { cancel: () => { t.live = false; } }; } },
	} as unknown as EngineInterface;
	const tick = (): void => timers.filter((t) => t.live).forEach((t) => t.fn());
	return { $, timers, tick };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('bored controller', () => {
	test('entering the tab starts the stream; each chunk bumps seq; the first shows at once', async () => {
		resetBored();
		const { $, tick } = engine();
		const fake = fakeStream();
		let spawned = 0;
		const spawn: BoredSpawn = () => { spawned++; return fake as never; };
		await setViewState($, 'bored', spawn);
		expect(spawned).toBe(1);
		expect((await read($, boredState)).status).toBe('connecting');
		fake.chunk('\u001b[Hhi');
		await settle();
		const first = await read($, boredState);
		expect(first.status).toBe('streaming');
		expect(first.seq).toBe(1);
		expect(first.screen!.cells[0]!.map((c) => c.ch).join('')).toBe('hi');
		fake.chunk('!');
		fake.chunk('?');
		await settle();
		expect((await read($, boredState)).seq).toBe(1); // coalesced: nothing written until the timer fires
		tick();
		await settle();
		expect((await read($, boredState)).seq).toBe(3);
		await stopBored($);
	});

	test('stop calls return() and releases a pull that is blocked', async () => {
		resetBored();
		const { $ } = engine();
		const fake = fakeStream();
		await startBored($, () => fake as never);
		await settle();
		expect(fake.pulls).toBe(1); // blocked on a pull: no output yet
		await stopBored($);
		expect(fake.returned).toBe(1);
		await settle();
		fake.chunk('late'); // a chunk after the stop is not published
		await settle();
		expect((await read($, boredState)).seq).toBe(0);
		expect((await read($, boredState)).status).toBe('closed');
	});

	test('leaving the tab stops it, and a second start while running spawns nothing', async () => {
		resetBored();
		const { $ } = engine();
		const fake = fakeStream();
		let spawned = 0;
		const spawn: BoredSpawn = () => { spawned++; return fake as never; };
		await setViewState($, 'bored', spawn);
		await startBored($, spawn);
		expect(spawned).toBe(1);
		await setViewState($, 'route', spawn);
		expect(fake.returned).toBe(1);
	});

	test('a spawn that rejects on its first pull gives status error', async () => {
		resetBored();
		const { $ } = engine();
		const bad = { ...fakeStream(), next: () => Promise.reject(new Error('spawn ssh ENOENT')) };
		await startBored($, () => bad as never);
		await settle();
		const v = await read($, boredState);
		expect(v.status).toBe('error');
		expect(v.error).toContain('ENOENT');
	});

	test('a spawn that throws synchronously gives status error', async () => {
		resetBored();
		const { $ } = engine();
		await startBored($, () => { throw new Error('denied'); });
		const v = await read($, boredState);
		expect([v.status, v.error]).toEqual(['error', 'denied']);
	});

	test('a non-zero exit gives status error with the stderr tail; exit 0 gives closed', async () => {
		resetBored();
		const a = engine();
		const failing = fakeStream();
		await startBored(a.$, () => failing as never);
		failing.chunk('Permission denied (publickey).\n', 'stderr');
		failing.end(255);
		await settle();
		const v = await read(a.$, boredState);
		expect(v.status).toBe('error');
		expect(v.error).toContain('code 255');
		expect(v.error).toContain('Permission denied');

		resetBored();
		const b = engine();
		const clean = fakeStream();
		await startBored(b.$, () => clean as never);
		clean.end(0);
		await settle();
		expect((await read(b.$, boredState)).status).toBe('closed');
	});
});
