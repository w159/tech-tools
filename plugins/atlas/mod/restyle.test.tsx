// Tests for mod/restyle.tsx — pure tree builders plus the registration wiring.
// Runs under `claude plugin test` (claude-code/testing): no fs, network or process.

import { expect, test } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On } from 'claude-code'
import {
  noisyTree,
  assistantTree,
  durationTree,
  formatDuration,
  personaFor,
  registerRestyle,
  spinnerSuffix,
  toolUseTree,
  turnCostText,
  type ReceiptTracker,
} from './restyle'
import type { AtlasSnapshot } from './contract'
import { textWidth } from './theme'
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
  contextPct: 41,
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

test('formatDuration', () => {
  expect(formatDuration(12_000)).toBe('12s')
  expect(formatDuration(252_000)).toBe('4m12s')
  expect(formatDuration(3_720_000)).toBe('1h2m')
})

test('receipt duration is the turn durationMs, not session time', () => {
  expect(stringsOf(durationTree(snap(), { durationMs: 77_000 }, {}, null))).toContain('1m17s')
})

// ---- Spinner ----

const worker = (name: string, state: string) => ({ name, persona: 'implementer', state, source: 'task', task: '' }) as AtlasSnapshot['squad'][number]

test('spinner suffix names working workers, blocked first, and is empty when idle', () => {
  expect(spinnerSuffix(snap())).toBe('')
  expect(spinnerSuffix(snap({ squad: [worker('impl-auth', 'running')] }))).toBe(' · impl-auth')
  const text = spinnerSuffix(snap({ squad: [worker('a', 'running'), worker('b', 'input'), worker('c', 'running'), worker('d', 'running')] }))
  expect(text).toBe(' · ⏸ b · a · c')
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

test('header line is drawn styled in place with the body kept', () => {
  const first = 'ATLAS | 🔧 implement 3/5 | shipping restyle'
  const text = stringsOf(assistantTree(snap(), { text: `${first}\n\nBody text here.`, isFirstOfReply: true }))
  expect(text).toContain(' ATLAS ')
  expect(text).toContain('implement')
  expect(text).toContain('3/5')
  expect(text).toContain('shipping restyle')
  expect(text).toContain('Body text here.')
  expect(text).toContain('ATLAS | ')
  expect(text).toContain(first)
})

test('header row fits one line at 60 columns with both pipes', () => {
  const row = assistantTree(snap(), { text: `ATLAS | 🔧 implement 3/5 | ${'x'.repeat(120)}`, isFirstOfReply: true }, 60) as { type: string }
  expect(row.type).toBe('Box')
  const line = stringsOf(row)
  expect(textWidth(line)).toBeLessThanOrEqual(60)
  expect(line).toContain('ATLAS | ')
  expect(line.split('|').length).toBe(3)
})

test('headerless or summary replies return null (engine-drawn)', () => {
  expect(assistantTree(snap(), { text: 'just prose', isFirstOfReply: true })).toBeNull()
  expect(assistantTree(snap(), { text: 'ATLAS | 🔧 implement 3/5 | x', isSummary: true })).toBeNull()
})

// ---- TurnDuration receipt ----

test('turn receipt: done delta, workers, ctx, cost', () => {
  const tracker: ReceiptTracker = { done: 0, costStart: 1.2 }
  const text = stringsOf(durationTree(snap({ squad: [worker('a', 'running')] }), { durationMs: 252_000 }, tracker, 1.32))
  expect(text).toBe('▸ 4m12s · +3 done · 1 workers · ctx 41% · $0.12')
  expect(tracker.done).toBe(3)
})

test('turn cost is the delta of two engine readings; a missing or zero reading prints no dollars', () => {
  expect(turnCostText(1.2, 1.32)).toBe('$0.12')
  expect(turnCostText(null, 1.32)).toBeNull()
  expect(turnCostText(1.2, 1.2)).toBeNull()
  const text = stringsOf(durationTree(snap(), { durationMs: 1000 }, {}, null))
  expect(text).not.toContain('$')
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

const fake$ = (over: { env?: string; snapshot?: AtlasSnapshot | null } = {}): { $: EngineInterface; timers: { fire: () => void; cancelled: number; started: number }; ticks: number[] } => {
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
    } as unknown as EngineInterface,
  }
}

const fakeE = (component: string, props: Record<string, unknown> = {}) =>
  ({ surface: 'terminal', component, requestId: 'r1', props })

test('registerRestyle wires the four sites; without a snapshot every site no-ops', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  expect(regs.length).toBe(7) // 4 sites + turn.start + ToolGroup + UserMessage
  expect(regs.slice(0, 4).map((r) => r.matcher?.component)).toEqual(['Spinner', 'ToolUse', 'AssistantMessage', 'TurnDuration'])
  for (const r of regs.slice(0, 4)) {
    expect(await r.hook(fake$().$, fakeE(r.matcher?.component ?? ''), engineNext)).toBe(SENTINEL)
  }
})

test('turn.start records the cost baseline; the receipt prints the delta', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const costs: Array<{ usd: number } | undefined> = [{ usd: 1.2 }, { usd: 1.32 }]
  const harness = fake$({ snapshot: snap() })
  const $ = { ...(harness.$ as object), session: { usage: async () => ({ cost: costs.shift() }) } } as unknown as EngineInterface
  await regs[4]?.hook($, {}, echoNext)
  const text = stringsOf(await regs[3]?.hook($, fakeE('TurnDuration', { durationMs: 1000 }), echoNext))
  expect(text).toContain('$0.12')
})

test('receipt duration is capped by the mod-owned turn timer when the host figure is larger', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const ticks = [1_000_000, 1_077_000]
  const harness = fake$({ snapshot: snap() })
  const $ = { ...(harness.$ as object), clock: { now: async () => ticks.shift() } } as unknown as EngineInterface
  await regs[4]?.hook($, {}, echoNext)
  const text = stringsOf(await regs[3]?.hook($, fakeE('TurnDuration', { durationMs: 542_000 }), echoNext))
  expect(text).toContain('1m17s')
  expect(text).not.toContain('9m02s')
})

test('ATLAS_MOD=off no-ops every site even with a live snapshot', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  for (const r of regs.slice(0, 4)) {
    expect(await r.hook(fake$({ env: 'off', snapshot: snap() }).$, fakeE(r.matcher?.component ?? ''), engineNext)).toBe(SENTINEL)
  }
})

test('live spinner passes the suffix through next', async () => {
  const regs: Reg[] = []
  const harness = fake$({ snapshot: snap({ squad: [worker('impl-auth', 'running')] }) })
  registerRestyle(fakeOn(regs))
  const drawn = await regs[0]?.hook(harness.$, fakeE('Spinner', { word: 'Sauteing', message: null }), echoNext)
  expect((drawn as { props?: { suffix?: string } }).props?.suffix).toBe(' · impl-auth')
})

test('AssistantMessage draws the contract header on one styled row and keeps the body', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const text = 'ATLAS | ⚒ implement 3/5 | dedup cpWidth\n\nBody text here.'
  const drawn = await regs[2]?.hook(fake$({ snapshot: snap() }).$, fakeE('AssistantMessage', { text, isFirstOfReply: true }), echoNext)
  expect(drawn).not.toBe(SENTINEL)
  const out = stringsOf(drawn)
  for (const s of ['ATLAS', 'implement', '3/5', 'dedup cpWidth', 'Body text here.']) expect(out).toContain(s)
})

test('header-less AssistantMessage keeps the engine drawing with no pill', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const drawn = await regs[2]?.hook(fake$({ snapshot: snap() }).$, fakeE('AssistantMessage', { text: 'just prose', isFirstOfReply: true }), engineNext)
  expect(drawn).toBe(SENTINEL)
  expect(stringsOf(drawn)).not.toContain('inferred')
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
