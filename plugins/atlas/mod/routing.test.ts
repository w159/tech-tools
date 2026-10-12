// Tests for routing.ts — run with `claude plugin test plugins/atlas` (kit:
// claude-code/testing). Covers: model passthrough on agent.spawn (persona
// model pins live in agent-definition frontmatter, honored natively),
// agentId→persona recording, effort pinning on turn.step, and the fail-open
// paths.
import { describe, expect, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import { registerHeaderDrift, registerPromptReinforce, registerRouting } from './routing';
import type { Persona } from './contract';
import { memState } from './test_helpers';

// Structural mirrors of the event shapes the handlers read (d.ts: AgentSpawnInput,
// TurnStepInput, TurnCompleteInput, PromptSubmitInput).
interface SpawnEvent {
  tool_use_id: string;
  prompt: string;
  description: string;
  subagentType: string;
  model?: string;
  fork: boolean;
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
  'turn.step': StepEvent;
  'turn.complete': CompleteEvent;
  'prompt.submit': SubmitEvent;
}
/** What next(e) resolves to per event (d.ts: AgentSpawnResult, TurnStepInput doc, { text }). */
interface ResultShape {
  'agent.spawn': { model: string; agentId: string };
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
  const on = ((event: string, hook: unknown) => {
    handlers.set(event, hook);
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
  const misses = async () => ((await stateOf('headerMisses')) as number | undefined) ?? 0;
  return { on, pick, $, recorded, misses };
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
    const { on, pick, $, recorded, misses } = captureOn();
    const { deps } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput(), spawnNext);
    expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
    expect(await recorded()).toEqual([['agent-1', 'implementer']]);
  });

  test('passes an inherit model through untouched and records the agent', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    const { deps } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput({ model: 'inherit' }), spawnNext);
    expect(result).toEqual({ model: 'inherit', agentId: 'agent-1' });
    expect(await recorded()).toEqual([['agent-1', 'implementer']]);
  });

  test('passes an explicit model through untouched, records the agent, and notes the drift', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    const { deps, drift } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput({ model: 'opus' }), spawnNext);
    expect(result).toEqual({ model: 'opus', agentId: 'agent-1' });
    expect(await recorded()).toEqual([['agent-1', 'implementer']]);
    expect(drift).toEqual(['agent.spawn: atlas:implementer asked for model opus, pinned haiku']);
  });

  test('leaves a fork untouched', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    const { deps, drift } = routingDeps();
    registerRouting(on, deps);
    const result = await pick('agent.spawn')($, spawnInput({ fork: true }), spawnNext);
    expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
    expect(await recorded()).toEqual([]);
    expect(drift).toEqual([]);
  });

  test('routes no persona for unknown roles but records them for the band', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    const { deps, drift } = routingDeps();
    registerRouting(on, deps);
    for (const subagentType of ['atlas:nobody', 'armada:core', 'general-purpose', 'task']) {
      const result = await pick('agent.spawn')($, spawnInput({ subagentType }), spawnNext);
      expect(result).toEqual({ model: 'parent-model', agentId: 'agent-1' });
    }
    // No persona routing and no drift, yet every spawn shows in the band
    // (persona 'unknown' resolves through mergeSquad's personaOf).
    // (the fake spawn reuses one agentId, so $.state holds a single entry)
    expect(await recorded()).toEqual([['agent-1', 'unknown']]);
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
    const { on, pick, $, recorded, misses } = captureOn();
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
    const { on, pick, $, recorded, misses } = captureOn();
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
    const { on, pick, $, recorded, misses } = captureOn();
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
    const { on, pick, $, recorded, misses } = captureOn();
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

describe('registerHeaderDrift', () => {
  const answer = (first: string, agentId?: string): CompleteEvent => ({
    answer: `${first}\nbody`,
    ...(agentId === undefined ? {} : { agentId }),
  });

  test('counts a miss when the first line breaks the pattern', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    registerHeaderDrift(on, { pattern: () => '^ATLAS \\|' });
    await pick('turn.complete')($, answer('no header here'), () => ({ text: 'x' }));
    expect(await misses()).toBe(1);
  });

  test('counts no miss when the first line matches', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    registerHeaderDrift(on, { pattern: () => '^ATLAS \\|' });
    await pick('turn.complete')($, answer('ATLAS | 🔧 implement | x'), () => ({ text: 'x' }));
    expect(await misses()).toBe(0);
  });

  test('skips subagent turns', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    registerHeaderDrift(on, { pattern: () => '^ATLAS \\|' });
    await pick('turn.complete')($, answer('subagent answer', 'agent-1'), () => ({ text: 'x' }));
    expect(await misses()).toBe(0);
  });

  test('never throws on a broken pattern and still moves the answer on', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    registerHeaderDrift(on, { pattern: () => '(' });
    const result = await pick('turn.complete')($, answer('anything'), () => ({ text: 'kept' }));
    expect(await misses()).toBe(0);
    expect(result).toEqual({ text: 'kept' });
  });
});

describe('registerPromptReinforce', () => {
  test('adds the line as context and never alters the user text', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    registerPromptReinforce(on, { line: () => 'keep the header' });
    const seen: SubmitEvent[] = [];
    await pick('prompt.submit')($, { text: 'user prompt', context: ['prior'] }, (e) => (seen.push(e), { text: e.text }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toBe('user prompt');
    expect(seen[0]!.context).toEqual(['prior', 'keep the header']);
  });

  test('adds context when none was present and skips on a null line', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    let line: string | null = 'reminder';
    registerPromptReinforce(on, { line: () => line });
    const seen: SubmitEvent[] = [];
    await pick('prompt.submit')($, { text: 'p' }, (e) => (seen.push(e), { text: e.text }));
    expect(seen[0]!.context).toEqual(['reminder']);
    line = null;
    await pick('prompt.submit')($, { text: 'p' }, (e) => (seen.push(e), { text: e.text }));
    expect(seen[1]!.context).toBeUndefined();
    expect(seen[1]!.text).toBe('p');
  });

  test('fails open when line() throws', async () => {
    const { on, pick, $, recorded, misses } = captureOn();
    registerPromptReinforce(on, {
      line: () => {
        throw new Error('boom');
      },
    });
    const seen: SubmitEvent[] = [];
    await pick('prompt.submit')($, { text: 'p' }, (e) => (seen.push(e), { text: e.text }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.text).toBe('p');
    expect(seen[0]!.context).toBeUndefined();
  });
});
