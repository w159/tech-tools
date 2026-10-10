// Pure SVG/string renderers for the non-terminal surfaces (Desktop, VS Code):
// the contract track and the squad chip row as standalone SVG documents, plus
// a one-line plain-text fallback. No DOM or Node APIs; every byte
// deterministic (no Date, no Math.random, no locale-dependent formatting).
import type { AtlasSnapshot, PhaseId, SpriteState } from './contract'
import { BRAND } from './contract'
import { spriteFor } from './sprites'
import { frameToSvg, tint } from './sprites/grid'

const FONT = 'monospace'
const CHAR_W = 6 // px per char at font-size 10 in a monospace face
const TRACK_H = 34
const SQUAD_H = 22

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  )

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v))

const svgOpen = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`

/** A phase counts as done when every one of its items is completed. */
const phaseDone = (s: AtlasSnapshot, p: PhaseId): boolean => {
  const c = s.counts.byPhase[p]
  return !!c && c.total > 0 && c.done >= c.total
}

/** n/m progress for a phase from the snapshot counts; missing counts as 0/0. */
const phaseFraction = (s: AtlasSnapshot, p: PhaseId): string => {
  const c = s.counts.byPhase[p]
  return `${c?.done ?? 0}/${c?.total ?? 0}`
}

const glyphOf = (s: AtlasSnapshot, p: PhaseId): string =>
  s.contract.phases.find((ph) => ph.id === p)?.glyph ?? '⬢'

/**
 * The contract track as an SVG document: a rail with one diamond per
 * contract.todoPhases plus the final done diamond, the current phase as a
 * capsule above the rail labelled "phase n/m" from counts.byPhase, and a
 * progress marker under the rail at the global done fraction. Pure data:
 * no scripts, no handlers (safe for SvgProps' non-interactive element).
 */
export function trackSvg(s: AtlasSnapshot, w: number): string {
  const width = Math.max(1, Math.floor(w))
  const phases = s.contract.todoPhases
  const n = phases.length + 1 // + the trailing done diamond
  const pad = 14
  const railY = 24
  const r = 5
  const gap = n > 1 ? (width - 2 * pad) / (n - 1) : 0

  const doneAt = s.phase === 'done' ? n - 1 : -1
  let idx = phases.indexOf(s.phase)
  if (idx < 0) idx = s.phase === 'blocked' || s.phase === 'done' ? n - 1 : 0

  const cx = (i: number): number => pad + i * gap
  const diamond = (i: number, fill: string, stroke: string): string =>
    `<polygon points="${cx(i)},${railY - r} ${cx(i) + r},${railY} ${cx(i)},${railY + r} ${cx(i) - r},${railY}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`

  const shapes: string[] = [
    `<line x1="${pad - r}" y1="${railY}" x2="${width - pad + r}" y2="${railY}" stroke="${BRAND.dim}" stroke-width="2"/>`,
  ]
  phases.forEach((p, i) => {
    if (phaseDone(s, p) || i === doneAt) shapes.push(diamond(i, BRAND.ok, BRAND.ok))
    else if (i < idx) shapes.push(diamond(i, BRAND.working, BRAND.working))
    else if (i === idx && s.phase !== 'blocked') shapes.push(diamond(i, BRAND.accent, BRAND.accent))
    else shapes.push(diamond(i, 'none', BRAND.dim))
  })
  if (doneAt === n - 1) shapes.push(diamond(n - 1, BRAND.ok, BRAND.ok))
  else if (s.phase !== 'blocked') shapes.push(diamond(n - 1, 'none', BRAND.dim))
  else shapes.push(diamond(n - 1, BRAND.fail, BRAND.fail))

  const label = s.phase === 'blocked' ? '⛔ blocked' : `${s.phase} ${phaseFraction(s, s.phase)}`
  const capW = label.length * CHAR_W + 12
  const capX = clamp(cx(Math.min(idx, n - 1)) - capW / 2, 2, Math.max(2, width - capW - 2))
  const capColor = s.phase === 'blocked' ? BRAND.fail : BRAND.accent
  shapes.push(`<rect x="${capX}" y="2" width="${capW}" height="14" rx="7" fill="${BRAND.surface}" stroke="${capColor}"/>`)
  shapes.push(`<text x="${capX + capW / 2}" y="12" font-family="${FONT}" font-size="10" fill="${BRAND.text}" text-anchor="middle">${esc(label)}</text>`)

  const frac = s.counts.total > 0 ? s.counts.done / s.counts.total : 0
  const mx = clamp(pad + frac * (width - 2 * pad), pad, Math.max(pad, width - pad))
  shapes.push(`<path d="M ${mx} ${railY + 6} l 4 6 l -8 0 Z" fill="${BRAND.working}"/>`)

  return `${svgOpen(width, TRACK_H)}${shapes.join('')}</svg>`
}

/** SquadAgent state -> sprite state; parked sits like idle, dead is killed. */
const STATE_TO_SPRITE: Record<string, SpriteState> = {
  spawning: 'spawn', running: 'working', idle: 'idle', input: 'input', stuck: 'stuck',
  parked: 'idle', finished: 'done', failed: 'failed', dead: 'killed',
}

/** Frontmatter colour names -> brand tokens; anything else falls back to accent. */
const PERSONA_HEX: Record<string, string> = {
  green: BRAND.ok, red: BRAND.fail, blue: BRAND.working, orange: BRAND.input,
  amber: BRAND.input, yellow: BRAND.input, cyan: BRAND.focus, teal: BRAND.accent,
  purple: BRAND.subagent, violet: BRAND.subagent, pink: BRAND.focus,
  grey: BRAND.idle, gray: BRAND.idle,
}

/**
 * The squad as a row of chips: one mini sprite frame (frame 0; animation is
 * the Client's job) tinted with the persona colour, next to the agent name.
 * Chips clip at the surface width rather than overflowing it.
 */
export function squadSvg(s: AtlasSnapshot, w: number): string {
  const width = Math.max(1, Math.floor(w))
  const parts: string[] = []
  let x = 4
  for (const a of s.squad) {
    const chipW = Math.ceil(13 + 8 + 4 + a.name.length * 5.5 + 6)
    if (x + chipW > width && x > 4) break
    const set = spriteFor(a.persona)
    const persona = s.personas.find((p) => p.name === a.persona)
    const accent =
      (persona && PERSONA_HEX[persona.color]) ||
      (a.persona.startsWith('armada-') ? BRAND.subagent : BRAND.accent)
    const st = STATE_TO_SPRITE[a.state] ?? 'idle'
    const frame = set.mini[st]?.[0] ?? set.mini.idle?.[0]
    parts.push(`<rect x="${x}" y="1" width="${chipW}" height="${SQUAD_H - 2}" rx="4" fill="${BRAND.surface}" stroke="${accent}"/>`)
    if (frame) {
      parts.push(`<g transform="translate(${x + 5},${Math.floor((SQUAD_H - 8) / 2)})">${frameToSvg(frame, tint(set.palette, accent), 2)}</g>`)
    }
    parts.push(`<text x="${x + 17}" y="14" font-family="${FONT}" font-size="9" fill="${BRAND.text}">${esc(a.name)}</text>`)
    x += chipW + 4
  }
  return `${svgOpen(width, SQUAD_H)}${parts.join('')}</svg>`
}

/**
 * One-line plain fallback, e.g. for research done and implement at 3/5:
 *   ATLAS ⬢ research ◆━◆━⟦implement 3/5⟧┄◇ verify ┄◇ done
 * Done phases render glyph+name+diamond with a rail out, the current phase a
 * ⟦name n/m⟧ capsule behind its rail-in diamond, future phases ┄◇, and the
 * trailing done diamond closes the line.
 */
export function trackText(s: AtlasSnapshot): string {
  const phases = s.contract.todoPhases
  const curAt = phases.indexOf(s.phase)
  const segs: string[] = []
  let blockedAt = -1 // insert point for the blocked capsule: after the last done-or-started phase
  phases.forEach((p, i) => {
    if (s.phase !== 'done' && p === s.phase) segs.push(`◆━⟦${p} ${phaseFraction(s, p)}⟧`)
    else if (phaseDone(s, p)) {
      segs.push(`${glyphOf(s, p)} ${p} ◆━`)
      if (blockedAt < 0) blockedAt = segs.length
    } else if (curAt >= 0 && i < curAt) {
      segs.push(`◆ ${p} ━`)
      if (blockedAt < 0) blockedAt = segs.length
    } else {
      if (blockedAt < 0) blockedAt = segs.length
      segs.push(`┄◇ ${p}`)
    }
  })
  if (s.phase === 'blocked') segs.splice(Math.max(0, blockedAt), 0, '⛔ ⟦blocked⟧')
  else if (s.phase === 'done') segs.push('◆ done')
  else if (curAt < 0) segs.push(`◆━⟦${s.phase} ${phaseFraction(s, s.phase)}⟧`)
  if (s.phase !== 'done') segs.push('┄◇ done')
  // a space separates two dotted-future segments; everything else joins tight
  let out = ''
  let prevFuture = false
  for (const seg of segs) {
    const future = seg.startsWith('┄◇')
    if (out && future && prevFuture) out += ' '
    out += seg
    prevFuture = future
  }
  return `ATLAS ${out}`
}
