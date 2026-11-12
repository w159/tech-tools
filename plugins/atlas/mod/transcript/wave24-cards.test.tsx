// Wave 24, slice C step 5: a faded card keeps its state colour on the rail; a `⚑ DONE` chip a Stop refusal overturned is struck through and says so;
// a header still streaming is a chip from its first `ATLAS |`.
import { expect, test } from 'claude-code/testing'
import contract from '../../contracts/operating-contract.json'
import { uiFromEnv } from '../atlas-ui'
import type { AtlasSnapshot } from '../contract'
import { assistantTree } from '../restyle'
import { notificationTree } from './cards'
import { forgetSuperseded, noteDoneChip, noteStopVerdict } from './superseded'

const ui = { ...uiFromEnv({}), color: 'truecolor' as const }
type El = { type?: string; props: Record<string, unknown>; children?: unknown }
const walk = (n: unknown, out: El[] = []): El[] => {
  if (Array.isArray(n)) { for (const x of n) walk(x, out); return out }
  if (n && typeof n === 'object') { const e = n as El; out.push(e); walk(e.children, out) }
  return out
}
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text((n as El).children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '')
const cellsOf = (n: unknown): El[] => ((n as El).children as El[])

test('a faded done card is drawn exactly as a fresh one: one grey on every card (critique 26)', () => {
  const fresh = cellsOf(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false, ui))
  const aged = cellsOf(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false, ui, true))
  expect(text(aged[0])).toBe('▌')
  expect(aged[0]!.props.color).toBe(fresh[0]!.props.color)
  const word = (cs: El[]): El => cs.find((x) => text(x) === 'done')!
  expect(word(aged).props.color).toBe(word(fresh).props.color)
  const name = (cs: El[]): El => cs.find((x) => text(x).includes('wave-a'))!
  expect(name(aged).props.color).toBe(name(fresh).props.color)
})

const snap = { contract: { headerFirstLinePattern: (contract as { headerFirstLinePattern: string }).headerFirstLinePattern } } as unknown as AtlasSnapshot
const DONE = 'ATLAS | 🏁 done | 5/5 board items complete'

test('a header still streaming draws the bar from `ATLAS |`, then the phase word once it is whole', () => {
  const bar = text(assistantTree(snap, { text: 'ATLAS |' }, 100))
  expect(bar).toBe('▌')
  expect(text(assistantTree(snap, { text: 'ATLAS | 🏁 do' }, 100))).not.toContain('done')
  expect(text(assistantTree(snap, { text: 'ATLAS | 🏁 done | ' }, 100))).toContain('done')
  expect(text(assistantTree(snap, { text: DONE }, 100))).toContain('done')
})

test('a `⚑ DONE` chip a Stop refusal overturned is struck through and marked superseded; a fresh one is not', () => {
  const fresh = assistantTree(snap, { text: DONE }, 100)!
  expect(text(fresh)).not.toContain('superseded')
  expect(walk(fresh).some((e) => e.props.strikethrough === true)).toBe(false)
  const dead = assistantTree(snap, { text: DONE }, 100, true)!
  expect(text(dead)).toContain('superseded')
  expect(text(dead)).toContain('done') // the word stays readable
  expect(walk(dead).some((e) => e.props.strikethrough === true)).toBe(true)
})

test('the registry supersedes the done chips drawn before a Stop refusal, and not the ones drawn after it', () => {
  forgetSuperseded()
  expect(noteDoneChip('req-1')).toBe(false)
  noteStopVerdict(false)
  expect(noteDoneChip('req-1')).toBe(false)
  noteStopVerdict(true) // the refusal arrives
  expect(noteDoneChip('req-1')).toBe(true) // the chip drawn before it is overturned
  expect(noteDoneChip('req-2')).toBe(false) // a finish after the refusal stands
  noteStopVerdict(true) // the same verdict read again changes nothing
  expect(noteDoneChip('req-2')).toBe(false)
  expect(noteDoneChip(undefined)).toBe(false) // no id, nothing to tell apart
  forgetSuperseded()
})
