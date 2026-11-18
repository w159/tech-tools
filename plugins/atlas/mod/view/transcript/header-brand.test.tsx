// The reply header line draws as `ATLAS <glyph> <phase> | <state>`, the whole line in the phase colour (17.14.0 redesign had dropped the brand, the glyph and the line colour).
import { expect, test } from 'claude-code/testing'
import contract from '../../../contracts/operating-contract.json'
import { HEADER_FIRST_LINE_PATTERN } from '../../contract-pattern'
import { assistantTree, forgetDrawnHeaders } from './restyle'
import { displayDelta } from './leadheader'
import type { AtlasSnapshot } from '../../contract'
import type { Ui } from '../../atlas-ui'

const snap = { contract: { headerFirstLinePattern: HEADER_FIRST_LINE_PATTERN } } as unknown as AtlasSnapshot
const glyphOf = (phase: string): string => (contract as { phases: { id: string; glyph: string }[] }).phases.find((p) => p.id === phase)!.glyph
type Node = { type?: string; props?: { color?: string }; children?: (Node | string)[] }
const kids = (n: Node): (Node | string)[] => n.children ?? []
// every Text run of the tree, in order, with its colour
const texts = (n: Node | string): { t: string; color?: string }[] => {
  if (typeof n === 'string') return [{ t: n }]
  return n.type === 'Text' ? [{ t: kids(n).join(''), color: n.props?.color }] : kids(n).flatMap(texts)
}
const draw = (phase: string, state: string, color: Ui['color'] = 'truecolor') => {
  forgetDrawnHeaders()
  const tree = assistantTree(snap, { text: `ATLAS | ${glyphOf(phase)} ${phase} | ${state}`, isFirstOfReply: true }, 120, false, { theme: 'mocha', ascii: false, color })!
  return texts(tree as Node).filter((x) => x.t.trim() !== '')
}

for (const [phase, state] of [['implement', 'wiring the gate'], ['blocked', 'stop gate open']] as const) {
  test(`header for ${phase} shows ATLAS, glyph, phase and state in one phase colour`, () => {
    const runs = draw(phase, state)
    const line = runs.map((r) => r.t).join(' ')
    for (const want of ['ATLAS', glyphOf(phase), phase, state]) expect(line).toContain(want)
    // the brand, glyph, phase word and state all carry the same colour (the bar is not the only coloured run)
    for (const want of ['ATLAS', glyphOf(phase), phase, state]) {
      const run = runs.find((r) => r.t.includes(want))!
      expect([want, run.color]).toEqual([want, runs[0]!.color])
    }
    expect(runs[0]!.color).toBeTruthy()
  })
}

test('implement and blocked use different line colours', () => {
  expect(draw('implement', 'x')[0]!.color).not.toBe(draw('blocked', 'x')[0]!.color)
})

test('no colour: the text is still complete and carries no colour', () => {
  const runs = draw('implement', 'wiring the gate', 'none')
  const line = runs.map((r) => r.t).join(' ')
  for (const want of ['ATLAS', glyphOf('implement'), 'implement', 'wiring the gate']) expect(line).toContain(want)
  expect(runs.filter((r) => r.color !== undefined)).toEqual([])
})

test('every phase draws its contract glyph', () => {
  for (const { id, glyph } of (contract as { phases: { id: string; glyph: string }[] }).phases) expect(draw(id, 's').map((r) => r.t).join(' ')).toContain(glyph)
})

test('the streaming line and the final chip show the same brand, glyph and phase', () => {
  const raw = `ATLAS | ${glyphOf('implement')} implement 3/5 | wiring the gate`
  const streamed = displayDelta(raw, HEADER_FIRST_LINE_PATTERN)!
  expect(streamed).toBe('ATLAS 🔧 implement 3/5 | wiring the gate')
  const chip = draw('implement', 'wiring the gate').map((r) => r.t).join(' ')
  for (const part of ['ATLAS', glyphOf('implement'), 'implement']) expect([part, streamed.includes(part), chip.includes(part)]).toEqual([part, true, true])
  expect(displayDelta(raw, HEADER_FIRST_LINE_PATTERN, true)).toBe('ATLAS implement 3/5 | wiring the gate')
})


test('the bold-brand markdown form draws the same chip as the plain form', () => {
  const chip = (text: string) => {
    forgetDrawnHeaders()
    const tree = assistantTree(snap, { text, isFirstOfReply: true }, 120, false, { theme: 'mocha', ascii: false, color: 'truecolor' })!
    return texts(tree as Node).filter((x) => x.t.trim() !== '')
  }
  expect(chip('**ATLAS** | 🔧 implement 3/5 | wiring the gate')).toEqual(chip('ATLAS | 🔧 implement 3/5 | wiring the gate'))
})

test('a leading blank line or space still draws the chip, and the body after the header is kept', () => {
  forgetDrawnHeaders()
  const text = '\n  ATLAS | 🔧 implement | wiring the gate\nbody line'
  const tree = assistantTree(snap, { text, isFirstOfReply: true }, 120, false, { theme: 'mocha', ascii: false, color: 'truecolor' })!
  const line = JSON.stringify(tree) // the body is a Markdown element, which `texts` does not walk
  for (const want of ['ATLAS', '🔧', 'implement', 'wiring the gate', 'body line']) expect(line).toContain(want)
})

test('a header with no glyph is no chip', () => {
  forgetDrawnHeaders()
  expect(assistantTree(snap, { text: 'ATLAS | implement | wiring the gate', isFirstOfReply: true }, 120, false, { theme: 'mocha', ascii: false, color: 'truecolor' })).toBeNull()
})

test('each of the eight phases draws in its own colour (latte has a distinct hex per tone)', () => {
  const colours = (contract as { phases: { id: string; glyph: string }[] }).phases.map(({ id, glyph }) => {
    forgetDrawnHeaders()
    const tree = assistantTree(snap, { text: `ATLAS | ${glyph} ${id} | s`, isFirstOfReply: true }, 120, false, { theme: 'latte', ascii: false, color: 'truecolor' })!
    return texts(tree as Node).filter((x) => x.t.trim() !== '')[0]!.color
  })
  expect(new Set(colours).size).toBe(8)
})
