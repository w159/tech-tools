// Golden tests for transcript/cards.tsx: worker cards, wave strips, channel bubbles.
import { expect, test } from 'claude-code/testing'
import { fitText, stateColor } from '../theme'
import { bubbleTree, waveTree, workerCard, goalLine, resultLine, phaseOf } from './cards'
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
/** The `▌` stripe colour and the header chip of a card. */
const stripe = (c: unknown): unknown => (c as El).children[0]!.children[0]!.props.color
const chip = (c: unknown): El => (c as El).children[0]!.children[1]!

test('running card: filled panel, stripe, name chip, role · tier, goal and now rows', () => {
  const c = workerCard(call(), 'running', 80, undefined, '', { mark: '⣾', now: 'Grep auth/ · 12s · 3 tools', wave: 2 })!
  expect(props(c)).toMatchObject({ backgroundColor: '#11111b', width: 80 })
  expect(props(c).borderStyle).toBeUndefined()
  expect(text(chip(c))).toBe(' ⣾ impl-a ')
  expect(chip(c).props).toMatchObject({ backgroundColor: '#a6e3a1', color: '#1e1e2e', bold: true })
  const t = text(c)
  for (const s of ['▌', 'implementer · sonnet · wave 2', 'goal', 'ship the thing', 'now', 'Grep auth/ · 12s · 3 tools']) expect(t).toContain(s)
  for (const row of (c as El).children) expect(text(row).length).toBe(80)
})

test('done card shows the result line; errored uses the fail colour', () => {
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished')!
  expect(text(done)).toContain('STATUS: DONE')
  const bad = workerCard(call({ isRunning: false, isErrored: true }), 'failed')!
  expect(stripe(bad)).toBe('#f38ba8')
  expect(stripe(bad)).not.toBe(stripe(done))
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

test('phaseOf: errored beats interrupted beats running; else finished', () => {
  const s = (over: Partial<CallLike>) => phaseOf(call({ isRunning: false, ...over }), 'finished')
  expect(s({ isErrored: true, isInterrupted: true }).state).toBe('failed')
  expect(s({ isInterrupted: true }).state).toBe('dead')
  expect(phaseOf(call(), 'finished').state).toBe('running')
  expect(s({})).toMatchObject({ mark: '✓', state: 'finished' })
})

test('interrupted card says so; flatten walks nested output', () => {
  expect(text(workerCard(call({ isRunning: false, isInterrupted: true }), 'dead')!)).toContain('interrupted')
  expect(resultLine([{ text: 'a' }, { content: ['STATUS: OK'] }, 5])).toBe('STATUS: OK')
})

test('narrow wave stacks cards', () => {
  const calls = [call(), call()]
  expect(props((waveTree(calls, 2, 60) as { children: unknown[] }).children[1])).toMatchObject({ flexDirection: 'column' })
})

test('denied dispatch: `✖ denied` with the first sentence of the reason, no tier, goal from the GOAL: line only', () => {
  const prompt = 'GOAL: list files in /tmp. TOOLS: ToolSearch lean-ctx (ctx_tree). DELIVERABLE: list. SUCCESS CRITERIA: list returned.'
  const output = 'Error: PreToolUse:Agent hook error: DENY - this dispatch to atlas:explorer has no `SCOPE: <class>/<effort>` line. Classify the task, then resolve its team:\n  python3 x'
  const c = workerCard(call({ input: { subagent_type: 'atlas:explorer', prompt, model: 'sonnet', effort: 'low' }, isRunning: false, isErrored: true, output }), 'failed', 160)!
  const t = text(c)
  expect(t).toContain('✖ denied')
  expect(t).toContain('this dispatch to atlas:explorer has no `SCOPE: <class>/<effort>` line.')
  expect(t).not.toContain('Classify the task')
  expect(t).not.toContain('sonnet')
  expect(t).toContain('list files in /tmp.')
  expect(t).not.toContain('TOOLS:')
  expect(t).not.toContain('DELIVERABLE')
})

test('goalLine stops at the next ALL-CAPS label on a one-line prompt', () => {
  expect(goalLine({ prompt: 'GOAL: do x. TOOLS: a. OUT OF SCOPE: b' })).toBe('do x.')
})

test('phaseOf colours a finished call by its worker state, not the idle fallback', () => {
  const done = phaseOf(call({ isRunning: false }), 'dead')
  expect(done.color).toBe(stateColor('dead'));
  expect(done.color).not.toBe(stateColor('idle'));
  expect(phaseOf(call({ isRunning: false }), 'finished').color).toBe(stateColor('finished'));
})

test('card rows are fixed-size boxes with 5-wide padded labels', () => {
  const running = workerCard(call(), 'running', 60, undefined, '', { now: 'x' })!
  for (const row of (running as El).children) expect(row.props.flexShrink).toBe(0)
  const labelOf = (row: El): string => text(row.children[1])
  const rows = (running as El).children
  expect(labelOf(rows[1]!)).toBe(' goal  ')
  expect(labelOf(rows[2]!)).toBe(' now   ')
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished', 60)!
  expect(labelOf((done as El).children[2]!)).toBe(' done  ')
  const failed = workerCard(call({ isRunning: false, isErrored: true, output: 'boom' }), 'failed', 60)!
  expect(labelOf((failed as El).children[2]!)).toBe(' fail  ')
})

test('bubble body lines are fitted to the columns less the 3-cell gutter', () => {
  const long = 'abcdefghijklmnopqrstuvwxyz'
  const b = bubbleTree(long, 'a', 'lead', 12)!
  expect(text(b)).toContain(fitText(long, 9))
  expect(text(b)).not.toContain(long)
})
