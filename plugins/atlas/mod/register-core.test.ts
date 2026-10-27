// coreTick: toasts once per new verdict (the first read is a baseline), the refutation sound, a finished worker,
// the status line, logs re-read when size or mtime changes, /atlas-core, and the header tally.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { coreMatrix } from '../contracts/core-fixture';
import { coreTick, register, resetCore } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

function captureOn() {
  const handlers: { event: string; matcher: Record<string, unknown> | undefined; hook: AnyHandler }[] = [];
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    handlers.push({ event, matcher, hook: (maybeHook ?? hookOrMatcher) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const all = (event: string, key?: [string, unknown]): AnyHandler[] =>
    handlers.filter((h) => h.event === event && (key === undefined || h.matcher?.[key[0]] === key[1])).map((h) => h.hook);
  return { on, all };
}

const ROOT = '/proj';
const RUN = `${ROOT}/.atlas/.run`;
const verdict = (id: string, status: string, at: string) => ({ id, status, title: `title ${id}`, evidence: ['ev'], verified_at: at, verified_by: 'atlas:verifier' });
const team = JSON.stringify({ team_id: 'tx', name: 'x', class: 'fix', effort: 'low', isolation: 'shared', max_parallel: 1, created: 1, members: [{ name: 'implementer-1', role: 'implementer' }] });
const assistant = (id: string, cacheRead: number) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: 1, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } } });

function stubEngine() {
  const files: Record<string, string> = {
    [`${RUN}/findings.json`]: JSON.stringify([verdict('a', 'verified', '2026-10-27T08:00:00+00:00')]),
    [`${RUN}/teams/tx.json`]: team,
    [`${RUN}/logs/implementer-1.log`]: `${assistant('m1', 1000)}\n${assistant('m2', 5000)}`,
    '/plugins/atlas/contracts/scope-matrix.json': coreMatrix,
  };
  const mtimes: Record<string, number> = {};
  const rec = { toasts: [] as string[], status: [] as (string | undefined)[], plays: [] as string[], reads: [] as string[], commands: [] as string[] };
  const state = memState({
    'atlas/snapshot': { root: ROOT, todos: [], contract: { headerFirstLinePattern: '^ATLAS \\| \\S+ (research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\| \\S' } },
    'atlas/isModOn': true,
    'atlas/isInteractive': true,
  });
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => 1_760_000_000_000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    session: { id: async () => 'sess-core' },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    fs: {
      read: async (p: string) => { rec.reads.push(p); if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: mtimes[p] ?? 0 }; },
      exists: async (p: string) => p in files,
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    state,
    audio: { play: async (clip: { asset: string }) => { rec.plays.push(clip.asset); } },
    ui: { log: () => {}, toast: (t: string) => { rec.toasts.push(t); }, status: (t: string | undefined) => { rec.status.push(t); } },
    command: { register: async (spec: { name: string }) => { rec.commands.push(spec.name); return { command: spec.name }; } },
  };
  return { $: $ as unknown as EngineInterface, files, mtimes, rec, state };
}

async function session(sound: boolean) {
  const cap = captureOn();
  resetCore();
  await register(cap.on, { atlas_mod_sound: sound });
  return { ...cap, ...stubEngine() };
}

describe('coreTick', () => {
  test('the baseline read toasts nothing; each new verdict toasts once', async () => {
    const s = await session(false);
    await coreTick(s.$);
    expect(s.rec.toasts).toEqual([]);
    expect(s.rec.status.at(-1)).toMatch(/^atlas ✔1 ✖0 ⚠0/);
    s.files[`${RUN}/findings.json`] = JSON.stringify([verdict('a', 'verified', '2026-10-27T08:00:00+00:00'), verdict('b', 'rejected', '2026-10-27T08:05:00+00:00'), verdict('c', 'needs-evidence', '2026-10-27T08:06:00+00:00'), verdict('d', 'verified', '2026-10-27T08:07:00+00:00')]);
    await coreTick(s.$);
    expect(s.rec.toasts).toEqual(['✖ REFUTED b: title b', '? c needs evidence', '✔ verified d: title d']);
    await coreTick(s.$);
    await coreTick(s.$);
    expect(s.rec.toasts).toHaveLength(3);
    expect(s.rec.status.at(-1)).toMatch(/^atlas ✔2 ✖1 ⚠0/);
  });

  test('sound plays fail.wav on a refutation only when the option is on', async () => {
    for (const sound of [true, false]) {
      const s = await session(sound);
      await coreTick(s.$);
      s.files[`${RUN}/findings.json`] = JSON.stringify([verdict('b', 'rejected', '2026-10-27T08:05:00+00:00')]);
      s.mtimes[`${RUN}/findings.json`] = 1;
      await coreTick(s.$);
      expect(s.rec.plays).toEqual(sound ? ['mod/fx/fail.wav'] : []);
    }
  });

  test('a worker whose log finishes toasts its offload once', async () => {
    const s = await session(false);
    await coreTick(s.$);
    s.files[`${RUN}/logs/implementer-1.log`] += `\n${JSON.stringify({ type: 'result', total_cost_usd: 0.1, modelUsage: { 'claude-sonnet-5-5': { costUSD: 0.1 } } })}`;
    await coreTick(s.$);
    await coreTick(s.$);
    expect(s.rec.toasts).toEqual(['⇆ implementer-1 done: 4.0k kept in tmux, 0 back']);
  });

  test('an unchanged log is not read again', async () => {
    const s = await session(false);
    for (let i = 0; i < 4; i++) await coreTick(s.$);
    expect(s.rec.reads.filter((p) => p.endsWith('implementer-1.log'))).toHaveLength(1);
  });

  test('unchanged findings are read once; a same-size rewrite with a new mtime is re-read', async () => {
    const s = await session(false);
    const path = `${RUN}/findings.json`;
    for (let i = 0; i < 3; i++) await coreTick(s.$);
    expect(s.rec.reads.filter((p) => p === path)).toHaveLength(1);
    s.files[path] = JSON.stringify([verdict('b', 'verified', '2026-10-27T08:00:00+00:00')]);
    s.mtimes[path] = 5;
    await coreTick(s.$);
    expect(s.rec.reads.filter((p) => p === path)).toHaveLength(2);
  });

  test('a removed log is evicted from the cache', async () => {
    const s = await session(false);
    const log = `${RUN}/logs/implementer-1.log`;
    await coreTick(s.$);
    delete s.files[log];
    await coreTick(s.$);
    s.files[log] = `${assistant('m1', 1000)}\n${assistant('m2', 5000)}`;
    await coreTick(s.$);
    expect(s.rec.reads.filter((p) => p === log)).toHaveLength(2);
  });

  test('findings.json missing for one tick does not re-toast every verdict on the next good read', async () => {
    const s = await session(false);
    await coreTick(s.$);
    const path = `${RUN}/findings.json`;
    const good = s.files[path]!;
    delete s.files[path];
    await coreTick(s.$);
    s.files[path] = good;
    await coreTick(s.$);
    expect(s.rec.toasts).toEqual([]);
  });

  test('a partial findings.json for one tick does not re-toast every verdict on the next good read', async () => {
    const s = await session(false);
    await coreTick(s.$);
    const path = `${RUN}/findings.json`;
    const good = s.files[path]!;
    s.files[path] = good.slice(0, 10);
    await coreTick(s.$);
    s.files[path] = good;
    await coreTick(s.$);
    expect(s.rec.toasts).toEqual([]);
  });

  test('board reports with one timestamp keep a stable order whatever the listing order', async () => {
    const s = await session(false);
    const note = (owner: string) => JSON.stringify({ kind: 'report', owner, text: 'STATUS: DONE', ts: 100 });
    s.files[`${RUN}/board/z.jsonl`] = note('implementer-2');
    s.files[`${RUN}/board/a.jsonl`] = note('implementer-1a');
    await coreTick(s.$);
    const core = (await s.state.get({ plugin: 'atlas', key: 'core' })).value as { claims: { owner: string }[] };
    expect(core.claims.map((c) => c.owner)).toEqual(['implementer-1a', 'implementer-2']);
  });

  test('the core is stored only when it changed, and written never by a render', async () => {
    const s = await session(false);
    await coreTick(s.$);
    const v1 = (await s.state.get({ plugin: 'atlas', key: 'core' })).version;
    await coreTick(s.$);
    expect((await s.state.get({ plugin: 'atlas', key: 'core' })).version).toBe(v1);
    expect((await s.state.get({ plugin: 'atlas', key: 'core' })).value).toMatchObject({ ledger: { verified: 1 } });
  });

  test('no board root: no status, no state', async () => {
    const s = await session(false);
    await s.state.set({ plugin: 'atlas', key: 'snapshot' }, { root: '', todos: [] });
    await coreTick(s.$);
    expect(s.rec.status).toEqual([]);
  });

  test('headless sessions do nothing', async () => {
    const s = await session(false);
    await s.state.set({ plugin: 'atlas', key: 'isInteractive' }, false);
    await coreTick(s.$);
    expect(s.rec.toasts).toEqual([]);
    expect(s.rec.status).toEqual([]);
  });
});

describe('/atlas-core and the header tally', () => {
  test('the command answers with the report, computed from the files', async () => {
    const s = await session(false);
    s.files[`${RUN}/findings.json`] = JSON.stringify([verdict('b', 'rejected', '2026-10-27T08:05:00+00:00')]);
    const run = s.all('command.run', ['command', 'atlas-core'])[0]!;
    const out = (await run(s.$, { args: '' }, noopNext)) as { text: string };
    expect(out.text).toContain('VERDICTS');
    expect(out.text).toContain('REFUTED  b  title b');
    expect(out.text).toContain('1x implementer sonnet/medium  ran claude-sonnet-5-5');
  });

  test('with nothing recorded the command says so in one line', async () => {
    const s = await session(false);
    for (const k of Object.keys(s.files)) if (k.startsWith(RUN)) delete s.files[k];
    const run = s.all('command.run', ['command', 'atlas-core'])[0]!;
    const out = (await run(s.$, { args: '' }, noopNext)) as { text: string };
    expect(out.text.split('\n')).toHaveLength(1);
  });

  test('session.start registers /atlas-core in an interactive session', async () => {
    const s = await session(false);
    s.files[`${ROOT}/.atlas/.run/todos.json`] = '[]';
    await s.all('session.start')[0]!(s.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
    expect(s.rec.commands).toContain('atlas-core');
  });

  test('main-agent answers bump the header tally; a matching header bumps ok', async () => {
    const s = await session(false);
    const e = (answer: string) => ({ reason: 'answer', answer, agentId: undefined, isAborted: false });
    for (const h of s.all('turn.complete', ['reason', 'answer'])) {
      await h(s.$, e('ATLAS | 🏁 done | shipped\nbody'), noopNext).catch(() => undefined);
      await h(s.$, e('no header here'), noopNext).catch(() => undefined);
    }
    expect((await s.state.get({ plugin: 'atlas', key: 'headerTally' })).value).toEqual({ ok: 1, total: 2 });
  });
});
