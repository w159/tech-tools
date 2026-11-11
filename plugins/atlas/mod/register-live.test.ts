// Live data path (round 2, slice A): rebuild() is serialized and stamps a monotonic `seq`; a write to the data files reaches the
// snapshot on the next 500 ms stat-poll tick (the engine fs has no watch); an idle
// session schedules no rebuild. Recording engine stub with an injected clock, no node: imports.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { rebuild, rebuildTick, register, resetCore } from './register';
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

const ROOT = '/tmp/proj-live';
const RUN = `${ROOT}/.atlas/.run`;
const TODOS = `${RUN}/todos.json`;
const items = (n: number): string => JSON.stringify({ items: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, content: `[research] item ${i}`, status: 'pending', phase: 'research', session_id: '' })) });

type Timer = { at: number; fn: () => void; live: boolean };

function stubEngine() {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [TODOS]: items(1) };
  const mtimes: Record<string, number> = {};
  let now = 1_910_000_000_000;
  const every: { ms: number; fn: () => void }[] = [];
  const afters: Timer[] = [];
  const rec = { reads: [] as string[], listCalls: 0, running: 0, maxRunning: 0, toasts: [] as string[] };
  let listGate: Promise<void> | null = null;
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: {
      now: async () => now,
      every: (ms: number, fn: () => void) => { every.push({ ms, fn }); return { cancel() {} }; },
      after: (ms: number, fn: () => void) => { const t: Timer = { at: now + ms, fn, live: true }; afters.push(t); return { cancel() { t.live = false; } }; },
      sleep: async () => {},
    },
    session: { id: async () => 'sess-live' },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    fs: {
      read: async (p: string) => { rec.reads.push(p); if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: mtimes[p] ?? 0 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: {
      list: async () => {
        rec.listCalls++;
        rec.running++;
        rec.maxRunning = Math.max(rec.maxRunning, rec.running);
        if (listGate) await listGate;
        rec.running--;
        return [];
      },
    },
    state: memState(),
    audio: { play: async () => {} },
    ui: { log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true as const }), toast: (t: string) => { rec.toasts.push(t); }, resolve: () => ({}), status: () => {} },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  /** Advance the injected clock, running every due `after` in order. */
  const advance = async (ms: number): Promise<void> => {
    const end = now + ms;
    for (;;) {
      const due = afters.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      now = Math.max(now, due.at);
      due.fn();
      await settle();
    }
    now = end;
  };
  return {
    $: $ as unknown as EngineInterface,
    files, mtimes, every, rec,
    holdList: () => { let open!: () => void; listGate = new Promise<void>((r) => { open = r; }); return () => { listGate = null; open(); }; },
    write: (p: string, text: string) => { files[p] = text; mtimes[p] = (mtimes[p] ?? 0) + 1; },
    advance,
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

describe('rebuild is serialized and stamped', () => {
  test('overlapping rebuilds never run together; a pending request coalesces into one follow-up; seq only grows', async () => {
    const s = stubEngine();
    await boot(s);
    const base = s.rec.listCalls;
    const seq0 = (await snapOf(s)).seq;
    expect(typeof seq0).toBe('number');
    const release = s.holdList();
    const a = rebuild(s.$);
    const b = rebuild(s.$);
    const c = rebuild(s.$);
    await settle();
    expect(s.rec.listCalls - base).toBe(1); // b and c wait behind a
    release();
    await Promise.all([a, b, c]);
    expect(s.rec.maxRunning).toBe(1);
    expect(s.rec.listCalls - base).toBe(2); // a, plus ONE follow-up for b and c
    const seq1 = (await snapOf(s)).seq;
    expect(seq1).toBeGreaterThan(seq0);
  });
});

describe('polled updates', () => {
  test('a todos.json fingerprint change is picked up by the next rebuildTick', async () => {
    const s = stubEngine();
    await boot(s);
    expect((await snapOf(s)).todos).toHaveLength(1);
    s.write(TODOS, items(3));
    await rebuildTick(s.$);
    await settle();
    expect((await snapOf(s)).todos).toHaveLength(3);
  });

  test('the registered poll runs at most every 500 ms and picks the write up', async () => {
    const s = stubEngine();
    await boot(s);
    const poll = s.every.find((e) => e.ms <= 500);
    expect(poll).toBeDefined();
    s.write(TODOS, items(4));
    poll!.fn();
    await settle();
    expect((await snapOf(s)).todos).toHaveLength(4);
  });

  test('an idle session schedules no rebuild, and one fingerprint check is under 2 ms', async () => {
    const s = stubEngine();
    await boot(s);
    expect(s.every.find((e) => e.ms <= 500)).toBeDefined();
    await rebuildTick(s.$); // the first tick after boot records the fingerprint
    const reads = s.rec.reads.length;
    const seq = (await snapOf(s)).seq;
    const t = performance.now();
    for (let i = 0; i < 200; i++) await rebuildTick(s.$);
    const per = (performance.now() - t) / 200;
    expect(s.rec.reads.length).toBe(reads); // no rebuild read anything
    expect((await snapOf(s)).seq).toBe(seq);
    expect(per).toBeLessThan(2);
  });
});
