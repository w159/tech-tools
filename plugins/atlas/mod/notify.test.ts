// Tests for notify.ts — covers: pure diffSnapshots events (agent ✓/✗, note to
// lead/human with 60-char preview, todo completed, phase advance), no-change and
// first-sight (null prev) yielding [], and malformed snapshots never throwing.
import { describe, expect, test } from 'claude-code/testing';
import type { AtlasSnapshot, ChannelNote, SquadAgent, TodoItem } from './contract';
import type { EngineInterface, On } from 'claude-code';
import { memState } from './test_helpers';
import { diffSnapshots, nextStepSuggestion, registerNotify } from './notify';

function snap(over: Partial<AtlasSnapshot> = {}): AtlasSnapshot {
	return {
		root: null,
		sessionId: 's1',
		channel: 'tech-tools@main/lead',
		contract: {
			phases: [
				{ id: 'research', glyph: '?' },
				{ id: 'implement', glyph: '!' },
				{ id: 'verify', glyph: 'V' },
				{ id: 'done', glyph: 'D' },
			],
			todoPhases: [],
			headerFirstLinePattern: '',
			itemPhasePrefix: '[<phase>] ',
		},
		personas: [],
		todos: [],
		counts: { done: 0, total: 0, byPhase: {} },
		phase: 'research',
		phaseSource: 'default',
		notes: [],
		members: [],
		squad: [],
		contextPct: 0,
		now: 0,
		...over,
	};
}

function agent(name: string, state: SquadAgent['state']): SquadAgent {
	return { name, persona: 'implementer', state, source: 'task' };
}

function note(seq: number, to: string | undefined, text: string, owner = 'impl-auth'): ChannelNote {
	return { ts: 't', seq, owner, to, text, channel: 'tech-tools@main/lead' };
}

function todo(id: string, status: TodoItem['status'], content = id, phase?: TodoItem['phase']): TodoItem {
	return { id, content, status, phase };
}

describe('diffSnapshots', () => {
	test('null prev yields no events (first sight)', () => {
		expect(diffSnapshots(null, snap({ squad: [agent('a', 'running')] }))).toEqual([]);
	});

	test('no change yields no events', () => {
		const s = snap({ squad: [agent('a', 'running')], todos: [todo('t1', 'in_progress')], notes: [note(1, 'lead', 'hi')] });
		expect(diffSnapshots(s, snap({ squad: [agent('a', 'running')], todos: [todo('t1', 'in_progress')], notes: [note(1, 'lead', 'hi')] }))).toEqual([]);
	});

	test('agent running -> finished toasts complete', () => {
		expect(diffSnapshots(snap({ squad: [agent('a', 'running')] }), snap({ squad: [agent('a', 'finished')] }))).toEqual([
			{ type: 'agent-complete', name: 'a', age: '', lastLine: '' },
		]);
	});

	test('agent running -> failed toasts fail, and stays put (no repeat)', () => {
		const failed = snap({ squad: [agent('a', 'failed')] });
		expect(diffSnapshots(snap({ squad: [agent('a', 'running')] }), failed)).toEqual([{ type: 'agent-fail', name: 'a', lastLine: '' }]);
		expect(diffSnapshots(failed, snap({ squad: [agent('a', 'failed')] }))).toEqual([]);
	});

	test('new working agent toasts spawn; a new already-finished one is not a completion', () => {
		expect(diffSnapshots(snap(), snap({ squad: [agent('a', 'running')] }))).toEqual([{ type: 'agent-spawn', name: 'a' }]);
		expect(diffSnapshots(snap(), snap({ squad: [agent('a', 'finished')] }))).toEqual([]);
	});

	test('agent turning blocked toasts blocked', () => {
		expect(diffSnapshots(snap({ squad: [agent('a', 'running')] }), snap({ squad: [agent('a', 'input')] }))).toEqual([
			{ type: 'agent-blocked', name: 'a', lastLine: '' },
		]);
	});

	test('new note to lead yields sender + 60-char preview; non-lead notes ignored', () => {
		const long = 'x'.repeat(70) + 'tail';
		const prev = snap({ notes: [note(1, 'impl-auth', 'old')] });
		const next = snap({ notes: [note(1, 'impl-auth', 'old'), note(2, 'lead-01a122', long), note(3, 'impl-auth', 'not for lead'), note(4, undefined, 'no to field')] });
		expect(diffSnapshots(prev, next)).toEqual([{ type: 'note', sender: 'impl-auth', preview: 'x'.repeat(60) }]);
	});

	test('note to human counts as addressed to the human', () => {
		expect(diffSnapshots(snap(), snap({ notes: [note(9, 'human', 'hello lead')] }))).toEqual([
			{ type: 'note', sender: 'impl-auth', preview: 'hello lead' },
		]);
	});

	test('todo becomes completed once', () => {
		const prev = snap({ todos: [todo('t1', 'in_progress'), todo('t2', 'pending')] });
		const next = snap({ todos: [todo('t1', 'completed', 'write tests'), todo('t2', 'pending')] });
		expect(diffSnapshots(prev, next)).toEqual([{ type: 'todo-done', text: 'write tests' }]);
		// already-completed stays silent
		expect(diffSnapshots(next, snap({ todos: [todo('t1', 'completed', 'write tests')] }))).toEqual([]);
	});

	test('phase advance yields phase event with new phase', () => {
		expect(diffSnapshots(snap({ phase: 'implement' }), snap({ phase: 'verify' }))).toEqual([{ type: 'phase', phase: 'verify' }]);
	});

	test('multiple events at once', () => {
		const prev = snap({ squad: [agent('a', 'running'), agent('b', 'running')], phase: 'research' });
		const next = snap({ squad: [agent('a', 'finished'), agent('b', 'failed')], phase: 'implement' });
		expect(diffSnapshots(prev, next)).toEqual([
			{ type: 'agent-fail', name: 'b', lastLine: '' },
			{ type: 'agent-complete', name: 'a', age: '', lastLine: '' },
			{ type: 'phase', phase: 'implement' },
		]);
	});

	test('malformed snapshots never throw', () => {
		const raw: Record<string, unknown> = snap() as unknown as Record<string, unknown>;
		delete raw.squad;
		delete raw.notes;
		delete raw.todos;
		delete raw.phase;
		const broken = raw as unknown as AtlasSnapshot;
		expect(() => diffSnapshots(broken, broken)).not.toThrow();
		expect(diffSnapshots(broken, broken)).toEqual([]);
		const junk = {
			...snap(),
			squad: [null, { state: 'finished' }, agent('a', 'running')],
			notes: [null, { seq: 2, to: 'lead' }, note(3, 'human', 'ok')],
			todos: [null, { status: 'completed' }, todo('t1', 'completed')],
		} as unknown as AtlasSnapshot;
		const settled = snap({ todos: [todo('t1', 'completed')] });
		expect(() => diffSnapshots(settled, junk)).not.toThrow();
		expect(diffSnapshots(settled, junk)).toEqual([
			{ type: 'agent-spawn', name: 'a' },
			{ type: 'note', sender: 'unknown', preview: '' },
			{ type: 'note', sender: 'impl-auth', preview: 'ok' },
		]);
	});
});

describe('nextStepSuggestion', () => {
	test('blocked worker wins: reply <name>: <lastLine>', () => {
		const s = snap({ squad: [agent('impl', 'input')], todos: [todo('t1', 'in_progress', 'x')] });
		expect(nextStepSuggestion(s)).toBe('reply impl: ');
		const live = { ...s, activity: { impl: { mood: 'blocked', tool: null, since: 0, lastLine: 'need path?' } } };
		expect(nextStepSuggestion(live as unknown as AtlasSnapshot)).toBe('reply impl: need path?');
	});

	test('first in_progress todo, prefix stripped, phase falls back to snapshot phase', () => {
		const s = snap({ phase: 'implement', todos: [todo('t0', 'pending', 'later'), todo('t1', 'in_progress', '[verify] dispatch verifier', 'verify'), todo('t2', 'in_progress', 'write code')] });
		expect(nextStepSuggestion(s)).toBe('verify: dispatch verifier');
		expect(nextStepSuggestion(snap({ phase: 'implement', todos: [todo('t2', 'in_progress', 'write code')] }))).toBe('implement: write code');
	});

	test('null when nothing blocked or in progress', () => {
		expect(nextStepSuggestion(snap())).toBeNull();
		expect(nextStepSuggestion(snap({ todos: [todo('t1', 'pending'), todo('t2', 'completed')] }))).toBeNull();
	});
});

describe('registerNotify', () => {
	test('toasts ✗ for a failed worker and makes the single suggestion', async () => {
		let hook: (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<unknown> = async () => undefined;
		registerNotify(((_p: unknown, _m: unknown, h: typeof hook) => { hook = h; return { catch: () => undefined }; }) as unknown as On, { soundEnabled: () => false });
		const toasts: string[] = [];
		const suggested: string[] = [];
		const mem = memState({ 'atlas/snapshot': null });
		const $ = { state: mem, ui: { toast: (t: string) => toasts.push(t) }, prompt: { suggest: async (a: { text: string }) => (suggested.push(a.text), { isShown: true }) } } as unknown as EngineInterface;
		const put = (s: AtlasSnapshot) => (mem.set as (...a: unknown[]) => Promise<unknown>)({ plugin: 'atlas', key: 'snapshot' }, s);
		await put(snap({ squad: [agent('a', 'running')], todos: [todo('t1', 'in_progress', 'build')] }));
		await hook($, {}, async (x) => x);
		await put(snap({ squad: [agent('a', 'failed')], todos: [todo('t1', 'in_progress', 'build')] }));
		await hook($, {}, async (x) => x);
		expect(toasts).toEqual(['✗ a']);
		expect(suggested).toEqual(['research: build', 'research: build']);
	});
});

// ---- toast text, age, truncation and the hook's return (mutation-driven) ----
type Live = AtlasSnapshot & { activity: Record<string, Record<string, unknown>> };
const withActivity = (over: Partial<AtlasSnapshot>, activity: Record<string, Record<string, unknown>>): AtlasSnapshot =>
	({ ...snap(over), activity, comms: [], todoGroups: [] }) as unknown as Live;
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: 0, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...over });

describe('diffSnapshots details', () => {
	test('a completed worker carries its age and last line', () => {
		const prev = withActivity({ now: 0, squad: [agent('a', 'running')] }, { a: act({ startedAt: 0 }) });
		const next = withActivity({ now: 252_000, squad: [agent('a', 'finished')] }, { a: act({ startedAt: 0, lastLine: 'all green' }) });
		expect(diffSnapshots(prev, next)).toEqual([{ type: 'agent-complete', name: 'a', age: '4m12s', lastLine: 'all green' }]);
	});
	test('a one millisecond age is "0s", a zero or negative one is blank', () => {
		const at = (now: number) => {
			const prev = withActivity({ now: 0, squad: [agent('a', 'running')] }, { a: act({ startedAt: 1000 }) });
			const next = withActivity({ now, squad: [agent('a', 'finished')] }, { a: act({ startedAt: 1000 }) });
			return (diffSnapshots(prev, next)[0] as { age: string }).age;
		};
		expect(at(1001)).toBe('0s');
		expect(at(1000)).toBe('');
		expect(at(999)).toBe('');
	});
	test('failed and blocked events carry the worker\'s last line', () => {
		const prev = withActivity({ squad: [agent('a', 'running'), agent('b', 'running')] }, { a: act(), b: act() });
		const next = withActivity({ squad: [agent('a', 'failed'), agent('b', 'input')] }, { a: act({ lastLine: 'boom' }), b: act({ lastLine: 'which path?', mood: 'blocked' }) });
		expect(diffSnapshots(prev, next)).toEqual([
			{ type: 'agent-blocked', name: 'b', lastLine: 'which path?' },
			{ type: 'agent-fail', name: 'a', lastLine: 'boom' },
		]);
	});
});

describe('registerNotify toasts', () => {
	type Hook = (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<unknown>;
	async function run(prev: AtlasSnapshot, next: AtlasSnapshot, sound = false) {
		let hook: Hook = async () => undefined;
		registerNotify(((_p: unknown, _m: unknown, h: Hook) => { hook = h; return { catch: () => undefined }; }) as unknown as On, { soundEnabled: () => sound });
		const toasts: string[] = [];
		const suggested: string[] = [];
		const played: unknown[] = [];
		const mem = memState({ 'atlas/snapshot': null });
		const $ = {
			state: mem,
			ui: { toast: (t: string) => toasts.push(t) },
			prompt: { suggest: async (a: { text: string }) => (suggested.push(a.text), { isShown: true }) },
			audio: { play: (a: unknown) => (played.push(a), Promise.resolve()) },
		} as unknown as EngineInterface;
		const put = (s: AtlasSnapshot) => (mem.set as (...a: unknown[]) => Promise<unknown>)({ plugin: 'atlas', key: 'snapshot' }, s);
		await put(prev);
		await hook($, {}, async (x) => x);
		toasts.length = 0;
		suggested.length = 0;
		await put(next);
		const returned = await hook($, { id: 'event' }, async (x) => ({ passed: x }));
		return { toasts, suggested, played, returned };
	}
	test('every event kind has its toast', async () => {
		const prev = withActivity({ now: 0, phase: 'research', todos: [todo('t1', 'in_progress', 'build it')], squad: [agent('done', 'running'), agent('bad', 'running'), agent('wait', 'running'), agent('quiet', 'running')] }, {
			done: act({ startedAt: 0 }), bad: act(), wait: act(), quiet: act(),
		});
		const next = withActivity({
			now: 90_000, phase: 'implement', todos: [todo('t1', 'completed', 'build it')], notes: [note(1, 'lead', 'ship it')],
			squad: [agent('done', 'finished'), agent('bad', 'failed'), agent('wait', 'input'), agent('quiet', 'running'), agent('new', 'running')],
		}, {
			done: act({ startedAt: 0, lastLine: 'all green' }), bad: act({ lastLine: 'boom' }), wait: act({ lastLine: 'which path?', mood: 'blocked' }), quiet: act(), new: act(),
		});
		const { toasts } = await run(prev, next);
		expect(toasts).toEqual([
			'⏸ wait blocked: which path?',
			'✗ bad boom',
			'▸ new spawned',
			'✓ done 1m30s · all green',
			'impl-auth: ship it',
			'✓ build it',
		]);
	});
	test('trailing blanks are trimmed from fail and blocked toasts; complete without age or line is bare', async () => {
		const prev = withActivity({ squad: [agent('a', 'running'), agent('b', 'running'), agent('c', 'running')] }, { a: act(), b: act(), c: act() });
		const next = withActivity({ squad: [agent('a', 'failed'), agent('b', 'input'), agent('c', 'finished')] }, { a: act(), b: act({ mood: 'blocked' }), c: act() });
		expect((await run(prev, next)).toasts).toEqual(['⏸ b blocked:', '✗ a', '✓ c']);
	});
	test('the last line in a completion toast is cut at 40 cells with an ellipsis', async () => {
		const at = async (line: string) => {
			const prev = withActivity({ now: 0, squad: [agent('a', 'running')] }, { a: act({ startedAt: 0 }) });
			const next = withActivity({ now: 0, squad: [agent('a', 'finished')] }, { a: act({ startedAt: 0, lastLine: line }) });
			return (await run(prev, next)).toasts[0]!;
		};
		expect(await at('y'.repeat(40))).toBe(`✓ a · ${'y'.repeat(40)}`);
		expect(await at('y'.repeat(41))).toBe(`✓ a · ${'y'.repeat(39)}…`);
	});
	test('a phase advance plays the sound only when sound is on', async () => {
		const prev = snap({ phase: 'research' });
		const next = snap({ phase: 'implement' });
		expect((await run(prev, next, true)).played).toEqual([{ asset: 'mod/fx/advance.wav' }]);
		expect((await run(prev, next, false)).played).toEqual([]);
		expect((await run(prev, next, true)).toasts).toEqual([]);
	});
	test('the hook hands the event on to the next handler and returns its result', async () => {
		const r = await run(snap(), snap({ phase: 'implement' }));
		expect(r.returned).toEqual({ passed: { id: 'event' } });
	});
	test('a hook that meets a broken snapshot still passes the turn on', async () => {
		let hook: Hook = async () => undefined;
		registerNotify(((_p: unknown, _m: unknown, h: Hook) => { hook = h; return { catch: () => undefined }; }) as unknown as On, { soundEnabled: () => false });
		const $ = { state: { get: () => { throw new Error('bad'); } }, ui: { toast() {} }, prompt: { suggest: async () => ({}) } } as unknown as EngineInterface;
		expect(await hook($, { id: 1 }, async (x) => ['next', x])).toEqual(['next', { id: 1 }]);
	});
});
