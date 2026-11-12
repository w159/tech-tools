// The lead's header line (the contract header line (glyph, phase, optional n/m, state)) as the transcript draws it.
//
// Two forms of the same line reach the AssistantMessage site: the contract's own form, and the display form this mod writes through the classic `MessageDisplay` hook.
// Why the display form exists (critique 23, 37 raw frames in 11 of 12 runs): while a reply streams, the host paints each flushed batch of whole lines itself and
// does not ask `ui.render` for the message until it is complete (live-110-513bb41c-1 f0062-f0064: the raw `● ATLAS | 🔍 research | ...` row stands three 0.5 s frames
// while the body streams under it, and the chip arrives at f0065). `MessageDisplay` is the one host event that sees those batches and may rewrite them for the screen
// alone, so the first batch is rewritten to `research 1/3 · state`: never a pipe, never an emoji. The stored message, the model and the Stop gate keep the contract form.
//
// The chip itself is drawn from either form: no fill, a 1-cell bar in the phase colour, the phase word bold in body text, the state in the secondary grey.

import type { RenderElement, RenderNode } from 'claude-code'
import { PHASES } from '../intents'
import type { PhaseId } from '../contract'
import { runHex, type Ui } from '../atlas-ui'

export interface Lead { phase: PhaseId; count: string; sentence: string; first: string; form: 'contract' | 'display' }

const PHASE_ALT = PHASES.join('|')
const PHASE_IN_LINE = new RegExp(`\\b(${PHASE_ALT})\\b`)
/** The display form: `research 3/5 · state`, which the host paints after its own `●` bullet. The bar form `▌ research 3/5 · state` (what an earlier build wrote) is still read; the form with no bar needs the
 * count or the ` · ` so that a plain first line that is only a phase word (`done`) is no header. */
const DISPLAY_RE = new RegExp(`^(?:▌ (${PHASE_ALT})(?: (\\d+/\\d+))?(?: · (.*))?|(${PHASE_ALT})(?: (\\d+/\\d+)(?: · (.*))?| · (.*)))$`)

/** The header the first line of `text` pins, in either form; null when the first line is neither. `pattern` is the contract's `headerFirstLinePattern`. */
export function leadOf(text: string, pattern: string): Lead | null {
  const first = text.split('\n', 1)[0] ?? ''
  const shown = DISPLAY_RE.exec(first)
  if (shown) return { phase: (shown[1] ?? shown[4]) as PhaseId, count: shown[2] ?? shown[5] ?? '', sentence: (shown[3] ?? shown[6] ?? shown[7] ?? '').trim(), first, form: 'display' }
  if (pattern === '') return null
  let re: RegExp
  try { re = new RegExp(pattern) } catch { return null }
  if (!re.test(first)) return null
  const phase = PHASE_IN_LINE.exec(first)?.[1]
  if (phase === undefined) return null
  const [, mid = '', ...tail] = first.split('|')
  return { phase: phase as PhaseId, count: /(\d+)\s*\/\s*(\d+)/.exec(mid)?.slice(1, 3).join('/') ?? '', sentence: tail.join('|').trim(), first, form: 'contract' }
}

/** `research 3/5 · state`: the header as the host's own streaming row shows it (plain text: that row takes no colour). The host draws its own `●` before the row, so the line carries no bar of its own:
 * `● ▌ research · waiting on 3 explorers` put two marks on one line (critique 27, live-150-46d4825c-1 f0065:23). */
export const displayLine = (l: Lead): string => `${l.phase}${l.count ? ` ${l.count}` : ''}${l.sentence ? ` · ${l.sentence}` : ''}`

/** A MessageDisplay batch with its first line rewritten from the contract form to the display form; null when the batch holds no header (or already the display form). */
export function displayDelta(delta: string, pattern: string): string | null {
  const nl = delta.indexOf('\n')
  const first = nl < 0 ? delta : delta.slice(0, nl)
  const lead = leadOf(first, pattern)
  return lead && lead.form === 'contract' ? displayLine(lead) + (nl < 0 ? '' : delta.slice(nl)) : null
}

// ---- the chip -------------------------------------------------------------------------------------------------------------

type Props = Record<string, string | number | boolean>
const txt = (props: Props, ...children: RenderNode[]): RenderElement => ({ type: 'Text', props, children })
const keep = (child: RenderElement): RenderElement => ({ type: 'Box', props: { flexShrink: 0 }, children: [child] })
const fixed = { wrap: 'truncate-end' }

/** The bar colour of a lead status line: four values and no others (critique 25: five bar colours on one screen). Accent 141 for an active phase, ok 114 for done, error 203 for blocked; the quiet
 * and superseded bars and the notes' bars take the secondary grey (245). */
export const leadTone = (phase: PhaseId): 'accent' | 'ok' | 'bad' => (phase === 'done' ? 'ok' : phase === 'blocked' ? 'bad' : 'accent')

export interface LeadOpts { ui: Ui; columns: number; /** A done chip a Stop refusal overturned: the word is struck and quiet, and says why. */ superseded?: boolean; /** The previous header was this phase: no word, a quiet bar and the state. */ quiet?: boolean }

/** The chip's row: `▌ research 3/5 state`, the phase word in lower case like the band's. No background. Under 40 columns the bar and the word only. */
export function leadRow(l: Lead, o: LeadOpts): RenderElement {
  const paint = (tone: 'accent' | 'ok' | 'bad' | 'text' | 'sub' | 'dim'): Props => (o.ui.color === 'none' ? {} : { color: runHex({ tone }, o.ui.theme, o.ui.color) })
  const dead = o.superseded === true
  const bar = txt({ ...fixed, ...paint(dead || o.quiet ? 'sub' : leadTone(l.phase)) }, '▌')
  const word = txt({ ...fixed, ...paint(dead ? 'dim' : 'text'), bold: !dead, ...(dead ? { strikethrough: true } : {}) }, ` ${l.phase}`)
  const count = l.count ? [txt({ ...fixed, ...paint('sub') }, ` ${l.count}`)] : []
  const state = l.sentence ? [txt({ wrap: 'wrap', ...paint('sub') }, ` ${l.sentence}`)] : []
  const narrow = o.columns > 0 && o.columns < 40
  const kids: RenderNode[] = o.quiet && !dead
    ? [keep(bar), ...(narrow ? [] : state)]
    : [keep(bar), keep(word), ...(dead ? [keep(txt({ ...fixed, ...paint('dim') }, ' superseded'))] : []), ...(narrow ? [] : [...count, ...state])]
  return { type: 'Box', props: { flexDirection: 'row', flexShrink: 0 }, children: kids }
}

/** A header still streaming in (`ATLAS |`, `ATLAS | 🏁 do`): the bar, and the word once it is whole. A finished first line that is no header is not this. */
export function partialLead(text: string, ui: Ui): RenderElement | null {
  if (text.includes('\n') || !text.startsWith('ATLAS |')) return null
  const pipes = text.split('|')
  if (pipes.length >= 3 && pipes.slice(2).join('|').trim() !== '') return null // the state has begun: the strict pattern decides
  const word = (pipes[1] ?? '').trim().split(/\s+/).filter(Boolean)[1]
  const phase = word !== undefined && (PHASES as readonly string[]).includes(word) ? (word as PhaseId) : null
  return leadRow({ phase: phase ?? 'research', count: '', sentence: '', first: text, form: 'contract' }, { ui, columns: 0, ...(phase ? {} : { quiet: true }) })
}
