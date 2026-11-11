// Fresh data on the next poll, with an injected clock and no node: imports.
// Step 2: a todos.json rewrite that keeps its mtime (a coarse clock, or a torn read cached under the bad mtime) still reaches the
//   snapshot, because the todo cache keys on mtime AND size, as the poll fingerprint does.
// Step 3: a change to a gate file (todos.json, findings.json, the gate DB) re-runs the gates on the next poll, not after the 30 s backstop.
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

const ROOT = '/tmp/proj-fresh';
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
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async (k: string) => (k === 'ATLAS_DB' ? DB : undefined) },
    clock: {
      now: async () => now,
      every: (ms: number, fn: () => void) => { every.push({ ms, fn }); return { cancel() {} }; },
      after: () => ({ cancel() {} }),
      sleep: async () => {},
    },
    session: { id: async () => 'sess-fresh' },
    process: {
      run: async (argv: string[]) => {
        if (argv.some((a) => a.endsWith('atlas_gates.py'))) { gateRuns.push(now); return { exitCode: 0, stdout: '{"groups":[]}', stderr: '' }; }
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
    files, mtimes, every, gateRuns,
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

describe('step 2: the snapshot is current one poll after a todos.json write', () => {
  test('a rewrite inside the same mtime tick, with a new size, shows on the next poll', async () => {
    const s = stubEngine();
    await boot(s);
    expect((await snapOf(s)).todos).toHaveLength(1);
    await poll(s); // records the fingerprint
    s.write(TODOS, items(3), false); // same mtime, bigger file
    await poll(s);
    expect((await snapOf(s)).todos).toHaveLength(3);
  });

  test('a torn read cached under an mtime is replaced when the complete file lands with that mtime', async () => {
    const s = stubEngine();
    await boot(s);
    await poll(s);
    s.write(TODOS, '{"items": [', true); // the poll catches the writer mid-write
    await poll(s);
    expect((await snapOf(s)).todos).toHaveLength(1); // the last good board stays up
    s.write(TODOS, items(4), false); // the write finishes inside the same mtime tick
    await poll(s);
    expect((await snapOf(s)).todos).toHaveLength(4);
  });
});

describe('step 3: a gate file change re-runs the gates on the next poll', () => {
  test('findings.json, todos.json and the gate DB each invalidate the gates; a quiet poll does not', async () => {
    const s = stubEngine();
    await boot(s);
    await poll(s); // first sight records the signature
    const base = s.gateRuns.length;
    for (let i = 0; i < 4; i++) await poll(s); // 2 s of quiet polls (inside the gap)
    expect(s.gateRuns.length).toBe(base);
    for (const [path, text] of [[FINDINGS, '[{"id":"a"}]'], [TODOS, items(2)], [DB, 'db1-longer']] as const) {
      s.write(path, text);
      await poll(s);
      s.advance(5000); // past the 5 s minimum gap between two runs
      await poll(s);
    }
    expect(s.gateRuns.length - base).toBe(3);
  });

  test('a burst of changes inside the minimum gap runs the gates once, then once more after the gap', async () => {
    const s = stubEngine();
    await boot(s);
    await poll(s);
    s.advance(5000);
    await poll(s);
    const base = s.gateRuns.length;
    s.write(DB, 'db-a');
    await poll(s);
    expect(s.gateRuns.length - base).toBe(1); // the change is seen on this very poll
    s.write(DB, 'db-bb');
    await poll(s);
    expect(s.gateRuns.length - base).toBe(1); // inside the gap: held, not dropped
    s.advance(5000);
    await poll(s);
    expect(s.gateRuns.length - base).toBe(2);
  });
});
