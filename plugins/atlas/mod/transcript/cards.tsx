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
export const isAtlasWorker = (c: CallLike): boolean => (c.tool === 'Agent' || c.tool === 'Task') && typeOf(inputOf(c)).startsWith('atlas:')

/** The GOAL: line of a dispatch prompt, else the description. */
export function goalLine(i: { prompt?: string; description?: string }): string {
 const m = /^\s*GOAL:\s*(.+)$/m.exec(i.prompt ?? '')
 return (m?.[1] ?? i.description ?? '').trim()
}

const flatten = (o: unknown): string => {
 if (typeof o === 'string') return o
 if (Array.isArray(o)) return o.map(flatten).join('\n')
 if (o && typeof o === 'object') {
  const r = o as { text?: unknown; content?: unknown }
  return flatten(r.text ?? r.content ?? '')
 }
 return ''
}

/** One result line: the STATUS line when present, else the first non-empty line. */
export function resultLine(output: unknown): string {
 const s = flatten(output)
 return (/^\s*STATUS:.+$/m.exec(s)?.[0] ?? s.split('\n').find((l) => l.trim()) ?? '').trim()
}

const colorOf = (s: AgentState): string => { try { return stateColor(s) || BRAND.idle } catch { return BRAND.idle } }
const borderFor = (c: CallLike, s: AgentState): string =>
 c.isErrored ? BRAND.fail : c.isInterrupted ? BRAND.input : c.isRunning ? BRAND.working : s === 'finished' ? BRAND.ok : colorOf(s)

/** Bordered card for an atlas:* dispatch; null leaves non-atlas calls to the engine. `width` 0 = unknown. */
export function workerCard(c: CallLike, state: AgentState, width = 0, name?: string, label = ''): RenderElement | null {
 if (!isAtlasWorker(c)) return null
 const i = inputOf(c)
 const role = typeOf(i).slice('atlas:'.length)
 const tier = [i.model, i.effort].filter(Boolean).join('·')
 const fit = (s: string, pad: number) => (width > pad ? fitText(s, width - pad) : s)
 const mark = c.isErrored ? '✗' : c.isInterrupted ? '⏸' : c.isRunning ? glyph.dot : '✓'
 const lines: RenderNode[] = [
  t({ wrap: 'truncate-end' },
   t({ color: BRAND.accent, bold: true }, '◆ '), t({ color: BRAND.text, bold: true }, `${i.name ?? name ?? role} `),
   t({ color: BRAND.subagent }, `${glyph.dot} ${role}`), tier ? t({ color: BRAND.dim }, ` ${glyph.dot} ${tier}`) : '',
   t({ color: borderFor(c, state), bold: true }, ` ${mark}${label ? ` ${label}` : ''}`)),
  t({ wrap: 'truncate-end', color: BRAND.dim }, fit(goalLine(i), 4)),
 ]
 if (!c.isRunning) {
  const r = c.isInterrupted ? 'interrupted' : resultLine(c.output)
  if (r) lines.push(t({ wrap: 'truncate-end', color: borderFor(c, state) }, fit(r, 4)))
 }
 return el('Box', { borderStyle: 'round', borderColor: borderFor(c, state), flexDirection: 'column', paddingX: 1, ...(width > 0 ? { width } : {}) }, ...lines)
}

/** WAVE strip: 2+ calls, all atlas Agent/Task, side by side when each gets >= 40 columns, else stacked. */
export function waveTree(calls: ReadonlyArray<CallLike>, n: number, columns: number): RenderElement | null {
 if (calls.length < 2 || !calls.every(isAtlasWorker)) return null
 const side = columns > 0 && Math.floor(columns / calls.length) >= 40
 const w = side ? Math.floor(columns / calls.length) - 1 : columns > 0 ? columns : 0
 const stateOf = (c: CallLike): AgentState => (c.isErrored ? 'failed' : c.isInterrupted ? 'dead' : c.isRunning ? 'running' : 'finished')
 const cards = calls.map((c) => workerCard(c, stateOf(c), w) as RenderElement)
 const live = calls.filter((c) => c.isRunning).length
 return el('Box', { flexDirection: 'column' },
  t({ color: BRAND.accent, bold: true }, `WAVE ${n} · ${calls.length} workers${live ? ` · ${live} running` : ' · done'}`),
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
