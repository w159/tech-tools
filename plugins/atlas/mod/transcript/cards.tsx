// Transcript restyles for parallel work: filled worker cards (Mocha truecolor, coloured left stripe),
// wave strips, channel bubbles. Pure tree builders (plain element data); restyle.tsx wires them to
// ToolUse / ToolGroup / UserMessage and falls back to next(e) on null or a throw.

import type { RenderElement, RenderNode } from 'claude-code'
import { BRAND } from '../contract'
import type { AgentState } from '../contract'
import { fitText, glyph, MOCHA as M, stateColor, textWidth } from '../theme'

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

/** Worker states that are still live after the Agent call itself returned (a background launch). */
const LIVE: ReadonlySet<AgentState> = new Set<AgentState>(['running', 'spawning', 'input'])
const isLive = (c: CallLike, s: AgentState): boolean => c.isRunning || LIVE.has(s)

/** First matching flag wins (errored, then interrupted, then running or a live worker); none means finished. */
export function phaseOf(c: CallLike, s: AgentState): { mark: string; color: string; state: AgentState } {
 const phases: Array<[boolean, { mark: string; color: string; state: AgentState }]> = [
  [c.isErrored, { mark: '✗', color: BRAND.fail, state: 'failed' }],
  [c.isInterrupted, { mark: '⏸', color: BRAND.input, state: 'dead' }],
  [isLive(c, s), { mark: glyph.dot, color: BRAND.working, state: 'running' }],
 ]
 return phases.find(([on]) => on)?.[1] ?? { mark: '✓', color: s === 'finished' ? BRAND.ok : colorOf(s), state: 'finished' }
}

const tierOf = (i: AgentInput): string => [i.model, i.effort].filter(Boolean).join('·')

/** Card hue per settled state (Mocha): running green, failed red, interrupted yellow, finished teal. */
const CARD_HUE: Partial<Record<AgentState, string>> = { running: M.green, failed: M.red, dead: M.yellow }
const cardHue = (s: AgentState): string => CARD_HUE[s] ?? M.teal

type Run = { t: string; color?: string; bg?: string; bold?: boolean }
const cell = (r: Run): RenderNode => t({ ...(r.color ? { color: r.color } : {}), ...(r.bg ? { backgroundColor: r.bg } : {}), ...(r.bold ? { bold: true } : {}) }, r.t)

/** One filled card row: the coloured `▌` stripe, then runs, padded to `width` on `bg` (0 = unknown width). */
function cardRow(hue: string, bg: string, width: number, runs: Run[]): RenderElement {
 const used = 1 + runs.reduce((n, r) => n + textWidth(r.t), 0)
 const fill: Run[] = width > used ? [{ t: ' '.repeat(width - used), bg }] : []
 return el('Box', { flexDirection: 'row', flexShrink: 0 }, ...[{ t: '▌', color: hue, bg }, ...runs, ...fill].map(cell))
}

/** Result text: the worker's outcome when known, else the call's own result; '' while running. */
const resultText = (c: CallLike, outcome = ''): string => (c.isRunning ? '' : (outcome || callResult(c)).replace(/^done · /, '')) // the row label already says done
const callResult = (c: CallLike): string => (c.isInterrupted ? 'interrupted' : resultLine(c.output))

const fitter = (width: number) => (s: string, pad: number) => (width > pad ? fitText(s, width - pad) : s)
const label = (word: string): Run => ({ t: ` ${word.padEnd(5)} `, color: M.muted, bg: M.panel })

/** Card extras: `mark` replaces the status glyph (a spinner frame), `outcome` is the worker's result line,
 * `now` what a running worker is doing (tool, target, age), `wave` the strip number it was dispatched in. */
export interface CardExtra { mark?: string; outcome?: string; now?: string; wave?: number }

/** `now` row of a running worker: what it is doing, else the host status word. */
const nowRow = (word: string, extra: CardExtra, hue: string, width: number): RenderElement =>
 cardRow(hue, M.panel, width, [label('now'), { t: fitter(width)(extra.now || word || 'running', 9), color: M.muted, bg: M.panel }])

/** `done`/`fail` row with the result once settled; null when there is none. */
function endRow(c: CallLike, state: AgentState, extra: CardExtra, hue: string, width: number): RenderElement | null {
 const r = resultText(c, extra.outcome)
 return r ? cardRow(hue, M.panel, width, [label(state === 'failed' ? 'fail' : 'done'), { t: fitter(width)(r, 9), color: hue, bg: M.panel }]) : null
}

/** Header row: the state-coloured chip (`⣾ name`) then `role · tier · wave N`. */
function headRow(i: AgentInput, role: string, name: string | undefined, mark: string, hue: string, width: number, wave?: number): RenderElement {
 const who = i.name ?? name ?? role
 const meta = [role, tierOf(i), wave ? `wave ${wave}` : ''].filter(Boolean).join(' · ')
 return cardRow(hue, M.panel2, width, [{ t: ` ${mark} ${who} `, color: M.base, bg: hue, bold: true }, { t: fitter(width)(` ${meta} `, 24), color: M.text, bg: M.panel2 }])
}

const markOf = (p: { mark: string; state: AgentState }, extra: CardExtra): string => (p.state === 'running' && extra.mark) || p.mark
const cardBox = (width: number, lines: Array<RenderElement | null>): RenderElement =>
 el('Box', { flexDirection: 'column', flexShrink: 0, backgroundColor: M.panel, ...(width > 0 ? { width } : {}) }, ...lines.filter((l): l is RenderElement => l !== null))

/** Filled card for an atlas:* dispatch; null leaves non-atlas calls to the engine. `width` 0 = unknown. */
export function workerCard(c: CallLike, state: AgentState, width = 0, name?: string, word = '', extra: CardExtra = {}): RenderElement | null {
 if (!isAtlasWorker(c)) return null
 const i = inputOf(c)
 const role = typeOf(i).slice('atlas:'.length)
 const phase = phaseOf(c, state)
 const hue = cardHue(phase.state)
 const running = phase.state === 'running'
 return cardBox(width, [
  headRow(i, role, name, markOf(phase, extra), hue, width, extra.wave),
  cardRow(hue, M.panel, width, [label('goal'), { t: fitter(width)(goalLine(i), 9), color: M.text, bg: M.panel }]),
  running ? nowRow(word, extra, hue, width) : endRow(c, phase.state, extra, hue, width),
 ])
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
 const cards = calls.map((c) => workerCard(c, phaseOf(c, 'finished').state, w, undefined, '', { wave: n }) as RenderElement)
 return el('Box', { flexDirection: 'column' }, waveHeader(calls, n),
  el('Box', { flexDirection: side ? 'row' : 'column', flexWrap: 'wrap' }, ...cards))
}

/** One-row filled card for a background atlas worker's task-notification: stripe, `✔ wave-a` chip, role, outcome. */
export function notificationTree(name: string, role: string, outcome: string, failed: boolean): RenderElement {
 const hue = failed ? M.red : M.teal
 return cardRow(hue, M.panel2, 0, [{ t: ` ${failed ? '✖' : '✔'} ${name} `, color: M.base, bg: hue, bold: true }, { t: ` ${role} `, color: M.muted, bg: M.panel2 }, { t: `${outcome} `, color: hue, bg: M.panel2 }])
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
