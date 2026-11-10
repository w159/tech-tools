// A failure that only reaches the debug log (`claude --debug`) leaves the person with a blank band and no
// reason. The boot catch, the rebuild catch and the ui.fault hook must each also show one toast line,
// once per distinct message.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;

function captureOn() {
  const handlers = new Map<string, AnyHandler>();
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const hook = (maybeHook ?? hookOrMatcher) as AnyHandler;
    handlers.set(maybeHook === undefined ? event : `${event}|${String((hookOrMatcher as Record<string, unknown>).component ?? '')}`, hook);
    return { catch() {} };
  }) as unknown as On;
  return { on, pick: (key: string): AnyHandler => handlers.get(key) ?? (() => { throw new Error(`no ${key}`); }) };
}

function stubEngine(sessionId: () => Promise<string>) {
  const seen = { toasts: [] as string[], logs: [] as string[] };
  const $ = {
    state: memState(),
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => 1_760_000_000_000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    session: { id: sessionId },
    fs: {
      read: async () => { throw new Error('no such file'); },
      stat: async () => { throw new Error('no such file'); },
      exists: async () => false,
      list: async () => [],
    },
    ui: {
      log: (t: string) => seen.logs.push(t),
      toast: (t: string) => seen.toasts.push(t),
      invalidate: () => {},
      open: async () => ({ isPlaced: true }),
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return { engine: $ as unknown as EngineInterface, seen };
}

const noopNext: AnyNext = async (input) => input;
const fault = (reason: string) => ({ surface: 'terminal', component: 'AbovePrompt', requestId: 'r1', element: 'band', module: 'band.js', phase: 'draw', reason });

describe('visible failure lines', () => {
  test('a boot that throws shows one short atlas line with the error text', async () => {
    const { on, pick } = captureOn();
    const { engine, seen } = stubEngine(async () => { throw new Error('x'.repeat(500) + 'sessid-boom'); });
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    expect(seen.toasts).toHaveLength(1);
    expect(seen.toasts[0]).toContain('atlas: boot failed');
    expect(seen.toasts[0]!.length).toBeLessThanOrEqual(200);
    expect(seen.logs.some((l) => l.includes('boot failed'))).toBe(true);
  });

  test('a snapshot rebuild over a corrupt todos.json shows one atlas line naming todos.json', async () => {
    const { on, pick } = captureOn();
    const { engine, seen } = stubEngine(async () => 's');
    const files: Record<string, string> = { '/proj/.atlas': '', '/proj/.atlas/.run/todos.json': '{not json' };
    Object.assign(engine.fs, {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('no such file'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('no such file'); return { size: files[p]!.length, mtimeMs: 7 }; },
      exists: async (p: string) => p in files,
    });
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/proj', surface: 'terminal', isInteractive: false }, noopNext);
    const lines = seen.toasts.filter((t) => t.includes('todos.json'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^atlas: todos\.json is corrupt/);
  });

  test('a ui.fault shows one line naming the component and the reason', async () => {
    const { on, pick } = captureOn();
    const { engine, seen } = stubEngine(async () => 's');
    await register(on, {});
    await pick('ui.fault')(engine, fault('module did not load'), noopNext);
    expect(seen.toasts).toEqual([expect.stringMatching(/^atlas: AbovePrompt band\.js draw: module did not load/)]);
  });

  test('the same failure 5 times is one line, a different one adds a second', async () => {
    const { on, pick } = captureOn();
    const { engine, seen } = stubEngine(async () => 's');
    await register(on, {});
    for (let i = 0; i < 5; i++) await pick('ui.fault')(engine, fault('same'), noopNext);
    expect(seen.toasts).toHaveLength(1);
    await pick('ui.fault')(engine, fault('other'), noopNext);
    expect(seen.toasts).toHaveLength(2);
  });
});
