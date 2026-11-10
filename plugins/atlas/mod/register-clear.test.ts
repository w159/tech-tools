// A /clear raises session.end (reason 'clear') and NO session.start (plugin-authoring reference.md:27),
// and the session's $.state atoms fall back to their initial values. The mod must re-boot itself for the
// new session from the classic SessionStart hook (source 'clear'), or the band, the todo board and the
// /atlas-cc pane stay dead and the builder keeps the old session id.
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

const TODOS = JSON.stringify([{ id: 't1', content: '[research] map it', status: 'pending', phase: 'research' }]);

function stubEngine() {
  const seen = { sid: 'aaaaaa-session-A', resolved: 0, commands: 0, timers: 0 };
  const files: Record<string, string> = { '/tmp/proj/.atlas/todos.json': TODOS };
  const $ = {
    state: memState(),
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => 1_760_000_000_000, every: () => { seen.timers++; return { cancel() {} }; }, after: () => ({ cancel() {} }), sleep: async () => {} },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    session: { id: async () => seen.sid },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('no such file'); },
      stat: async (p: string) => { if (p in files) return { size: files[p]!.length, mtimeMs: 1 }; throw new Error('no such file'); },
      exists: async (p: string) => p === '/tmp/proj/.atlas' || p in files,
      list: async () => [],
    },
    ui: {
      log: () => {},
      invalidate: () => {},
      open: async () => ({ isPlaced: true }),
      // the band reaches resolve() only when it decides to draw
      resolve: () => { seen.resolved++; throw new Error('no drawing in test'); },
    },
    command: { register: async (spec: { name: string }) => { seen.commands++; return { command: spec.name }; } },
  };
  return { engine: $ as unknown as EngineInterface, seen };
}

const noopNext: AnyNext = async (input) => input;
const snapshotOf = async (engine: EngineInterface) =>
  (await engine.state.get({ plugin: 'atlas', key: 'snapshot' } as never)).value as { sessionId: string } | null | undefined;

describe('/clear re-boot', () => {
  test('after session.end(clear) + classic.SessionStart(clear) the band draws and the builder carries the new session id', async () => {
    const { on, pick } = captureOn();
    const { engine, seen } = stubEngine();
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);

    const render = { surface: 'terminal', viewport: { columns: 100, rows: 40, isFullscreen: false }, props: { hasSurvey: false, bodyColumns: 100 } };
    await pick('ui.render|AbovePrompt')(engine, render, noopNext).catch(() => undefined);
    expect(seen.resolved).toBe(1);
    expect((await snapshotOf(engine))?.sessionId).toBe('aaaaaa-session-A');
    const commands = seen.commands;
    const timers = seen.timers;

    // What the host does on /clear: session.end, new id, atoms back to their initial values, no session.start.
    await pick('session.end')(engine, { reason: 'clear' }, noopNext);
    seen.sid = 'bbbbbb-session-B';
    for (const [key, initial] of [['isInteractive', false], ['snapshot', null], ['headerTally', { ok: 0, total: 0 }], ['usage', { tokens: null, contextPct: null }]] as const) {
      await engine.state.set({ plugin: 'atlas', key } as never, initial as never);
    }
    seen.resolved = 0;
    await pick('ui.render|AbovePrompt')(engine, render, noopNext).catch(() => undefined);
    expect(seen.resolved).toBe(0); // the dead state the bug leaves: no band

    await pick('classic.SessionStart')(
      engine,
      { hook_event_name: 'SessionStart', source: 'clear', session_id: 'bbbbbb-session-B', cwd: '/tmp/proj', transcript_path: '/tmp/t.jsonl' },
      noopNext,
    );
    await pick('ui.render|AbovePrompt')(engine, render, noopNext).catch(() => undefined);
    expect(seen.resolved).toBe(1); // band draws again
    expect((await snapshotOf(engine))?.sessionId).toBe('bbbbbb-session-B');
    expect(seen.commands).toBe(commands); // commands survive a clear: not registered twice
    expect(seen.timers).toBe(timers + 1); // only the spinner tick (session.end cancelled it) is re-armed
  });

  test('a classic SessionStart that is not a clear changes nothing', async () => {
    const { on, pick } = captureOn();
    const { engine, seen } = stubEngine();
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    seen.sid = 'cccccc-other';
    await pick('classic.SessionStart')(engine, { source: 'startup', session_id: 'cccccc-other', cwd: '/tmp/proj' }, noopNext);
    expect((await snapshotOf(engine))?.sessionId).toBe('aaaaaa-session-A');
  });
});
