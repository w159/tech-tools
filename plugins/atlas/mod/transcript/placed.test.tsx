// Critique 14 B3: the finish card was the host's task-notification row, which lands when the lead takes the notification up (5.07 / 5.32 s
// after the worker ended in live-150-61858003-2 and -3, against 1.03 s for the HUD row). The mod places its own card from the rebuild tick.
import { expect, test as base } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On } from 'claude-code'
import type { AtlasSnapshot, SquadAgent } from '../contract'
import { registerRestyle } from '../restyle'
import { memState } from '../test_helpers'
import { uiFromEnv } from '../atlas-ui'
import { cardAged, finishedWorkers, forgetPlaced, hideNotification, placeFinished, placedTree } from './placed'

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

/** The card shape (wave 32, critique 30: `<role> finished` is gone, `● done` says it once): `▌ ◆ ATLAS  ● done  <name>  <time> · <n> fn`. The external scorer (round2/tools/live_capture.py:642) still reads the old tail and needs the same change. */
const CARD = /▌ ◆ ATLAS\s+(\S)\s+(\w+)\s+(\S+)/
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
  expect(row).toContain('● done')
  expect(row).not.toContain('finished')
  expect(row).toContain('0:13')
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

// critique 15 A1/A2: the killed worker (stoprun-150-95c4a588-2 and -3) got no failed card, and a green one 31 s later.
test('A1: failure is terminal, a failed worker later read as finished places no done card', async () => {
  const ids: string[] = []
  const failed = snap(0, [worker('ghost-explorer', 'failed')])
  const later = snap(31_000, [worker('ghost-explorer', 'finished')])
  expect(finishedWorkers(failed, later)).toEqual([])
  await placeFinished(engine(ids), failed, later)
  expect(ids).toEqual([])
})

test('A2: a place the host refused is retried on the next build, so the failed card still lands', async () => {
  const ids: string[] = []
  const running = snap(0, [worker('ghost-explorer', 'running')])
  const failed = snap(5000, [worker('ghost-explorer', 'failed')])
  await placeFinished(engine(ids, false), running, failed) // the one build that saw the transition: the host refuses
  expect(ids).toEqual(['done-ghost-explorer-1'])
  await placeFinished(engine(ids), failed, snap(5500, [worker('ghost-explorer', 'failed')])) // nothing moved, the card is still owed
  expect(ids).toHaveLength(2)
  expect(flat(placedTree(ids[1]!, uiFromEnv()))).toContain('■ failed')
  await placeFinished(engine(ids), failed, snap(6000, [worker('ghost-explorer', 'failed')]))
  expect(ids).toHaveLength(2) // placed once: nothing owed any more
})

// critique 16 C4: stoprun-110-e4a8186a-3 never drew the failed card (5 of 6 stop runs). A killed worker drops out of the host list, so the build that
// shows it failed can be the first build that lists it: first sight of a FAILED worker is a finish the person must see (first sight of a done one stays none).
test('C4: a worker first listed as failed (the killed ghost dropped out of the host list while running) still gets its failed card, once', async () => {
  const ids: string[] = []
  const before = live(10_000, [worker('alpha-explorer', 'running')], { 'alpha-explorer': act({ startedAt: 9000 }) })
  const after = live(20_000, [worker('alpha-explorer', 'running'), worker('ghost-explorer', 'failed')], { 'alpha-explorer': act({ startedAt: 9000 }), 'ghost-explorer': act({ startedAt: 12_000, since: 18_000, mood: 'failed' }) })
  expect(finishedWorkers(before, after)).toEqual([{ name: 'ghost-explorer', role: 'explorer', failed: true, durationMs: 6000 }])
  await placeFinished(engine(ids), before, after)
  expect(ids).toEqual(['done-ghost-explorer-1'])
  expect(flat(placedTree(ids[0]!, uiFromEnv()))).toContain('■ failed')
  await placeFinished(engine(ids), after, live(20_500, [worker('alpha-explorer', 'running'), worker('ghost-explorer', 'failed')], { 'alpha-explorer': act({ startedAt: 9000 }), 'ghost-explorer': act({ startedAt: 12_000, since: 18_000, mood: 'failed' }) }))
  expect(ids).toHaveLength(1) // placed once
  expect(finishedWorkers(before, live(20_000, [worker('alpha-explorer', 'running'), worker('gamma-explorer', 'finished')], { 'gamma-explorer': act({}) }))).toEqual([]) // a worker first listed done is still no finish
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

// stoprun-150-95c4a588-1/frames/tab-team.ans:10: the host's notification row for the killed task read `● done ghost-explorer explorer finished · 5s`, 31 s after the kill.
function killed(over: { rows?: AgentInfo[]; squad?: SquadAgent[]; messages?: unknown[]; mood?: string } = {}): EngineInterface {
  const activity = over.mood ? { a1: { mood: over.mood, startedAt: 1000, since: 6000, tool: null, toolCount: 0, tokens: null, lastLine: '' } } : {}
  return {
    env: { get: async () => undefined },
    state: memState({ 'atlas/snapshot': snap(0, over.squad ?? []), 'atlas/orch': { activity, comms: [], stage: {}, meta: { a1: { name: 'ghost-explorer', type: 'atlas:explorer' } } } }),
    agent: { list: async () => over.rows ?? [] },
    session: { messages: async (a?: { agentId?: string }) => (a?.agentId ? [] : over.messages ?? []) },
  } as unknown as EngineInterface
}
const stoppedNotice = (requestId: string, status?: string) => ({ surface: 'terminal', component: 'UserMessage', requestId, props: { text: 'Agent stopped', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'a1', ...(status ? { status } : {}), durationMs: 5000 } } })

test('A1: the notification row of a killed task reads failed, never finished, whichever source says it', async () => {
  const h = sites().UserMessage!
  const FINISHED = /● done/
  for (const [label, eng, status] of [
    ['task status killed', killed(), 'killed'],
    ['task status stopped', killed(), 'stopped'],
    ['host row killed, task status completed', killed({ rows: [{ id: 'a1', type: 'atlas:explorer', description: 'x', status: 'killed', name: 'ghost-explorer' } as AgentInfo] }), 'completed'],
    ['row dropped, squad says dead', killed({ squad: [worker('ghost-explorer', 'dead')] }), 'completed'],
    ['row dropped, squad says failed', killed({ squad: [worker('ghost-explorer', 'failed')] }), undefined],
    ['row dropped, the mod recorded the failure', killed({ mood: 'failed' }), undefined],
    ['row dropped, the lead transcript notification says killed', killed({ messages: [{ role: 'user', text: '<task-notification>\n<task-id>a1</task-id>\n<status>killed</status>\n</task-notification>', toolUses: [] }] }), 'completed'],
  ] as const) {
    forgetPlaced()
    const row = flat(await h(eng, stoppedNotice(`k-${label}`, status), next))
    expect([label, FINISHED.test(row), /■ (failed|stopped)/.test(row)]).toEqual([label, false, true])
  }
})

test('A1: a worker the host lists completed with no failure anywhere still reads finished', async () => {
  forgetPlaced()
  const row = flat(await sites().UserMessage!(killed({ squad: [worker('ghost-explorer', 'finished')] }), stoppedNotice('ok1', 'completed'), next))
  expect(row).toMatch(/● done/)
})

// critique 17 C2/C3: stoprun-150-a4fad2f9-1 f0057 drew the mod-placed `ghost-explorer explorer failed · 9s` where the lead had stopped the task (every other
// stop run's card read `explorer killed`), and the host row's `explorer killed` (f0085.ans:5) carried no duration where a done card has `· 15s`.
function stopped(): EngineInterface {
  const s = live(30_000, [worker('ghost-explorer', 'failed')], { 'ghost-explorer': act({ startedAt: 21_000, since: 30_000, mood: 'failed' }) })
  return {
    env: { get: async () => undefined },
    state: memState({ 'atlas/snapshot': s, 'atlas/killed': ['a1'], 'atlas/orch': { activity: {}, comms: [], stage: {}, meta: { a1: { name: 'ghost-explorer', type: 'atlas:explorer' } } } }),
    agent: { list: async () => [] },
    session: { messages: async () => [] },
    ui: { place: async ({ id }: { id: string }) => ({ isPlaced: true, requestId: id }) },
  } as unknown as EngineInterface
}

test('C2: the card placed for a worker the lead stopped reads killed with its run time; one nobody stopped reads killed too (wave 30: one word)', async () => {
  const before = snap(21_000, [worker('ghost-explorer', 'running'), worker('beta-explorer', 'running')])
  const after = live(30_000, [worker('ghost-explorer', 'failed'), worker('beta-explorer', 'failed')], {
    'ghost-explorer': act({ startedAt: 21_000, since: 30_000, mood: 'failed' }), 'beta-explorer': act({ startedAt: 21_000, since: 30_000, mood: 'failed' }),
  })
  const ids: string[] = []
  const $ = stopped()
  await placeFinished({ ...($ as object), ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id } } } } as unknown as EngineInterface, before, after)
  const cards = ids.map((id) => flat(placedTree(id, uiFromEnv())))
  expect(cards.find((c) => c.includes('ghost-explorer'))).toMatch(/■ failed {2}ghost-explorer\s+0:09/)
  expect(cards.find((c) => c.includes('beta-explorer'))).toMatch(/■ failed {2}beta-explorer\s+0:09/)
})

test('C3: the host row of a stopped task with no duration_ms carries the run the HUD prints, like a done card', async () => {
  const row = flat(await sites().UserMessage!(stopped(), stoppedNoDuration('k1'), next))
  expect(row).toMatch(/■ failed {2}ghost-explorer\s+0:09/)
})
const stoppedNoDuration = (requestId: string) => ({ surface: 'terminal', component: 'UserMessage', requestId, props: { text: 'Agent stopped', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'a1', status: 'killed' } } })

test('C3: a card never recolours with age (critique 26: one text grey on every card); cardAged still times the card out; the words never change', async () => {
  const ids: string[] = []
  await placeFinished(engine(ids), snap(0, [worker('a', 'running'), worker('b', 'running')]), snap(9000, [worker('a', 'finished'), worker('b', 'finished')]))
  const ui = uiFromEnv()
  const fresh = placedTree(ids[0]!, ui)
  const old = placedTree(ids[0]!, ui, true)
  expect(flat(old)).toBe(flat(fresh))
  expect(strings(old)).toBe(strings(fresh))
  expect(cardAged(ids[0]!, 100_000)).toBe(false) // first draw
  expect(cardAged(ids[1]!, 101_000)).toBe(false) // a later card, but not yet 5 s on
  expect(cardAged(ids[0]!, 104_000)).toBe(false)
  expect(cardAged(ids[0]!, 105_500)).toBe(true) // superseded for 5 s
  expect(cardAged(ids[1]!, 105_500)).toBe(false) // the newest card stays full colour...
  expect(cardAged(ids[1]!, 121_500)).toBe(true) // ...until 20 s
  expect(cardAged('never', 0)).toBe(false) // no clock, no dimming
})

test('C3: the Placed site draws an old card as a new one but for its bar, which has faded 141 to 245 after 1 s (critique 29)', async () => {
  const ids: string[] = []
  await placeFinished(engine(ids), snap(0, [worker('alpha-explorer', 'running')]), snap(13_000, [worker('alpha-explorer', 'finished')], { activity: {} }))
  const at = (now: number) => ({ ...host(), state: memState({ 'atlas/snapshot': snap(now, []), 'atlas/orch': { activity: {}, comms: [], stage: {}, meta: {} } }) }) as unknown as EngineInterface
  const site = sites().Placed!
  const first = strings(await site(at(100_000), placedEvent('atlas', ids[0]!), next))
  const bar = (x: string): string => x.replace(/"color":"#(af87ff|8a8a8a)"(,"backgroundColor":"#181825"\},"children":\["▌"\])/, '"color":"BAR"$2')
  expect(first).toContain('"color":"#af87ff","backgroundColor":"#181825"},"children":["▌"]')
  const later = strings(await site(at(110_000), placedEvent('atlas', ids[0]!), next))
  expect(later).toContain('"color":"#8a8a8a","backgroundColor":"#181825"},"children":["▌"]')
  expect(bar(later)).toBe(bar(first))
  expect(bar(strings(await site(at(121_000), placedEvent('atlas', ids[0]!), next)))).toBe(bar(first))
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
