// The sidebar opens unasked at session.start (no keyboard request) and /atlas-cc opens it with
// focus and without closeOnEscape or holdToasts, so it stays until the person closes it.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
interface OpenArgs { id: string; focus?: true; closeOnEscape?: true; holdToasts?: true }

function handlerKey(event: string, matcher: Record<string, unknown> | undefined): string {
  return matcher === undefined ? event : `${event}|${String(matcher.command ?? matcher.component ?? '')}`;
}

function captureOn() {
  const handlers = new Map<string, AnyHandler>();
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    handlers.set(handlerKey(event, matcher), (maybeHook ?? hookOrMatcher) as AnyHandler);
    return { catch() {} };
  }) as unknown as On;
  return { on, pick: (key: string): AnyHandler => handlers.get(key) ?? (() => { throw new Error(`no ${key}`); }) };
}

function stubEngine() {
  const opens: OpenArgs[] = [];
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => 1_760_000_000_000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    session: { id: async () => 'sess-open' },
    fs: { read: async () => { throw new Error('no fs'); }, stat: async () => { throw new Error('no fs'); }, exists: async () => false, list: async () => [] },
    state: memState(),
    ui: {
      log: () => {},
      invalidate: () => {},
      open: async (args: OpenArgs) => { opens.push(args); return { isPlaced: true as const }; },
      close: async () => {},
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return { engine: $ as unknown as EngineInterface, opens };
}

const noopNext: AnyNext = async (input) => input;

describe('sidebar open requests', () => {
  test('session.start opens without focus; /atlas-cc (twice) opens with focus and nothing that closes it', async () => {
    const { on, pick } = captureOn();
    const { engine, opens } = stubEngine();
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    expect(opens.length).toBe(1);
    expect(opens[0]).toMatchObject({ id: 'atlas' });
    expect(opens[0]?.focus).toBeUndefined();
    const cc = pick('command.run|atlas-cc');
    await cc(engine, { args: '' }, noopNext);
    await cc(engine, { args: '' }, noopNext);
    expect(opens.length).toBe(3);
    for (const o of opens.slice(1)) {
      expect(o).toMatchObject({ id: 'atlas', focus: true });
      expect(o.closeOnEscape).toBeUndefined();
      expect(o.holdToasts).toBeUndefined();
    }
  });
});
