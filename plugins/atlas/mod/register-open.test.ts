// The sidebar never opens unasked unless docked (fullscreen, >= 144 columns), decided at the first
// render with a viewport; /atlas-cc opens it on demand with focus and Esc-to-close.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { dockTick, register, shouldDock } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
interface OpenArgs { id: string; focus?: true; closeOnEscape?: true; holdToasts?: true; columns?: number; rows?: number; title?: string }

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

/** The engine refuses a $.state write made while ui.render dispatches; `rendering` marks that window. */
const guard = { rendering: false, deniedWrites: 0 };
function renderGuard(state: ReturnType<typeof memState>) {
  return {
    get: state.get,
    set: async (...args: Parameters<typeof state.set>) => {
      if (guard.rendering) { guard.deniedWrites++; throw new Error('atlas: state.set: denied: it was made while ui.render is being dispatched'); }
      return state.set(...args);
    },
  };
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
    state: renderGuard(memState()),
    ui: {
      log: () => {},
      invalidate: () => {},
      open: async (args: OpenArgs) => { opens.push(args); return { isPlaced: true as const }; },
      toast: () => {},
      resolve: () => { throw new Error('no drawing in test'); },
      close: async () => {},
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return { engine: $ as unknown as EngineInterface, opens };
}

const noopNext: AnyNext = async (input) => input;

describe('sidebar open requests', () => {
  test('shouldDock: fullscreen and >= 144 columns only (the engine floor for unasked panes)', () => {
    expect(shouldDock({ isFullscreen: true, columns: 160 })).toBe(true);
    expect(shouldDock({ isFullscreen: true, columns: 144 })).toBe(true);
    expect(shouldDock({ isFullscreen: true, columns: 143 })).toBe(false);
    expect(shouldDock({ isFullscreen: true, columns: 110 })).toBe(false);
    expect(shouldDock({ isFullscreen: false, columns: 160 })).toBe(false);
    expect(shouldDock({ columns: 160 })).toBe(false);
  });

  async function renderBand(viewport: { columns: number; rows: number; isFullscreen: boolean }) {
    const { on, pick } = captureOn();
    const { engine, opens } = stubEngine();
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    const e = { surface: 'terminal', viewport, props: { hasSurvey: false, bodyColumns: viewport.columns } };
    // the drawing itself is not under test (no resolve in the stub); only the unasked open is
    guard.rendering = true;
    guard.deniedWrites = 0;
    await pick('ui.render|AbovePrompt')(engine, e, noopNext).catch(() => undefined);
    await pick('ui.render|AbovePrompt')(engine, e, noopNext).catch(() => undefined);
    guard.rendering = false;
    const denied = guard.deniedWrites;
    await dockTick(engine); // the rebuild tick, where writes are allowed, performs the open
    return { opens, pick, engine, denied };
  }

  test('no auto open at 100 columns non-fullscreen or fullscreen-narrow', async () => {
    expect((await renderBand({ columns: 100, rows: 40, isFullscreen: false })).opens).toEqual([]);
    expect((await renderBand({ columns: 100, rows: 40, isFullscreen: true })).opens).toEqual([]);
  });

  test('the band render writes no $.state (the engine skips a render hook that does)', async () => {
    expect((await renderBand({ columns: 160, rows: 40, isFullscreen: true })).denied).toBe(0);
  });

  test('opens once docked at 160 fullscreen; /atlas-cc opens 12 rows with focus and Esc-close', async () => {
    const { opens, pick, engine } = await renderBand({ columns: 160, rows: 40, isFullscreen: true });
    expect(opens).toEqual([{ id: 'atlas', title: 'Atlas', columns: 56 }]);
    await pick('command.run|atlas-cc')(engine, { args: '' }, noopNext);
    expect(opens[1]).toMatchObject({ id: 'atlas', rows: 12, closeOnEscape: true, focus: true });
  });

  test('closing the pane resets the tab to route', async () => {
    const { on, pick } = captureOn();
    const { engine } = stubEngine();
    await register(on, {});
    await engine.state.set({ plugin: 'atlas', key: 'atlasView' }, 'gates');
    await pick('ui.close')(engine, { id: 'atlas' }, noopNext);
    expect((await engine.state.get({ plugin: 'atlas', key: 'atlasView' })).value).toBe('route');
  });
});
