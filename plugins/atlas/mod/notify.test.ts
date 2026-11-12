// Tests for notify.ts — covers: pure diffSnapshots events (agent ✓/✗, note to
// lead/human with 60-char preview, todo completed, phase advance), no-change and
// first-sight (null prev) yielding [], and malformed snapshots never throwing.
import { describe, expect, test } from 'claude-code/testing';
import type { AtlasSnapshot, ChannelNote, SquadAgent, TodoItem } from './contract';
import type { EngineInterface, On } from 'claude-code';
import { memState } from './test_helpers';
import { cells } from './atlas-ui';
import { diffSnapshots, isOlder, mergeToasts, nextStepSuggestion, registerNotify, TOAST_MAX, TOAST_MS } from './notify';

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
		// critique 15 A1: failure is terminal, a failed worker later read as finished raises no done toast
		expect(diffSnapshots(failed, snap({ squad: [agent('a', 'finished')] }))).toEqual([]);
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
	test('toasts state, name and fact for a failed worker and makes the single suggestion', async () => {
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
		expect(toasts).toEqual(['▌ ◆ ATLAS  ■ failed  a']);
		expect(suggested).toEqual(['research: build', 'research: build']);
	});
});

describe('registerNotify ordering', () => {
	test('a snapshot older than the last applied one (lower seq) is ignored: working -> done toasts once', async () => {
		let hook: (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<unknown> = async () => undefined;
		registerNotify(((_p: unknown, _m: unknown, h: typeof hook) => { hook = h; return { catch: () => undefined }; }) as unknown as On, { soundEnabled: () => false });
		const toasts: string[] = [];
		const mem = memState({ 'atlas/snapshot': null });
		const $ = { state: mem, ui: { toast: (t: string) => toasts.push(t) }, prompt: { suggest: async () => ({ isShown: true }) } } as unknown as EngineInterface;
		const put = (s: AtlasSnapshot) => (mem.set as (...a: unknown[]) => Promise<unknown>)({ plugin: 'atlas', key: 'snapshot' }, s);
		const working = (seq: number) => snap({ squad: [agent('beta-explorer', 'running')], seq });
		const done = (seq: number) => snap({ squad: [agent('beta-explorer', 'failed')], seq });
		await put(working(1));
		await hook($, {}, async (x) => x);
		await put(done(2));
		await hook($, {}, async (x) => x); // failed toast
		await put(working(1)); // a late, older write lands last
		await hook($, {}, async (x) => x);
		await put(done(2));
		await hook($, {}, async (x) => x); // must not toast failed a second time
		expect(toasts.filter((t) => t.includes('failed'))).toHaveLength(1);
		expect(toasts.filter((t) => t.includes('beta-explorer'))).toHaveLength(1);
	});

	test('isOlder: only a lower seq than the applied one is older; unstamped snapshots are never older', () => {
		expect(isOlder(snap({ seq: 5 }), snap({ seq: 4 }))).toBe(true);
		expect(isOlder(snap({ seq: 5 }), snap({ seq: 5 }))).toBe(false);
		expect(isOlder(snap({ seq: 5 }), snap({ seq: 6 }))).toBe(false);
		expect(isOlder(snap({ seq: 5 }), snap())).toBe(false);
		expect(isOlder(snap(), snap({ seq: 1 }))).toBe(false);
		expect(isOlder(null, snap({ seq: 1 }))).toBe(false);
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
	test('the toast age is the worker\'s own run (start to finish), not start to the turn that noticed it (critique 8: toast 32s, card 18s)', () => {
		const prev = withActivity({ now: 20_000, squad: [agent('a', 'running')] }, { a: act({ startedAt: 2_000 }) });
		const next = withActivity({ now: 34_000, squad: [agent('a', 'finished')] }, { a: act({ startedAt: 2_000, since: 20_000, lastLine: 'x' }) });
		expect(diffSnapshots(prev, next)).toEqual([{ type: 'agent-complete', name: 'a', age: '18s', lastLine: 'x' }]);
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
		// One toast per turn: a burst of six left the stack undrawn and the host printed a notice into the transcript.
		// `+N more` counts only the other toasts of the first one's kind (critique 11): one waiting agent among failures, spawns and todos is alone.
		expect(toasts).toEqual(['▌ ◆ ATLAS  ◉ waiting  wait']);
		expect(cells(toasts[0]!)).toBeLessThanOrEqual(TOAST_MAX);
		expect(toasts[0]).not.toMatch(/[✓✗⏸▸]/u);
	});
	test('critique 12 C2 / 14 B4: one toast row per turn boundary (two stacked boxes cut the 150 column transcript); a failure never waits and a routine finish sends none', async () => {
		let hook: Hook = async () => undefined;
		registerNotify(((_p: unknown, _m: unknown, h: Hook) => { hook = h; return { catch: () => undefined }; }) as unknown as On, { soundEnabled: () => false });
		const shown: { text: string; opts: unknown }[] = [];
		const mem = memState({ 'atlas/snapshot': null });
		const $ = {
			state: mem,
			ui: { toast: (text: string, opts?: unknown) => shown.push({ text, opts }) },
			prompt: { suggest: async () => ({ isShown: true }) },
			audio: { play: () => Promise.resolve() },
		} as unknown as EngineInterface;
		const put = (s: AtlasSnapshot) => (mem.set as (...a: unknown[]) => Promise<unknown>)({ plugin: 'atlas', key: 'snapshot' }, s);
		const names = ['alpha', 'beta', 'gamma', 'delta'];
		const at = (now: number, states: string[], seq: number): AtlasSnapshot => ({
			...withActivity({ now, squad: names.map((n, i) => agent(n, states[i] as never)) }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })]))),
			seq,
		});
		const turn = async (s: AtlasSnapshot) => { await put(s); await hook($, {}, async (x) => x); };
		await turn(at(0, ['running', 'running', 'running', 'running'], 1));
		await turn(at(10_000, ['finished', 'running', 'running', 'running'], 2)); // a routine finish: no host toast at all (B4)
		expect(shown).toHaveLength(0);
		await turn(at(11_000, ['finished', 'failed', 'running', 'running'], 3)); // a failure: shown at once
		expect(shown.map((t) => t.text)).toEqual(['▌ ◆ ATLAS  ■ failed  beta']);
		expect(shown[0]!.opts).toEqual({ timeoutMs: TOAST_MS });
		await turn(at(12_000, ['finished', 'failed', 'failed', 'failed'], 4)); // 1s later, two more failures: never held, folded into one row
		expect(shown).toHaveLength(2);
		expect(shown[1]!.text).toBe('▌ ◆ ATLAS  ■ failed  gamma +1 more');
		expect(cells(shown[1]!.text)).toBeLessThanOrEqual(TOAST_MAX);
	});
	test('critique 14 B4: a routine start or finish sends no host toast (it overlaid the transcript and cut names: `alpha-expl... +1 more`); failures, waits and notes still do', async () => {
		const names = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];
		const prev = withActivity({ now: 0, todos: [todo('t1', 'in_progress', 'task one')], squad: names.slice(0, 2).map((n) => agent(n, 'running')) }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })])));
		const routine = withActivity({ now: 13_000, todos: [todo('t1', 'completed', 'task one')], squad: [agent(names[0]!, 'finished'), agent(names[1]!, 'finished'), agent(names[2]!, 'running')] }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })])));
		expect((await run(prev, routine)).toasts).toEqual([]);
		const failing = withActivity({ now: 13_000, todos: [todo('t1', 'completed', 'task one')], squad: [agent(names[0]!, 'finished'), agent(names[1]!, 'failed'), agent(names[2]!, 'running')] }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })])));
		expect((await run(prev, failing)).toasts).toEqual(['▌ ◆ ATLAS  ■ failed  beta-explorer']);
		const waiting = withActivity({ now: 13_000, squad: [agent(names[0]!, 'finished'), agent(names[1]!, 'input'), agent(names[2]!, 'running')] }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })])));
		expect((await run(prev, waiting)).toasts).toEqual(['▌ ◆ ATLAS  ◉ waiting  beta-explorer']); // the fact would push the row past the host's 40 cell text box
		expect((await run(snap(), snap({ notes: [note(1, 'lead', 'ship it')] }))).toasts).toHaveLength(1);
	});
	test('trailing blanks are trimmed from fail and blocked toasts; complete without age or line is bare', async () => {
		const prev = withActivity({ squad: [agent('a', 'running'), agent('b', 'running'), agent('c', 'running')] }, { a: act(), b: act(), c: act() });
		const next = withActivity({ squad: [agent('a', 'failed'), agent('b', 'input'), agent('c', 'finished')] }, { a: act(), b: act({ mood: 'blocked' }), c: act() });
		expect((await run(prev, next)).toasts).toEqual(['▌ ◆ ATLAS  ◉ waiting  b  needs a reply']);
	});
	test('mergeToasts: one passes through, many fold into one row of at most TOAST_MAX cells, the count last', () => {
		expect(mergeToasts([])).toBeNull();
		expect(mergeToasts(['● done  a'])).toBe('● done  a');
		expect(cells(mergeToasts(['x'.repeat(120), 'y'.repeat(80)])!)).toBe(TOAST_MAX);
		expect(mergeToasts(['x'.repeat(120), 'y'.repeat(80)])!.endsWith(' +1 more')).toBe(true);
		expect(mergeToasts(['a'.repeat(30), 'b'])).toBe(`${'a'.repeat(30)} +1 more`);
		expect(mergeToasts(['a'.repeat(34), 'b'])).toBe(`${'a'.repeat(34)} +1`); // the long count would not fit: the short one keeps the whole text
		expect(mergeToasts(['a'.repeat(37), 'b'])).toBe(`${'a'.repeat(37)} +1`);
		expect(mergeToasts(['a'.repeat(38), 'b'])!.endsWith(' +1 more')).toBe(true); // not even the short count fits: clip, long count
		expect(cells(mergeToasts([{ text: 'wide '.repeat(20) }])!)).toBeLessThanOrEqual(TOAST_MAX); // a lone toast never wraps either
	});
	test('critique 11 C2 / 14 B4: +N counts only the other failures of the same burst, and the short count keeps the whole name (`alpha-expl... +1 more` cut it)', async () => {
		const names = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];
		const prev = withActivity({ now: 0, todos: ['t1', 't2', 't3', 't4', 't5'].map((id) => todo(id, 'in_progress', `task ${id}`)), squad: names.map((n) => agent(n, 'running')) }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })])));
		const next = withActivity({ now: 12_000, todos: ['t1', 't2', 't3', 't4', 't5'].map((id) => todo(id, 'completed', `task ${id}`)), squad: names.map((n) => agent(n, 'failed')) }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })])));
		const { toasts } = await run(prev, next);
		expect(toasts).toEqual(['▌ ◆ ATLAS  ■ failed  alpha-explorer +2']);
		expect(cells(toasts[0]!)).toBeLessThanOrEqual(TOAST_MAX); // the host's 40 cell text box: no mid-phrase wrap (`after` / `11s +1 more`)
		const one = await run(prev, withActivity({ now: 12_000, squad: [agent(names[0]!, 'failed'), agent(names[1]!, 'running'), agent(names[2]!, 'running')] }, Object.fromEntries(names.map((n) => [n, act({ startedAt: 0 })]))));
		expect(one.toasts[0]).not.toContain('+'); // a lone failure has nobody to count
	});
	test('B5: a failed or blocked worker toast carries no free text either', async () => {
		const prev = withActivity({ squad: [agent('a', 'running'), agent('b', 'running')] }, { a: act(), b: act() });
		const next = withActivity({ squad: [agent('a', 'failed'), agent('b', 'input')] }, { a: act({ lastLine: 'Traceback (most recent call last)' }), b: act({ lastLine: 'which path?', mood: 'blocked' }) });
		const t = (await run(prev, next)).toasts[0]!;
		expect(t).not.toMatch(/Traceback|which path/);
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
