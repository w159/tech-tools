// Tests for register.ts agent-list sync + nullable usage mount: the squad is
// synced from the host's own $.agent.list() ground truth each rebuild, unknown
// statuses map to running, and the usage state carries per-figure unknown-ness
// (null until session.measure carries a value; a measured 0 stays a 0).
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register, syncAgentsFromList } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;

interface MountProps {
  snapshot: { squad: { name: string; state: string; source: string }[] };
  usage?: { tokens: number | null; contextPct: number | null };
}

/** Minimal on() registrar capturing handlers by event (matcher narrowed by component). */
function captureOn() {
  const handlers = new Map<string, AnyHandler>();
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const hook = (maybeHook ?? hookOrMatcher) as AnyHandler;
    handlers.set(maybeHook === undefined ? event : `${event}|${String((hookOrMatcher as Record<string, unknown>).component ?? '')}`, hook);
    return { catch() {} };
  }) as unknown as On;
  const pick = (name: string, component?: string): AnyHandler => {
    const found = handlers.get(component === undefined ? name : `${name}|${component}`);
    if (found === undefined) throw new Error(`no ${name}|${component ?? ''} handler registered`);
    return found;
  };
  return { on, pick };
}

/** Engine stub with an injectable agent list (null = no agent surface at all). */
function stubEngine(listed: unknown[] | null, state = memState()): { engine: EngineInterface } {
  const $: Record<string, unknown> = {
    state,
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: {
      now: async () => 1_760_000_000_000,
      every: (_ms: number, _fn: () => void) => ({ cancel() {} }),
      after: () => ({ cancel() {} }),
      sleep: async () => {},
    },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    session: { id: async () => 'sess-agents' },
    fs: {
      read: async () => {
        throw new Error('no fs in test');
      },
      stat: async () => {
        throw new Error('no fs in test');
      },
      exists: async (path: string) => path === '/tmp/proj/.atlas',
      list: async () => [],
    },
    ui: {
      log: () => {},
      invalidate: () => {},
      open: async () => ({ isPlaced: true }),
    },
  };
  if (listed !== null) $.agent = { list: async () => listed };
  return { engine: $ as unknown as EngineInterface };
}

const noopNext: AnyNext = async (input) => input;
/** A rebuild, run to completion: /atlas-todo (the last bare command.run hook) rebuilds after it posts. */
async function rebuildNow(pick: (name: string, component?: string) => AnyHandler, engine: EngineInterface) {
  await pick('command.run', '')(engine, { args: 'x' }, noopNext);
  for (let i = 0; i < 1000; i++) await Promise.resolve();
}

/** Boot an interactive session; session.start builds the first snapshot. */
async function boot(on: On, engine: EngineInterface, _pick: (name: string, component?: string) => AnyHandler) {
  await register(on, {});
  await _pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
}

async function snapshotOf(engine: EngineInterface): Promise<MountProps['snapshot']> {
  const held = await engine.state.get({ plugin: 'atlas', key: 'snapshot' } as never);
  if (held.value === undefined) throw new Error('no snapshot');
  return held.value as MountProps['snapshot'];
}

async function usageOf(engine: EngineInterface): Promise<unknown> {
  return (await engine.state.get({ plugin: 'atlas', key: 'usage' } as never)).value;
}

async function taskSquad(engine: EngineInterface) {
  return (await snapshotOf(engine)).squad.filter((a) => a.source === 'task').map((a) => [a.name, a.state]);
}

describe('register agent-list sync', () => {
  test('host agents land in the squad with mapped states and unknown usage pre-measure', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine([
      { id: 'aa-1', status: 'running' },
      { id: 'aa-2', teammateId: 'ModGate@team', status: 'idle' },
      { id: 'aa-3', status: 'completed' },
      { id: 'aa-4', status: 'waiting' },
    ]);
    await boot(on, engine, pick);
    expect(await taskSquad(engine)).toEqual([
      ['aa-1', 'running'],
      ['ModGate', 'idle'],
      ['aa-3', 'finished'],
      ['aa-4', 'input'],
    ]);
    expect(await usageOf(engine)).toEqual({ tokens: null, contextPct: null });
  });

  test('an unknown AgentStatus reads as running', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine([{ id: 'aa-9', status: 'mystery' }]);
    await boot(on, engine, pick);
    expect(await taskSquad(engine)).toEqual([['aa-9', 'running']]);
  });

  test('a measured zero replaces the unknowns', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine([]);
    await boot(on, engine, pick);
    expect(await usageOf(engine)).toEqual({ tokens: null, contextPct: null });
    await pick('session.measure')(engine, { context: { tokens: 0, percent: 0 }, cost: { usd: 0 } }, noopNext);
    expect(await usageOf(engine)).toEqual({ tokens: 0, contextPct: 0 });
  });

  test('a measure with absent fields leaves the figures unknown', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine([]);
    await boot(on, engine, pick);
    await pick('session.measure')(engine, { context: {}, cost: undefined }, noopNext);
    expect(await usageOf(engine)).toEqual({ tokens: null, contextPct: null });
  });

  test('usage and task agents survive a re-register: they live in $.state, not module variables', async () => {
    const state = memState();
    const first = captureOn();
    const { engine } = stubEngine([], state);
    await boot(first.on, engine, first.pick);
    await first.pick('session.measure')(engine, { context: { tokens: 7, percent: 3 }, cost: { usd: 0.5 } }, noopNext);
    await first.pick('agent.spawn')(engine, { subagentType: 'task', fork: false, model: undefined }, async () => ({ agentId: 'spawn-9' }));
    await rebuildNow(first.pick, engine); // folds the spawn record into the snapshot

    // A hot reload: new module registration, same session state, no session.start.
    const second = captureOn();
    const reloaded = stubEngine([], state);
    await register(second.on, {});
    expect(await usageOf(reloaded.engine)).toEqual({ tokens: 7, contextPct: 3 });
    expect(await taskSquad(reloaded.engine)).toEqual([['spawn-9', 'running']]);
  });

  test('a missing agent surface keeps spawn-recorded agents', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine(null);
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    await pick('agent.spawn')(engine, { subagentType: 'task', fork: false, model: undefined }, async () => ({ agentId: 'spawn-1' }));
    await rebuildNow(pick, engine); // a rebuild folds the spawn record in
    expect(await taskSquad(engine)).toEqual([['spawn-1', 'running']]);
  });
});

describe('syncAgentsFromList identity', () => {
  test('labels by persona/type with the description as task, never the raw host id', () => {
    const out = syncAgentsFromList(
      [
        { id: 'a142cc7b6ed6bec50', description: 'List plugins/atlas/mod', type: 'atlas:explorer', status: 'running' },
        { id: 'b9999999999999999', description: 'Fix it', type: 'general-purpose', status: 'completed' },
        { id: 'c1234567890abcdef', description: '', type: 'teammate', status: 'idle' },
      ],
      [{ name: 'a142cc7b6ed6bec50', persona: 'explorer', state: 'running', source: 'task' }],
    );
    expect(out.map((a) => [a.name, a.persona, a.task, a.state])).toEqual([
      ['explorer', 'explorer', 'List plugins/atlas/mod', 'running'],
      ['fix-it', 'general-purpose', 'Fix it', 'finished'],
      ['c12345', 'unknown', undefined, 'idle'],
    ]);
  });

  test('generic agents are labelled by a short slug of the Agent description; teammates and personas keep their names', () => {
    const out = syncAgentsFromList(
      [
        { id: 'aaaa1111', description: 'List mod pane files for review', type: 'general-purpose', status: 'running' },
        { id: 'bbbb2222', description: 'ignored', teammateId: 'scout@team', status: 'running' },
        { id: 'cccc3333', description: 'ignored', type: 'atlas:explorer', status: 'running' },
      ],
      [],
    );
    expect(out.map((a) => a.name)).toEqual(['list-mod-pane', 'scout', 'explorer']);
  });

  test('duplicate labels get a short id suffix; unlisted spawn records are kept', () => {
    const out = syncAgentsFromList(
      [
        { id: 'aaaa1111', type: 'atlas:explorer', status: 'running' },
        { id: 'bbbb2222', type: 'atlas:explorer', status: 'running' },
      ],
      [{ name: 'pending01', persona: 'verifier', state: 'running', source: 'task' }],
    );
    expect(out.map((a) => a.name)).toEqual(['explorer', 'explorer-bbbb', 'pending01']);
  });
});

describe('syncAgentsFromList dispatch identity', () => {
  test('the Agent call name labels the worker and the spawn type (atlas:explorer) is its persona, even for a teammate-typed row', () => {
    const out = syncAgentsFromList(
      [
        { id: 'a06f54fc229f1c245', description: 'Map sessions tail lines', type: 'teammate', status: 'completed' },
        { id: 'a6839f49ee72a2b14', description: 'Map band row count', type: 'atlas:explorer', status: 'running' },
      ],
      [],
      { a06f54fc229f1c245: { name: 'explore-session-tail', type: 'atlas:explorer' }, a6839f49ee72a2b14: { name: 'explore-band-rows', type: 'atlas:explorer' } },
    );
    expect(out.map((a) => [a.name, a.persona])).toEqual([['explore-session-tail', 'explorer'], ['explore-band-rows', 'explorer']]);
  });
});

describe('stale workers', () => {
  test('host status completed/failed/killed wins over a spawn-recorded running entry', () => {
    const stale = { name: 'a1', persona: 'explorer', state: 'running' as const, source: 'task' as const };
    for (const [status, state] of [['completed', 'finished'], ['failed', 'failed'], ['killed', 'dead']] as const) {
      expect(syncAgentsFromList([{ id: 'a1', type: 'atlas:explorer', status }], [stale])[0]?.state).toBe(state);
    }
  });

  test('liveness is the host list only: listed pending/running/waiting stay live whatever the lead does; completed/failed/killed finish', () => {
    const states = (status: string) => syncAgentsFromList([{ id: 'w1', type: 'atlas:explorer', status }], [], {}, 1_000_000)[0]?.state;
    expect([states('pending'), states('running'), states('waiting')]).toEqual(['spawning', 'running', 'input']);
    expect([states('completed'), states('failed'), states('killed')]).toEqual(['finished', 'failed', 'dead']);
  });

  test('a spawn-recorded entry the host does not list expires only once its spawn is older than 15 s', () => {
    const recorded = [
      { name: 'ghost01', persona: 'explorer', state: 'running' as const, source: 'task' as const },
      { name: 'kept', persona: 'explorer', state: 'running' as const, source: 'task' as const },
    ];
    const listed = [{ id: 'kept', type: 'atlas:explorer', status: 'running' }];
    const meta = { ghost01: { at: 1_000 } };
    const at = (now: number) => syncAgentsFromList(listed, recorded, meta, now).map((a) => [a.name, a.state]);
    expect(at(1_000 + 15_000)).toEqual([['explorer', 'running'], ['ghost01', 'running']]); // young: the host list may lag the spawn
    expect(at(1_000 + 15_001)).toEqual([['explorer', 'running'], ['ghost01', 'finished']]);
    expect(syncAgentsFromList(listed, recorded, {}, 9_999_999).map((a) => a.state)).toEqual(['running', 'running']); // no spawn time: never expire
  });
});
