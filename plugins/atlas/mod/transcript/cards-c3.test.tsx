// Design rev 5, slice C3: one rail style for dispatch, done, failed and killed cards: `▌` in the state colour, the state word in a fixed-width column so the name starts
// at the same column on every card, and a failed card keeps its error colour (rail, glyph, word) as it ages.
import { expect, test } from 'claude-code/testing'
import { uiFromEnv } from '../atlas-ui'
import { notificationTree, workerCard, type CallLike } from './cards'

const ui = { ...uiFromEnv({}), color: 'truecolor' as const }
type El = { props: Record<string, unknown>; children: unknown[] }
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text((n as El).children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '')
const cellsOf = (n: unknown): El[] => (((n as El).children.length > 1 ? (n as El).children[1] : (n as El).children[0]) as El).children as El[] // a launch card is a column of one row; a finish card is a framed block whose title row is the second
const call = (over: Partial<CallLike> = {}): CallLike => ({ tool: 'Agent', input: { subagent_type: 'atlas:implementer', name: 'impl-a', description: 'desc', prompt: 'GOAL: x', model: 'sonnet' }, isRunning: true, isErrored: false, isInterrupted: false, ...over })

const title = (n: unknown): string => text((n as El).children[0]) // wave 31: a finish card is one row
const cards = (): Record<string, string> => ({
  dispatch: text(workerCard(call(), 'running', 80, undefined, '', { ui, now: 'Grep 12s' })),
  done: title(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false, ui)),
  failed: title(notificationTree('wave-b', 'explorer', 'boom', true, ui)),
  killed: title(notificationTree('wave-c', 'explorer', 'killed · 6s', true, ui)),
  doneAged: title(notificationTree('wave-d', 'explorer', 'STATUS: DONE', false, ui, true)),
  failedAged: title(notificationTree('wave-e', 'explorer', 'boom', true, ui, true)),
})

test('C3: every card opens with the rail; the finish cards carry the brand `◆ ATLAS  ` and the dispatch card does not', () => {
  const c = cards()
  for (const k of Object.keys(c)) expect(c[k]!.startsWith('▌ ')).toBe(true)
  for (const k of ['done', 'failed', 'killed', 'doneAged', 'failedAged']) expect(c[k]!).toContain('◆ ATLAS  ')
  expect(c.dispatch).not.toContain('◆ ATLAS')
})

test('C3: the state word is followed by two spaces and the name, whatever the word', () => {
  const c = cards()
  expect(c.done).toMatch(/● done {2}wave-a/)
  expect(c.failed).toMatch(/failed {2}wave-b/)
  expect(c.killed).toMatch(/failed {2}wave-c/)
  expect(c.dispatch).toMatch(/running {2}impl-a/)
})

test('C3: the rail is one colour on every card kind and fades with age (wave 33), and a failed card keeps the error colour on glyph and word as it ages', () => {
  const fresh = cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui))
  const aged = cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui, true))
  const word = (cs: El[]): El => cs.find((x) => text(x) === 'failed')!
  expect(aged[0]!.props.color).toBe(fresh[0]!.props.color) // the rail
  expect(word(aged).props.color).toBe(word(fresh).props.color)
  expect(word(aged).props.color).not.toBe(cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui, true)).find((x) => text(x).includes('wave-b'))!.props.color)
  expect(cellsOf(notificationTree('wave-a', 'explorer', 'ok', false, ui, false, { fade: 1 }))[0]!.props.color).not.toBe(fresh[0]!.props.color) // wave 33: every card's rail fades 141 -> 245 with its age (fade), a failure's too
  expect(cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui, false, { fade: 1 }))[0]!.props.color).toBe(cellsOf(notificationTree('wave-a', 'explorer', 'ok', false, ui, false, { fade: 1 }))[0]!.props.color)
})
