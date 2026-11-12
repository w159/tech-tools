// Critique 18, slice C3. stoprun-150-562576ed-3/tab-board.png: the lead's first TaskStop hit beta-explorer (card `explorer killed · 4s`, f0075.ans:6), the lead resumed
// beta with SendMessage, beta finished, and the host's notification row for that finish read `explorer failed · 10s` while SUBAGENTS said done. A stopped worker's
// card said `explorer killed` in one run (150-2 f0068.ans:13) and `explorer failed` in another (150-3): one verb for a TaskStop kill.
import { expect, test as base } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On } from 'claude-code'
import type { AtlasSnapshot, SquadAgent } from '../contract'
import { registerRestyle } from '../restyle'
import { memState } from '../test_helpers'
import { noteFailed } from './outcome'
import { forgetPlaced } from './placed'

const test = ((name: string, fn: () => Promise<unknown> | unknown) => base(name, async () => { forgetPlaced(); try { await fn() } finally { forgetPlaced() } })) as unknown as typeof base
const snap = (now: number, squad: SquadAgent[], activity: Record<string, unknown> = {}): AtlasSnapshot => ({
  root: null, sessionId: 's1', channel: 'c', todos: [], notes: [], members: [], squad, contextPct: 0, now,
  contract: { phases: [], todoPhases: [], headerFirstLinePattern: '^ATLAS', itemPhasePrefix: '[<phase>] ' },
  personas: [], counts: { done: 0, total: 0, byPhase: {} }, phase: 'research', phaseSource: 'default', activity, comms: [], todoGroups: [],
}) as unknown as AtlasSnapshot
const flat = (tree: unknown): string => {
  const out: string[] = []
  const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) walk(k) }
  walk(tree)
  return out.join('')
}
type Hook = (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<unknown>
function sites(): Record<string, Hook> {
  const out: Record<string, Hook> = {}
  const on = ((_p: unknown, a: unknown, b?: unknown) => { if (b !== undefined) out[(a as { component: string }).component] = b as Hook; return { catch: () => undefined } }) as unknown as On
  registerRestyle(on)
  return out
}
const next = async () => ({ type: 'Text', props: {}, children: ['host'] })
const notice = (status: string) => ({ surface: 'terminal', component: 'UserMessage', requestId: `n-${status}`, props: { text: 'Agent notice', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'a1', status, durationMs: 10_000 } } })
const stop = { role: 'assistant', text: '', toolUses: [{ tool: 'TaskStop', input: { task_id: 'a1' } }] }
const resume = { role: 'assistant', text: '', toolUses: [{ tool: 'SendMessage', input: { to: 'beta-explorer', message: 'carry on' } }] }

function lead(over: { squadState: SquadAgent['state']; killed: boolean; messages: unknown[] }): EngineInterface {
  const squad: SquadAgent[] = [{ name: 'beta-explorer', persona: 'explorer', state: over.squadState, source: 'task' }]
  return {
    env: { get: async () => undefined },
    state: memState({ 'atlas/snapshot': snap(30_000, squad, { 'beta-explorer': { tool: null, since: 30_000, startedAt: 20_000, toolCount: 0, tokens: null, mood: over.squadState === 'failed' ? 'failed' : 'done', lastLine: '' } }), ...(over.killed ? { 'atlas/killed': ['a1'] } : {}), 'atlas/orch': { activity: {}, comms: [], stage: {}, meta: { a1: { name: 'beta-explorer', type: 'atlas:explorer' } } } }),
    agent: { list: async () => [{ id: 'a1', type: 'atlas:explorer', description: 'x', status: 'completed', name: 'beta-explorer' } as AgentInfo] },
    session: { messages: async (a?: { agentId?: string }) => (a?.agentId ? [] : over.messages) },
  } as unknown as EngineInterface
}

test('C3: a worker the lead stopped and then resumed reads `finished` on its own finish row, not the stale `failed` (150-3 tab-board.png)', async () => {
  noteFailed('a1') // the kill card (placed.ts, the host row) already saw it fail: failure is sticky by id
  const row = flat(await sites().UserMessage!(lead({ squadState: 'finished', killed: true, messages: [stop, resume] }), notice('completed'), next))
  expect(row).toContain('explorer finished')
  expect(row).not.toMatch(/■ (failed|killed)/)
})

test('C3: a worker stopped and never resumed keeps its failure, and a TaskStop kill always says `killed` (one verb)', async () => {
  for (const messages of [[stop], []]) {
    forgetPlaced()
    const row = flat(await sites().UserMessage!(lead({ squadState: 'failed', killed: true, messages }), notice('completed'), next))
    expect(row).toContain('■ killed')
    expect(row).not.toContain('■ failed')
  }
})

test('C3: a failure no TaskStop caused still reads `failed`', async () => {
  const row = flat(await sites().UserMessage!(lead({ squadState: 'failed', killed: false, messages: [] }), notice('failed'), next))
  expect(row).toContain('■ failed')
})

test('C3: a SendMessage that came before the TaskStop is no resume', async () => {
  const row = flat(await sites().UserMessage!(lead({ squadState: 'failed', killed: true, messages: [resume, stop] }), notice('completed'), next))
  expect(row).toContain('■ killed')
})
