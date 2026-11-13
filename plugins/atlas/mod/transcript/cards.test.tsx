// Golden tests for transcript/cards.tsx: worker cards, wave strips, channel bubbles.
import { expect, test } from 'claude-code/testing'
import { fitText, textWidth } from '../theme'
import { hexTo256, hostTo256, runHex, uiFromEnv } from '../atlas-ui'
import { bubbleTree, notificationTree, waveTree, workerCard, goalLine, resultLine, phaseOf, stripStatus } from './cards'
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

// Critique 16 C3: one card style. The dispatch card is the rail card the finish uses (toastRuns): `▌ ◐ running  name  what it does  tag` (no brand: only the finish card carries `◆ ATLAS`), one row, never a box.
test('running card: the rail card, the state word and name, what it is doing, then the model tag', () => {
  const c = workerCard(call(), 'running', 60, undefined, '', { now: 'Grep auth/ 12s', wave: 2 })!
  const rows = rowsOf(c)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/^▌ ⠋ running {2}impl-a {2}Grep auth\/ 12s {2}sonnet$/u) // wave 32: the start card is the band's braille (frame 0 here), not a static `◐`
  expect(textWidth(rows[0]!)).toBeLessThanOrEqual(60)
  expect(text(c)).not.toMatch(/[┌┐└┘│]/u) // no box anywhere
  expect(props(c).borderStyle).toBeUndefined()
})

test('the rail bar takes the state hue: running, done and failed differ; the state word stays plain text', () => {
  const frame = (c: unknown): unknown => (((c as El).children[0]!.children[0]!).props as Record<string, unknown>).color
  const run = frame(workerCard(call(), 'running')!)
  const done = frame(workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished')!)
  const bad = frame(workerCard(call({ isRunning: false, isErrored: true }), 'failed')!)
  expect(new Set([run, done, bad]).size).toBe(3)
  expect(bad).toBe(runHex({ tone: 'bad' }, 'mocha', uiFromEnv().color)) // the bad tone in the depth the card is drawn in
})

test('done card shows the result line after the name; errored reads killed in the state word (wave 30)', () => {
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished')!
  expect(rowsOf(done)[0]).toContain('done     impl-a')
  expect(text(done)).not.toContain('STATUS')
  expect(text(done)).not.toContain('DONE')
  const bad = workerCard(call({ isRunning: false, isErrored: true }), 'failed')!
  expect(rowsOf(bad)[0]).toContain('killed   impl-a')
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

test('denied dispatch: killed in the state word, the first sentence of the reason, no goal text', () => {
  const prompt = 'GOAL: list files in /tmp. TOOLS: ToolSearch lean-ctx (ctx_tree). DELIVERABLE: list. SUCCESS CRITERIA: list returned.'
  const output = 'Error: PreToolUse:Agent hook error: DENY - this dispatch to atlas:explorer has no `SCOPE: <class>/<effort>` line. Classify the task, then resolve its team:\n  python3 x'
  const c = workerCard(call({ input: { subagent_type: 'atlas:explorer', prompt, model: 'sonnet', effort: 'low' }, isRunning: false, isErrored: true, output }), 'failed', 120)!
  const t = text(c)
  expect(rowsOf(c)[0]).toContain('killed   explorer')
  expect(t).toContain('denied: this dispatch to atlas:')
  expect(t).not.toContain('Classify the task')
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

test('the card row is fixed-size; a returned worker reads done, never finished-as-done twice', () => {
  const running = workerCard(call(), 'running', 60, undefined, '', { now: 'x' })!
  for (const row of (running as El).children) expect(row.props.flexShrink).toBe(0)
  expect(rowsOf(running)[0]).toMatch(/^▌ ⠋ running {2}impl-a/u)
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE' }), 'finished', 60)!
  expect(rowsOf(done)[0]).toContain('done     impl-a')
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

test('every card is one rail row no wider than asked, up to 100, at 30 to 120 columns, every state, long text', () => {
  for (const width of [30, 44, 60, 80, 120]) {
    const cards = [
      workerCard(longCall(), 'running', width, undefined, '', { now: LONG }),
      workerCard(longCall({ isRunning: false, isErrored: true, output: DENIED }), 'failed', width),
      workerCard(longCall({ isRunning: false, output: LONG }), 'finished', width),
      workerCard(longCall({ isRunning: false, isErrored: true, output: LONG }), 'failed', width),
    ]
    for (const card of cards) {
      const rows = rowsOf(card)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.startsWith('▌ ')).toBe(true)
      expect(rows[0]!).not.toContain('ATLAS') // a launch card carries no brand
      for (const r of rows) expect(textWidth(r)).toBeLessThanOrEqual(Math.min(width, 100)) // a rail row never outgrows its room, nor 100 cells
    }
  }
})

test('a short card with no width fits the design 44 columns', () => {
  for (const r of rowsOf(workerCard(call(), 'running')!)) expect(textWidth(r)).toBeLessThanOrEqual(W)
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

test('the outcome of a background worker follows its name on the rail row', () => {
  const launch = call({ isRunning: false, output: { status: 'async_launched', agentId: 'a1' } })
  const row = (ended: string, outcome: string): string => rowsOf(workerCard(launch, 'finished', 60, undefined, '', { ended, outcome })!)[0]!
  expect(row('finished', 'STATUS: DONE · 29s')).toContain('impl-a  29s')
})

test('a killed or failed background worker reads killed on the rail; a finished one reads done', () => {
  const launch = call({ isRunning: false, output: { status: 'async_launched', agentId: 'a1' } })
  const card = (ended: string) => workerCard(launch, 'finished', 60, undefined, '', { ended, outcome: '' })!
  for (const ended of ['killed', 'failed']) expect([ended, rowsOf(card(ended))[0]!.includes('killed   impl-a')]).toEqual([ended, true])
  expect(rowsOf(card('finished'))[0]).toContain('done     impl-a')
})

test('the notification row is state, name, role and outcome', () => {
  // Wave 31: a finish card is one row, the one-line shape the capture scorer reads.
  const title = (n: unknown): string => text((n as El).children[0])
  expect(title(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false))).toMatch(/^▌ ◆ ATLAS {2}● done {2}wave-a$/) // wave 32: no `explorer finished` after the name
  expect(title(notificationTree('wave-a', 'explorer', 'boom', true))).toMatch(/^▌ ◆ ATLAS {2}■ killed {2}wave-a/)
})

// Critique 19 B4 (stoprun-150-232567af-3/f0132.ans:4, -1/f0093.ans:15 vs :20): one verb per card, and a failure keeps its red glyph and word as it ages.
const parts = (n: unknown): Array<{ t: string; color: unknown }> => {
  const o = n as { type?: string; props?: Record<string, unknown>; children?: unknown }
  if (Array.isArray(n)) return n.flatMap(parts)
  if (!o || typeof o !== 'object') return []
  if (o.type === 'Text') return [{ t: text(o.children), color: o.props?.color }]
  return parts(o.children)
}
test('B4: a killed worker reads one verb: `killed name · 6s`, not `failed name explorer killed · 6s`', () => {
  const card = text(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true))
  expect(card).not.toContain('\n')
  expect(card).toMatch(/■ killed {2}ghost-explorer\s+0:06$/)
  expect(card).not.toContain('failed')
  expect(text(notificationTree('ghost-explorer', 'explorer', 'failed · tests red · 6s', true))).toMatch(/■ killed {2}ghost-explorer\s+0:06$/) // the result line lives in the HUD's RESULT column, not on the card
})
test('B4: an aged failure card is drawn exactly as a fresh one (critique 26: one text grey on every card)', () => {
  const fresh = parts(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true, uiFromEnv(), false))
  const aged = parts(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true, uiFromEnv(), true))
  const at = (xs: typeof fresh, w: string) => xs.find((x) => x.t.trim() === w)!
  expect(at(aged, '■').color).toBe(at(fresh, '■').color)
  expect(at(aged, 'killed').color).toBe(at(fresh, 'killed').color)
  expect(at(aged, 'ghost-explorer').color).toBe(at(fresh, 'ghost-explorer').color)
})

test('the card shows the whole agent name: the model tag goes before the name is cut (L14)', () => {
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

test('B3: a raw STATUS: <WORD> caps prefix never prints on a card; the state word carries it', () => {
  expect(stripStatus('STATUS: DONE')).toBe('')
  expect(stripStatus('STATUS: DONE - read alpha.py')).toBe('read alpha.py')
  expect(stripStatus('STATUS: COMPLETE · 29s')).toBe('29s')
  expect(stripStatus('STATUS: BLOCKED needs a tmux team')).toBe('blocked: needs a tmux team')
  expect(stripStatus('STATUS: FAILED')).toBe('failed')
  expect(stripStatus('read alpha.py')).toBe('read alpha.py')
  const done = workerCard(call({ isRunning: false, output: 'STATUS: DONE - read alpha.py' }), 'finished', 60)!
  expect(rowsOf(done)[0]).toContain('done     impl-a')
  expect(text(done)).toContain('impl-a  read alpha.py')
  expect(text(done)).not.toMatch(/STATUS|DONE/)
})
