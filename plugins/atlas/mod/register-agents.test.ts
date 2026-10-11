// Tests for register.ts agent-list sync + nullable usage mount: the squad is
// synced from the host's own $.agent.list() ground truth each rebuild, unknown
// statuses map to running, and the band mount carries per-figure unknown-ness
// (null until session.measure carries a value; a measured 0 stays a 0).
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register } from './register';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;

interface MountProps {
  snapshot: { squad: { name: string; state: string; source: string }[] };
  usage?: { tokens: number | null; costUsd: number | null; contextPct: number | null };
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

interface ClientMount {
  key: string;
  module: string;
  props: MountProps;
}

interface Rec {
  mounts: ClientMount[];
}

/** Engine stub with an injectable agent list (null = no agent surface at all). */
function stubEngine(listed: unknown[] | null): { engine: EngineInterface; rec: Rec } {
  const rec: Rec = { mounts: [] };
  const $: Record<string, unknown> = {
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
      resolve: () => ({
        Client: (args: unknown) => {
          rec.mounts.push(args as ClientMount);
          return 'MOUNT';
        },
      }),
    },
  };
  if (listed !== null) $.agent = { list: async () => listed };
  return { engine: $ as unknown as EngineInterface, rec };
}

const noopNext: AnyNext = async (input) => input;
const BAND_EVENT = {
  surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 200, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const;

/** Boot an interactive session, then render the band once. */
async function boot(on: On, engine: EngineInterface, pick: (name: string, component?: string) => AnyHandler) {
  await register(on, {});
  await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
  await pick('ui.render', 'AbovePrompt')(engine, BAND_EVENT, noopNext);
}

function mountAt(rec: Rec, i: number): MountProps {
  const mount = rec.mounts[i];
  if (mount === undefined) throw new Error(`no band mount #${i}`);
  return mount.props;
}

function taskSquad(mount: MountProps | undefined) {
  if (mount === undefined) throw new Error('no band mount');
  return mount.snapshot.squad.filter((a) => a.source === 'task').map((a) => [a.name, a.state]);
}

describe('register agent-list sync', () => {
  test('host agents land in the squad with mapped states and unknown usage pre-measure', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine([
      { id: 'aa-1', status: 'running' },
      { id: 'aa-2', name: 'ModGate', status: 'idle' },
      { id: 'aa-3', status: 'completed' },
      { id: 'aa-4', status: 'waiting' },
    ]);
    await boot(on, engine, pick);
    expect(taskSquad(mountAt(rec, 0))).toEqual([
      ['aa-1', 'running'],
      ['ModGate', 'idle'],
      ['aa-3', 'finished'],
      ['aa-4', 'input'],
    ]);
    expect(mountAt(rec, 0).usage).toEqual({ tokens: null, costUsd: null, contextPct: null });
  });

  test('an unknown AgentStatus reads as running', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine([{ id: 'aa-9', status: 'mystery' }]);
    await boot(on, engine, pick);
    expect(taskSquad(mountAt(rec, 0))).toEqual([['aa-9', 'running']]);
  });

  test('a measured zero replaces the unknowns on the mount', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine([]);
    await boot(on, engine, pick);
    expect(mountAt(rec, 0).usage).toEqual({ tokens: null, costUsd: null, contextPct: null });
    await pick('session.measure')(engine, { context: { tokens: 0, percent: 0 }, cost: { usd: 0 } }, noopNext);
    await pick('ui.render', 'AbovePrompt')(engine, BAND_EVENT, noopNext);
    expect(mountAt(rec, 1).usage).toEqual({ tokens: 0, costUsd: 0, contextPct: 0 });
  });

  test('a measure with absent fields leaves the figures unknown', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine([]);
    await boot(on, engine, pick);
    await pick('session.measure')(engine, { context: {}, cost: undefined }, noopNext);
    await pick('ui.render', 'AbovePrompt')(engine, BAND_EVENT, noopNext);
    expect(mountAt(rec, 1).usage).toEqual({ tokens: null, costUsd: null, contextPct: null });
  });

  test('a missing agent surface keeps spawn-recorded agents', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine(null);
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    await pick('agent.spawn')(engine, { subagentType: 'task', fork: false, model: undefined }, async () => ({ agentId: 'spawn-1' }));
    // A rebuild (any cli intent through ui.message) folds the spawn record in.
    const res = (await pick('ui.message')(engine, {
      surface: 'terminal', component: 'Pane', requestId: 'atlas', module: './band.tsx',
      data: { t: 'todo.claim', id: 't1', owner: 'me' },
    }, noopNext)) as { props?: MountProps };
    expect(taskSquad(res.props)).toEqual([['spawn-1', 'running']]);
    expect(rec.mounts).toEqual([]);
  });
});
