// Critique 23, step 2: 37 raw `● ATLAS | <emoji> <phase> | <state>` frames in 11 of 12 runs of build 513bb41c, after a restyle.tsx change that answers the AssistantMessage site synchronously.
// Root cause: the answer was never the late one. While a reply streams the host paints every flushed batch of whole lines itself and asks `ui.render` for the message only once the
// message is complete: live-110-513bb41c-1 f0062, f0063 and f0064 (three 0.5 s frames) show the raw header row while the body streams under it in the host's own indent, and f0065
// shows the chip. The one host event that sees those batches is the classic `MessageDisplay`; it rewrites a batch for the screen alone. This pins the exact sequences the frames show.
import { expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import contract from '../../contracts/operating-contract.json'
import type { AtlasSnapshot } from '../contract'
import { assistantTree, forgetDrawnHeaders, forgetHeaderPattern, registerRestyle } from '../restyle'
import { displayDelta, leadOf, partialLead } from './leadheader'

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
const RAW = /ATLAS \||[\u{1F300}-\u{1FAFF}⛔✅]/u

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
  expect(out[0]).toBe('research · 0/3 explorers returned\n\nThe three atlas:explorer agents (alpha, beta, gamma) are\nrunning in the background.\n')
  expect(out[1]).toBe(STREAM[1]!.delta)
  expect(out[2]).toBe('')
})

test('C23: a reply that is the header alone (first and final flush at once) is rewritten too', async () => {
  const shown = display()
  expect(await shown(DONE_ONLY)).toBe('done · all finished')
  expect(RAW.test(await shown({ index: 0, final: true, delta: 'ATLAS | 🔍 research 3/5 | 3/5 dispatched' }))).toBe(false)
  expect(await shown({ index: 0, final: true, delta: 'ATLAS | 🔍 research 3/5 | 3/5 dispatched' })).toBe('research 3/5 · 3/5 dispatched')
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
  expect(await shown({ index: 0, final: true, delta: 'x' }, { displayContent: 'ATLAS | 🏁 done | other' })).toBe('done · other')
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
  expect(leadOf('▌ done · all finished', '')?.phase).toBe('done')
  expect(leadOf('ATLAS | 🏁 done | all finished', '')).toBeNull()
})

test('a phase-first header (`ATLAS | done 🏁 | ...`) parses like the glyph-first one, whole and streaming', () => {
  expect(leadOf('ATLAS | done 🏁 | all finished', pattern)?.phase).toBe('done')
  expect(leadOf('ATLAS | implement 🔧 3/5 | working', pattern)?.count).toBe('3/5')
  expect(displayDelta('ATLAS | done 🏁 | all finished\nbody', pattern)).toBe('done · all finished\nbody')
  const ui = { theme: 'dark', ascii: false, color: 'none' } as const
  expect(flat(partialLead('ATLAS | done 🏁', ui)!)).toBe(flat(partialLead('ATLAS | 🏁 done', ui)!))
  expect(flat(partialLead('ATLAS | done 🏁', ui)!)).toContain('done')
})
