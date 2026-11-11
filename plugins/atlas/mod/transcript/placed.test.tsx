// Critique 14 B3: the finish card was the host's task-notification row, which lands when the lead takes the notification up (5.07 / 5.32 s
// after the worker ended in live-150-61858003-2 and -3, against 1.03 s for the HUD row). The mod places its own card from the rebuild tick.
import { expect, test as base } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On } from 'claude-code'
import type { AtlasSnapshot, SquadAgent } from '../contract'
import { registerRestyle } from '../restyle'
import { memState } from '../test_helpers'
import { uiFromEnv } from '../atlas-ui'
import { finishedWorkers, forgetPlaced, hideNotification, placeFinished, placedTree } from './placed'

const snap = (now: number, squad: SquadAgent[], over: Record<string, unknown> = {}): AtlasSnapshot => ({
  root: null, sessionId: 's1', channel: 'c', todos: [], notes: [], members: [], squad, contextPct: 0, now,
  contract: { phases: [], todoPhases: [], headerFirstLinePattern: '^ATLAS', itemPhasePrefix: '[<phase>] ' },
  personas: [], counts: { done: 0, total: 0, byPhase: {} }, phase: 'research', phaseSource: 'default',
  ...over,
}) as unknown as AtlasSnapshot
const worker = (name: string, state: SquadAgent['state']): SquadAgent => ({ name, persona: 'explorer', state, source: 'task' })
const live = (now: number, squad: SquadAgent[], activity: Record<string, unknown>): AtlasSnapshot => ({ ...snap(now, squad), activity, comms: [], todoGroups: [] }) as unknown as AtlasSnapshot
const act = (over: Record<string, unknown>) => ({ tool: null, since: 0, toolCount: 0, tokens: null, mood: 'working', lastLine: '', ...over })
const strings = (n: unknown): string => JSON.stringify(n) ?? ''

/** The scorer's card shape (round2/tools/live_capture.py:642): `▌ ◆ ATLAS  ● done  <name>  <role> finished`. */
const CARD = /▌ ◆ ATLAS\s+(\S)\s+(\w+)\s+(\S+)\s{2,}\w+ finished/
const flat = (tree: unknown): string => {
  const out: string[] = []
  const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) walk(k) }
  walk(tree)
  return out.join('')
}

function engine(placed: string[], isPlaced = true): EngineInterface {
  return { ui: { place: async ({ id }: { id: string }) => { placed.push(id); return isPlaced ? { isPlaced: true, requestId: id } : { isPlaced: false, reason: 'no surface' } } } } as unknown as EngineInterface
}

// every test starts with no placed card or notification decision (they are module state)
const test = ((name: string, fn: () => Promise<unknown> | unknown) => base(name, async () => { forgetPlaced(); try { await fn() } finally { forgetPlaced() } })) as unknown as typeof base

test('finishedWorkers: a worker that moved into done or failed, with its own run time; first sight and repeats are no finish', () => {
  const prev = live(21_000, [worker('alpha-explorer', 'running'), worker('beta-explorer', 'running')], { 'alpha-explorer': act({ startedAt: 22_000 - 1000 }), 'beta-explorer': act({ startedAt: 21_000 }) })
  const next = live(36_000, [worker('alpha-explorer', 'finished'), worker('beta-explorer', 'failed'), worker('gamma-explorer', 'finished')], {
    'alpha-explorer': act({ startedAt: 21_000, since: 34_000, mood: 'done' }), 'beta-explorer': act({ startedAt: 21_000, since: 30_000, mood: 'failed' }), 'gamma-explorer': act({}),
  })
  expect(finishedWorkers(prev, next)).toEqual([
    { name: 'beta-explorer', role: 'explorer', failed: true, durationMs: 9000 },
    { name: 'alpha-explorer', role: 'explorer', failed: false, durationMs: 13_000 },
  ])
  expect(finishedWorkers(null, next)).toEqual([])
  expect(finishedWorkers(next, next)).toEqual([])
})

test('B3: the card is placed in the build that shows the worker done (the HUD row\'s tick), and reads like the host row the scorer counts', async () => {
  const ids: string[] = []
  const prev = live(21_000, [worker('alpha-explorer', 'running')], { 'alpha-explorer': act({ startedAt: 21_000 }) })
  const next = live(36_300, [worker('alpha-explorer', 'finished')], { 'alpha-explorer': act({ startedAt: 21_000, since: 34_000, mood: 'done' }) })
  await placeFinished(engine(ids), prev, next)
  expect(ids).toEqual(['done-alpha-explorer-1']) // the host's own row came ~5 s after the finish at 35.27 s; this one is stamped in the build at 36.3 s
  const row = flat(placedTree(ids[0]!, uiFromEnv()))
  expect(row).toMatch(CARD)
  expect(row).toContain('alpha-explorer')
  expect(row).toContain('explorer finished · 13s')
  expect(placedTree('done-missing-9', uiFromEnv())).toBeNull()
})

test('a failed worker places a failed card; an id is letters, digits, _ and -', async () => {
  const ids: string[] = []
  const prev = snap(0, [worker('weird name/1', 'running')])
  await placeFinished(engine(ids), prev, snap(5000, [worker('weird name/1', 'failed')]))
  expect(ids[0]).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  expect(flat(placedTree(ids[0]!, uiFromEnv()))).toContain('failed')
})

test('one card per finish: the host notification that follows a placed card draws empty, however often it redraws', async () => {
  const ids: string[] = []
  await placeFinished(engine(ids), snap(0, [worker('a', 'running')]), snap(9000, [worker('a', 'finished')]))
  expect(hideNotification('m1', 'a')).toBe(true)
  expect(hideNotification('m1', 'a')).toBe(true) // a redraw of the same message keeps the decision
  expect(hideNotification('m2', 'a')).toBe(false) // a second notification has no card of its own left
})

test('a host row that drew first stays, and no card follows it', async () => {
  const ids: string[] = []
  expect(hideNotification('m1', 'a')).toBe(false)
  await placeFinished(engine(ids), snap(0, [worker('a', 'running')]), snap(9000, [worker('a', 'finished')]))
  expect(ids).toEqual([])
})

test('a place the host refuses leaves the host row to draw the finish', async () => {
  const ids: string[] = []
  await placeFinished(engine(ids, false), snap(0, [worker('a', 'running')]), snap(9000, [worker('a', 'finished')]))
  expect(placedTree('done-a-1', uiFromEnv())).toBeNull()
  expect(hideNotification('m1', 'a')).toBe(false)
  const throwing = { ui: { place: async () => { throw new Error('no conversation') } } } as unknown as EngineInterface
  await placeFinished(throwing, snap(0, [worker('b', 'running')]), snap(9000, [worker('b', 'finished')])) // never throws
})

// ---- the render sites ----

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
const SENTINEL = { type: 'Text', props: {}, children: ['host'] }
const next = async () => SENTINEL

function host(): EngineInterface {
  const a1 = { id: 'a1', type: 'atlas:explorer', description: 'x', status: 'completed', name: 'alpha-explorer' } as AgentInfo
  return {
    env: { get: async () => undefined },
    state: memState({ 'atlas/snapshot': snap(0, []), 'atlas/orch': { activity: {}, comms: [], stage: {}, meta: { a1: { name: 'alpha-explorer', type: 'atlas:explorer' } } } }),
    agent: { list: async () => [a1] },
    session: { messages: async () => [] },
  } as unknown as EngineInterface
}
const placedEvent = (plugin: string, id: string) => ({ surface: 'terminal', component: 'Placed', requestId: 'p1', props: { id, plugin } })
const notice = (requestId: string) => ({ surface: 'terminal', component: 'UserMessage', requestId, props: { text: 'Agent finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'a1', status: 'completed', durationMs: 29_000 } } })

test('the Placed site draws the mod\'s own card and passes another plugin\'s row or an unknown id', async () => {
  const ids: string[] = []
  await placeFinished(engine(ids), snap(0, [worker('alpha-explorer', 'running')]), snap(13_000, [worker('alpha-explorer', 'finished')], { activity: {} }))
  const out = await sites().Placed!(host(), placedEvent('atlas', ids[0]!), next)
  expect(flat(out)).toMatch(CARD)
  expect(await sites().Placed!(host(), placedEvent('other', ids[0]!), next)).toBe(SENTINEL)
  expect(await sites().Placed!(host(), placedEvent('atlas', 'done-nope-7'), next)).toBe(SENTINEL)
})

test('B3/L15: the host notification row for a worker whose card is placed draws nothing; with no card it draws the result row', async () => {
  const h = sites().UserMessage!
  expect(flat(await h(host(), notice('u0'), next))).toMatch(CARD) // no card placed: the host row is the card
  forgetPlaced()
  const ids: string[] = []
  await placeFinished(engine(ids), snap(0, [worker('alpha-explorer', 'running')]), snap(13_000, [worker('alpha-explorer', 'finished')]))
  const hidden = await h(host(), notice('u1'), next)
  expect(strings(hidden)).toBe(strings({ type: 'Text', props: {}, children: [] }))
  expect(strings(await h(host(), notice('u1'), next))).toBe(strings(hidden))
})
