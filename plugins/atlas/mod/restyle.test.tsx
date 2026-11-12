// Tests for mod/restyle.tsx — pure tree builders plus the registration wiring.
// Runs under `claude plugin test` (claude-code/testing): no fs, network or process.

import { expect, test } from 'claude-code/testing'
import type { AgentInfo, EngineInterface, On, RenderElement } from 'claude-code'
import {
  noisyTree,
  drawnHeaderTally,
  forgetDrawnHeaders,
  forgetHeaderPattern,
  assistantTree,
  durationTree,
  PHASE_RE,
  personaFor,
  registerRestyle,
  spinnerSuffix,
  toolUseTree,
  type ReceiptTracker,
} from './restyle'
import type { AtlasSnapshot } from './contract'
import { formatDuration, textWidth } from './theme'
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
  expect(text).toContain('IMPLEMENT')
  expect(text).toContain('3/5')
  expect(text).toContain('shipping restyle')
  expect(text).toContain('Body text here.')
  expect(text).not.toContain('|')
})

type Pill = { props: Record<string, unknown>; children: string[] }
type Kid = Pill | { type: 'Box'; props: Record<string, unknown>; children: Pill[] }
const rawKids = (text: string, columns: number): Kid[] => (assistantTree(snap(), { text, isFirstOfReply: true }, columns) as unknown as { children: Kid[] }).children
// the two chips sit in non-shrinking Boxes; the tests read the Text inside
const pillsOf = (text: string, columns: number): Pill[] => rawKids(text, columns).map((k) => ((k as { type?: string }).type === 'Box' ? (k as { children: Pill[] }).children[0]! : (k as Pill)))

test('critique 15 C1: at 110 the ATLAS and phase chips never shrink, whatever the sentence', () => {
  // live-110-95c4a588-1/tab-route.png: `◆ ATLA… ◎ RESEARC…` beside a long sentence; a Text cannot opt out of flex shrink, a Box can
  const long = 'ATLAS | 🔍 research 1/5 | 3 explorers running on the auth path, the billing path and the session path, none returned yet'
  for (const cols of [66, 110, 150]) {
    const kids = rawKids(long, cols)
    expect([cols, kids.slice(0, 2).map((k) => [(k as { type: string }).type, (k as { props: Record<string, unknown> }).props.flexShrink])]).toEqual([cols, [['Box', 0], ['Box', 0]]])
    expect(pillsOf(long, cols).slice(0, 2).map((p) => p.children[0])).toEqual([' ◆ ATLAS ', ' ◎ RESEARCH '])
  }
})

test('header is filled pills: brand on violet, phase on its hue, then the state text, no pipe', () => {
  const [brand, phase, ...rest] = pillsOf('ATLAS | 🔧 implement 3/5 | shipping restyle', 120)
  expect(brand!.children[0]).toBe(' ◆ ATLAS ')
  expect(brand!.props).toMatchObject({ backgroundColor: '#cba6f7', color: '#1e1e2e', bold: true })
  expect(phase!.children[0]).toBe(' ⚒ IMPLEMENT ')
  expect(phase!.props).toMatchObject({ backgroundColor: '#fab387', color: '#1e1e2e' })
  expect(rest.map((p) => p.children[0]).join('')).toBe(' 3/5 shipping restyle')
})

test("critique 14 B2: the lead's sentence is never cut inside the chip; it wraps beside the pills", () => {
  // live-110-61858003-1 tab-route.png: `marking T1 compl...` at the 66 columns the docked transcript has
  const sentence = '1 of 3 explorers done (alpha), marking T1 complete'
  const kids = pillsOf(`ATLAS | 🔍 research | ${sentence}`, 66)
  const line = stringsOf({ type: 'Box', props: {}, children: kids })
  expect(line).toContain(sentence)
  expect(line).not.toContain('…')
  const tail = kids.at(-1)!
  expect(tail.children[0]).toBe(` ${sentence}`)
  expect(tail.props.wrap).toBe('wrap') // a wrapping Text in a row shrinks and hangs under itself; truncate-end cut it
  const long = pillsOf(`ATLAS | 🔧 implement 3/5 | ${'word '.repeat(40).trim()}`, 60)
  expect(stringsOf({ type: 'Box', props: {}, children: long })).not.toContain('…')
  expect(line).not.toContain('|')
  expect(pillsOf('ATLAS | ✅ verify | started', 39)).toHaveLength(2)
})

test('headerless or summary replies return null (engine-drawn)', () => {
  expect(assistantTree(snap(), { text: 'just prose', isFirstOfReply: true })).toBeNull()
  expect(assistantTree(snap(), { text: 'ATLAS | 🔧 implement 3/5 | x', isSummary: true })).toBeNull()
})

const withPattern = (headerFirstLinePattern: string, over: Partial<AtlasSnapshot> = {}): AtlasSnapshot => {
  const base = snap(over)
  return { ...base, contract: { ...base.contract, headerFirstLinePattern } }
}

test('an empty contract pattern draws no pill on a plain reply', () => {
  expect(assistantTree(withPattern(''), { text: 'Hello', isFirstOfReply: true })).toBeNull()
})

test('a header with no valid phase draws no pill, never the snapshot phase', () => {
  const loose = withPattern('^ATLAS \\|', { phase: 'verify' })
  expect(assistantTree(loose, { text: 'ATLAS | x mystery | state', isFirstOfReply: true })).toBeNull()
})

test('the pill shows the phase the header states, not a phase word in its sentence', () => {
  const text = stringsOf(assistantTree(snap({ phase: 'verify' }), { text: 'ATLAS | 🔧 implement 2/9 | text containing the word verify', isFirstOfReply: true }))
  expect(text).toContain('IMPLEMENT')
  expect(text).not.toContain('VERIFY')
})

// ---- TurnDuration receipt ----

test('turn receipt: done delta, workers, ctx', () => {
  const tracker: ReceiptTracker = { done: 0 }
  const text = stringsOf(durationTree(snap({ squad: [worker('a', 'running')] }), { durationMs: 252_000 }, tracker))
  expect(text).toBe('▸ 4m12s · +3 done · 1 worker · ctx 41%') // critique 15 B6: singular
  expect(tracker.done).toBe(3)
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
  expect(regs.length).toBe(8) // 4 sites + turn.start + ToolGroup + UserMessage + Placed
  expect(regs.slice(0, 4).map((r) => r.matcher?.component)).toEqual(['Spinner', 'ToolUse', 'AssistantMessage', 'TurnDuration'])
  for (const r of regs.slice(0, 4)) {
    expect(await r.hook(fake$().$, fakeE(r.matcher?.component ?? ''), engineNext)).toBe(SENTINEL)
  }
})

test('the receipt never prints dollars, even when the engine reports a session cost', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const costs: Array<{ usd: number } | undefined> = [{ usd: 1.2 }, { usd: 1.32 }]
  const harness = fake$({ snapshot: snap() })
  const $ = { ...(harness.$ as object), session: { usage: async () => ({ cost: costs.shift() }) } } as unknown as EngineInterface
  await regs[4]?.hook($, {}, echoNext)
  const text = stringsOf(await regs[3]?.hook($, fakeE('TurnDuration', { durationMs: 1000 }), echoNext))
  expect(text).not.toContain('$')
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
  for (const s of ['ATLAS', 'IMPLEMENT', '3/5', 'dedup cpWidth', 'Body text here.']) expect(out).toContain(s)
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

// ---- mutation-hardening: what the restyled rows actually say ----

const callBase = { isRunning: false, isErrored: false, isInterrupted: false }
const taskProps = (over: Record<string, unknown> = {}) => ({
  tool: 'Task',
  input: { subagentType: 'atlas:implementer', name: 'impl-auth' },
  ...callBase,
  ...over,
})
const withActivity = (a: Record<string, unknown>, now = 73_500) =>
  snap({ now, ...({ activity: { 'impl-auth': a } } as object) })
const runAgent: AgentInfo[] = [{ id: 'a1', type: 'atlas:implementer', description: '', status: 'running', name: 'impl-auth' }]

test('running worker card shows what it is doing: tool (mcp prefix cut), target, age, tool count', () => {
  const s = withActivity({ tool: 'mcp__lean-ctx__ctx_read', target: 'register.ts', since: 1000, startedAt: 500, toolCount: 9 })
  const text = stringsOf(toolUseTree(s, taskProps({ isRunning: true }), runAgent))
  expect(text).toContain('ctx_read register.ts · 1m13s') // the 44-column card sheds the tool count rather than clip the age
})

test('worker card activity: last tool without a target, and no tool at all, still render the age', () => {
  const last = withActivity({ lastTool: 'Grep', since: 500, toolCount: 2 })
  expect(stringsOf(toolUseTree(last, taskProps({ isRunning: true }), runAgent))).toContain('Grep · 1m13s · 2 tools')
  const none = withActivity({ since: 500, toolCount: 0 })
  const text = stringsOf(toolUseTree(none, taskProps({ isRunning: true }), runAgent))
  expect(text).toContain('1m13s · 0 tools')
  expect(text).not.toContain(' ·  · ')
})

test('with no listed agent the card status falls back from the call flags', () => {
  const s = snap()
  const label = (over: Record<string, unknown>) => stringsOf(toolUseTree(s, taskProps(over), []))
  expect(label({ isRunning: true })).toContain('running')
  expect(label({ isErrored: true })).toContain('failed   impl-auth')
  expect(label({ isInterrupted: true })).toContain('blocked  impl-auth')
  expect(label({ output: undefined })).toContain('pending')
  expect(label({ output: 'ok' })).toContain('done     impl-auth')
})

test('a listed agent is found by name, and its status wins over the call flags', () => {
  const agents: AgentInfo[] = [{ id: 'z', type: 'atlas:implementer', description: '', status: 'completed', name: 'impl-auth' }]
  const text = stringsOf(toolUseTree(snap(), taskProps({ isRunning: true }), agents))
  expect(text).toContain('completed')
  expect(text).toContain('impl-auth')
})

test('noisy badge is an inverse accent pill with the size; boundary is 8000', () => {
  const base = { tool: 'Read', input: { file_path: '/a/b.ts' }, ...callBase }
  const tree = noisyTree({ ...base, output: 'x'.repeat(8000) })! as Extract<RenderElement, { type: string }> & { props: Record<string, unknown>; children: RenderElement[] }
  const badge = tree.children.at(-1)! as typeof tree
  expect(badge.props).toMatchObject({ color: '#2fbd9f', inverse: true })
  expect(stringsOf(badge)).toBe(' ▸ 8.0kB ')
  expect(stringsOf(tree)).toContain('Read /a/b.ts')
  expect(noisyTree({ ...base, output: 'x'.repeat(7999) })).toBeNull()
  expect(stringsOf(noisyTree({ ...base, output: 'x'.repeat(2_500_000) })!)).toContain('▸ 2.5MB')
  expect(noisyTree({ ...base, output: null })).toBeNull()
})

test('header pills: tail shows from 40 columns up, only the two pills below, and a width of 1 is narrow', () => {
  const t = 'ATLAS | 🔧 implement 3/5 | go'
  expect(pillsOf(t, 40).length).toBeGreaterThan(2)
  expect(pillsOf(t, 39)).toHaveLength(2)
  expect(pillsOf(t, 1)).toHaveLength(2)
  expect(pillsOf(t, 0).length).toBeGreaterThan(2) // unknown width draws it whole
})

test('assistantTree: an unknown phase word gives null (no snapshot fallback), bad pattern and empty text give null, layout follows the body', () => {
  const loose = { ...snap().contract, headerFirstLinePattern: '^ATLAS \\|' }
  const s = snap({ phase: 'verify', contract: loose })
  expect(assistantTree(s, { text: 'ATLAS | ✅ underway | state' }, 120)).toBeNull()
  const tree = assistantTree(s, { text: 'ATLAS | ✅ verify | state' }, 120)!
  expect(tree.type).toBe('Box')
  expect(stringsOf(tree)).toContain('VERIFY')
  expect((tree as { props: Record<string, unknown> }).props.flexDirection).toBe('row')
  expect(assistantTree(snap({ contract: { ...snap().contract, headerFirstLinePattern: '(' } }), { text: 'ATLAS | x | y' })).toBeNull()
  expect(assistantTree(snap(), { text: '' })).toBeNull()
  const withBody = assistantTree(snap(), { text: 'ATLAS | 🔧 implement | s\nbody' }, 120)!
  expect((withBody as { props: Record<string, unknown> }).props.flexDirection).toBe('column')
})

test('durationTree: capped by the mod clock, delta only when positive, no workers or ctx when zero', () => {
  const s = snap({ contextPct: 0, counts: { done: 2, total: 5, byPhase: {} } })
  const tr: ReceiptTracker = { done: 2, turnStart: 1000 }
  expect(stringsOf(durationTree(s, { durationMs: 600_000 }, tr, 6000))).toBe('▸ 5s')
  expect(stringsOf(durationTree(s, { durationMs: 3000 }, tr, 60_000))).toBe('▸ 3s')
  expect(stringsOf(durationTree(s, { durationMs: 7000 }, { done: 5 }, null))).toBe('▸ 7s')
})

test('personaFor needs the atlas: prefix and a known name', () => {
  expect(personaFor(snap(), undefined)).toBeUndefined()
  expect(personaFor(snap(), 'implementer')).toBeUndefined()
  expect(personaFor(snap(), 'atlas:nobody')).toBeUndefined()
})

test('UserMessage: agent messages become chat bubbles; prompts, expanded rows, senderless text and mod-off stay engine-drawn', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  expect(regs[6]?.matcher?.component).toBe('UserMessage')
  const live = fake$({ snapshot: snap() }).$
  const msg = (props: Record<string, unknown>) => regs[6]!.hook(live, fakeE('UserMessage', props), engineNext)
  const bubble = await msg({ text: 'ship it', from: { name: 'impl-auth' } })
  expect(stringsOf(bubble)).toContain('#atlas impl-auth › lead')
  expect(stringsOf(bubble)).toContain('ship it')
  expect(await msg({ text: 'ship it' })).toBe(SENTINEL)
  expect(await msg({ text: 'ship it', from: { name: 'x' }, isExpanded: true })).toBe(SENTINEL)
  expect(await msg({ text: 'ship it', from: { name: 'x' }, origin: { kind: 'composer' } })).toBe(SENTINEL)
  const offRegs: Reg[] = []
  registerRestyle(fakeOn(offRegs)) // ATLAS_MOD is read once per registration
  const off = fake$({ env: 'off', snapshot: snap() }).$
  expect(await offRegs[6]!.hook(off,fakeE('UserMessage', { text: 't', from: { name: 'x' } }), engineNext)).toBe(SENTINEL)
})

test('ToolGroup: two atlas dispatches draw as a numbered wave, anything else stays engine-drawn', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  expect(regs[5]?.matcher?.component).toBe('ToolGroup')
  const live = fake$({ snapshot: snap() }).$
  const call = (id: string, name: string) => ({ tool: 'Task', tool_use_id: id, input: { subagentType: 'atlas:implementer', name }, ...callBase })
  const group = (calls: unknown[]) => regs[5]!.hook(live, fakeE('ToolGroup', { calls }), engineNext)
  const first = stringsOf(await group([call('t1', 'a'), call('t2', 'b')]))
  expect(first).toContain('WAVE 1')
  expect(first).toContain('done     a')
  expect(await group([call('t3', 'a')])).toBe(SENTINEL)
  expect(await group([])).toBe(SENTINEL)
  const offRegs: Reg[] = []
  registerRestyle(fakeOn(offRegs))
  expect(await offRegs[5]!.hook(fake$({ env: 'off', snapshot: snap() }).$, fakeE('ToolGroup', { calls: [call('t1', 'a'), call('t2', 'b')] }), engineNext)).toBe(SENTINEL)
})

test('a failing clock leaves the receipt on the host figure', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const harness = fake$({ snapshot: snap({ contextPct: 0, counts: { done: 0, total: 0, byPhase: {} } }) })
  const $ = { ...(harness.$ as object), clock: { now: async () => { throw new Error('no clock') } } } as unknown as EngineInterface
  await regs[4]?.hook($, {}, echoNext)
  expect(stringsOf(await regs[3]?.hook($, fakeE('TurnDuration', { durationMs: 9000 }), echoNext))).toBe('▸ 9s')
})

test('PHASE_RE picks a whole phase word and ignores substrings', () => {
  expect(PHASE_RE.exec(' ⚒ implement 3/5 ')?.[1]).toBe('implement')
  expect(PHASE_RE.exec('stuck, test blocked')?.[1]).toBe('test')
  expect(PHASE_RE.exec('contested undone')).toBeNull()
})

test('critique 11: the header tally counts every assistant text the transcript drew (a chip per text block), not one answer per turn', async () => {
  forgetDrawnHeaders()
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const site = regs.find((r) => r.matcher?.component === 'AssistantMessage')!
  const harness = fake$({ snapshot: snap() })
  const draw = (id: string, text: string) => site.hook(harness.$, { surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text } }, engineNext)
  await draw('m1', 'ATLAS | 🔍 research | 0/3 explorers returned, board 0/5')
  await draw('m2', 'ATLAS | 🔍 research | 1/3 explorers returned, board 1/5')
  await draw('m3', 'ATLAS | 🏁 done | 5/5')
  await draw('m4', 'plain text with no header')
  await draw('m3', 'ATLAS | 🏁 done | 5/5\n\nbody grown by streaming') // a re-draw of one message is still one message
  expect(drawnHeaderTally()).toEqual({ ok: 3, total: 3 }) // critique 15 B3: the headerless narration block is not a failed chip
  await draw('m5', 'also plain')
  expect(drawnHeaderTally()).toEqual({ ok: 3, total: 3 }) // the figure never falls as the lead narrates
  forgetDrawnHeaders()
  await draw('p1', 'plain text, no header')
  await draw('p2', 'more plain text')
  expect(drawnHeaderTally()).toEqual({ ok: 0, total: 2 }) // a run with text and no chip at all still fails
  forgetDrawnHeaders()
  expect(drawnHeaderTally()).toEqual({ ok: 0, total: 0 })
})

test('critique 12 C1: once the pattern is known, a new message is chipped with no host state or env read (the raw frame is the wait for that round trip)', async () => {
  forgetHeaderPattern()
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const site = regs.find((r) => r.matcher?.component === 'AssistantMessage')!
  const base = fake$({ snapshot: snap() })
  let calls = 0
  const tap = (o: object): object =>
    new Proxy(o, {
      get: (t, k, r) => {
        const v = Reflect.get(t, k, r)
        return typeof v === 'function' ? (...a: unknown[]) => { calls++; return (v as (...x: unknown[]) => unknown).apply(t, a) } : v
      },
    })
  const src = base.$ as unknown as { env: object; state: object }
  const $ = { ...src, env: tap(src.env), state: tap(src.state) } as unknown as EngineInterface
  const text = 'ATLAS | 🏁 done | 5/5'
  const draw = (id: string) => site.hook($, { surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text } }, engineNext)
  await draw('first') // cold: the pattern is unknown until the first snapshot read
  const cold = calls
  expect(cold).toBeGreaterThan(0)
  const warm = await draw('second')
  expect(calls).toBe(cold) // the warm path asks the host for nothing
  expect(stringsOf(warm)).toContain('ATLAS')
  expect(warm).not.toBe(SENTINEL)
})

// ---- critique 17 C1: the first AssistantMessage answer is synchronous ----

test('C1: with the env primed by turn.start, the first AssistantMessage draw is a chip returned synchronously (no promise, no state read)', async () => {
  forgetDrawnHeaders()
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs)) // fresh registration: no snapshot was ever read; the pattern comes from contracts/operating-contract.json
  let stateReads = 0
  const base = fake$({ snapshot: snap() }).$
  const $ = { ...(base as object), state: { ...(base.state as object), get: async () => { stateReads += 1; return null } } } as unknown as EngineInterface
  await regs[4]!.hook($, {}, echoNext) // turn.start
  stateReads = 0
  const lines = ['ATLAS | 🔍 research | 0/3 explorers returned', 'ATLAS | ⛔ blocked | Stop gate open', 'ATLAS | 🏁 done | 5/5']
  let raw = 0
  for (const text of lines) {
    const out = regs[2]!.hook($, fakeE('AssistantMessage', { text }), engineNext) as unknown
    if (out instanceof Promise || stringsOf(out).includes('ATLAS |')) raw += 1
  }
  expect(raw).toBe(0)
  expect(stateReads).toBe(0)
})

test('C1: before any turn.start the first draw still resolves to a chip, and mod-off still passes through', async () => {
  const regs: Reg[] = []
  registerRestyle(fakeOn(regs))
  const first = await regs[2]!.hook(fake$({ snapshot: snap() }).$, fakeE('AssistantMessage', { text: 'ATLAS | 🏁 done | 5/5' }), engineNext)
  expect(stringsOf(first)).toContain('DONE')
  const offRegs: Reg[] = []
  registerRestyle(fakeOn(offRegs))
  const off = fake$({ env: 'off', snapshot: snap() }).$
  await offRegs[4]!.hook(off, {}, echoNext)
  expect(await offRegs[2]!.hook(off, fakeE('AssistantMessage', { text: 'ATLAS | 🏁 done | 5/5' }), engineNext)).toBe(SENTINEL)
})
