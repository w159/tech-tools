// Golden tests for transcript/cards.tsx: worker cards, wave strips, channel bubbles.
import { expect, test } from 'claude-code/testing'
import { fitText, textWidth } from '../theme'
import { hexTo256, hostTo256, toneHex } from '../atlas-ui'
import { bubbleTree, notificationTree, waveTree, workerCard, goalLine, resultLine, phaseOf } from './cards'
import type { CallLike } from './cards'

const leaf = (n: unknown): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : '')
const text = (n: unknown): string => {
  if (Array.isArray(n)) return n.map(text).join('')
  return n && typeof n === 'object' ? text((n as { children?: unknown }).children) : leaf(n)
}
const props = (n: unknown): Record<string, unknown> => ((n as { props?: Record<string, unknown> }).props ?? {})

const PROMPT = 'ROLE: x\nGOAL: ship the thing\nINPUTS: y'
const call = (over: Partial<CallLike> = {}): CallLike => ({
  tool: 'Agent',
  input: { subagent_type: 'atlas:implementer', name: 'impl-a', description: 'desc', prompt: PROMPT, model: 'sonnet' },
  isRunning: true, isErrored: false, isInterrupted: false, ...over,
})

test('goalLine takes the GOAL: line, else the description', () => {
  expect(goalLine({ prompt: PROMPT, description: 'd' })).toBe('ship the thing')
  expect(goalLine({ description: 'd' })).toBe('d')
})

test('resultLine prefers the STATUS line', () => {
  expect(resultLine('blah\nSTATUS: DONE\nmore')).toBe('STATUS: DONE')
  expect(resultLine({ content: [{ type: 'text', text: 'plain result' }] })).toBe('plain result')
})

type El = { props: Record<string, unknown>; children: El[] }
/** The card as its plain rows. */
const rowsOf = (c: unknown): string[] => (c as El).children.map((r) => text(r))
const W = 44

test('running card: a closed box, the state word and name in the top border, goal and last rows', () => {
  const c = workerCard(call(), 'running', 0, undefined, '', { now: 'Grep auth/ 12s', wave: 2 })!
  const rows = rowsOf(c)
  expect(rows[0]).toMatch(/^┌─ ◆ running impl-a ─+ sonnet ─┐$/u)
  expect(rows.at(-1)).toMatch(/^└─+┘$/u)
  expect(rows.some((r) => /^│ goal {2}ship the thing +│$/.test(r))).toBe(true)
  expect(rows.some((r) => /^│ last {2}Grep auth\/ 12s +│$/.test(r))).toBe(true)
  for (const r of rows) expect(textWidth(r)).toBe(W)
  expect(props(c).borderStyle).toBeUndefined()
})

test('the card frame takes the state hue: running, done and failed differ; the state word stays plain text', () => {
  const frame = (c: unknown): unknown => (((c as El).children[0]!.children[0]!).props as Record<string, unknown>).color
  const run = frame(workerCard(call(), 'running')!)
  const done = frame(workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished')!)
  const bad = frame(workerCard(call({ isRunning: false, isErrored: true }), 'failed')!)
  expect(new Set([run, done, bad]).size).toBe(3)
  expect(bad).toBe(toneHex('bad', 'mocha'))
})

test('done card shows the result line in the last row; errored reads failed in the border', () => {
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished')!
  expect(rowsOf(done)[0]).toContain('done impl-a')
  expect(text(done)).toContain('STATUS: DONE')
  const bad = workerCard(call({ isRunning: false, isErrored: true }), 'failed')!
  expect(rowsOf(bad)[0]).toContain('failed impl-a')
})

test('non-atlas Agent call is left to the engine', () => {
  expect(workerCard(call({ input: { subagent_type: 'general-purpose' } }), 'running')).toBeNull()
})

test('wave of 3 is one strip headed WAVE 1 with three cards', () => {
  const calls = ['a', 'b', 'c'].map((n) => call({ input: { subagent_type: 'atlas:explorer', name: `wave-${n}`, prompt: PROMPT } }))
  const w = waveTree(calls, 1, 160)!
  const t = text(w)
  expect(t).toContain('WAVE 1 · 3 workers')
  for (const n of ['wave-a', 'wave-b', 'wave-c']) expect(t).toContain(n)
  expect(waveTree([calls[0]!], 1, 160)).toBeNull()
  expect(waveTree([calls[0]!, call({ tool: 'Bash' })], 1, 160)).toBeNull()
})

test('bubble names sender and carries the text', () => {
  const b = bubbleTree('hello team', 'wave-a')!
  const t = text(b)
  expect(t).toContain('#atlas wave-a › lead')
  expect(t).toContain('hello team')
  expect(bubbleTree('x', undefined)).toBeNull()
})

test('phaseOf: errored beats interrupted beats running; else finished; the UI state is in the six-word vocabulary', () => {
  const s = (over: Partial<CallLike>) => phaseOf(call({ isRunning: false, ...over }), 'finished')
  expect(s({ isErrored: true, isInterrupted: true })).toMatchObject({ state: 'failed', ui: 'failed' })
  expect(s({ isInterrupted: true })).toMatchObject({ state: 'dead', ui: 'blocked' })
  expect(phaseOf(call(), 'finished')).toMatchObject({ state: 'running', ui: 'running' })
  expect(s({})).toMatchObject({ state: 'finished', ui: 'done' })
})

test('interrupted card says so; flatten walks nested output', () => {
  expect(text(workerCard(call({ isRunning: false, isInterrupted: true }), 'dead')!)).toContain('interrupted')
  expect(resultLine([{ text: 'a' }, { content: ['STATUS: OK'] }, 5])).toBe('STATUS: OK')
})

test('narrow wave stacks cards', () => {
  const calls = [call(), call()]
  expect(props((waveTree(calls, 2, 60) as { children: unknown[] }).children[1])).toMatchObject({ flexDirection: 'column' })
})

test('denied dispatch: failed in the border, the first sentence of the reason, goal from the GOAL: line only', () => {
  const prompt = 'GOAL: list files in /tmp. TOOLS: ToolSearch lean-ctx (ctx_tree). DELIVERABLE: list. SUCCESS CRITERIA: list returned.'
  const output = 'Error: PreToolUse:Agent hook error: DENY - this dispatch to atlas:explorer has no `SCOPE: <class>/<effort>` line. Classify the task, then resolve its team:\n  python3 x'
  const c = workerCard(call({ input: { subagent_type: 'atlas:explorer', prompt, model: 'sonnet', effort: 'low' }, isRunning: false, isErrored: true, output }), 'failed', 120)!
  const t = text(c)
  expect(rowsOf(c)[0]).toContain('failed explorer')
  expect(t).toContain('denied: this dispatch to atlas:')
  expect(t).not.toContain('Classify the task')
  expect(t).toContain('list files in /tmp.')
  expect(t).not.toContain('TOOLS:')
  expect(t).not.toContain('DELIVERABLE')
})

test('goalLine stops at the next ALL-CAPS label on a one-line prompt', () => {
  expect(goalLine({ prompt: 'GOAL: do x. TOOLS: a. OUT OF SCOPE: b' })).toBe('do x.')
})

test('phaseOf maps a finished call by its worker state, not the idle fallback', () => {
  expect(phaseOf(call({ isRunning: false, isInterrupted: true }), 'dead').ui).toBe('blocked')
  expect(phaseOf(call({ isRunning: false }), 'finished').ui).toBe('done')
  expect(phaseOf(call({ isRunning: false, isErrored: true }), 'failed').ui).toBe('failed')
})

test('card rows are fixed-size boxes; a returned worker reads done, never finished-as-done twice', () => {
  const running = workerCard(call(), 'running', 60, undefined, '', { now: 'x' })!
  for (const row of (running as El).children) expect(row.props.flexShrink).toBe(0)
  expect(rowsOf(running)[0]).toMatch(/^┌─ ◆ running impl-a/u)
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished', 60)!
  expect(rowsOf(done)[0]).toContain('done impl-a')
})

test('bubble body lines are fitted to the columns less the 3-cell gutter', () => {
  const long = 'abcdefghijklmnopqrstuvwxyz'
  const b = bubbleTree(long, 'a', 'lead', 12)!
  expect(text(b)).toContain(fitText(long, 9))
  expect(text(b)).not.toContain(long)
})

const LONG = 'word '.repeat(60).trim()
const DENIED = `Error: PreToolUse:Agent hook error: DENY - ${LONG}.`
const longCall = (over: Partial<CallLike> = {}): CallLike =>
  call({ input: { subagent_type: 'atlas:implementer', name: 'impl-a', prompt: `GOAL: ${LONG}`, model: 'sonnet' }, ...over })

test('every card is a closed box as wide as asked up to the design 44, at 30 to 120 columns, every state, long text', () => {
  for (const width of [30, 44, 60, 80, 120]) {
    const cards = [
      workerCard(longCall(), 'running', width, undefined, '', { now: LONG }),
      workerCard(longCall({ isRunning: false, isErrored: true, output: DENIED }), 'failed', width),
      workerCard(longCall({ isRunning: false, output: LONG }), 'finished', width),
      workerCard(longCall({ isRunning: false, isErrored: true, output: LONG }), 'failed', width),
    ]
    for (const card of cards) {
      const rows = rowsOf(card)
      expect(rows[0]!.startsWith('┌')).toBe(true)
      expect(rows[0]!.endsWith('┐')).toBe(true)
      expect(rows.at(-1)!.startsWith('└')).toBe(true)
      expect(rows.at(-1)!.endsWith('┘')).toBe(true)
      for (const r of rows.slice(1, -1)) { expect(r.startsWith('│')).toBe(true); expect(r.endsWith('│')).toBe(true) }
      for (const r of rows) expect([width, textWidth(r)]).toEqual([width, Math.min(width, W)]) // the design card is 44 wide at most
    }
  }
})

test('a card with no width is the design 44 columns', () => {
  for (const r of rowsOf(workerCard(call(), 'running')!)) expect(textWidth(r)).toBe(W)
})

test('side-by-side wave cards fit the columns between them; below two boxes of room they stack', () => {
  for (const columns of [120, 160]) {
    const w = waveTree([longCall(), longCall({ isRunning: false, output: LONG })], 1, columns)!
    const strip = (w as El).children[1]!
    expect(strip.props.flexDirection).toBe('row')
    const widest = strip.children.map((card) => Math.max(...rowsOf(card).map(textWidth)))
    expect(widest.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(columns)
  }
  const narrow = waveTree([longCall(), longCall()], 1, 80)!
  expect(((narrow as El).children[1]!).props.flexDirection).toBe('column')
})

test('a wave whose workers all returned is headed finished, never done', () => {
  const calls = [call({ isRunning: false, output: 'STATUS: DONE' }), call({ isRunning: false, output: 'STATUS: DONE' })]
  expect(text((waveTree(calls, 3, 160) as El).children[0])).toBe('WAVE 3 · 2 workers · finished')
  expect(text((waveTree([call(), calls[0]!], 3, 160) as El).children[0])).toBe('WAVE 3 · 2 workers · 1 running')
})

test('the outcome of a background worker is the last row, led by its label', () => {
  const launch = call({ isRunning: false, output: { status: 'async_launched', agentId: 'a1' } })
  const lastRow = (ended: string, outcome: string): string => rowsOf(workerCard(launch, 'finished', 60, undefined, '', { ended, outcome })!).slice(1, -1).join('\n')
  expect(lastRow('finished', 'STATUS: DONE · 29s')).toContain('last  STATUS: DONE · 29s')
})

test('a killed or failed background worker reads failed in the border; a finished one reads done', () => {
  const launch = call({ isRunning: false, output: { status: 'async_launched', agentId: 'a1' } })
  const card = (ended: string) => workerCard(launch, 'finished', 60, undefined, '', { ended, outcome: '' })!
  for (const ended of ['killed', 'failed']) expect([ended, rowsOf(card(ended))[0]!.includes('failed impl-a')]).toEqual([ended, true])
  expect(rowsOf(card('finished'))[0]).toContain('done impl-a')
})

test('the notification row is state, name, role and outcome', () => {
  expect(text(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false))).toMatch(/^▌ ◆ ATLAS {2}● done {2}wave-a {2}explorer STATUS: DONE/)
  expect(text(notificationTree('wave-a', 'explorer', 'boom', true))).toMatch(/^▌ ◆ ATLAS {2}■ failed {2}wave-a/)
})

test('a boxed card shows the whole agent name: the model tag goes before the name is cut (L14)', () => {
  const long = call({ input: { subagent_type: 'atlas:explorer', name: 'board-auditor-open-items', description: 'd', prompt: PROMPT, model: 'haiku', effort: 'low' } })
  const out = text(workerCard(long, 'running')!)
  expect(out).toContain('board-auditor-open-items')
  expect(out).not.toContain('board-auditor-open-items...')
})

test('both card formats show the lead as `lead`, not its session hash name', () => {
  expect(text(notificationTree('lead-a3a3ab', 'lead', 'ok', false))).toContain('lead')
  expect(text(notificationTree('lead-a3a3ab', 'lead', 'ok', false))).not.toContain('a3a3ab')
  const c = call({ input: { subagent_type: 'atlas:explorer', name: 'lead-a3a3ab', description: 'd', prompt: PROMPT } })
  expect(text(workerCard(c, 'running')!)).not.toContain('a3a3ab')
})

test('C6: on a 256-colour terminal the card fills are stable palette colours, never the raw panel hex (navy 17 on the host)', () => {
  const card = workerCard(call(), 'running', 60, undefined, '', { ui: { theme: 'mocha', ascii: false, color: '256' } })
  const hexes = [...JSON.stringify(card).matchAll(/"backgroundColor":"(#[0-9a-f]{6})"/g)].map((x) => x[1]!)
  expect(hexes.length).toBeGreaterThan(0)
  for (const b of hexes) expect([b, hostTo256(b), hostTo256(b) === 17]).toEqual([b, hexTo256(b), false])
})
