// register.ts edges pinned by mutation survivors: label building in mapListed, HUD row arithmetic, the
// worktree throttle, host-finished workers, pane-log calls, the sidebar note path, the core cache and its
// gates. Plain unit tests of the exports plus the real hooks on a recording engine stub; no node: imports.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { EMPTY_ORCH, onSpawn, onToolStart } from './data/orchestration';
import { busySnap } from './live_fixture';
import { coreTick, hudStarvedAtFullLine, inlineBelowRows, mapListed, register, resetCore, syncAgentsFromList } from './register';
import type { SquadAgent } from './contract';
import { memState } from './test_helpers';

// ---- mapListed: labels and personas ----

const row = (over: Partial<{ id: string; teammateId: string; description: string; type: string; status: string }> = {}) => ({ id: 'a1b2c3d4e5f6a7b8', status: 'running', ...over });
const recorded = (name: string, persona: string): SquadAgent => ({ name, persona, state: 'running', source: 'task' });

describe('mapListed labels', () => {
  test('a generic agent is labelled by the first three words of its description', () => {
    const [m] = mapListed([row({ type: 'general-purpose', description: 'List the mod pane extra words' })], []);
    expect(m?.agent.name).toBe('list-the-mod');
    expect(m?.agent.task).toBe('List the mod pane extra words');
    expect(mapListed([row({ type: 'general-purpose', description: 'one' })], [])[0]?.agent.name).toBe('one');
  });

  test('the persona recorded at spawn labels a typeless row, but a recorded unknown does not', () => {
    const rec = recorded('a1b2c3d4e5f6a7b8', 'explorer');
    expect(mapListed([row({ type: 'teammate' })], [rec])[0]?.agent).toMatchObject({ name: 'explorer', persona: 'explorer' });
    const unknown = recorded('a1b2c3d4e5f6a7b8', 'unknown');
    expect(mapListed([row({ type: 'teammate' })], [unknown])[0]?.agent).toMatchObject({ name: 'a1b2c3', persona: 'unknown' });
  });

  test('every row gets a string label, the id prefix as the last resort', () => {
    const out = mapListed([row({ type: 'atlas:Verifier' }), row({ id: 'ffffffffffffffff' }), row({ id: '1234567890abcdef', type: 'teammate', teammateId: 'impl-a@s' })], []);
    expect(out.map((m) => m.agent.name)).toEqual(['verifier', 'ffffff', 'impl-a']);
    expect(syncAgentsFromList([row({ type: 'atlas:Verifier' })], []).map((a) => a.name)).toEqual(['verifier']);
  });
});

describe('D5 duplicate labels read as ordinals, never a host id', () => {
  test('D5: two explorers with no description are `explorer` and `explorer #2`', () => {
    const out = mapListed([row({ id: 'aaaa1111', type: 'atlas:explorer' }), row({ id: 'bbbb2222', type: 'atlas:explorer' }), row({ id: 'cccc3333', type: 'atlas:explorer' })], []);
    expect(out.map((m) => m.agent.name)).toEqual(['explorer', 'explorer #2', 'explorer #3']);
  });
  test('D5: a label an earlier id still holds gives the new id the next ordinal', () => {
    const out = mapListed([row({ id: 'dddd4444', type: 'atlas:explorer' })], [], {}, { aaaa1111: 'explorer', bbbb2222: 'explorer #2' });
    expect(out[0]!.agent.name).toBe('explorer #3');
  });
  test('D5: the dispatch name is the label, with no suffix when names differ', () => {
    const out = mapListed([row({ id: 'aaaa1111', type: 'atlas:explorer', description: 'alpha-explorer: map x' }), row({ id: 'bbbb2222', type: 'atlas:explorer', description: 'beta-explorer: map y' })], []);
    expect(out.map((m) => m.agent.name)).toEqual(['alpha-explorer', 'beta-explorer']);
  });
  test('D5: a true collision on a dispatch name is `alpha-explorer #2`', () => {
    const out = mapListed([row({ id: 'aaaa1111', type: 'atlas:explorer', description: 'alpha-explorer: a' }), row({ id: 'bbbb2222', type: 'atlas:explorer', description: 'alpha-explorer: b' })], []);
    expect(out.map((m) => m.agent.name)).toEqual(['alpha-explorer', 'alpha-explorer #2']);
  });
});

describe('HUD row arithmetic', () => {
  test('hudStarvedAtFullLine is true only when strictly fewer rows show than wanted', () => {
    const shownAt = (cap: number): number => cap;
    expect(hudStarvedAtFullLine(10, 11, shownAt, null)).toBe(true);
    expect(hudStarvedAtFullLine(10, 10, shownAt, null)).toBe(false);
    expect(hudStarvedAtFullLine(10, 9, shownAt, null)).toBe(false);
    // the full status line takes 3 more rows: 10 - 3 = 7 shown against 8 wanted
    expect(hudStarvedAtFullLine(10, 8, shownAt, { ts: 1, rows: 1, fullRows: 4 })).toBe(true);
    expect(hudStarvedAtFullLine(10, 7, shownAt, { ts: 1, rows: 1, fullRows: 4 })).toBe(false);
  });

  test('inlineBelowRows adds prompt 3, status line (5 unknown), mode+blank 2, blank 1, and the agent list', () => {
    expect(inlineBelowRows(null, 0)).toBe(11);
    expect(inlineBelowRows(2, 0)).toBe(8);
    expect(inlineBelowRows(null, 1)).toBe(13);
    expect(inlineBelowRows(4, 3)).toBe(3 + 4 + 2 + 1 + 4);
  });
});

// ---- engine stub ----

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

function captureOn() {
  const handlers: { event: string; matcher: Record<string, unknown> | undefined; hook: AnyHandler }[] = [];
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    handlers.push({ event, matcher, hook: (maybeHook ?? hookOrMatcher) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const one = (event: string, key?: [string, unknown]): AnyHandler => {
    const found = handlers.find((h) => h.event === event && (key === undefined || h.matcher?.[key[0]] === key[1]));
    if (!found) throw new Error(`no ${event} handler`);
    return found.hook;
  };
  return { on, one };
}

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const fakeEls = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') };
const kidsOf = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const walk = (n: Node): Node[] => [n, ...kidsOf(n).flatMap(walk)];

/** Later tests need a clock past every earlier one: the worktree throttle is module state. */
const clock = { now: 1_900_000_000_000 };
const ROOT = '/tmp/proj';
const RUN = `${ROOT}/.atlas/.run`;

function stubEngine(seed: Record<string, unknown> = {}) {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '' };
  const mtimes: Record<string, number> = {};
  const rec = { runs: [] as string[][], toasts: [] as string[], reads: [] as string[], ticks: [] as (() => void)[] };
  const agents: { list: unknown[] } = { list: [] };
  let responder: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string } | undefined = () => undefined;
  const state = memState(seed);
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: {
      now: async () => clock.now,
      every: (_ms: number, fn: () => void) => { rec.ticks.push(fn); return { cancel() {} }; },
      after: () => ({ cancel() {} }),
      sleep: async () => {},
    },
    session: { id: async () => 'sess-abc123def456' },
    process: {
      run: async (argv: readonly string[]) => {
        rec.runs.push([...argv]);
        return responder(argv) ?? { exitCode: 0, stdout: 'main', stderr: '' };
      },
    },
    fs: {
      read: async (p: string) => { rec.reads.push(p); if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: mtimes[p] ?? 0 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => agents.list },
    state,
    audio: { play: async () => {} },
    ui: {
      log: () => {},
      invalidate: () => {},
      open: async () => ({ isPlaced: true as const }),
      toast: (t: string) => { rec.toasts.push(t); },
      resolve: () => fakeEls,
      status: () => {},
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return { $: $ as unknown as EngineInterface, files, mtimes, rec, agents, state, respond: (f: typeof responder) => { responder = f; } };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };
const stateOf = async (s: ReturnType<typeof stubEngine>, key: string): Promise<any> => (await s.state.get({ plugin: 'atlas', key } as never)).value;

async function boot(s: ReturnType<typeof stubEngine>, cap = captureOn()) {
  resetCore();
  await register(cap.on, {});
  await cap.one('session.start')(s.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  await settle();
  return cap;
}

/** Run the rebuild tick (REBUILD_MS, the first timer) after moving the agent list so the fingerprint changes. */
async function rebuildTick(s: ReturnType<typeof stubEngine>): Promise<void> {
  s.rec.ticks[0]!();
  await settle();
}

describe('session boot and rebuild', () => {
  test('the folder half of the cwd names the lead channel candidate (`<folder>@<branch>`)', async () => {
    const s = stubEngine();
    s.files[`${RUN}/channels.json`] = JSON.stringify({ channels: { 'proj@main': { members: [{ name: 'w1', role: 'implementer' }] } } });
    await boot(s);
    const snap = await stateOf(s, 'snapshot');
    expect(snap.channel).toBe('proj@main');
    expect(snap.members.map((m: { name: string }) => m.name)).toEqual(['w1']);
  });

  test('atlas_wt.py status runs at most every 5 s of the clock', async () => {
    const s = stubEngine();
    const cap = await boot(s);
    void cap;
    const wtRuns = (): number => s.rec.runs.filter((a) => a[1]?.endsWith('atlas_wt.py')).length;
    const step = async (dt: number, id: string): Promise<void> => {
      clock.now += dt;
      s.agents.list = [{ id, status: 'running' }];
      await rebuildTick(s);
    };
    await step(10_000, 'w-a'); // far past the last run: runs
    expect(wtRuns()).toBe(1);
    expect(s.rec.runs.find((a) => a[1]?.endsWith('atlas_wt.py'))).toEqual(['python3', '/plugins/atlas/scripts/atlas_wt.py', '--root', ROOT, 'status']);
    await step(1_000, 'w-b'); // inside the window: no new run
    expect(wtRuns()).toBe(1);
    await step(4_000, 'w-c'); // exactly 5 s after the run: runs again
    expect(wtRuns()).toBe(2);
  });

  test('a worker the host lists as failed, killed or completed is reported with the matching outcome', async () => {
    const s = stubEngine();
    await boot(s);
    let orch = EMPTY_ORCH;
    for (const id of ['f1', 'k1', 'c1', 'r1']) orch = onToolStart(onSpawn(orch, id, 'work', clock.now, { name: `w-${id}` }), id, 'Read', clock.now);
    await s.state.set({ plugin: 'atlas', key: 'orch' }, orch);
    clock.now += 10_000;
    s.agents.list = [{ id: 'f1', status: 'failed' }, { id: 'k1', status: 'killed' }, { id: 'c1', status: 'completed' }, { id: 'r1', status: 'running' }];
    await rebuildTick(s);
    const after = await stateOf(s, 'orch');
    expect(['f1', 'k1', 'c1', 'r1'].map((id) => [id, after.stage[id], after.activity[id].mood])).toEqual([
      ['f1', 'reported', 'failed'],
      ['k1', 'reported', 'failed'],
      ['c1', 'reported', 'done'],
      ['r1', 'working', 'working'],
    ]);
  });

  test('pane-log tool uses that appear after the first read become calls (the first read is the baseline)', async () => {
    const s = stubEngine();
    s.files[`${RUN}/channels.json`] = JSON.stringify({ channels: { 'proj@main': { members: [{ name: 'worker-1', role: 'implementer' }] } } });
    s.respond((argv) => (argv[1]?.endsWith('atlas_mux.py') ? { exitCode: 0, stdout: JSON.stringify({ transport: 'tmux', workers: [{ name: 'worker-1', dead: false }], board: [] }), stderr: '' } : undefined));
    const cap = await boot(s);
    void cap;
    const use = (id: string): string => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: `/a/${id}.ts` } }] } });
    const log = `${RUN}/logs/worker-1.log`;
    const callsNow = async (): Promise<number[]> => (await stateOf(s, 'snapshot')).activity['worker-1']?.calls ?? [];
    const muxTick = (): void => s.rec.ticks[2]!();
    s.files[log] = '';
    muxTick();
    await settle();
    expect(await callsNow()).toEqual([]);
    clock.now += 1_000;
    s.files[log] = use('u1');
    muxTick();
    await settle();
    const t2 = clock.now;
    expect(await callsNow()).toEqual([t2]);
    clock.now += 1_000;
    s.files[log] = `${use('u1')}\n${use('u2')}\n${use('u3')}`;
    muxTick();
    await settle();
    expect(await callsNow()).toEqual([t2, clock.now, clock.now]);
    clock.now += 1_000;
    muxTick(); // nothing new in the log: no new calls
    await settle();
    expect(await callsNow()).toEqual([t2, clock.now - 1_000, clock.now - 1_000]);
  });
});

describe('sidebar note', () => {
  test('submitting the message input posts the note to the lead on the snapshot channel, clears the draft and toasts', async () => {
    const snapshot = { ...busySnap(), root: ROOT, channel: 'lead-abc123', sessionId: 'sess-abc123def456' };
    const s = stubEngine({ 'atlas/snapshot': snapshot, 'atlas/isModOn': true, 'atlas/atlasView': 'team', 'atlas/sidebarDraft': 'ping' });
    const cap = captureOn();
    await register(cap.on, {});
    const tree = (await cap.one('ui.render', ['component', 'Pane'])(s.$, { surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { bodyColumns: 70, scroll: { offset: 0, bodyRows: 40 } } }, noopNext)) as Node;
    const input = walk(tree).find((n) => n.kind === 'Input' && n.props.key === 'msg');
    expect(input?.props.value).toBe('ping');
    input!.props.onSubmit('ping');
    await settle();
    const argv = s.rec.runs.find((a) => a.includes('note'));
    expect(argv).toBeDefined();
    expect(argv!.slice(argv!.indexOf('--root'), argv!.indexOf('--root') + 2)).toEqual(['--root', ROOT]);
    expect(argv!.filter((a, i) => a === '--channel' && argv![i + 1] === 'lead-abc123')).toHaveLength(2);
    expect(argv!.slice(argv!.indexOf('--to'), argv!.indexOf('--to') + 2)).toEqual(['--to', 'lead']);
    expect(argv!.at(-1)).toBe('ping');
    expect(s.rec.toasts).toContain('Sent to lead');
    expect(await stateOf(s, 'sidebarDraft')).toBe('');
  });

  test('a snapshot with no board root refuses the note with a toast and keeps the draft', async () => {
    const snapshot = { ...busySnap(), root: '', channel: null };
    const s = stubEngine({ 'atlas/snapshot': snapshot, 'atlas/isModOn': true, 'atlas/atlasView': 'team', 'atlas/sidebarDraft': 'ping' });
    const cap = captureOn();
    await register(cap.on, {});
    const tree = (await cap.one('ui.render', ['component', 'Pane'])(s.$, { surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { bodyColumns: 70, scroll: { offset: 0, bodyRows: 40 } } }, noopNext)) as Node;
    walk(tree).find((n) => n.kind === 'Input' && n.props.key === 'msg')!.props.onSubmit('ping');
    await settle();
    expect(s.rec.runs.some((a) => a.includes('note'))).toBe(false);
    expect(s.rec.toasts.length).toBe(1);
    expect(s.rec.toasts[0]).toMatch(/^atlas: bad channel/);
    expect(await stateOf(s, 'sidebarDraft')).toBe('ping');
  });
});

describe('core cache and gates', () => {
  const verdict = JSON.stringify([{ id: 'a', status: 'verified', title: 'title a', evidence: ['ev'], verified_at: '2026-10-27T08:00:00+00:00', verified_by: 'atlas:verifier' }]);
  const seeded = (over: Record<string, unknown> = {}) => {
    const s = stubEngine({ 'atlas/snapshot': { root: ROOT, todos: [], contract: { headerFirstLinePattern: '' } }, 'atlas/isModOn': true, 'atlas/isInteractive': true, ...over });
    s.files[`${RUN}/findings.json`] = verdict;
    resetCore();
    return s;
  };
  const findingsReads = (s: ReturnType<typeof stubEngine>): number => s.rec.reads.filter((p) => p.endsWith('findings.json')).length;

  test('an unchanged file is read once; a new mtime or size re-reads it and the new text wins', async () => {
    const s = seeded();
    await coreTick(s.$);
    await coreTick(s.$);
    expect(findingsReads(s)).toBe(1);
    s.mtimes[`${RUN}/findings.json`] = 5;
    s.files[`${RUN}/findings.json`] = verdict.replace('verified', 'rejected');
    await coreTick(s.$);
    expect(findingsReads(s)).toBe(2);
    expect((await stateOf(s, 'core')).verdicts.map((v: { status: string }) => v.status)).toEqual(['rejected']);
    expect(s.rec.toasts).toEqual([]); // critique 16 C2: a refuted verdict raises no host toast
  });

  test('coreTick builds only for an interactive session with the mod on', async () => {
    const off = seeded({ 'atlas/isModOn': false });
    await coreTick(off.$);
    expect(await stateOf(off, 'core')).toBeUndefined();
    expect(findingsReads(off)).toBe(0);
    const headless = seeded({ 'atlas/isInteractive': false });
    await coreTick(headless.$);
    expect(await stateOf(headless, 'core')).toBeUndefined();
    expect(findingsReads(headless)).toBe(0);
    const live = seeded();
    await coreTick(live.$);
    expect((await stateOf(live, 'core')).verdicts).toHaveLength(1);
  });

  test('open gates count every script group but ignore a stale stored header group (the header is rebuilt)', async () => {
    const line = (id: string) => ({ id, label: id, ok: false });
    const s = seeded({
      'atlas/gates': [{ id: 'completion', title: 'Gates', lines: [line('x')] }, { id: 'header', title: 'stale', lines: [line('h1'), line('h2')] }],
    });
    await coreTick(s.$);
    expect((await stateOf(s, 'core')).contract.openGates).toBe(1);
  });
});
