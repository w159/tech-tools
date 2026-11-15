// The sidebar opens at rest at every width (X5: the first render with a viewport notes it, the next tick opens it; below 144 the engine draws it when the first prompt asks); /atlas-cc opens it on demand with focus and Esc-to-close.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { dockTick, register, shouldDockAsked, shouldDockRest } from './register';
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

function stubEngine(placed: (args: OpenArgs) => boolean = () => true) {
  const opens: OpenArgs[] = [];
  const toasts: string[] = [];
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
      open: async (args: OpenArgs) => { opens.push(args); return placed(args) ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'waits undrawn below 144 columns' }; },
      toast: (t: string) => { toasts.push(t); },
      resolve: () => { throw new Error('no drawing in test'); },
      close: async () => {},
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return { engine: $ as unknown as EngineInterface, opens, toasts };
}

const noopNext: AnyNext = async (input) => input;

describe('sidebar open requests', () => {
  test('shouldDockAsked: fullscreen and >= 110 columns only (the engine floor for asked panes); the pane never opens at rest', () => {
    expect(shouldDockAsked({ isFullscreen: true, columns: 160 })).toBe(true);
    expect(shouldDockAsked({ isFullscreen: true, columns: 110 })).toBe(true);
    expect(shouldDockAsked({ isFullscreen: true, columns: 109 })).toBe(false);
    expect(shouldDockAsked({ isFullscreen: false, columns: 160 })).toBe(false);
    expect(shouldDockAsked(undefined)).toBe(false);
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
    return { opens, pick, engine, denied };
  }

  test('no auto open at 100 columns non-fullscreen or fullscreen-narrow', async () => {
    expect((await renderBand({ columns: 100, rows: 40, isFullscreen: false })).opens).toEqual([]);
    expect((await renderBand({ columns: 100, rows: 40, isFullscreen: true })).opens).toEqual([]);
  });

  test('K (round W, reversed by X5): the render alone opens nothing at any width; the tick that follows it opens the pane (see X5)', async () => {
    const { on, pick } = captureOn();
    const { engine, opens } = stubEngine();
    await register(on, {});
    await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    const at = (columns: number) => ({ surface: 'terminal', viewport: { columns, rows: 40, isFullscreen: true }, props: { hasSurvey: false, bodyColumns: columns } });
    const draw = async (columns: number) => { guard.rendering = true; await pick('ui.render|AbovePrompt')(engine, at(columns), noopNext).catch(() => undefined); guard.rendering = false; };
    for (const c of [110, 110, 150, 150, 110, 150]) await draw(c);
    expect(opens).toEqual([]);
    await pick('prompt.submit')(engine, { text: 'go' }, noopNext);
    expect(opens).toEqual([{ id: 'atlas', title: 'Atlas', columns: 56 }]);
    await draw(150);
    await pick('prompt.submit')(engine, { text: 'again' }, noopNext);
    expect(opens).toHaveLength(1); // opened once: a pane the person closed stays closed
  });

  // A2 (critique 14): the engine places an UNASKED pane from 144 columns, but an open made behind the person's prompt is "asked" and
  // docks from 110 (types UiOpenResult). The first prompt of a run at 110 fullscreen opens the pane, once, and never after a by-hand close.
  describe('A2: the first prompt opens the pane at 110 columns', () => {
    const at = (columns: number, isFullscreen = true) => ({ surface: 'terminal', viewport: { columns, rows: 40, isFullscreen }, props: { hasSurvey: false, bodyColumns: columns } });
    async function session(columns: number, isFullscreen = true) {
      const { on, pick } = captureOn();
      const { engine, opens } = stubEngine();
      await register(on, {});
      await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
      const draw = async (c = columns) => { guard.rendering = true; await pick('ui.render|AbovePrompt')(engine, at(c, isFullscreen), noopNext).catch(() => undefined); guard.rendering = false; };
      const submit = () => pick('prompt.submit')(engine, { text: 'go' }, noopNext);
      return { engine, opens, pick, draw, submit };
    }
    test('110 fullscreen: the prompt opens the docked pane once, with no focus', async () => {
      const s = await session(110);
      await s.draw();
      expect(s.opens).toEqual([]); // the render alone asks nothing at 110
      await s.submit();
      expect(s.opens).toEqual([{ id: 'atlas', title: 'Atlas', columns: 56 }]);
      await s.submit();
      expect(s.opens).toHaveLength(1);
    });
    test('never below 110, never inline; at 150 the render opens nothing and the first prompt opens the pane once, as at 110', async () => {
      for (const [columns, full] of [[100, true], [110, false], [109, true]] as const) { const s = await session(columns, full); await s.draw(); await s.submit(); expect(s.opens).toEqual([]); }
      const wide = await session(150);
      await wide.draw();
      expect(wide.opens).toEqual([]);
      await wide.submit();
      expect(wide.opens).toHaveLength(1);
      await wide.submit();
      expect(wide.opens).toHaveLength(1);
    });
    test('a pane the person closed by hand is not opened again by a later prompt', async () => {
      const s = await session(110);
      await s.draw();
      await s.submit();
      await s.pick('ui.close')(s.engine, { id: 'atlas', origin: { kind: 'person' } }, noopNext);
      await s.submit();
      expect(s.opens).toHaveLength(1);
    });
    test('the open is made before any await (the engine counts it asked only while the prompt is behind it)', async () => {
      const s = await session(110);
      await s.draw();
      const p = s.submit();
      expect(s.opens).toHaveLength(1); // synchronous: recorded before the hook's first await settles
      await p;
    });
  });

  // X5: idle is never empty. The pane opens at rest at every width (the engine draws an unasked pane from 144 columns; below that the first prompt asks for it and it docks from 110).
  describe('X5: the pane opens at rest at every width', () => {
    const at = (columns: number, isFullscreen = true) => ({ surface: 'terminal', viewport: { columns, rows: 40, isFullscreen }, props: { hasSurvey: false, bodyColumns: columns } });
    async function rest(columns: number, placed: (a: OpenArgs) => boolean = () => true, isFullscreen = true) {
      const { on, pick } = captureOn();
      const { engine, opens, toasts } = stubEngine(placed);
      await register(on, {});
      await pick('session.start')(engine, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
      guard.rendering = true;
      await pick('ui.render|AbovePrompt')(engine, at(columns, isFullscreen), noopNext).catch(() => undefined);
      await pick('ui.render|AbovePrompt')(engine, at(columns, isFullscreen), noopNext).catch(() => undefined);
      guard.rendering = false;
      return { engine, opens, toasts, pick, tick: () => dockTick(engine), submit: () => pick('prompt.submit')(engine, { text: 'go' }, noopNext) };
    }
    test('shouldDockRest: any fullscreen terminal, whatever its width', () => {
      expect([shouldDockRest({ isFullscreen: true, columns: 150 }), shouldDockRest({ isFullscreen: true, columns: 110 }), shouldDockRest({ isFullscreen: true, columns: 90 })]).toEqual([true, true, true]);
      expect(shouldDockRest({ isFullscreen: false, columns: 150 })).toBe(false);
    });
    for (const columns of [150, 110]) test(`${columns} fullscreen: one tick after the first render opens the pane at rest, once, with no focus`, async () => {
      const s = await rest(columns);
      expect(s.opens).toEqual([]); // the render itself writes and opens nothing
      await s.tick();
      expect(s.opens).toEqual([{ id: 'atlas', title: 'Atlas', columns: 56 }]);
      await s.tick();
      expect(s.opens).toHaveLength(1);
      await s.submit();
      expect(s.opens).toHaveLength(1); // placed at rest: the first prompt need not ask again
    });
    test('below 144 the engine keeps the unasked pane undrawn: no toast at rest, and the first prompt asks for it again (docks from 110)', async () => {
      let calls = 0;
      const s = await rest(110, () => ++calls > 1); // the first (unasked) open waits undrawn, the second (behind the prompt) is placed
      await s.tick();
      await Promise.resolve();
      expect(s.opens).toHaveLength(1);
      expect(s.toasts).toEqual([]);
      await s.submit();
      expect(s.opens).toHaveLength(2);
    });
    test('never inline: a non-fullscreen terminal opens nothing at rest', async () => {
      const s = await rest(150, () => true, false);
      await s.tick();
      expect(s.opens).toEqual([]);
    });
    test('a pane the person closed by hand is not opened again at rest', async () => {
      const s = await rest(150);
      await s.tick();
      await s.pick('ui.close')(s.engine, { id: 'atlas', origin: { kind: 'person' } }, noopNext);
      guard.rendering = true;
      await s.pick('ui.render|AbovePrompt')(s.engine, at(150), noopNext).catch(() => undefined);
      guard.rendering = false;
      await s.tick();
      expect(s.opens).toHaveLength(1);
    });
  });

  test('the band render writes no $.state (the engine skips a render hook that does)', async () => {
    expect((await renderBand({ columns: 160, rows: 40, isFullscreen: true })).denied).toBe(0);
  });

  test('the render alone opens nothing (X5: the tick does); /atlas-cc opens 12 rows with focus and Esc-close', async () => {
    const { opens, pick, engine } = await renderBand({ columns: 160, rows: 40, isFullscreen: true });
    expect(opens).toEqual([]);
    await pick('command.run|atlas-cc')(engine, { args: '' }, noopNext);
    expect(opens[0]).toMatchObject({ id: 'atlas', rows: 12, closeOnEscape: true, focus: true });
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
