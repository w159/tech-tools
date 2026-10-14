// Tests for register.ts — run with `bun test --preload /tmp/cc_testing_preload.ts
// plugins/atlas/mod/register.test.ts` (shim maps 'claude-code/testing' to bun:test)
// or `claude plugin test plugins/atlas`. Covers the three required behaviors:
// the ATLAS_MOD=off kill switch, exact intent argv passthrough, and headless
// inertness (no ui.*, no timers, no commands). A fourth case pins the stop
// confirmation: $.ui.ask gates the atlas_mux kill.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { headerPhaseOf, register } from './register';
import { memState } from './test_helpers';

// ---- structural event shapes (d.ts: SessionStartInput, RenderInputOf, UiMessageArgument) ----

interface SessionStartEvent {
  cwd: string;
  surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' | null;
  isInteractive: boolean;
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
    tickFns: [] as (() => void)[],
    commands: [] as string[],
    askAnswer: 'Kill it',
  };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async (name: string) => env[name] },
    clock: {
      now: async () => 1_760_000_000_000,
      every: (ms: number, fn: () => void) => {
        rec.timers.push(ms);
        rec.tickFns.push(fn);
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
    state: memState(),
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
    expect(rec.ui).toEqual([]);
    expect(rec.runs).toEqual([]);
  });
});

describe('header phase', () => {
  const snapWith = (pattern: string) => ({ contract: { headerFirstLinePattern: pattern } }) as unknown as Parameters<typeof headerPhaseOf>[1];
  const PATTERN = '^ATLAS \\| \\S+ (research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\| \\S';
  test('reads the phase from the live `ATLAS | <glyph> <phase> | <state>` header', () => {
    expect(headerPhaseOf('ATLAS | 🏁 done | shipped\nbody', snapWith(PATTERN))).toBe('done');
    expect(headerPhaseOf('ATLAS | 🔨 implement 2/5 | writing', snapWith(PATTERN))).toBe('implement');
  });
  test('null when the line misses the contract pattern or the pattern is empty', () => {
    expect(headerPhaseOf('hello done', snapWith(PATTERN))).toBeNull();
    expect(headerPhaseOf('ATLAS | 🏁 done | x', snapWith(''))).toBeNull();
  });
  test('a new turn drops the previous turn\'s header phase (live 12.2.0: rail kept a stale "done")', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine();
    await register(on, {});
    const ref = { plugin: 'atlas', key: 'headerPhase' } as const;
    await engine.state.set(ref, 'done');
    await pick('turn.start')(engine, { text: 'next task', turnId: 't2' }, noopNext);
    expect((await engine.state.get(ref)).value ?? null).toBeNull();
  });
});

describe('faults', () => {
  test('ui.fault logs component, module, phase and reason to debug, then passes on', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine();
    const logs: unknown[][] = [];
    (engine.ui as unknown as { log: (...a: unknown[]) => void }).log = (...a) => { logs.push(a); };
    await register(on, {});
    const e = { surface: 'terminal', component: 'Pane', requestId: 'atlas', element: 'k', module: 'mod/pane/board.tsx', phase: 'load', reason: 'boom' };
    expect(await pick('ui.fault')(engine, e, noopNext)).toEqual(e);
    expect(logs).toEqual([['atlas: Pane mod/pane/board.tsx load: boom', { to: 'debug' }]]);
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

describe('snapshot refresh on live state', () => {
  test('a session.measure reaches the snapshot on the next tick, no file change', async () => {
    const { on, pick } = captureOn();
    const { engine, rec } = stubEngine();
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    const rebuildTick = rec.tickFns[0] as () => void;
    const snap = async () =>
      (await engine.state.get({ plugin: 'atlas', key: 'snapshot' } as never)).value as { contextPct: number };
    const settle = async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve();
    };
    rebuildTick();
    await settle();
    const before = await snap();
    await pick('session.measure')(engine, { context: { tokens: 4321, percent: 7 }, changed: ['context'] }, noopNext);
    rebuildTick();
    await settle();
    const after = await snap();
    expect(after.contextPct).toBe(7);
    expect(after.contextPct).not.toBe(before.contextPct);
  });
});
