// The reply header line draws as `ATLAS <glyph> <phase> | <state>`, the whole line in the phase colour (17.14.0 redesign had dropped the brand, the glyph and the line colour).
import { expect, test } from 'claude-code/testing'
import contract from '../../../contracts/operating-contract.json'
import { HEADER_FIRST_LINE_PATTERN } from '../../contract-pattern'
import { assistantTree, forgetDrawnHeaders } from './restyle'
import { displayDelta } from './leadheader'
import type { AtlasSnapshot } from '../../contract'
import type { Ui } from '../../atlas-ui'
import { describe } from 'claude-code/testing';

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

describe('header-chip', () => {
// Critique 7 B6: the raw `ATLAS | <glyph> <phase> | <state>` header line renders as a chip from the first frame the mod is asked to draw it.
// The mod side has no delay: assistantTree decides from the text and the contract pattern alone. These tests pin that with the SHIPPED contract
// pattern and the exact first lines the live runs showed raw for 3-5 frames (150-1 f0128-f0130, 150-3 f0123-f0127, 110-3 f0098-f0100).

const pattern = (contract as { headerFirstLinePattern: string }).headerFirstLinePattern;
const snap = { contract: { headerFirstLinePattern: pattern } } as unknown as AtlasSnapshot;
const chipped = (text: string): boolean => assistantTree(snap, { text, isFirstOfReply: true }, 100) !== null;

const LIVE = [
  'ATLAS | ⛔ blocked | Stop gate open: the run used in-process Agent calls, and no tmux team record exists',
  'ATLAS | ⛔ blocked | team gate open, work done',
  'ATLAS | 🏁 done | 5/5',
  'ATLAS | ✅ verify | scenario steps run; team gate still open',
];

test('B6 (wave 24): a still-streaming first line is a chip from the first `ATLAS |` on, so no raw `● ATLAS | ...` frame is drawn', () => {
  // Critique 21: 22 raw header frames in 11 of 12 runs. The strict pattern needs one non-space character after the second pipe; before it the brand pill
  // draws alone (then with the phase pill once the phase word is whole), and from the state's first character the strict pattern takes over. Only a line
  // too short to be told from prose (`ATLAS`, `ATLAS |` without its space) stays the host's own row.
  const full = LIVE[0]!;
  const cut = full.indexOf('| Stop') + 2;
  const frames = Array.from({ length: full.length - 'ATLAS |'.length + 1 }, (_, k) => full.slice(0, 'ATLAS |'.length + k));
  expect(frames.filter((f) => !chipped(f))).toEqual([]);
  expect(chipped(full.slice(0, cut))).toBe(true);
  expect(chipped(full.slice(0, cut + 1))).toBe(true);
  for (const f of ['A', 'ATLAS', 'ATLAS ', 'ATLA']) expect([f, chipped(f)]).toEqual([f, false]);
  expect(chipped('ATLAS | x | y\nbody')).toBe(false); // a finished first line that is no header stays the host's
});

// Critique 11 C3: 15 raw `● ATLAS | ...` frames at build 5d6a53ef. These are the complete first lines of those frames (live-150-5d6a53ef-2 f0043-f0044,
// live-110-5d6a53ef-1 f0040-f0041, and the single-frame ones). The text was whole when the host drew it raw and the same text is a chip two frames later,
// so detection is not what missed: the mod's decision is a pure function of the text and the contract pattern, and it chips every one on the first call.
// The raw frame is the host drawing a new message before the async `ui.render` hook (one `await read`) has answered; the host gives the mod no earlier site.
const LIVE_11 = [
  'ATLAS | 🔍 research | step 2 done: 3 explorers running, 0 of 3 returned',
  'ATLAS | 🔍 research | 0/3 explorers returned; plan on board (5 open)',
  'ATLAS | 🔍 research | 0/3 explorers returned, board 0/5',
  'ATLAS | 🔍 research | 3/5 dispatched, waiting on explorers',
  'ATLAS | 🔍 research | 3/3 explorers returned, board updating T2 then T3',
  'ATLAS | 🏁 done | 5/5 board items complete',
];

test('C3: every first line the 5d6a53ef live runs drew raw is a chip on the first call, at 110 and 150 columns, alone or with a body', () => {
  for (const line of LIVE_11) for (const cols of [110, 150]) {
    expect([line, cols, assistantTree(snap, { text: line }, cols) !== null]).toEqual([line, cols, true]);
    expect([line, cols, assistantTree(snap, { text: `${line}\n\nbody`, isFirstOfReply: true }, cols) !== null]).toEqual([line, cols, true]);
  }
});
});
