// Tests for routing.ts — run with `claude plugin test plugins/atlas` (kit:
// claude-code/testing). Covers: model passthrough on agent.spawn (persona
// model pins live in agent-definition frontmatter, honored natively),
// agentId→persona recording, effort pinning on turn.step, and the fail-open
// paths.
import { describe, expect, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import { fullModel, promptName, registerCompletion, registerRouting } from './routing';
import type { Persona } from './contract';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS, memFs, memState } from './test_helpers';
import { SnapshotBuilder } from './snapshot';

// Structural mirrors of the event shapes the handlers read (d.ts: AgentSpawnInput,
// TurnStepInput, TurnCompleteInput, PromptSubmitInput).
interface SpawnEvent {
  tool_use_id: string;
  prompt: string;
  description: string;
  subagentType: string;
  model?: string;
  parentModel?: string;
  fork: boolean;
  name?: string;
}
interface StepEvent {
  turnId: string;
  index: number;
  model: string;
  effort?: string;
  messageCount: number;
  agentId?: string;
}
interface CompleteEvent {
  answer: string;
  agentId?: string;
}
interface SubmitEvent {
  text: string;
  context?: readonly string[];
}

interface EventShape {
  'agent.spawn': SpawnEvent;
  'tool.call': { tool: string; tool_use_id: string; [k: string]: unknown };
  'turn.step': StepEvent;
  'turn.complete': CompleteEvent;
  'prompt.submit': SubmitEvent;
}
/** What next(e) resolves to per event (d.ts: AgentSpawnResult, TurnStepInput doc, { text }). */
interface ResultShape {
  'agent.spawn': { model: string; agentId: string };
  'tool.call': unknown;
  'turn.step': unknown; // the whole model response; never asserted on
  'turn.complete': { text: string };
  'prompt.submit': { text: string; context?: readonly string[] };
}
type Handler<E extends keyof EventShape> = (
  $: unknown,
  e: EventShape[E],
  next: (input: EventShape[E]) => ResultShape[E] | Promise<ResultShape[E]>,
) => ResultShape[E] | Promise<ResultShape[E]>;

/** Minimal on() registrar: captures handlers by event name for direct calls. */
function captureOn() {
  const handlers = new Map<string, unknown>();
  // Bridge the test registrar to the engine's On type; the fake stores any hook.
  const on = ((event: string, ...rest: unknown[]) => {
    handlers.set(event, rest[rest.length - 1]); // (event, hook) or (event, matcher, hook)
    return { catch() {} };
  }) as unknown as On;
  const pick = <E extends keyof EventShape>(name: E): Handler<E> => {
    const hook = handlers.get(name);
    if (hook === undefined) throw new Error(`no ${name} handler registered`);
    return hook as Handler<E>; // stored by the registration above
  };
  // The engine stub: only $.state, which routing reads and writes.
  const state = memState();
  const $ = { state };
  const stateOf = async (key: string) => (await state.get({ plugin: 'atlas', key })).value;
  /** [name, persona] of every task agent routing recorded into $.state. */
  const recorded = async () =>
    ((await stateOf('taskAgents')) as Array<{ name: string; persona: string }> | undefined ?? []).map((a) => [a.name, a.persona]);
  return { on, pick, $, recorded };
}

const persona: Persona = {
  name: 'implementer',
  model: 'haiku',
  effort: 'medium',
  color: 'green',
  description: 'implements',
};

const spawnInput = (over: Partial<SpawnEvent> = {}): SpawnEvent => ({
  tool_use_id: 't1',
  prompt: 'do it',
  description: 'task',
  subagentType: 'atlas:implementer',
  fork: false,
  ...over,
});

/** Fake engine next for agent.spawn: echoes the model the hook chose. */
const spawnNext = async (e: SpawnEvent) => ({ model: e.model ?? 'parent-model', agentId: 'agent-1' });

/** The turn.step hook's real shape (d.ts StreamHook): an async generator whose
 * `next(e)` is the stream beneath, not a promise. */
type StepHook = (
  $: unknown,
  e: StepEvent,
  next: (input: StepEvent) => AsyncGenerator<unknown, unknown>,
) => AsyncGenerator<unknown, void>;

/**
 * Drives a streaming (turn.step) hook the way the engine does: a hook body is
 * an async generator, so it is consumed to completion. `next(e)` is faked as
 * the stream beneath (d.ts HookStream): an empty generator whose return value
 * is the fake next's result. No chunks are faked; the hook forwards all.
 */
async function runStep($: unknown, hook: Handler<'turn.step'>, e: StepEvent, next: (input: StepEvent) => unknown): Promise<void> {
  // `next(e)` is faked as the stream beneath (d.ts HookStream): an empty
  // generator whose return value is the fake next's result.
  const gen = (hook as unknown as StepHook)(
    $,
    e,
    (input) =>
      (async function* () {
        return next(input);
      })(),
  );
  while (!(await gen.next()).done) {
    // chunks of the response beneath: forwarded by the hook, nothing to assert
  }
}

function routingDeps(over: Partial<{ getPersonas: () => Persona[] }> = {}) {
  const drift: string[] = [];
  const deps = {
    getPersonas: () => [persona],
    logDrift: (msg: string) => drift.push(msg),
    ...over,
  };
  return { deps, drift };
}

describe('registerRouting agent.spawn', () => {
  test('passes an omitted model through untouched and records the agent', async () => {
    const { on, pick, $, recorded } = captureOn();
    const { deps } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput(), spawnNext);
    expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
    expect(await recorded()).toEqual([['agent-1', 'implementer']]);
  });

  test('passes an inherit model through untouched and records the agent', async () => {
    const { on, pick, $, recorded } = captureOn();
    const { deps } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput({ model: 'inherit' }), spawnNext);
    expect(result).toEqual({ model: 'inherit', agentId: 'agent-1' });
    expect(await recorded()).toEqual([['agent-1', 'implementer']]);
  });

  test('passes an explicit model through untouched, records the agent, and notes the drift', async () => {
    const { on, pick, $, recorded } = captureOn();
    const { deps, drift } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput({ model: 'opus' }), spawnNext);
    expect(result).toEqual({ model: 'opus', agentId: 'agent-1' });
    expect(await recorded()).toEqual([['agent-1', 'implementer']]);
    expect(drift).toEqual(['agent.spawn: atlas:implementer asked for model opus, pinned haiku']);
  });

  test('leaves a fork untouched', async () => {
    const { on, pick, $, recorded } = captureOn();
    const { deps, drift } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput({ fork: true }), spawnNext);
    expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
    expect(await recorded()).toEqual([]);
    expect(drift).toEqual([]);
  });

  test('routes no persona for unknown roles but records them for the band', async () => {
    const { on, pick, $, recorded } = captureOn();
    const { deps, drift } = routingDeps();
    registerRouting(on, deps);
    for (const subagentType of ['atlas:nobody', 'armada:core', 'general-purpose', 'task']) {
      const result = await pick('agent.spawn')($, spawnInput({ subagentType }), spawnNext);
      expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
    }
    // No persona routing and no drift, yet every spawn shows in the band
    // (persona = the lowercased subagentType, so the band never shows a raw id).
    // (the fake spawn reuses one agentId, so $.state holds a single entry)
    expect(await recorded()).toEqual([['agent-1', 'task']]);
    expect(drift).toEqual([]);
  });

  test('fails open when getPersonas throws', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, {
      getPersonas: () => {
        throw new Error('boom');
      },
      logDrift: () => {},
    });
    const result = await pick('agent.spawn')($, spawnInput(), spawnNext);
    expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
  });
});

describe('registerRouting Agent tool name', () => {
  const orchNames = async ($: { state: ReturnType<typeof memState> }) =>
    Object.values(((await $.state.get({ plugin: 'atlas', key: 'orch' })).value as { meta: Record<string, { name?: string }> }).meta).map((m) => m.name);
  for (const [label, callId] of [['tool_use_id', 't1'], ['description+type', 'other']] as const) {
    test(`tool.call name reaches a nameless agent.spawn by ${label}`, async () => {
      const { on, pick, $ } = captureOn();
      registerRouting(on, { getPersonas: () => [persona], logDrift() {} });
      const $c = { ...$, clock: { now: async () => 1000 } };
      await pick('tool.call')($c, { tool: 'Agent', tool_use_id: callId, name: 'impl-auth', subagent_type: 'atlas:implementer', description: 'edit auth' }, () => ({}));
      await pick('agent.spawn')($c, spawnInput({ description: 'edit auth' }), spawnNext);
      expect(await orchNames($)).toEqual(['impl-auth']);
    });
  }
});

describe('registerRouting spawn model', () => {
  const orchMeta = async ($: { state: ReturnType<typeof memState> }) =>
    Object.values(((await $.state.get({ plugin: 'atlas', key: 'orch' })).value as { meta: Record<string, { name?: string; model?: string }> }).meta);
  const spawned = async (over: Partial<SpawnEvent>, personas: Persona[] = []) => {
    const { on, pick, $, recorded } = captureOn();
    registerRouting(on, { getPersonas: () => personas, logDrift() {} });
    const $c = { ...$, clock: { now: async () => 1000 } };
    await pick('agent.spawn')($c, spawnInput(over), spawnNext);
    const squad = ((await $.state.get({ plugin: 'atlas', key: 'taskAgents' })).value as Array<{ model?: string }>).map((a) => a.model);
    return { meta: await orchMeta($), squad, recorded };
  };
  test('an explicit spawn model and the spawn name reach the orchestration meta and the task agent', async () => {
    const { meta, squad } = await spawned({ model: 'opus', parentModel: 'sonnet', name: 'explorer-calc', subagentType: 'Explore' });
    expect(meta.map((m) => [m.name, m.model])).toEqual([['explorer-calc', 'opus']]);
    expect(squad).toEqual(['opus']);
  });
  test('an unpinned spawn inherits the parent model', async () => {
    expect((await spawned({ parentModel: 'sonnet', subagentType: 'Explore' })).meta.map((m) => m.model)).toEqual(['sonnet']);
    expect((await spawned({ model: 'inherit', parentModel: 'sonnet', subagentType: 'Explore' })).meta.map((m) => m.model)).toEqual(['sonnet']);
  });
  test('a known role shows its frontmatter pin, not the parent model', async () => {
    expect((await spawned({ parentModel: 'opus' }, [persona])).meta.map((m) => m.model)).toEqual(['haiku']);
  });
});

describe('registerRouting turn.step', () => {
  const stepInput = (over: Partial<StepEvent> = {}): StepEvent => ({
    turnId: 'turn-1',
    index: 0,
    model: 'haiku',
    messageCount: 3,
    agentId: 'agent-1',
    ...over,
  });

  /** Registers routing, records agent-1 via a spawn, returns the turn.step handler. */
  async function recordedStep() {
    const { on, pick, $, recorded } = captureOn();
    const { deps } = routingDeps();
    registerRouting(on, deps);
    await pick('agent.spawn')($, spawnInput(), spawnNext); // records agent-1
    return { step: pick('turn.step'), $ };
  }

  test('pins the recorded persona effort onto the request', async () => {
    const { step, $ } = await recordedStep();
    const seen: StepEvent[] = [];
    await runStep($, step, stepInput(), (e) => (seen.push(e), { response: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.effort).toBe('medium');
  });

  test('leaves unrecorded agents untouched', async () => {
    const { step, $ } = await recordedStep();
    const seen: StepEvent[] = [];
    await runStep($, step, stepInput({ agentId: 'agent-2' }), (e) => (seen.push(e), { response: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.effort).toBeUndefined();
  });

  test('pins nothing when the persona effort is not low/medium/high', async () => {
    const { on, pick, $, recorded } = captureOn();
    registerRouting(on, {
      getPersonas: () => [{ ...persona, effort: 'xhigh' }],
      logDrift: () => {},
    });
    await pick('agent.spawn')($, spawnInput(), spawnNext);
    const seen: StepEvent[] = [];
    await runStep($, pick('turn.step'), stepInput(), (e) => (seen.push(e), { response: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.effort).toBeUndefined();
  });

  test('records an inherit-model persona so its effort is pinned', async () => {
    const { on, pick, $, recorded } = captureOn();
    registerRouting(on, {
      getPersonas: () => [{ ...persona, model: 'inherit' }],
      logDrift: () => {},
    });
    await pick('agent.spawn')($, spawnInput(), spawnNext);
    const seen: StepEvent[] = [];
    await runStep($, pick('turn.step'), stepInput(), (e) => (seen.push(e), { response: true }));
    expect(seen[0]!.effort).toBe('medium');
  });

  test('fails open when getPersonas throws on turn.step', async () => {
    const { on, pick, $, recorded } = captureOn();
    let calls = 0;
    registerRouting(on, {
      getPersonas: () => {
        calls += 1;
        if (calls > 1) throw new Error('boom');
        return [persona];
      },
      logDrift: () => {},
    });
    await pick('agent.spawn')($, spawnInput(), spawnNext); // records agent-1
    const seen: StepEvent[] = [];
    await runStep($, pick('turn.step'), stepInput(), (e) => (seen.push(e), { response: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.effort).toBeUndefined();
  });
});

describe('registerCompletion', () => {
  test('never throws on an engine without a clock and still moves the answer on', async () => {
    const { on, pick, $ } = captureOn();
    registerCompletion(on);
    const result = await pick('turn.complete')($, { answer: 'ATLAS | x\nbody', agentId: 'agent-1' }, () => ({ text: 'kept' }));
    expect(result).toEqual({ text: 'kept' });
  });
});

describe('fullModel', () => {
  test('resolves an alias only to a parent id of the same family', () => {
    expect(fullModel('sonnet', 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(fullModel('SONNET', 'Claude-Sonnet-5-5')).toBe('Claude-Sonnet-5-5');
    expect(fullModel('opus', 'claude-sonnet-5-5')).toBe('opus');
    expect(fullModel('claude-opus-4', 'claude-sonnet-5-5')).toBe('claude-opus-4');
    expect(fullModel('vendor/model', 'vendor-model-x')).toBe('vendor/model');
    expect(fullModel('sonnet', undefined)).toBe('sonnet');
    expect(fullModel('sonnet', '')).toBe('sonnet');
    expect(fullModel(undefined, 'claude-sonnet-5-5')).toBeUndefined();
    expect(fullModel('', 'claude-sonnet-5-5')).toBe('');
  });
});

describe('promptName', () => {
  test('reads the first-line worker name, with the allowed characters only', () => {
    expect(promptName('name: probe-slow\nSCOPE: x')).toBe('probe-slow');
    expect(promptName('  NAME:   a.b_c-1 rest')).toBe('a.b_c-1');
    expect(promptName('hello\nname: later')).toBeUndefined();
    expect(promptName('name: ')).toBeUndefined();
  });
});

describe('registerRouting bookkeeping', () => {
  const clockAt = (t: { now: number }) => ({ now: async () => t.now });
  const metaOf = async ($: { state: ReturnType<typeof memState> }) =>
    (await $.state.get({ plugin: 'atlas', key: 'orch' })).value as { meta: Record<string, { name?: string; model?: string; scope?: string }>; activity: Record<string, { tokens: number | null }> };

  test('caps live task agents at 64, newest kept, and re-spawning an id updates in place', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [], logDrift() {} });
    const $c = { ...$, clock: clockAt({ now: 1 }) };
    for (let i = 0; i < 70; i += 1) await pick('agent.spawn')($c, spawnInput({ subagentType: 'task' }), async () => ({ model: 'm', agentId: `ag-${i}` }));
    const agents = (await $.state.get({ plugin: 'atlas', key: 'taskAgents' })).value as Array<{ name: string }>;
    expect(agents.length).toBe(64);
    expect([agents[0]!.name, agents[63]!.name]).toEqual(['ag-6', 'ag-69']);
    await pick('agent.spawn')($c, spawnInput({ subagentType: 'task', description: 'again' }), async () => ({ model: 'm', agentId: 'ag-10' }));
    const after = (await $.state.get({ plugin: 'atlas', key: 'taskAgents' })).value as Array<{ name: string; task?: string }>;
    expect(after.length).toBe(64);
    expect(after.filter((a) => a.name === 'ag-10').map((a) => a.task)).toEqual(['again']);
  });

  test('prompt first-line name and SCOPE reach the orch meta when the spawn and tool call carry no name', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [], logDrift() {} });
    const $c = { ...$, clock: clockAt({ now: 1 }) };
    await pick('agent.spawn')($c, spawnInput({ subagentType: 'task', prompt: 'name: probe-slow\nSCOPE: audit/medium\nbody' }), spawnNext);
    const meta = (await metaOf($)).meta['agent-1']!;
    expect([meta.name, meta.scope]).toEqual(['probe-slow', 'audit/medium']);
  });

  test('an explicit spawn model beats the persona pin; the pin beats the parent', async () => {
    const run = async (over: Partial<SpawnEvent>) => {
      const { on, pick, $ } = captureOn();
      registerRouting(on, { getPersonas: () => [persona], logDrift() {} });
      await pick('agent.spawn')({ ...$, clock: clockAt({ now: 1 }) }, spawnInput(over), spawnNext);
      return (await metaOf($)).meta['agent-1']!.model;
    };
    expect(await run({ model: 'opus', parentModel: 'sonnet' })).toBe('opus');
    expect(await run({ parentModel: 'sonnet' })).toBe('haiku');
    expect(await run({ model: 'inherit', parentModel: 'sonnet' })).toBe('haiku');
  });

  test('tool.call name matching: id first, then newest same description+type inside 5s, never across type, description or time', async () => {
    const nameFor = async (calls: Array<{ at: number; id: string; name: string; description?: string; type?: string }>, spawnAt: number, over: Partial<SpawnEvent>) => {
      const { on, pick, $ } = captureOn();
      registerRouting(on, { getPersonas: () => [], logDrift() {} });
      const t = { now: 0 };
      const $c = { ...$, clock: clockAt(t) };
      for (const c of calls) {
        t.now = c.at;
        await pick('tool.call')($c, { tool: 'Agent', tool_use_id: c.id, name: c.name, subagent_type: c.type ?? 'task', description: c.description ?? 'd' }, () => ({}));
      }
      t.now = spawnAt;
      await pick('agent.spawn')($c, spawnInput({ subagentType: 'task', description: 'd', tool_use_id: '', ...over }), spawnNext);
      return (await metaOf($)).meta['agent-1']!.name;
    };
    expect(await nameFor([{ at: 0, id: 'x', name: 'n1' }], 5000, {})).toBe('n1');
    expect(await nameFor([{ at: 0, id: 'x', name: 'n1' }], 5001, {})).toBeUndefined();
    expect(await nameFor([{ at: 0, id: 'x', name: 'n1' }], 100, { description: 'other' })).toBeUndefined();
    expect(await nameFor([{ at: 0, id: 'x', name: 'n1' }], 100, { subagentType: 'Explore' })).toBeUndefined();
    expect(await nameFor([{ at: 0, id: 'x', name: 'n1', type: 'Explore' }], 100, {})).toBeUndefined();
    expect(await nameFor([{ at: 0, id: 'x', name: 'n1', description: 'zzz' }], 100, {})).toBeUndefined();
    // newest wins among matches
    expect(await nameFor([{ at: 0, id: 'x', name: 'old' }, { at: 50, id: 'y', name: 'new' }], 100, {})).toBe('new');
    // the engine's shared id wins over a newer description match, however old the call
    expect(await nameFor([{ at: 0, id: 'tid', name: 'byid', description: 'zz' }, { at: 4000, id: 'y', name: 'newer' }], 9000, { tool_use_id: 'tid' })).toBe('byid');
    // an empty spawn id never matches a call that also sent no id
    expect(await nameFor([{ at: 0, id: '', name: 'noid', description: 'zz' }], 100, {})).toBeUndefined();
    // a nameless call is not recorded
    expect(await nameFor([{ at: 0, id: 'x', name: '' }], 100, {})).toBeUndefined();
  });

  test('pending tool calls are pruned past 5s and capped at the newest 16', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [], logDrift() {} });
    const t = { now: 0 };
    const $c = { ...$, clock: clockAt(t) };
    const call = async (id: string, at: number) => {
      t.now = at;
      await pick('tool.call')($c, { tool: 'Agent', tool_use_id: id, name: `n-${id}`, subagent_type: 'task', description: `d-${id}` }, () => ({}));
    };
    for (let i = 0; i < 17; i += 1) await call(`c${i}`, i);
    const spawnId = async (id: string, at: number) => {
      t.now = at;
      await pick('agent.spawn')($c, spawnInput({ subagentType: 'task', description: 'none', tool_use_id: id }), async () => ({ model: 'm', agentId: `s-${id}` }));
      return (await metaOf($)).meta[`s-${id}`]!.name;
    };
    expect(await spawnId('c0', 20)).toBeUndefined(); // 17th call evicted the oldest
    expect(await spawnId('c1', 21)).toBe('n-c1');
    expect(await spawnId('c16', 22)).toBe('n-c16');
    await call('late', 6_000); // prunes every call older than 5s
    expect(await spawnId('c16', 6_001)).toBeUndefined();
    expect(await spawnId('late', 6_002)).toBe('n-late');
  });

  test('turn.complete adds input and output tokens, each defaulting to 0', async () => {
    const run = async (usage?: { input_tokens?: number; output_tokens?: number }) => {
      const { on, pick, $ } = captureOn();
      registerCompletion(on);
      await pick('turn.complete')({ ...$, clock: clockAt({ now: 5 }) }, { answer: 'ok', ...(usage ? { usage } : {}) } as never, () => ({ text: 't' }));
      return (await metaOf($)).activity['lead']!.tokens;
    };
    expect(await run()).toBeNull();
    expect(await run({})).toBeNull();
    expect(await run({ input_tokens: 10 })).toBe(10);
    expect(await run({ output_tokens: 4 })).toBe(4);
    expect(await run({ input_tokens: 10, output_tokens: 4 })).toBe(14);
  });
});

describe('registerRouting provisional row (critique 11 A5)', () => {
  const agentsOf = async ($: { state: ReturnType<typeof memState> }) =>
    ((await $.state.get({ plugin: 'atlas', key: 'taskAgents' })).value as Array<{ name: string; state: string; task?: string }> | undefined) ?? [];
  const call = { tool: 'Agent', tool_use_id: 'toolu_01', subagent_type: 'atlas:explorer', description: 'alpha-explorer: read alpha.py', prompt: 'read it' };

  test('the Agent tool_use alone puts a running row in the task agents, before any agent.spawn', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [persona], logDrift() {} });
    const $c = { ...$, clock: { now: async () => 1000 } };
    await pick('tool.call')($c, call, () => ({}));
    expect((await agentsOf($)).map((a) => [a.name, a.state])).toEqual([['alpha-explorer', 'running']]);
  });

  test('agent.spawn replaces the provisional row: one row, never two', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [persona], logDrift() {} });
    const $c = { ...$, clock: { now: async () => 1000 } };
    await pick('tool.call')($c, call, () => ({}));
    await pick('agent.spawn')($c, spawnInput({ tool_use_id: 'toolu_01', description: call.description, subagentType: 'atlas:explorer' }), spawnNext);
    expect((await agentsOf($)).map((a) => a.name)).toEqual(['agent-1']);
    const orch = (await $.state.get({ plugin: 'atlas', key: 'orch' })).value as { meta: Record<string, { name?: string }> };
    expect(Object.entries(orch.meta).map(([id, m]) => [id, m.name])).toEqual([['agent-1', 'alpha-explorer']]);
  });

  test('a tool call that throws leaves no row behind', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [persona], logDrift() {} });
    const $c = { ...$, clock: { now: async () => 1000 } };
    await expect(pick('tool.call')($c, call, () => { throw new Error('denied'); })).rejects.toThrow('denied');
    expect(await agentsOf($)).toEqual([]);
  });

  test('the snapshot built between tool.call and agent.spawn carries the row, running', async () => {
    const { on, pick, $ } = captureOn();
    registerRouting(on, { getPersonas: () => [persona], logDrift() {} });
    const $c = { ...$, clock: { now: async () => FIXTURE_EPOCH_MS } };
    await pick('tool.call')($c, call, () => ({}));
    const fs = memFs({ ['/plugin/contracts/operating-contract.json']: JSON.stringify(FIXTURE_CONTRACT), ['/r/.atlas']: '' });
    const b = new SnapshotBuilder(fs, '/plugin');
    await b.init('/r', {}, 'abc12345', 'tech-tools', 'main');
    const orch = (await $.state.get({ plugin: 'atlas', key: 'orch' })).value as never;
    const snap = await b.build({ headerPhase: null, taskAgents: await agentsOf($) as never, orch, herdrStdout: undefined, usage: { contextPct: 1 }, now: FIXTURE_EPOCH_MS });
    expect(snap.squad.filter((a) => a.name === 'alpha-explorer').map((a) => a.state)).toEqual(['running']);
  });
});
