// Critique 22, step 1: the lead's own `ATLAS | <glyph> <phase> | <state>` line drew raw (`● ATLAS | ⛔ blocked | ...`) in 24 frames of 11 of 12 runs, for the one frame
// the host paints a new message before the hook answers (stoprun-150-3-2cf10943 f0122.ans:14, live-150-2cf10943-1 f0110.ans:21). The hook answered through `ready()`'s
// promise whenever nothing had primed the env read yet (a session's first reply, a turn started without our turn.start). It now answers at once from the bundled
// contract pattern, so the chip is the first thing the host receives, for the exact lines those frames show and for every prefix of them.
import { expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'
import { registerRestyle } from '../restyle'

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
    expect([line, text.includes('ATLAS'), text.includes('host row'), text.includes('|')]).toEqual([line, true, false, false])
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
  expect(text).toContain('BLOCKED')
  expect(text).not.toMatch(/ATLAS \||● ATLAS/)
})
