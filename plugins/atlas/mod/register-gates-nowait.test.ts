// The 500 ms rebuild tick never waits on a gate run (atlas_gates.py): the todo state reaches the snapshot while the run is pending.
// A gate-file change starts the run without awaiting it; gatesBusy keeps a second run from starting meanwhile.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { rebuildTick, register, resetCore } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

function captureOn() {
  const handlers: { event: string; hook: AnyHandler }[] = [];
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    handlers.push({ event, hook: (maybeHook ?? hookOrMatcher) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  return { on, one: (event: string): AnyHandler => handlers.find((h) => h.event === event)!.hook };
}

const ROOT = '/tmp/proj-nowait';
const RUN = `${ROOT}/.atlas/.run`;
const TODOS = `${RUN}/todos.json`;
const FINDINGS = `${RUN}/findings.json`;
const DB = '/home/u/.atlas/atlas.db';
const items = (n: number): string => JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, content: `[research] item ${i}`, status: 'pending', phase: 'research', session_id: '' })) });

function stubEngine() {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [TODOS]: items(1), [FINDINGS]: '[]', [DB]: 'db0' };
  const mtimes: Record<string, number> = {};
  let now = 1_800_000_000_000; // below every other register test clock: the worktree-status throttle (wtAt) is module state
  const every: { ms: number; fn: () => void }[] = [];
  const gateRuns: number[] = [];
  const hold = { on: false, release: [] as (() => void)[] };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async (k: string) => (k === 'ATLAS_DB' ? DB : undefined) },
    clock: {
      now: async () => now,
      every: (ms: number, fn: () => void) => { every.push({ ms, fn }); return { cancel() {} }; },
      after: () => ({ cancel() {} }),
      sleep: async () => {},
    },
    session: { id: async () => 'sess-nowait' },
    process: {
      run: async (argv: string[]) => {
        if (argv.some((a) => a.endsWith('atlas_gates.py'))) {
          gateRuns.push(now);
          if (hold.on) await new Promise<void>((resolve) => hold.release.push(resolve));
          return { exitCode: 0, stdout: '{"groups":[]}', stderr: '' }; }
        return { exitCode: 0, stdout: 'main', stderr: '' };
      },
    },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: mtimes[p] ?? 0 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => [] },
    state: memState(),
    audio: { play: async () => {} },
    ui: { log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true as const }), toast: () => {}, resolve: () => ({}), status: () => {} },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return {
    $: $ as unknown as EngineInterface,
    files, mtimes, every, gateRuns, hold,
    /** Write `text` to `p`; `touch` false keeps the mtime (one mtime tick, or a coarse filesystem clock). */
    write: (p: string, text: string, touch = true) => { files[p] = text; if (touch) mtimes[p] = (mtimes[p] ?? 0) + 1; },
    advance: (ms: number) => { now += ms; },
    state: $.state,
  };
}

const settle = async (): Promise<void> => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };
const snapOf = async (s: ReturnType<typeof stubEngine>): Promise<any> => (await s.state.get({ plugin: 'atlas', key: 'snapshot' } as never)).value;

async function boot(s: ReturnType<typeof stubEngine>) {
  resetCore();
  const cap = captureOn();
  await register(cap.on, {});
  await cap.one('session.start')(s.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  await settle();
}

const poll = async (s: ReturnType<typeof stubEngine>): Promise<void> => { s.advance(500); await rebuildTick(s.$); await settle(); };


/** True when rebuildTick returned within a settle (the stub engine is all microtasks); false when it is still waiting. */
const returnsPromptly = (s: ReturnType<typeof stubEngine>): Promise<boolean> =>
  Promise.race([rebuildTick(s.$).then(() => true), settle().then(() => false)]);

describe('rebuildTick does not wait on a gate run', () => {
  test('a pending gate run neither holds the tick nor stops a todo change reaching the snapshot, and is not started twice', async () => {
    const s = stubEngine();
    await boot(s);
    await poll(s); // records the gate signature
    s.hold.on = true;
    const base = s.gateRuns.length;
    try {
      s.write(DB, 'db-new-longer');
      s.write(TODOS, items(3));
      s.advance(6000); // past the minimum gap between two gate runs
      expect(await returnsPromptly(s)).toBe(true);
      await settle();
      expect(s.gateRuns.length - base).toBe(1); // the run started and is still pending
      expect((await snapOf(s)).todos).toHaveLength(3);

      s.write(DB, 'db-newer-still-longer');
      s.write(TODOS, items(4));
      s.advance(6000);
      expect(await returnsPromptly(s)).toBe(true);
      await settle();
      expect(s.gateRuns.length - base).toBe(1); // gatesBusy: no second run while the first is pending
      expect((await snapOf(s)).todos).toHaveLength(4);
    } finally {
      s.hold.on = false;
      s.hold.release.splice(0).forEach((r) => r());
      await settle();
    }
    // The finished run frees the guard: the next gate change runs again.
    s.write(DB, 'db-after-release');
    s.advance(6000);
    await poll(s);
    expect(s.gateRuns.length - base).toBe(2);
  });
});
