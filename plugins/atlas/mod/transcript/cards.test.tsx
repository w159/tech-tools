// Golden tests for transcript/cards.tsx: worker cards, wave strips, channel bubbles.
import { expect, test } from 'claude-code/testing'
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

test('running card: round border, name, role, goal', () => {
  const c = workerCard(call(), 'running')!
  expect(props(c).borderStyle).toBe('round')
  const t = text(c)
  for (const s of ['◆', 'impl-a', 'implementer', 'sonnet', 'ship the thing']) expect(t).toContain(s)
})

test('done card shows the result line; errored uses the fail color', () => {
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished')!
  expect(text(done)).toContain('STATUS: DONE')
  const bad = workerCard(call({ isRunning: false, isErrored: true }), 'failed')!
  expect(props(bad).borderColor).not.toBe(props(done).borderColor)
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
