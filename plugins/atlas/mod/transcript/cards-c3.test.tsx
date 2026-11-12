// Design rev 5, slice C3: one rail style for dispatch, done, failed and killed cards: `▌` in the state colour, the state word in a fixed-width column so the name starts
// at the same column on every card, and a failed card keeps its error colour (rail, glyph, word) as it ages.
import { expect, test } from 'claude-code/testing'
import { uiFromEnv } from '../atlas-ui'
import { notificationTree, workerCard, type CallLike } from './cards'

const ui = { ...uiFromEnv({}), color: 'truecolor' as const }
type El = { props: Record<string, unknown>; children: unknown[] }
const text = (n: unknown): string => (Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text((n as El).children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '')
const cellsOf = (n: unknown): El[] => ((n as El).props.flexDirection === 'column' ? ((n as El).children[0] as El) : (n as El)).children as El[] // a card is a column of one row; a notification is the row
const call = (over: Partial<CallLike> = {}): CallLike => ({ tool: 'Agent', input: { subagent_type: 'atlas:implementer', name: 'impl-a', description: 'desc', prompt: 'GOAL: x', model: 'sonnet' }, isRunning: true, isErrored: false, isInterrupted: false, ...over })

const cards = (): Record<string, string> => ({
  dispatch: text(workerCard(call(), 'running', 80, undefined, '', { ui, now: 'Grep 12s' })),
  done: text(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false, ui)),
  failed: text(notificationTree('wave-b', 'explorer', 'boom', true, ui)),
  killed: text(notificationTree('wave-c', 'explorer', 'killed · 6s', true, ui)),
  doneAged: text(notificationTree('wave-d', 'explorer', 'STATUS: DONE', false, ui, true)),
  failedAged: text(notificationTree('wave-e', 'explorer', 'boom', true, ui, true)),
})

test('C3: every card opens with the rail and its name starts at the same column', () => {
  const at = { dispatch: 'impl-a', done: 'wave-a', failed: 'wave-b', killed: 'wave-c', doneAged: 'wave-d', failedAged: 'wave-e' }
  const c = cards()
  const cols = Object.entries(at).map(([k, name]) => { expect(c[k]!.startsWith('▌ ')).toBe(true); return [k, c[k]!.indexOf(name)] })
  expect(new Set(cols.map(([, x]) => x)).size).toBe(1)
  expect(cols[0]![1]).toBeGreaterThan(0)
})

test('C3: the state word column is fixed: the word is padded to 7 cells and two spaces follow, whatever the word', () => {
  const c = cards()
  expect(c.done).toMatch(/● done {5}wave-a/)
  expect(c.failed).toMatch(/failed {3}wave-b/)
  expect(c.killed).toMatch(/killed {3}wave-c/)
  expect(c.dispatch).toMatch(/running {2}impl-a/)
})

test('C3: the rail is in the state colour on every card, and a failed card keeps the error colour on rail, glyph and word as it ages', () => {
  const fresh = cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui))
  const aged = cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui, true))
  const word = (cs: El[]): El => cs.find((x) => text(x) === 'failed')!
  expect(aged[0]!.props.color).toBe(fresh[0]!.props.color) // the rail
  expect(word(aged).props.color).toBe(word(fresh).props.color)
  expect(word(aged).props.color).not.toBe(cellsOf(notificationTree('wave-b', 'explorer', 'boom', true, ui, true)).find((x) => text(x).includes('wave-b'))!.props.color)
  expect(cellsOf(notificationTree('wave-a', 'explorer', 'ok', false, ui, true))[0]!.props.color).not.toBe(fresh[0]!.props.color) // a done card that aged is muted, the rail too
})
