// Background worker outcomes (live 12.2.0 finding: a background launch's card never showed a result line,
// and a 2-agent batch is folded by the engine, so its result must land on the task-notification row).
import { expect, test } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On } from 'claude-code'
import { registerRestyle } from '../restyle'
import type { AtlasSnapshot } from '../contract'
import { memState } from '../test_helpers'
import { cardExtra, launchedId, notifiedMs, outcomeText, reportOf } from './outcome'
import { spin } from '../theme'

const SNAP = {
  root: null, sessionId: 's1', channel: 'c', todos: [], notes: [], members: [], squad: [], contextPct: 0, now: 0,
  contract: { phases: [], todoPhases: [], headerFirstLinePattern: '^ATLAS', itemPhasePrefix: '[<phase>] ' },
  personas: [{ name: 'explorer', model: 'sonnet', effort: 'low', color: 'cyan', description: 'x' }],
  counts: { done: 0, total: 0, byPhase: {} }, phase: 'research', phaseSource: 'default',
} as unknown as AtlasSnapshot

const NOTICE = '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<usage><tool_uses>3</tool_uses><duration_ms>29046</duration_ms></usage>\n</task-notification>'
const CHILD = [
  { role: 'assistant', text: 'working', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool: 'SubagentHandback', input: { message: 'did it\nSTATUS: DONE\nNEXT: none' } }] },
]

/** Every string a plain render tree carries, as one JSON text (each Text child stays one piece). */
const strings = (n: unknown): string => JSON.stringify(n) ?? ''

type Hook = (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<unknown>
function sites(): Record<string, Hook> {
  const out: Record<string, Hook> = {}
  const on = ((_p: unknown, a: unknown, b?: unknown) => {
   if (b !== undefined) out[(a as { component: string }).component] = b as Hook
   return { catch: () => undefined }
  }) as unknown as On
  registerRestyle(on)
  return out
}

const SENTINEL = { type: 'Text', props: {}, children: [] }
const next = async () => SENTINEL

function engine(agents: AgentInfo[], meta: Record<string, unknown> = {}, tick: number | null = 3): EngineInterface {
  return {
   env: { get: async () => undefined },
   state: memState({ 'atlas/snapshot': SNAP, ...(tick === null ? {} : { 'atlas/spinnerTick': tick }), 'atlas/orch': { activity: {}, comms: [], stage: {}, meta } }),
   agent: { list: async () => agents },
   session: { messages: async (a?: { agentId?: string }) => (a?.agentId ? CHILD : [{ role: 'user', text: NOTICE, toolUses: [] }]) },
  } as unknown as EngineInterface
}

const launched = (status: string) => ({
  surface: 'terminal', component: 'ToolUse', requestId: 't1',
  props: {
   tool: 'Agent', isRunning: false, isErrored: false, isInterrupted: false,
   input: { subagent_type: 'atlas:explorer', description: 'wave-a sleep explorer', prompt: 'GOAL: sleep three times' },
   output: { status: 'async_launched', agentId: 'a1', description: 'wave-a sleep explorer', prompt: 'p', outputFile: 'f' },
  },
  agent: { id: 'a1', type: 'atlas:explorer', description: 'wave-a sleep explorer', status, name: 'wave-a' } as AgentInfo,
})

test('reportOf takes the SubagentHandback STATUS line, else the last assistant text', () => {
  expect(reportOf(CHILD)).toBe('STATUS: DONE')
  expect(reportOf([{ role: 'assistant', text: 'all good\nmore' }, { role: 'user', text: 'x' }])).toBe('all good')
  expect(reportOf([])).toBe('')
})

test('notifiedMs reads duration_ms of the notification naming the agent; outcomeText joins word, line, duration', () => {
  expect(notifiedMs(['hello', NOTICE], 'a1')).toBe(29046)
  expect(notifiedMs([NOTICE], 'zz')).toBeUndefined()
  expect(outcomeText({ status: 'completed', line: 'STATUS: DONE', durationMs: 29046 })).toBe('finished · STATUS: DONE · 29s')
  expect(outcomeText({ status: 'failed', line: '' })).toBe('failed')
})

test('background launch card: live worker spins as running, never a stale completed', async () => {
  const e = launched('running')
  const text = strings(await sites().ToolUse!(engine([e.agent]), e, next))
  expect(text).toContain('running')
  expect(text).not.toContain('completed')
  expect(text).not.toContain('✓')
})

test('background launch card: ended worker shows a finished row: STATUS line · duration', async () => {
  const e = launched('completed')
  const out = strings(await sites().ToolUse!(engine([e.agent]), e, next))
  expect(out).toContain(' finished ')
  expect(out).not.toContain(' done ')
  expect(out).toContain('STATUS: DONE · 29s')
  expect(out.match(/finished/g)).toEqual(['finished'])
  const row = (JSON.parse(out) as { children: Array<{ children: Array<{ children: string[] }> }> }).children[2]!
  expect(row.children.map((c) => c.children.join('')).join('').trimEnd()).toBe('▌ finished STATUS: DONE · 29s')
})

test('a call still being written reads pending, not completed', async () => {
  const e = launched('running')
  const streaming = { ...e, props: { ...e.props, output: undefined } }
  const text = strings(await sites().ToolUse!(engine([]), streaming, next))
  expect(text).toContain('pending')
  expect(text).not.toContain('completed')
})

test('task-notification of an atlas worker that left the host list draws its result row', async () => {
  const e = { surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: { text: 'Agent "wave-a" finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'a1', status: 'completed', durationMs: 29046 } } }
  const text = strings(await sites().UserMessage!(engine([], { a1: { name: 'wave-a', type: 'atlas:explorer' } }), e, next))
  expect(text).toContain('wave-a')
  expect(text).toContain('explorer')
  expect(text).toContain('finished · STATUS: DONE · 29s')
})

test('task-notification of a non-atlas task keeps the engine row', async () => {
  const e = { surface: 'terminal', component: 'UserMessage', requestId: 'u2', props: { text: 'shell done', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'b9', status: 'completed' } } }
  expect(await sites().UserMessage!(engine([{ id: 'b9', type: 'general-purpose', description: 'x', status: 'completed' } as AgentInfo]), e, next)).toBe(SENTINEL)
})

test('notifiedMs finds a notice that starts at offset 0 of its text', () => {
  expect(notifiedMs(['<task-id>a1</task-id><duration_ms>5</duration_ms>'], 'a1')).toBe(5);
});

test('launchedId needs both the async_launched status and a string agentId', () => {
  expect(launchedId({ status: 'async_launched', agentId: 'a1' })).toBe('a1');
  expect(launchedId({ status: 'completed', agentId: 'a1' })).toBe('');
  expect(launchedId({ status: 'async_launched' })).toBe('');
  expect(launchedId({ status: 'async_launched', agentId: 7 })).toBe('');
  expect(launchedId(undefined)).toBe('');
});

test('cardExtra is empty for a call that launched nothing and for a non-atlas worker', async () => {
  const memo = new Map();
  expect(await cardExtra(engine([]), { status: 'done' }, [], memo)).toEqual({});
  const other = { id: 'b9', type: 'general-purpose', description: 'x', status: 'running' } as AgentInfo;
  expect(await cardExtra(engine([other]), { status: 'async_launched', agentId: 'b9' }, [other], memo)).toEqual({});
});

test('cardExtra spins from tick 0 when the spinner atom was never written', async () => {
  const e = launched('running');
  const extra = await cardExtra(engine([e.agent], {}, null), e.props.output, [e.agent], new Map());
  expect(extra).toEqual({ mark: spin(0, 'implement') });
  expect(spin(0, 'implement')).not.toBe(spin(1, 'implement'));
});

test('an outcome is memoized only once its duration is known', async () => {
  const e = launched('completed');
  const memo = new Map();
  const known = await cardExtra(engine([e.agent]), e.props.output, [e.agent], memo);
  expect(known).toEqual({ ended: 'finished', outcome: 'STATUS: DONE · 29s' });
  expect([...memo.keys()]).toEqual(['a1:completed']);
  const noDuration = { ...engine([e.agent]), session: { messages: async (a?: { agentId?: string }) => (a?.agentId ? CHILD : []) } } as unknown as EngineInterface;
  const fresh = new Map();
  expect(await cardExtra(noDuration, e.props.output, [e.agent], fresh)).toEqual({ ended: 'finished', outcome: 'STATUS: DONE' });
  expect(fresh.size).toBe(0);
});
