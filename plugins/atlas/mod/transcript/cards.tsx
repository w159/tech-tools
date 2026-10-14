// Transcript restyles for parallel work: worker cards, wave strips, channel bubbles.
// Pure tree builders (plain element data); restyle.tsx wires them to ToolUse / ToolGroup /
// UserMessage and falls back to next(e) on null or a throw.

import type { RenderElement, RenderNode } from 'claude-code'
import { BRAND } from '../contract'
import type { AgentState } from '../contract'
import { fitText, glyph, stateColor } from '../theme'

export interface CallLike { tool: string; input: unknown; output?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
type AgentInput = { subagent_type?: string; subagentType?: string; name?: string; description?: string; prompt?: string; model?: string; effort?: string }

const el = (type: string, props: Record<string, string | number | boolean>, ...children: RenderNode[]): RenderElement => ({ type, props, children }) as RenderElement
const t = (props: Record<string, string | number | boolean>, ...c: RenderNode[]) => el('Text', props, ...c)

const inputOf = (c: CallLike): AgentInput => (c.input ?? {}) as AgentInput
const typeOf = (i: AgentInput): string => i.subagent_type ?? i.subagentType ?? ''
const isAtlasWorker = (c: CallLike): boolean => (c.tool === 'Agent' || c.tool === 'Task') && typeOf(inputOf(c)).startsWith('atlas:')

const promptGoal = (prompt?: string): string => /^\s*GOAL:\s*(.+)$/m.exec(prompt ?? '')?.[1] ?? ''

/** The GOAL: line of a dispatch prompt, else the description. */
export function goalLine(i: { prompt?: string; description?: string }): string {
 return (promptGoal(i.prompt) || i.description || '').trim()
}

const flattenObject = (o: unknown): string => {
 const r = (o ?? {}) as { text?: unknown; content?: unknown }
 return flatten(r.text ?? r.content ?? '')
}
const flatten = (o: unknown): string => {
 if (typeof o === 'string') return o
 if (Array.isArray(o)) return o.map(flatten).join('\n')
 return typeof o === 'object' ? flattenObject(o) : ''
}

/** One result line: the STATUS line when present, else the first non-empty line. */
export function resultLine(output: unknown): string {
 const s = flatten(output)
 return (/^\s*STATUS:.+$/m.exec(s)?.[0] ?? s.split('\n').find((l) => l.trim()) ?? '').trim()
}

const colorOf = (s: AgentState): string => { try { return stateColor(s) || BRAND.idle } catch { return BRAND.idle } }

/** First matching call flag wins (errored, then interrupted, then running); no flag means finished. */
export function phaseOf(c: CallLike, s: AgentState): { mark: string; color: string; state: AgentState } {
 const phases: Array<[boolean, { mark: string; color: string; state: AgentState }]> = [
  [c.isErrored, { mark: '✗', color: BRAND.fail, state: 'failed' }],
  [c.isInterrupted, { mark: '⏸', color: BRAND.input, state: 'dead' }],
  [c.isRunning, { mark: glyph.dot, color: BRAND.working, state: 'running' }],
 ]
 return phases.find(([on]) => on)?.[1] ?? { mark: '✓', color: s === 'finished' ? BRAND.ok : colorOf(s), state: 'finished' }
}

const tierNode = (i: AgentInput): RenderNode => {
 const tier = [i.model, i.effort].filter(Boolean).join('·')
 return tier ? t({ color: BRAND.dim }, ` ${glyph.dot} ${tier}`) : ''
}
const statusNode = (color: string, mark: string, label: string) => t({ color, bold: true }, ` ${mark}${label ? ` ${label}` : ''}`)

const headerLine = (i: AgentInput, role: string, name: string | undefined, status: RenderNode) =>
 t({ wrap: 'truncate-end' },
  t({ color: BRAND.accent, bold: true }, '◆ '), t({ color: BRAND.text, bold: true }, `${i.name ?? name ?? role} `),
  t({ color: BRAND.subagent }, `${glyph.dot} ${role}`), tierNode(i), status)

/** Result row for a finished call; null while running or when there is nothing to show. */
const resultRow = (c: CallLike, color: string, fit: ReturnType<typeof fitter>): RenderNode | null => {
 if (c.isRunning) return null
 const r = c.isInterrupted ? 'interrupted' : resultLine(c.output)
 return r ? t({ wrap: 'truncate-end', color }, fit(r, 4)) : null
}

const fitter = (width: number) => (s: string, pad: number) => (width > pad ? fitText(s, width - pad) : s)
const boxProps = (color: string, width: number) => ({ borderStyle: 'round', borderColor: color, flexDirection: 'column', paddingX: 1, ...(width > 0 ? { width } : {}) })

/** Bordered card for an atlas:* dispatch; null leaves non-atlas calls to the engine. `width` 0 = unknown. */
export function workerCard(c: CallLike, state: AgentState, width = 0, name?: string, label = ''): RenderElement | null {
 if (!isAtlasWorker(c)) return null
 const i = inputOf(c)
 const role = typeOf(i).slice('atlas:'.length)
 const { mark, color } = phaseOf(c, state)
 const fit = fitter(width)
 const lines = [
  headerLine(i, role, name, statusNode(color, mark, label)),
  t({ wrap: 'truncate-end', color: BRAND.dim }, fit(goalLine(i), 4)),
  resultRow(c, color, fit),
 ].filter((l): l is RenderNode => l !== null)
 return el('Box', boxProps(color, width), ...lines)
}

/** Side by side when each card gets >= 40 columns, else stacked; w is the per-card width (0 = unknown). */
const waveLayout = (columns: number, count: number): { side: boolean; w: number } => {
 const share = Math.floor(columns / count)
 const side = columns > 0 && share >= 40
 return { side, w: side ? share - 1 : Math.max(columns, 0) }
}
const waveHeader = (calls: ReadonlyArray<CallLike>, n: number) => {
 const live = calls.filter((c) => c.isRunning).length
 return t({ color: BRAND.accent, bold: true }, `WAVE ${n} · ${calls.length} workers${live ? ` · ${live} running` : ' · done'}`)
}

/** WAVE strip: 2+ calls, all atlas Agent/Task. */
export function waveTree(calls: ReadonlyArray<CallLike>, n: number, columns: number): RenderElement | null {
 if (calls.length < 2 || !calls.every(isAtlasWorker)) return null
 const { side, w } = waveLayout(columns, calls.length)
 const cards = calls.map((c) => workerCard(c, phaseOf(c, 'finished').state, w) as RenderElement)
 return el('Box', { flexDirection: 'column' }, waveHeader(calls, n),
  el('Box', { flexDirection: side ? 'row' : 'column', flexWrap: 'wrap' }, ...cards))
}

/** Chat bubble for a message another agent or channel sent; null without a sender. */
export function bubbleTree(text: string, from: string | undefined, to = 'lead', columns = 0): RenderElement | null {
 if (!from || !text) return null
 const lines = text.split('\n').slice(0, 8)
 const bar = Array(lines.length + 1).fill('▌').join('\n')
 const body = columns > 4 ? lines.map((l) => fitText(l, columns - 3)).join('\n') : lines.join('\n')
 return el('Box', { flexDirection: 'row' },
  t({ color: BRAND.subagent }, bar),
  el('Box', { flexDirection: 'column', paddingLeft: 1 },
   t({ color: BRAND.subagent, bold: true }, `#atlas ${from} › ${to}`),
   t({ color: BRAND.text }, body)))
}
