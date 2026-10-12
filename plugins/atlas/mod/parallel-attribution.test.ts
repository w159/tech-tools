// Two named workers dispatched in ONE message (live run, final build): every worker gets its own
// dispatch / join / report / quit line, attributed by the unique agent id, never by label or position.
// Event shapes are the real ones read from the live debug log, transcript .meta.json and the
// host d.ts (AgentSpawnInput / AgentSpawnResult / TurnCompleteInput / AgentInfo); ids and text redacted.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;

const A = 'a4fddc42b5a4c1df6'; // session-tails-explorer (4 turns)
const B = 'a26ea1206a1b15f0a'; // channel-nicks-explorer (9 turns)

const spawnInput = (name: string, description: string, toolUseId: string) => ({
  tool_use_id: toolUseId,
  prompt: `TOOLS: one batched ToolSearch select ... ${description}`,
  description,
  subagentType: 'atlas:explorer',
  provider: { plugin: 'atlas', tier: 'user' },
  parentModel: 'claude-sonnet-5-5',
  permissionMode: 'default',
  background: true,
  fork: false,
  name,
});

const complete = (agentId: string, answer: string) => ({
  reason: 'answer',
  answer,
  agentId,
  usage: { input_tokens: 1200, output_tokens: 300 },
});

function harness() {
  const handlers: { event: string; matcher: Record<string, unknown>; hook: AnyHandler }[] = [];
  const on = ((event: string, a: unknown, b?: unknown) => {
    handlers.push({ event, matcher: b === undefined ? {} : (a as Record<string, unknown>), hook: (b ?? a) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const listed: { id: string; type: string; description: string; status: string; name?: string }[] = [];
  let now = 1_760_000_000_000;
  const ticks: (() => void)[] = [];
  let sig = 0;
  const $ = {
    state: memState(),
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => now, every: (_ms: number, fn: () => void) => (ticks.push(fn), { cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    session: { id: async () => 'sess-parallel' },
    fs: {
      read: async () => { throw new Error('no fs'); },
      stat: async () => ({ size: ++sig, mtimeMs: sig }),
      exists: async (p: string) => p === '/tmp/proj/.atlas',
      list: async () => [],
    },
    command: { register: async () => {} },
    ui: {
      log: () => {},
      invalidate: () => {},
      open: async () => {},
      close: async () => {},
    },
    agent: { list: async () => listed },
  } as unknown as EngineInterface;
  const fire = (name: string, e: unknown, next: AnyNext = async (i) => i) => {
    const fields = e as Record<string, unknown>;
    const hit = handlers.filter((h) => h.event === name && Object.entries(h.matcher).every(([k, v]) => fields[k] === v));
    return Promise.all(hit.map((h) => h.hook($, e, next)));
  };
  /** The 1.5 s tick: fingerprint moved (listed/orch changed) -> rebuild. */
  const tick = async () => {
    ticks[0]?.();
    for (let i = 0; i < 400; i++) await Promise.resolve();
  };
  const comms = async () => {
    const snap = (await $.state.get({ plugin: 'atlas', key: 'snapshot' } as never)).value as { comms: { from: string; to: string; kind: string; text: string }[] } | undefined;
    if (snap === undefined) throw new Error('no snapshot');
    return snap.comms.map((c) => `${c.kind}|${c.from}>${c.to}|${c.text}`);
  };
  return { $, fire, tick, comms, listed, advance: (ms: number) => { now += ms; }, register: () => register(on, {}) };
}

const T = 'session-tails-explorer';
const N = 'channel-nicks-explorer';
const EXPECTED = [
  `dispatch|lead>${T}|Map parseTranscript tail lines`,
  `join|${T}>all|joined`,
  `dispatch|lead>${N}|Map channel.tsx nick list`,
  `join|${N}>all|joined`,
  `report|${T}>lead|parseTranscript keeps the last 4 assistant text lines (sessions.ts:40).`,
  `leave|${T}>all|left`,
  `report|${N}>lead|nick list = participants() channel.tsx:241.`,
  `leave|${N}>all|left`,
];

/** Both spawns in one message, a rebuild tick at the given moments, B's host row completing first or never listed again.
 * `noAgentId`: the workers' turn.complete carries no agentId (only the host list says who finished). */
async function run(opts: { tickInsideSpawn: boolean; dropCompleted: boolean; noAgentId?: boolean }): Promise<string[]> {
  const h = harness();
  await h.register();
  await h.fire('session.start', { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true });
  await h.fire('command.run', { command: 'atlas-cc', args: 'channel' });
  const spawn = (id: string, e: { description: string; name: string }) =>
    h.fire('agent.spawn', e, async () => {
      h.listed.push({ id, type: 'atlas:explorer', description: e.description, status: 'running', name: e.name });
      if (opts.tickInsideSpawn) await h.tick(); // a rebuild lands after the host listed the agent, before the hook recorded it
      return { model: 'claude-sonnet-5-5', agentId: id };
    });
  await Promise.all([
    spawn(A, spawnInput(T, 'Map parseTranscript tail lines', 'toolu_01M9kK4MeFy95BkCg8mk1vAt')),
    spawn(B, spawnInput(N, 'Map channel.tsx nick list', 'toolu_01PTeKZx1wit479DgryUXFMA')),
  ]);
  h.advance(1_000);
  await h.tick();
  const finish = async (id: string, answer: string) => {
    h.advance(30_000);
    if (opts.dropCompleted) h.listed.splice(h.listed.findIndex((r) => r.id === id), 1);
    else h.listed.find((r) => r.id === id)!.status = 'completed';
    const done = complete(id, answer);
    await h.fire('turn.complete', opts.noAgentId ? { ...done, agentId: undefined } : done);
    await h.tick();
  };
  await finish(A, 'STEPS: 4/4\n\nparseTranscript keeps the last 4 assistant text lines (sessions.ts:40).');
  await finish(B, 'STEPS: 5/5\n\nnick list = participants() channel.tsx:241.');
  return (await h.comms()).filter((l) => !l.startsWith('say|'));
}

describe('parallel workers dispatched in one message', () => {
  test('each worker gets its own dispatch, join, report and quit, attributed by agent id', async () => {
    expect(await run({ tickInsideSpawn: false, dropCompleted: false })).toEqual(EXPECTED);
  });
  test('same when a rebuild lands between the host listing the agents and the spawn hook recording them', async () => {
    expect(await run({ tickInsideSpawn: true, dropCompleted: false })).toEqual(EXPECTED);
  });
  test('same when the host list drops a worker once it completed', async () => {
    expect(await run({ tickInsideSpawn: false, dropCompleted: true })).toEqual(EXPECTED);
  });
  test('same with both', async () => {
    expect(await run({ tickInsideSpawn: true, dropCompleted: true })).toEqual(EXPECTED);
  });
  test('a turn.complete without agentId: the host row that completed names the worker', async () => {
    const lines = await run({ tickInsideSpawn: false, dropCompleted: false, noAgentId: true });
    expect(lines.filter((l) => l.startsWith('report|') || l.startsWith('leave|'))).toEqual([
      `report|${T}>lead|reported`,
      `leave|${T}>all|left`,
      `report|${N}>lead|reported`,
      `leave|${N}>all|left`,
    ]);
    expect(lines.filter((l) => l.startsWith('dispatch|') || l.startsWith('join|'))).toHaveLength(4);
  });
});
