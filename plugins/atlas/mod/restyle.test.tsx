// Tests for mod/restyle.tsx — pure tree builders plus the registration wiring.
// Runs under `claude plugin test` (claude-code/testing): no fs, network or process.

import { expect, test } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On } from 'claude-code'
import {
  noisyTree,
  HINT_TAIL,
  assistantTree,
  capsule,
  durationTree,
  formatDuration,
  fmtTok,
  nextStepText,
  personaFor,
  phaseCount,
  registerRestyle,
  spinnerTree,
  toolUseTree,
  turnCostText,
  turnTokensText,
  type ReceiptTracker,
} from './restyle'
import type { AtlasSnapshot } from './contract'
import { memState } from './test_helpers'

// ---- fixtures ----

const snap = (over: Partial<AtlasSnapshot> = {}): AtlasSnapshot => ({
  root: null,
  sessionId: 's1',
  channel: 'tech-tools@main/lead-01a122',
  contract: {
    phases: [{ id: 'implement', glyph: '🔧' }],
    todoPhases: ['research', 'implement', 'verify', 'done'],
    headerFirstLinePattern: '^ATLAS \\| \\S+ (research|theory|test|validate|implement|verify|done|blocked)( \\d+/\\d+)? \\|',
    itemPhasePrefix: '[<phase>] ',
  },
  personas: [{ name: 'implementer', model: 'sonnet', effort: 'low', color: 'green', description: 'worker' }],
  todos: [],
  counts: { done: 3, total: 5, byPhase: { implement: { done: 3, total: 5 } } },
  phase: 'implement',
  phaseSource: 'header',
  notes: [],
  members: [],
  squad: [],
  unread: 0,
  tokens: 48000,
  costUsd: 0.31,
  contextPct: 41,
  headerMisses: 0,
  now: 0,
  ...over,
})

/** All text a plain render tree carries (element children, props.children, Markdown props.text). */
const stringsOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(stringsOf).join('')
  if (node !== null && typeof node === 'object') {
    const el = node as { children?: unknown; props?: { children?: unknown; text?: unknown } }
    if (el.children !== undefined) return stringsOf(el.children)
    const p = el.props
    if (p !== null && typeof p === 'object') {
      if (typeof p.text === 'string') return p.text
      if (p.children !== undefined) return stringsOf(p.children)
    }
  }
  return ''
}

const SENTINEL = { type: 'Text', props: {}, children: [] }
const echoNext = async (x?: unknown) => x ?? SENTINEL
/** Pass-through `next` per the engine contract (claude-code d.ts `Next`, ~L6543):
 *  it takes the event and resolves to the drawing beneath — the SENTINEL here.
 *  A bare `next()` (no event) is outside the contract and resolves undefined. */
const engineNext = async (x?: unknown) => (x === undefined ? undefined : SENTINEL)

// ---- formatters ----

test('formatDuration and fmtTok', () => {
  expect(formatDuration(12_000)).toBe('12s')
  expect(formatDuration(252_000)).toBe('4m12s')
  expect(formatDuration(3_720_000)).toBe('1h2m')
  expect(fmtTok(48_000)).toBe('48k')
  expect(fmtTok(820)).toBe('820')
  expect(fmtTok(2_500_000)).toBe('2.5M')
})

test('capsule and phaseCount read the phase slice', () => {
  const pc = phaseCount(snap(), 'implement')
  expect(pc.done).toBe(3)
  expect(pc.total).toBe(5)
  expect(capsule(snap())).toBe('⟦implement 3/5⟧')
  expect(capsule(snap({ counts: { done: 0, total: 0, byPhase: {} } }), 'research')).toBe('⟦research⟧')
})

// ---- Spinner ----

test('spinner renders globe, capsule, meter and squad activity', () => {
  const s = snap({
    squad: [{ name: 'impl-auth', persona: 'implementer', state: 'running', source: 'task', task: 'editing hooks/completion_gate.py' }],
  })
  const text = stringsOf(spinnerTree(s, { word: 'Sauteing', message: null }, 0))
  expect(text).toContain('⠋')
  expect(text).toContain('⟦implement 3/5⟧')
  expect(text).toContain('▰▰▰▱▱')
  expect(text).toContain('Sauteing')
  expect(text).toContain('impl-auth editing hooks/completion_gate.py')
})

test('spinner keeps a one-cell gap between the capsule/bar and the verb', () => {
  const text = stringsOf(spinnerTree(snap(), { word: 'Twisting', message: null }, 0))
  expect(text).toContain('▰▰▰▱▱ Twisting')
})

test('spinner globe cycles through the 8 slots', () => {
  const s = snap()
  const at = (tickMs: number) => stringsOf(spinnerTree(s, { word: 'w', message: null }, tickMs))
  // 8 braille frames, one per 120 ms tick, wrapping.
  expect(at(0)).toContain('⠋')
  expect(at(120)).toContain('⠙')
  expect(at(7 * 120)).toContain('⠧')
  expect(at(8 * 120)).toContain('⠋')
})

// ---- ToolUse deployment card ----

test('deployment card for atlas persona Task rows', () => {
  const s = snap()
  const agents: AgentInfo[] = [
    { id: 'a1', type: 'atlas:implementer', description: 'One bounded implementation', status: 'running', name: 'impl-auth' },
  ]
  const tree = toolUseTree(
    s,
    { tool: 'Task', input: { subagentType: 'atlas:implementer', name: 'impl-auth', description: 'One bounded implementation' }, isRunning: true, isErrored: false, isInterrupted: false },
    agents,
  )
  expect(tree).not.toBeNull()
  const text = stringsOf(tree)
  expect(text).toContain('impl-auth')
  expect(text).toContain('implementer')
  expect(text).toContain('sonnet·low')
  expect(text).toContain('running')
})

test('non-atlas tool rows keep the engine drawing', () => {
  const s = snap()
  expect(toolUseTree(s, { tool: 'Read', input: {}, isRunning: false, isErrored: false, isInterrupted: false }, [])).toBeNull()
  expect(toolUseTree(s, { tool: 'Task', input: { subagentType: 'general-purpose' }, isRunning: true, isErrored: false, isInterrupted: false }, [])).toBeNull()
  expect(personaFor(snap(), 'atlas:implementer')?.model).toBe('sonnet')
  expect(personaFor(snap(), 'general-purpose')).toBeUndefined()
})

// ---- AssistantMessage pill ----

test('header line becomes a coloured pill with the body kept', () => {
  const tree = assistantTree(snap(), { text: 'ATLAS | 🔧 implement 3/5 | shipping restyle\n\nBody text here.', isFirstOfReply: true })
  expect(tree).not.toBeNull()
  const text = stringsOf(tree)
  expect(text).toContain('▸ implement 3/5')
  expect(text).toContain('Body text here.')
  expect(text).not.toContain('ATLAS |')
})

test('headerless reply gets a dim inferred pill; other blocks stay engine-drawn', () => {
  const text = stringsOf(assistantTree(snap(), { text: 'just prose', isFirstOfReply: true }))
  expect(text).toContain('▸ implement · inferred')
  expect(text).toContain('just prose')
  expect(assistantTree(snap(), { text: 'more prose' })).toBeNull()
  expect(assistantTree(snap(), { text: 'ATLAS | 🔧 implement 3/5 | x', isSummary: true })).toBeNull()
})

// ---- TurnDuration receipt ----

test('turn receipt with phase transition and tracker memory', () => {
  const tracker: ReceiptTracker = { phase: 'research', done: 0, costStart: 1.2, usage: { input_tokens: 12_400, output_tokens: 1_100, cache_read_input_tokens: 0 } }
  const text = stringsOf(durationTree(snap(), { durationMs: 252_000 }, tracker, 1.32))
  expect(text).toContain('▸')
  expect(text).toContain('4m12s')
  expect(text).toContain('research ▸ implement')
  expect(text).toContain('+3 done')
  expect(text).toContain('12k in / 1k out')
  expect(text).toContain('turn $0.12')
  expect(text).toContain('ctx 41%')
  expect(text).not.toContain('48k')
  expect(text).not.toContain('$0.31')
  expect(tracker.phase).toBe('implement')
  expect(tracker.done).toBe(3)
})

test('turn cost is the delta of two engine readings; a missing reading prints no dollars', () => {
  expect(turnCostText(1.2, 1.32)).toBe('turn $0.12')
  expect(turnCostText(null, 1.32)).toBeNull()
  expect(turnCostText(1.2, null)).toBeNull()
  const text = stringsOf(durationTree(snap({ costUsd: 0 }), { durationMs: 1000 }, {}, null))
  expect(text).not.toContain('$')
})

test('receipt tokens come from turn usage, never context fill', () => {
  expect(turnTokensText(null)).toBeNull()
  expect(turnTokensText({ input_tokens: 800, output_tokens: 90, cache_read_input_tokens: 5000 })).toBe('800 in / 90 out (+5k cached)')
  expect(stringsOf(durationTree(snap({ tokens: 48_000 }), { durationMs: 1000 }, {}, null))).not.toContain('tok')
})

// ---- prompt suggestion ----

test('next contract step suggestion branches', () => {
  const wip = snap({ todos: [{ id: 't1', content: 'ship restyle sites', status: 'in_progress', owner: 'Restyle' }] })
  expect(nextStepText(wip)).toBe('check: Restyle ship restyle sites')
  const pending = snap({ todos: [{ id: 't2', content: 'verify mod', status: 'pending' }], counts: { done: 5, total: 5, byPhase: {} } })
  expect(nextStepText(pending)).toBe('next: verify mod')
  const none = snap({ counts: { done: 5, total: 5, byPhase: {} } })
  expect(nextStepText(none)).toBe('atlas: record evidence and close the run')
  expect(nextStepText(snap({ counts: { done: 0, total: 0, byPhase: {} } }))).toBeNull()
})

// ---- registration wiring ----

type Reg = { matcher?: { component: string }; hook: (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<unknown> }

const fakeOn = (regs: Reg[]): On =>
  ((_pattern: unknown, a: unknown, b?: unknown) => {
    regs.push({
      matcher: b === undefined ? undefined : (a as Reg['matcher']),
      hook: (b === undefined ? a : b) as Reg['hook'],
    })
    return { catch: () => undefined }
  }) as unknown as On

const fake$ = (over: { env?: string; snapshot?: AtlasSnapshot | null } = {}): { $: EngineInterface; suggested: string[]; timers: { fire: () => void; cancelled: number; started: number }; ticks: number[] } => {
  const suggested: string[] = []
  const ticks: number[] = []
  const mem = memState({ 'atlas/snapshot': over.snapshot ?? null })
  const spinnerRecording = {
    ...mem,
    set: async (ref: { key: string }, value: unknown, opts?: unknown) => {
      if (ref.key === 'spinnerTick') ticks.push(value as number)
      return (mem.set as (...a: unknown[]) => Promise<unknown>)(ref, value, opts)
    },
  }
  const timers = { fire: () => undefined as void, cancelled: 0, started: 0 }
  return {
    timers,
    ticks,
    $: {
      clock: {
        every: (_ms: number, fn: () => void) => {
          timers.started += 1
          timers.fire = fn
          return { cancel: () => { timers.cancelled += 1 } }
        },
      },
      env: { get: async () => over.env },
      state: spinnerRecording,
      agent: { list: async () => [] },
      prompt: { suggest: async (a: { text: string }) => { suggested.push(a.text); return { isShown: true } } },
    } as unknown as EngineInterface,
    suggested,
  }
}

const fakeE = (component: string, props: Record<string, unknown> = {}) =>
  ({ surface: 'terminal', component, requestId: 'r1', props })

test('registerRestyle wires the five sites; without a snapshot every site no-ops', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  expect(regs.length).toBe(7)
  expect(regs[0]?.matcher?.component).toBe('Spinner')
  expect(regs[1]?.matcher?.component).toBe('ToolUse')
  expect(regs[2]?.matcher?.component).toBe('AssistantMessage')
  expect(regs[3]?.matcher?.component).toBe('TurnDuration')
  expect(regs[4]?.matcher?.component).toBe('PromptHint')
  for (const r of regs.slice(0, 5)) {
    expect(await r.hook(fake$().$, fakeE(r.matcher?.component ?? ''), engineNext)).toBe(SENTINEL)
  }
})

test('turn hooks record the cost baseline and the main loop usage; the receipt prints the delta', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const costs: Array<{ usd: number } | undefined> = [{ usd: 1.2 }, { usd: 1.32 }]
  const harness = fake$({ snapshot: snap({ costUsd: 0 }) })
  const $ = { ...(harness.$ as object), session: { usage: async () => ({ cost: costs.shift() }) } } as unknown as EngineInterface
  await regs[5]?.hook($, {}, echoNext)
  const usage = { input_tokens: 3000, output_tokens: 500, cache_read_input_tokens: 0 }
  await regs[6]?.hook($, { usage }, echoNext)
  await regs[6]?.hook($, { usage: { ...usage, input_tokens: 9 }, agentId: 'sub' }, echoNext)
  const text = stringsOf(await regs[3]?.hook($, fakeE('TurnDuration', { durationMs: 1000 }), echoNext))
  expect(text).toContain('turn $0.12')
  expect(text).toContain('3k in / 500 out')
})

test('ATLAS_MOD=off no-ops every site even with a live snapshot', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  for (const r of regs.slice(0, 5)) {
    expect(await r.hook(fake$({ env: 'off', snapshot: snap() }).$, fakeE(r.matcher?.component ?? ''), engineNext)).toBe(SENTINEL)
  }
})

test('live spinner draws and PromptHint appends the tail and suggests the next step', async () => {
  const regs: Reg[] = []
  const todos = [{ id: 't1', content: 'ship restyle sites', status: 'in_progress', owner: 'Restyle' }]
  const harness = fake$({ snapshot: snap({ todos }) })
  registerRestyle(fakeOn(regs))

  const drawn = await regs[0]?.hook(harness.$, fakeE('Spinner', { word: 'Sauteing', message: null }), echoNext)
  expect(drawn).not.toBe(SENTINEL)
  expect(stringsOf(drawn)).toContain('⟦implement 3/5⟧')

  const rewritten = await regs[4]?.hook(harness.$, fakeE('PromptHint', { isDraft: false, isWorking: false, hint: '' }), echoNext)
  const tail = (rewritten as { props?: { tail?: string } } | undefined)?.props?.tail
  expect(tail).toBe(HINT_TAIL)
  expect(harness.suggested[0]).toBe('check: Restyle ship restyle sites')
})

test('spinner globe advances per timer tick and the timer stops once the Spinner unmounts', async () => {
  const regs: Reg[] = []
  const h = fake$({ snapshot: snap() })
  registerRestyle(fakeOn(regs))
  const props = { word: 'Sauteing', message: null }
  const frameAt = async () => stringsOf(await regs[0]?.hook(h.$, fakeE('Spinner', props), echoNext)).charAt(0)

  const seen = [await frameAt()]
  await frameAt() // a second draw must not start a second timer
  expect(h.timers.started).toBe(1)
  for (let i = 0; i < 6; i++) {
    h.timers.fire()
    await Promise.resolve()
    seen.push(await frameAt())
  }
  expect(h.ticks).toEqual([1, 2, 3, 4, 5, 6])
  expect(seen[0]).not.toBe(seen[1]) // one glyph per tick
  expect(new Set(seen).size).toBe(7) // 7 distinct braille frames over 7 draws

  // turn over: the Spinner unmounts, so the next tick finds no draw since the last one and stops
  h.timers.fire() // draw happened since previous fire (frameAt above): still writes
  h.timers.fire() // no draw in between: cancels, writes nothing
  expect(h.ticks.length).toBe(7)
  expect(h.timers.cancelled).toBe(1)
  await frameAt() // the next turn restarts exactly one timer
  expect(h.timers.started).toBe(2)
})

test('noisy tool: huge Bash output collapses to a one-line size badge; small/running keeps engine row', () => {
  const base = { tool: 'Bash', input: { command: 'npm test' }, isRunning: false, isErrored: false, isInterrupted: false }
  const text = stringsOf(noisyTree({ ...base, output: { stdout: 'x'.repeat(20000) } })!)
  expect(text).toContain('Bash npm test')
  expect(text).toContain('▸ 20.0kB')
  expect(noisyTree({ ...base, output: { stdout: 'ok' } })).toBeNull()
  expect(noisyTree({ ...base, isRunning: true, output: 'x'.repeat(20000) })).toBeNull()
  expect(noisyTree({ ...base, tool: 'Edit', output: 'x'.repeat(20000) })).toBeNull()
})
