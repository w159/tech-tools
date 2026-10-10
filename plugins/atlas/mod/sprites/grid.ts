// Sprite frames -> the three render targets. One grid per persona (rows of palette
// letters, '.' transparent) emits Client half-block runs, Raster cells and SVG rects,
// so a terminal sprite and a Desktop sprite are the same art.
// Run/fold precedent: cc-arcade hooks/boards/common.tsx `runs()`.
import type { Frame, SpriteSet, SpriteSize, SpriteState } from '../contract'

/** One styled span of a Client row: half-blocks (▀/▄) or a space, per the plan's section 4. */
export interface SpriteRun {
  text: string
  color?: string
  backgroundColor?: string
}

/** One lit pixel for `$.ui.blit`'s Raster; transparent pixels are simply absent. */
export interface RasterCell {
  x: number
  y: number
  fg?: string
  bg?: string
}

/** Pixel dimensions per size: [width, height]. */
export const SIZES: Record<SpriteSize, readonly [number, number]> = {
  portrait: [16, 16],
  field: [8, 12],
  mini: [4, 4],
}

/** The contract's states, in declared order. */
export const STATES: readonly SpriteState[] = [
  'idle', 'working', 'spawn', 'input', 'done', 'failed', 'stuck', 'killed',
]

const hexFor = (palette: Record<string, string>, ch: string): string | undefined =>
  ch === '.' ? undefined : palette[ch]

/**
 * Renders a frame as rows of merged colour runs. A run of ▀ paints the top pixel as
 * `color` and the bottom one as `backgroundColor`; one transparent half keeps only the
 * other's colour (▀/▄); both transparent is a plain space. `maxRuns` folds neighbours
 * pair by pair (keeping the left run's colours) instead of exceeding the node budget;
 * `bg` paints fully transparent cells when the renderer wants no gaps.
 */
export function frameToRuns(
  frame: Frame,
  palette: Record<string, string>,
  opts?: { maxRuns?: number; bg?: string },
): SpriteRun[][] {
  if (frame.length === 0) return []
  const bg = opts?.bg
  const rows: SpriteRun[][] = []
  for (let r = 0; r < frame.length; r += 2) {
    const topRow = frame[r] ?? ''
    const bottomRow = frame[r + 1]
    const runs: SpriteRun[] = []
    for (let x = 0; x < topRow.length; x++) {
      const top = hexFor(palette, topRow[x] ?? '.')
      const bottom = hexFor(palette, bottomRow?.[x] ?? '.')
      let run: SpriteRun
      if (top === undefined && bottom === undefined) {
        run = bg ? { text: ' ', backgroundColor: bg } : { text: ' ' }
      } else if (bottom === undefined) {
        run = { text: '▀', color: top }
      } else if (top === undefined) {
        run = { text: '▄', color: bottom }
      } else {
        run = { text: '▀', color: top, backgroundColor: bottom }
      }
      const last = runs[runs.length - 1]
      if (last && last.text[0] === run.text[0] && last.color === run.color && last.backgroundColor === run.backgroundColor) {
        last.text += run.text
      } else {
        runs.push(run)
      }
    }
    const maxRuns = Math.max(1, Math.floor(opts?.maxRuns ?? Infinity))
    let out = runs
    while (out.length > maxRuns) {
      const folded: SpriteRun[] = []
      for (let i = 0; i < out.length; i += 2) {
        const a = out[i]!
        const next = out[i + 1]
        folded.push(next ? { ...a, text: a.text + next.text } : { ...a })
      }
      out = folded
    }
    rows.push(out)
  }
  return rows
}

/** The frame as Raster cells (one per lit pixel), for `$.ui.blit`. */
export function frameToCells(frame: Frame, palette: Record<string, string>): RasterCell[] {
  const cells: RasterCell[] = []
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fg = hexFor(palette, row[x] ?? '.')
      if (fg) cells.push({ x, y, fg })
    }
  })
  return cells
}

/** The frame as an SVG document: one <rect> per horizontal run of the same colour. */
export function frameToSvg(frame: Frame, palette: Record<string, string>, scale = 1): string {
  const w = (frame[0]?.length ?? 0) * scale
  const h = frame.length * scale
  const rects: string[] = []
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = hexFor(palette, row[x] ?? '.')
      if (!fill) continue
      let len = 1
      while (x + len < row.length && row[x + len] === row[x]) len++
      rects.push(`<rect x="${x * scale}" y="${y * scale}" width="${len * scale}" height="${scale}" fill="${fill}"/>`)
      x += len - 1
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${rects.join('')}</svg>`
}

/** The palette with its accent-stripe key 'a' set to a persona colour; source untouched. */
export function tint(palette: Record<string, string>, accent: string): Record<string, string> {
  return { ...palette, a: accent }
}

/**
 * Every structural problem with a sprite set: the three sizes have fixed pixel dims
 * (portrait 16x16, field 8x12, mini 4x4), every state needs >=2 frames, every frame row
 * is as tall/wide as its size, and every char is '.' or a palette key. [] means clean.
 */
export function validateSpriteSet(s: SpriteSet): string[] {
  const problems: string[] = []
  if (!s) return ['sprite set is missing']
  const palette = s.palette ?? {}
  for (const size of ['portrait', 'field', 'mini'] as SpriteSize[]) {
    const byState = s[size]
    if (!byState) {
      problems.push(`${size}: missing frames`)
      continue
    }
    const [w, h] = SIZES[size]
    for (const state of STATES) {
      const frames = byState[state]
      if (!Array.isArray(frames) || frames.length < 2) {
        problems.push(`${size}.${state}: needs >=2 frames, got ${Array.isArray(frames) ? frames.length : 'none'}`)
        continue
      }
      frames.forEach((frame, i) => {
        if (!Array.isArray(frame)) {
          problems.push(`${size}.${state}: frame ${i} is not a row list`)
          return
        }
        if (frame.length !== h) {
          problems.push(`${size}.${state}: frame ${i} has ${frame.length} rows, expected ${h}`)
          return
        }
        frame.forEach((row, r) => {
          if (row.length !== w) {
            problems.push(`${size}.${state}: frame ${i} row ${r} is ${row.length} wide, expected ${w}`)
            return
          }
          for (const ch of row) {
            if (ch !== '.' && !(ch in palette)) {
              problems.push(`${size}.${state}: frame ${i} row ${r} has unknown palette key '${ch}'`)
            }
          }
        })
      })
    }
  }
  return problems
}