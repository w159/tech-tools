// Critique 23, step 2: 37 raw `● ATLAS | <emoji> <phase> | <state>` frames in 11 of 12 runs of build 513bb41c, after a restyle.tsx change that answers the AssistantMessage site synchronously.
// Root cause: the answer was never the late one. While a reply streams the host paints every flushed batch of whole lines itself and asks `ui.render` for the message only once the
// message is complete: live-110-513bb41c-1 f0062, f0063 and f0064 (three 0.5 s frames) show the raw header row while the body streams under it in the host's own indent, and f0065
// shows the chip. The one host event that sees those batches is the classic `MessageDisplay`; it rewrites a batch for the screen alone. This pins the exact sequences the frames show.
import { expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import contract from '../../../contracts/operating-contract.json'
import type { AtlasSnapshot } from '../../contract'
import { HEADER_FIRST_LINE_PATTERN } from '../../contract-pattern'
import { assistantTree, forgetDrawnHeaders, forgetHeaderPattern, noteHeaderPattern, registerRestyle } from './restyle'
import { displayDelta, leadOf, partialLead } from './leadheader'
import { describe } from 'claude-code/testing';

type Flush = { index: number; final: boolean; delta: string }
type Hook = (d: unknown, e: unknown, n: (x?: unknown) => unknown) => Promise<{ displayContent?: string } | undefined>
function display(env: 'on' | 'off' = 'on'): (f: Flush, prior?: { displayContent?: string }) => Promise<string> {
  let hook: Hook | undefined
  const on = ((p: unknown, a: unknown) => { if (p === 'classic.MessageDisplay') hook = a as Hook; return { catch: () => undefined } }) as unknown as On
  registerRestyle(on)
  const $ = { env: { get: () => Promise.resolve(env === 'off' ? 'off' : undefined) } } as unknown as EngineInterface
  return async (f, prior = {}) => {
    const out = await hook!($, { hook_event_name: 'MessageDisplay', turn_id: 't', message_id: 'm', ...f }, () => Promise.resolve(prior))
    return out?.displayContent ?? f.delta
  }
}

const pattern = (contract as { headerFirstLinePattern: string }).headerFirstLinePattern
const snap = { contract: { headerFirstLinePattern: pattern } } as unknown as AtlasSnapshot
type El = { children?: unknown }
const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as El).children as unknown[] ?? []).map(flat).join('') : '')
const RAW = /ATLAS \|/u // the contract form's pipe right after the brand; the display form is `ATLAS <glyph> <phase> | <state>` (17.27.1)

// live-110-513bb41c-1 f0062-f0064: the first flush holds the header and the first paragraphs; later flushes the rest of the body.
const STREAM: Flush[] = [
  { index: 0, final: false, delta: 'ATLAS | 🔍 research | 0/3 explorers returned\n\nThe three atlas:explorer agents (alpha, beta, gamma) are\nrunning in the background.\n' },
  { index: 1, final: false, delta: "Step 1 is done: the board holds the 5 open items. I'll mark T1-T3 completed.\n" },
  { index: 2, final: true, delta: '' },
]
// stoprun-150-513bb41c-3 f0130: a reply that is the header and one paragraph, and one that is only the header (its first and last flush).
const DONE_ONLY: Flush = { index: 0, final: true, delta: 'ATLAS | 🏁 done | all finished' }

test('C23: the raw header is what the host would paint for the first streamed batch (the failing precondition)', () => {
  expect(RAW.test(STREAM[0]!.delta.split('\n')[0]!)).toBe(true)
})

test('C23: every batch of the streamed reply leaves MessageDisplay without the pipes or the emoji, the body untouched', async () => {
  const shown = display()
  const out: string[] = []
  for (const f of STREAM) out.push(await shown(f))
  expect(out.filter((d) => RAW.test(d))).toEqual([])
  expect(out[0]).toBe('ATLAS 🔍 research | 0/3 explorers returned\n\nThe three atlas:explorer agents (alpha, beta, gamma) are\nrunning in the background.\n')
  expect(out[1]).toBe(STREAM[1]!.delta)
  expect(out[2]).toBe('')
})

test('C23: a reply that is the header alone (first and final flush at once) is rewritten too', async () => {
  const shown = display()
  expect(await shown(DONE_ONLY)).toBe('ATLAS 🏁 done | all finished')
  expect(RAW.test(await shown({ index: 0, final: true, delta: 'ATLAS | 🔍 research 3/5 | 3/5 dispatched' }))).toBe(false)
  expect(await shown({ index: 0, final: true, delta: 'ATLAS | 🔍 research 3/5 | 3/5 dispatched' })).toBe('ATLAS 🔍 research 3/5 | 3/5 dispatched')
})

test('C23: prose, a later batch, ATLAS_MOD=off and an unknown phase are left exactly as the host has them', async () => {
  const shown = display()
  const prose = { index: 0, final: false, delta: 'The three explorers each listed their functions.\n' }
  expect(await shown(prose)).toBe(prose.delta)
  const later = { index: 3, final: false, delta: 'ATLAS | 🏁 done | quoted in the body\n' }
  expect(await shown(later)).toBe(later.delta)
  const mystery = { index: 0, final: false, delta: 'ATLAS | x mystery | state\n' }
  expect(await shown(mystery)).toBe(mystery.delta)
  expect(await display('off')(DONE_ONLY)).toBe(DONE_ONLY.delta)
})

test("C23: another plugin's rewrite of the batch is the source, not the raw delta", async () => {
  const shown = display()
  expect(await shown({ index: 0, final: true, delta: 'x' }, { displayContent: 'ATLAS | 🏁 done | other' })).toBe('ATLAS 🏁 done | other')
})

test('C23: the transcript draws the same chip from the display form the host may hand back as the message text, and from the contract form', () => {
  forgetDrawnHeaders()
  for (const [raw, count] of [['ATLAS | 🔍 research 3/5 | 3 explorers back', '3/5'], ['ATLAS | 🏁 done | all finished', '']] as const) {
    const shown = displayDelta(raw, pattern)!
    expect(RAW.test(shown)).toBe(false)
    const a = assistantTree(snap, { text: `${raw}\n\nbody` }, 110)
    const b = assistantTree(snap, { text: `${shown}\n\nbody` }, 110)
    expect(flat(b)).toBe(flat(a))
    expect(flat(a)).toContain(count)
    expect(leadOf(shown, pattern)?.form).toBe('display')
  }
})

test('C23: with no pattern the display form is still a header and the contract form is not', () => {
  forgetHeaderPattern()
  try {
    expect(leadOf('▌ done · all finished', '')?.phase).toBe('done')
    expect(leadOf('ATLAS 🏁 done | all finished', '')?.phase).toBe('done')
    expect(leadOf('ATLAS | 🏁 done | all finished', '')).toBeNull()
  } finally {
    noteHeaderPattern(HEADER_FIRST_LINE_PATTERN) // the pattern is module state: restore the bundled one so a later file (rawheader-c22) does not see an empty pattern
  }
})

test('a phase-first header (`ATLAS | done 🏁 | ...`) parses like the glyph-first one, whole and streaming', () => {
  expect(leadOf('ATLAS | done 🏁 | all finished', pattern)?.phase).toBe('done')
  expect(leadOf('ATLAS | implement 🔧 3/5 | working', pattern)?.count).toBe('3/5')
  expect(displayDelta('ATLAS | done 🏁 | all finished\nbody', pattern)).toBe('ATLAS 🏁 done | all finished\nbody')
  const ui = { theme: 'mocha', ascii: false, color: 'none' } as const
  expect(flat(partialLead('ATLAS | done 🏁', ui)!)).toBe(flat(partialLead('ATLAS | 🏁 done', ui)!))
  expect(flat(partialLead('ATLAS | done 🏁', ui)!)).toContain('done')
})

describe('rawheader-c22', () => {
// Critique 22, step 1: the lead's own `ATLAS | <glyph> <phase> | <state>` line drew raw (`● ATLAS | ⛔ blocked | ...`) in 24 frames of 11 of 12 runs, for the one frame
// the host paints a new message before the hook answers (stoprun-150-3-2cf10943 f0122.ans:14, live-150-2cf10943-1 f0110.ans:21). The hook answered through `ready()`'s
// promise whenever nothing had primed the env read yet (a session's first reply, a turn started without our turn.start). It now answers at once from the bundled
// contract pattern, so the chip is the first thing the host receives, for the exact lines those frames show and for every prefix of them.

type Hook = (d: unknown, e: unknown, n: (x?: unknown) => unknown) => unknown
function sites(): Record<string, Hook> {
  const out: Record<string, Hook> = {}
  const on = ((_p: unknown, a: unknown, b?: unknown) => { if (b !== undefined) out[(a as { component: string }).component] = b as Hook; return { catch: () => undefined } }) as unknown as On
  registerRestyle(on)
  return out
}
// An engine that has never been asked anything: `env.get` answers later than the draw, no snapshot, no clock.
const cold = { env: { get: () => Promise.resolve(undefined) }, state: { get: async () => null } } as unknown as EngineInterface
const flat = (tree: unknown): string => {
  const out: string[] = []
  const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) walk(k) }
  walk(tree)
  return out.join('')
}
const HOST_ROW = { type: 'Text', props: {}, children: ['host row'] }
const draw = (text: string, id = 'm1'): unknown => sites().AssistantMessage!(cold, { surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text, isFirstOfReply: true }, viewport: { columns: 110 } }, () => HOST_ROW)

const LINES = [
  'ATLAS | ⛔ blocked | ghost-explorer stopped, T2 open',
  'ATLAS | 🏁 done | 5/5',
  'ATLAS | 🔍 research | 3/3 explorers returned, finishing T4 and T5',
]

test('C22: a cold hook (env never read) answers the lead header with the chip at once, not with a promise and not with the host row', () => {
  for (const line of LINES) {
    const first = draw(line)
    expect([line, first instanceof Promise]).toEqual([line, false])
    const text = flat(first)
    expect([line, text.includes('▌'), text.includes('host row'), text.includes('ATLAS |')]).toEqual([line, true, false, false])
  }
})

test('C22: every prefix of those lines, from `ATLAS |` on, is the chip on its first draw; plain prose stays the host row', () => {
  for (const line of LINES) {
    for (let n = 'ATLAS |'.length; n <= line.length; n++) {
      const first = draw(line.slice(0, n), `m${n}`)
      expect([line.slice(0, n), first instanceof Promise]).toEqual([line.slice(0, n), false])
      expect([line.slice(0, n), flat(first).includes('host row')]).toEqual([line.slice(0, n), false])
    }
  }
  expect(flat(draw('The three explorers each listed their functions.'))).toContain('host row')
})

test('C22: the chip is drawn with the raw header words gone: no `|` and no `● ` host bullet in the tree', () => {
  const text = flat(draw('ATLAS | ⛔ blocked | ghost-explorer stopped, T2 open\n\nghost-explorer was stopped before it read anything.'))
  expect(text).toContain('blocked')
  expect(text).not.toMatch(/ATLAS \||● ATLAS/)
})
});
