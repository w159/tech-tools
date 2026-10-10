// svg.ts self-tests: well-formed SVG documents and the plain-text fallback
// across four snapshot shapes — research start, implement 3/5, blocked, empty.
import { describe, expect, test } from 'claude-code/testing'
import { trackSvg, squadSvg, trackText } from './svg'
import { BRAND } from './contract'
import { FIXTURE_CONTRACT, makeSnapshot } from './test_helpers'
import type { AtlasSnapshot, PhaseId } from './contract'

const TODO: PhaseId[] = ['research', 'implement', 'verify']

/** Glyphs chosen so the assignment's example line reproduces byte for byte. */
const THREE_PHASES = [
  { id: 'research' as PhaseId, glyph: '⬢' },
  { id: 'implement' as PhaseId, glyph: '🔧' },
  { id: 'verify' as PhaseId, glyph: '🔍' },
]

/**
 * A full AtlasSnapshot from the shared makeSnapshot helper, tuned to
 * "implement 3/5" with a three-phase contract; every field overridable.
 */
function snap(o: Partial<AtlasSnapshot> & { todoPhases?: PhaseId[] } = {}): AtlasSnapshot {
  const { todoPhases, ...rest } = o
  const base = makeSnapshot({
    phase: 'implement',
    counts: {
      done: 6,
      total: 8,
      byPhase: { research: { done: 3, total: 3 }, implement: { done: 3, total: 5 } },
    },
    squad: [
      { name: 'impl-auth', persona: 'implementer', state: 'running', source: 'task' },
      { name: 'exp-map', persona: 'explorer', state: 'idle', source: 'task' },
    ],
  })
  return {
    ...base,
    ...rest,
    contract: {
      ...FIXTURE_CONTRACT,
      phases: THREE_PHASES,
      todoPhases: todoPhases ?? TODO,
    },
  }
}

/** The shared well-formedness contract for both SVG renderers. */
function expectWellFormed(svg: string, w: number, h: number): void {
  expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}"`)).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg).not.toContain('NaN')
  expect(svg).not.toContain('undefined')
  expect(svg).toContain(`height="${h}"`)
}

describe('trackSvg', () => {
  test('research start: capsule 0/4, current diamond accent, futures hollow', () => {
    const s = snap({
      phase: 'research',
      counts: { done: 0, total: 4, byPhase: { research: { done: 0, total: 4 } } },
    })
    const svg = trackSvg(s, 600)
    expectWellFormed(svg, 600, 34)
    expect(svg).toContain('research 0/4')
    expect(svg).toContain(BRAND.accent)
    expect(svg).toContain(BRAND.dim)
  })

  test('implement 3/5: mid track, done diamonds in ok colour, marker at 6/8', () => {
    const s = snap()
    const svg = trackSvg(s, 600)
    expectWellFormed(svg, 600, 34)
    expect(svg).toContain('implement 3/5')
    expect(svg).toContain(BRAND.ok)
    expect(svg).toContain(BRAND.working)
    expect(svg).not.toContain('⛔')
  })

  test('blocked: fail-coloured capsule, red diamonds at the rail end', () => {
    const s = snap({ phase: 'blocked' })
    const svg = trackSvg(s, 600)
    expectWellFormed(svg, 600, 34)
    expect(svg).toContain('⛔ blocked')
    expect(svg).toContain(BRAND.fail)
  })

  test('empty snapshot: no phases, no squad, zero counts, still well-formed', () => {
    const s = snap({
      todoPhases: [],
      squad: [],
      phase: 'research',
      counts: { done: 0, total: 0, byPhase: {} },
    })
    const svg = trackSvg(s, 600)
    expectWellFormed(svg, 600, 34)
    expect(svg).not.toContain('Infinity')
  })

  test('deterministic: identical input, identical bytes', () => {
    const s = snap()
    expect(trackSvg(s, 600)).toBe(trackSvg(s, 600))
  })
})

describe('squadSvg', () => {
  test('chips carry the mini sprite rects, persona accent and names', () => {
    const svg = squadSvg(snap(), 600)
    expectWellFormed(svg, 600, 22)
    expect(svg).toContain('impl-auth')
    expect(svg).toContain('exp-map')
    expect(svg).toContain('<rect') // chip backgrounds
    expect(svg).toContain('width="8"') // 4px mini frame at scale 2
  })

  test('empty squad is an empty but well-formed document', () => {
    const svg = squadSvg(snap({ squad: [] }), 300)
    expectWellFormed(svg, 300, 22)
    expect(svg).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="22" viewBox="0 0 300 22" role="img"></svg>`)
  })

  test('unknown persona and odd states fall back instead of throwing', () => {
    const s = snap({
      squad: [{ name: 'a&b<c', persona: 'nobody', state: 'parked' as never, source: 'task' }],
    })
    const svg = squadSvg(s, 600)
    expectWellFormed(svg, 600, 22)
    expect(svg).toContain('a&amp;b&lt;c')
  })
})

describe('trackText', () => {
  test('implement 3/5 matches the band format exactly', () => {
    expect(trackText(snap())).toBe(
      'ATLAS ⬢ research ◆━◆━⟦implement 3/5⟧┄◇ verify ┄◇ done',
    )
  })

  test('research start leads with the current capsule', () => {
    const s = snap({
      phase: 'research',
      counts: { done: 0, total: 4, byPhase: { research: { done: 0, total: 4 } } },
    })
    expect(trackText(s)).toBe('ATLAS ◆━⟦research 0/4⟧┄◇ implement ┄◇ verify ┄◇ done')
  })

  test('blocked names the halt in a capsule and keeps the done tail', () => {
    expect(trackText(snap({ phase: 'blocked' }))).toBe(
      'ATLAS ⬢ research ◆━⛔ ⟦blocked⟧┄◇ implement ┄◇ verify ┄◇ done',
    )
  })

  test('empty snapshot degrades to the done tail', () => {
    const s = snap({ todoPhases: [], phase: 'research', counts: { done: 0, total: 0, byPhase: {} } })
    expect(trackText(s)).toBe('ATLAS ◆━⟦research 0/0⟧┄◇ done')
  })

  test('all done closes with the filled diamond', () => {
    const s = snap({
      phase: 'done',
      todoPhases: ['research', 'implement'],
      counts: { done: 8, total: 8, byPhase: { research: { done: 3, total: 3 }, implement: { done: 5, total: 5 } } },
    })
    expect(trackText(s)).toBe('ATLAS ⬢ research ◆━🔧 implement ◆━◆ done')
  })
})
