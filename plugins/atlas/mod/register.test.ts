// Tests for register.ts — run with `bun test --preload /tmp/cc_testing_preload.ts
// plugins/atlas/mod/register.test.ts` (shim maps 'claude-code/testing' to bun:test)
// or `claude plugin test plugins/atlas`. Covers the three required behaviors:
// the ATLAS_MOD=off kill switch, exact intent argv passthrough, and headless
// inertness (no ui.*, no timers, no commands). A fourth case pins the stop
// confirmation: $.ui.ask gates the atlas_mux kill.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { intentToArgv } from './intents';
import { register } from './register';

// ---- structural event shapes (d.ts: SessionStartInput, RenderInputOf, UiMessageArgument) ----

interface SessionStartEvent {
  cwd: string;
  surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' | null;
  isInteractive: boolean;
}
interface MessageEvent {
  surface: 'terminal';
  component: 'AbovePrompt' | 'Pane';
  requestId: string;
  element: string;
  module: string;
  data: unknown;
}

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;

/** Minimal on() registrar: captures handlers by event (matcher narrowed by component). */
function captureOn() {
  const handlers = new Map<string, { matcher?: Record<string, unknown>; hook: AnyHandler }>();
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    const hook = (maybeHook ?? hookOrMatcher) as AnyHandler;
    handlers.set(matcher === undefined ? event : `${event}|${String(matcher.component ?? '')}`, { matcher, hook });
    return { catch() {} };
  }) as unknown as On;
  const pick = (name: string, component?: string): AnyHandler => {
    const key = component === undefined ? name : `${name}|${component}`;
    const found = handlers.get(key);
    if (found === undefined) throw new Error(`no ${key} handler registered`);
    return found.hook;
  };
  return { on, pick };
}

/** Recording stub of the engine surface register.ts touches. */
function stubEngine(env: Record<string, string> = {}) {
  const rec = {
    runs: [] as string[][],
    ui: [] as string[],
    asks: [] as string[],
    timers: [] as number[],
    commands: [] as string[],
    askAnswer: 'Kill it',
  };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async (name: string) => env[name] },
    clock: {
      now: async () => 1_760_000_000_000,
      every: (ms: number, _fn: () => void) => {
        rec.timers.push(ms);
        return { cancel() {} };
      },
      after: () => ({ cancel() {} }),
      sleep: async () => {},
    },
    process: {
      run: async (argv: readonly string[]) => {
        rec.runs.push([...argv]);
        return { exitCode: 0, stdout: 'main', stderr: '' };
      },
    },
    session: { id: async () => 'sess-abc123def456' },
    fs: {
      read: async () => {
        throw new Error('no fs in test');
      },
      stat: async () => {
        throw new Error('no fs in test');
      },
      exists: async () => false,
      list: async () => [],
    },
    state: {
      get: async () => ({ value: undefined, version: 0 }),
      set: async () => ({ isSet: true as const, version: 1 }),
    },
    ui: {
      log: () => rec.ui.push('log'),
      toast: () => rec.ui.push('toast'),
      invalidate: () => rec.ui.push('invalidate'),
      open: async () => {
        rec.ui.push('open');
        return { isPlaced: true as const };
      },
      resolve: () => {
        rec.ui.push('resolve');
        throw new Error('no drawing in test');
      },
      ask: async (question: string) => {
        rec.asks.push(question);
        return rec.askAnswer;
      },
    },
    command: {
      register: async (spec: { name: string }) => {
        rec.commands.push(spec.name);
        return { command: spec.name };
      },
    },
  };
  return { engine: $ as unknown as EngineInterface, rec };
}

const noopNext: AnyNext = async (input) => input;

/** Narrow an IntentResult to its cli argv, failing the test otherwise. */
function cliArgv(result: ReturnType<typeof intentToArgv>): string[] {
  if (result.ok && result.kind === 'cli') return result.argv;
  throw new Error(result.ok ? 'expected a cli intent, got ui' : `intent rejected: ${result.error}`);
}

describe('register kill switch', () => {
  test('ATLAS_MOD=off: session.start wires nothing, handlers pass through', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine({ ATLAS_MOD: 'off' });
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: null, isInteractive: false }, noopNext);
    expect(rec.commands).toEqual([]); // no slash commands registered
    expect(rec.timers).toEqual([]); // no clock timers started
    expect(rec.ui).toEqual([]); // no ui.* calls at all
    // Every other handler is a pass-through: no side effects, next(e) called.
    await pick('ui.render', 'AbovePrompt')(engine, {
      surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
      props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 80, scroll: { offset: 0, bodyRows: 6 }, view: {} },
    }, noopNext);
    await pick('ui.message')(engine, {
      surface: 'terminal', component: 'Pane', requestId: 'atlas', element: 'k',
      module: './pane/board.tsx', data: { t: 'todo.claim', id: 't1', owner: 'me' },
    }, noopNext);
    expect(rec.ui).toEqual([]);
    expect(rec.runs).toEqual([]);
  });
});

describe('ui.message intent handling', () => {
  test('exact argv passthrough: the intent reaches $.process.run untouched', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine();
    await register(on, {});
    // Boot first: the kill-switch test runs earlier and flips module state off.
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: null, isInteractive: false }, noopNext);
    const runsAtBoot = rec.runs.length;
    const intent = { t: 'todo.claim', id: 't1', owner: 'impl-auth' };
    const ctx = { pluginRoot: '/plugins/atlas', root: '', channel: null };
    const result = (await pick('ui.message')(engine, {
      surface: 'terminal', component: 'Pane', requestId: 'atlas', element: 'k',
      module: './pane/board.tsx', data: intent,
    }, noopNext)) as { props?: unknown };
    expect(rec.runs.length).toBe(runsAtBoot + 1);
    expect(rec.runs.at(-1)).toEqual(cliArgv(intentToArgv(intent, ctx)));
    // No board found: an idle snapshot rides in the fresh props.
    expect(result).toEqual({
      props: { snapshot: expect.objectContaining({ root: null, sessionId: 'sess-abc123def456' }), columns: 0, rows: 0 },
    });
  });

  test('stop intent: $.ui.ask gates the atlas_mux kill, decline runs nothing', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine();
    await register(on, {});
    // Interactive session first, so the confirmation path is reachable.
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    const kill = { t: 'stop', run: 'run-1' };
    const event: MessageEvent = {
      surface: 'terminal', component: 'Pane', requestId: 'atlas', element: 'k',
      module: './band.tsx', data: kill,
    };
    rec.askAnswer = 'Leave it';
    const runsAtBoot = rec.runs.length; // the git branch probe from boot
    await pick('ui.message')(engine, event, noopNext);
    expect(rec.asks.length).toBe(1);
    expect(rec.runs.length).toBe(runsAtBoot); // declined: nothing ran
    rec.askAnswer = 'Kill it';
    await pick('ui.message')(engine, event, noopNext);
    expect(rec.asks.length).toBe(2);
    expect(rec.runs.at(-1)).toEqual(cliArgv(intentToArgv(kill, { pluginRoot: '/plugins/atlas', root: '', channel: null })));
  });
});

describe('headless inertness', () => {
  test('headless session.start: no ui.*, no timers, no commands, next(e) flows', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine();
    await register(on, {});
    const e: SessionStartEvent = { cwd: '/tmp/proj', surface: null, isInteractive: false };
    const out = await pick('session.start')(engine, e, noopNext);
    expect(out).toEqual(e); // next(e) echoes the event
    expect(rec.commands).toEqual([]);
    expect(rec.timers).toEqual([]);
    expect(rec.ui).toEqual([]);
    // The only process call is the branch probe; git is fine headless.
    expect(rec.runs).toEqual([['git', '-C', '/tmp/proj', 'rev-parse', '--abbrev-ref', 'HEAD']]);
  });
});
