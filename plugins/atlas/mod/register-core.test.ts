// coreTick: toasts once per new verdict (the first read is a baseline), the refutation sound, a finished worker,
// no status-line entry, logs re-read when size or mtime changes, /atlas-core, and the header tally.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { coreMatrix } from '../contracts/core-fixture';
import { buildCore, coreTick, headerTallyOf, register, resetCore } from './register';
import { memState } from './test_helpers';
import { withHeaderTally } from './data/runstate';
import { forgetDrawnHeaders } from './restyle';

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
const team = JSON.stringify({ team_id: 'tx', channel: 'proj@main/lead-sess-c', // a spawn-team record is on its lead's channel
 name: 'x', class: 'fix', effort: 'low', isolation: 'shared', max_parallel: 1, created: 1, members: [{ name: 'implementer-1', role: 'implementer' }] });
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
    'atlas/snapshot': { root: ROOT, todos: [], sessionId: 'sess-core', contract: { headerFirstLinePattern: '^ATLAS \\| \\S+ (research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\| \\S' } },
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
    expect(s.rec.status).toEqual([]); // the core never sets a status-line entry
    s.files[`${RUN}/findings.json`] = JSON.stringify([verdict('a', 'verified', '2026-10-27T08:00:00+00:00'), verdict('b', 'rejected', '2026-10-27T08:05:00+00:00'), verdict('c', 'needs-evidence', '2026-10-27T08:06:00+00:00'), verdict('d', 'verified', '2026-10-27T08:07:00+00:00')]);
    await coreTick(s.$);
    // One toast per read: state first, then the name, then one fact; the rest fold into `+N more`.
    expect(s.rec.toasts).toHaveLength(1);
    const [toast] = s.rec.toasts;
    expect(toast).toBe('▌ ◆ ATLAS  ■ failed  b  refut... +2 more');
    await coreTick(s.$);
    await coreTick(s.$);
    expect(s.rec.toasts).toHaveLength(1);
    expect(s.rec.status).toEqual([]);
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
    expect(s.rec.toasts).toEqual(['▌ ◆ ATLAS  ● done  implementer-1  4.0...']);
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

  test('buildCore hands the pane this session\'s channels and in-process dispatches', async () => {
    const s = await session(false);
    const onLead = (id: string, channel: string) => JSON.stringify({ ...JSON.parse(team), team_id: id, channel });
    s.files[`${RUN}/teams/mine.json`] = onLead('mine', 'proj@main/lead-abcdef');
    s.files[`${RUN}/teams/other.json`] = onLead('other', 'proj@main/lead-zzzzzz');
    await s.state.set({ plugin: 'atlas', key: 'snapshot' }, { root: ROOT, todos: [], sessionId: 'abcdef1234', channel: 'proj@main' });
    await s.state.set({ plugin: 'atlas', key: 'orch' }, { activity: {}, comms: [], stage: {}, meta: { 'implementer-w': { name: 'implementer-w', scope: 'fix/low', model: 'sonnet', at: 5 } } });
    const m = await buildCore(s.$);
    expect(m?.inProcess).toBe(true);
    expect(m?.routes.map((r) => r.transport).sort()).toEqual(['in-process', 'tmux']); // the other session's team is not a route
  });

  test('no board root: no state', async () => {
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

describe('critique 7 B1: the header count is the transcript chip count', () => {
  const snap = { contract: { headerFirstLinePattern: '^ATLAS \\| \\S+ (research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\| \\S' } } as never;
  // 150-1 f0107: one turn, three header replies between tool calls and notifications; only the last is the turn's answer.
  const transcript = [
    { role: 'user', text: 'run the scenario' },
    { role: 'assistant', text: 'ATLAS | 🔍 research | 1/3 explorers returned (alpha)', toolUses: [] },
    { role: 'user', text: '<task-notification>alpha</task-notification>' },
    { role: 'assistant', text: 'ATLAS | 🔍 research | 2/3 explorers returned (alpha, beta)' },
    { role: 'assistant', text: '', toolUses: [{ tool: 'Bash', input: { command: 'ls' } }] },
    { role: 'assistant', text: 'ATLAS | ✅ verify | done, 5/5 board items complete' },
  ];
  test('headerTallyOf counts every assistant text the transcript draws a chip for, and the answer once', () => {
    expect(headerTallyOf(transcript, 'ATLAS | ✅ verify | done, 5/5 board items complete', snap)).toEqual({ ok: 3, total: 3 });
    expect(headerTallyOf([...transcript, { role: 'assistant', text: 'plain reply, no header' }], 'plain reply, no header', snap)).toEqual({ ok: 3, total: 4 });
    // the host had not appended the answer to the transcript yet: it still counts, once
    expect(headerTallyOf(transcript.slice(0, -1), 'ATLAS | ✅ verify | done, 5/5 board items complete', snap)).toEqual({ ok: 3, total: 3 });
  });
  test('turn.complete stores the transcript count: 3 of 3 under three chips, never 1 of 1', async () => {
    const s = await session(false);
    (s.$ as unknown as { session: Record<string, unknown> }).session.messages = async (a?: { agentId?: string }) => (a?.agentId ? [] : transcript);
    const e = { reason: 'answer', answer: 'ATLAS | ✅ verify | done, 5/5 board items complete', agentId: undefined, isAborted: false };
    for (const h of s.all('turn.complete', ['reason', 'answer'])) await h(s.$, e, noopNext).catch(() => undefined);
    expect((await s.state.get({ plugin: 'atlas', key: 'headerTally' })).value).toEqual({ ok: 3, total: 3 });
  });
});

describe('critique 7 B2: evidence counts the plan the band counts', () => {
  test('buildCore counts this session plan items, not the shared board (dispatch rows, other sessions, advisor notes)', async () => {
    const s = await session(false);
    const row = (id: string, o: Record<string, unknown>) => ({ id, content: `item ${id}`, status: 'completed', evidence: 'ran it', session_id: 'sess-core', ...o });
    const snap = (await s.state.get({ plugin: 'atlas', key: 'snapshot' })).value as Record<string, unknown>;
    await s.state.set({ plugin: 'atlas', key: 'snapshot' }, { ...snap, todos: [
      row('T1', { origin: 'session' }), row('T2', { origin: 'session', evidence: '' }), row('T3', { origin: 'session', status: 'pending' }),
      row('d1', { origin: 'dispatch' }), row('d2', { origin: 'dispatch' }), row('x1', { origin: 'session', session_id: 'other-session' }), row('a1', { origin: 'advisor' }),
    ] });
    const core = await buildCore(s.$);
    expect(core!.contract.evidence).toEqual({ ok: 1, total: 2 }); // T1 and T2 are the plan's done items; the rest of the board is not the plan
  });
});

describe('critique 11 B3: the gates tab counts the replies the transcript drew a chip for', () => {
  const headerReplies = ['ATLAS | 🔍 research | 1/3 explorers returned', 'ATLAS | 🔍 research | 2/3 explorers returned', 'ATLAS | ✅ verify | done, 5/5'];
  // Live (150-1 tab-gates.png): the host lists no lead messages ($.session.messages is empty), turn.complete carries only the last reply, the transcript drew 3 chips.
  test('three header replies drawn, one turn.complete, no lead messages: the core header is 3 of 3 and the Header contract line reads 3 of 3', async () => {
    forgetDrawnHeaders();
    const s = await session(false);
    (s.$ as unknown as { session: Record<string, unknown> }).session.messages = async () => [];
    const draw = s.all('ui.render', ['component', 'AssistantMessage'])[0]!;
    for (const [i, text] of headerReplies.entries()) await draw(s.$, { surface: 'terminal', component: 'AssistantMessage', requestId: `m${i}`, props: { text } }, noopNext);
    const done = { reason: 'answer', answer: headerReplies[2], agentId: undefined, isAborted: false };
    for (const h of s.all('turn.complete', ['reason', 'answer'])) await h(s.$, done, noopNext).catch(() => undefined);
    expect((await s.state.get({ plugin: 'atlas', key: 'headerTally' })).value).toEqual({ ok: 1, total: 1 }); // the per-turn count alone is what read `0 of 1` / `1 of 1`
    const core = await buildCore(s.$);
    expect(core!.contract.header).toEqual({ ok: 3, total: 3 });
    const groups = withHeaderTally([{ id: 'header', lines: [] as unknown[] }], core!.contract.header) as unknown as { lines: { ok: boolean; detail: string }[] }[];
    expect(groups[0]!.lines[0]).toMatchObject({ ok: true, detail: '3 of 3' });
    forgetDrawnHeaders();
  });
});
