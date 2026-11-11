// Transcript restyles for parallel work: filled worker cards (Mocha truecolor, coloured left stripe),
// wave strips, channel bubbles. Pure tree builders (plain element data); restyle.tsx wires them to
// ToolUse / ToolGroup / UserMessage and falls back to next(e) on null or a throw.

import type { RenderElement, RenderNode } from 'claude-code'
import { BRAND } from '../contract'
import type { AgentState } from '../contract'
import { PALETTES, toneHex, uiFromEnv, type Run as UiRun, type Ui, type UiState } from '../atlas-ui'
import { CARD_W, cardLines, toastRuns } from '../panel-layout'
import { clip } from '../atlas-ui'
import { fitText } from '../theme'

export interface CallLike { tool: string; input: unknown; output?: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
type AgentInput = { subagent_type?: string; subagentType?: string; name?: string; description?: string; prompt?: string; model?: string; effort?: string }

const el = (type: string, props: Record<string, string | number | boolean>, ...children: RenderNode[]): RenderElement => ({ type, props, children }) as RenderElement
const t = (props: Record<string, string | number | boolean>, ...c: RenderNode[]) => el('Text', props, ...c)

const inputOf = (c: CallLike): AgentInput => (c.input ?? {}) as AgentInput
const typeOf = (i: AgentInput): string => i.subagent_type ?? i.subagentType ?? ''
const isAtlasWorker = (c: CallLike): boolean => (c.tool === 'Agent' || c.tool === 'Task') && typeOf(inputOf(c)).startsWith('atlas:')

// A one-line prompt keeps going after GOAL (`... TOOLS: x. DELIVERABLE: y`): stop at the next ALL-CAPS label.
const promptGoal = (prompt?: string): string => /^\s*GOAL:\s*(.+?)(?=\s+[A-Z][A-Z ]*[A-Z]:|$)/m.exec(prompt ?? '')?.[1] ?? ''

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

/** Worker states that are still live after the Agent call itself returned (a background launch). */
const LIVE: ReadonlySet<AgentState> = new Set<AgentState>(['running', 'spawning', 'input'])
const isLive = (c: CallLike, s: AgentState): boolean => c.isRunning || LIVE.has(s)

/** End words of a background worker that did not succeed (`CardExtra.ended`): its launch call itself returned clean. */
const ENDED_BAD: ReadonlySet<string> = new Set(['failed', 'killed'])

/** First matching flag wins (errored or a worker that ended failed / killed, then interrupted, then running or a
 * live worker); none means finished. `ui` is the design vocabulary word the card's border carries. */
export function phaseOf(c: CallLike, s: AgentState, ended = ''): { state: AgentState; ui: UiState } {
 const phases: Array<[boolean, { state: AgentState; ui: UiState }]> = [
  [c.isErrored || ENDED_BAD.has(ended), { state: 'failed', ui: 'failed' }],
  [c.isInterrupted, { state: 'dead', ui: 'blocked' }],
  [isLive(c, s), { state: 'running', ui: 'running' }],
 ]
 return phases.find(([on]) => on)?.[1] ?? { state: 'finished', ui: 'done' }
}

const tierOf = (i: AgentInput): string => [i.model, i.effort].filter(Boolean).join('·')

/** Run -> Text element on the rev 4 panel (or the run's own fill). */
const cell = (x: UiRun, ui: Ui): RenderNode => {
 const p = PALETTES[ui.theme]
 return t({ ...(ui.color === 'none' ? {} : { color: toneHex(x.tone, ui.theme), backgroundColor: x.bg ? p[x.bg] : p.panel }), ...(x.bold ? { bold: true } : {}) }, x.t)
}
const rowEl = (runs: UiRun[], ui: Ui): RenderElement => el('Box', { flexDirection: 'row', flexShrink: 0 }, ...runs.map((x) => cell(x, ui)))

/** Result text: the worker's outcome when known, else the call's own result; '' while running. */
// The outcome carries no lifecycle word: the border's state word is the only place that says done / failed / blocked.
const resultText = (c: CallLike, outcome = ''): string => (c.isRunning ? '' : outcome || callResult(c))
const callResult = (c: CallLike): string => (c.isInterrupted ? 'interrupted' : resultLine(c.output))

/** Card extras: `outcome` is the worker's result line without its lifecycle word, `ended` its end word (`finished`,
 * `failed`, `killed`), `now` what a running worker is doing (tool, target, age), `wave` the strip number it was
 * dispatched in, `steps` and `ctx` the worker's plan progress and context held (rows appear only when known).
 * `mark` is accepted for older callers and ignored: the border's state word replaces the spinner chip. */
export interface CardExtra { mark?: string; outcome?: string; ended?: string; now?: string; wave?: number; steps?: { done: number; total: number }; ctx?: number }

/** First sentence of a PreToolUse hook's DENY text, null when the call was not denied: a denied dispatch never ran. */
function denyReason(c: CallLike): string | null {
 if (!c.isErrored) return null
 return /hook error:\s*DENY\s*[-:]\s*([\s\S]+?[.!?])(?=\s|$)/.exec(flatten(c.output))?.[1]?.replace(/\s+/g, ' ') ?? null
}

/** The `last` row: what a running worker is doing, the hook's reason for a denied dispatch, else the settled result. */
function lastOf(c: CallLike, running: boolean, extra: CardExtra, word: string, room: number): string {
 const deny = denyReason(c)
 if (deny !== null) return `denied: ${deny}`
 if (!running) return resultText(c, extra.outcome)
 const now = extra.now || word || 'running'
 // A busy line sheds its tool count before it is clipped: the age is the fact that matters.
 return now.length > room ? now.replace(/ · \d+ tools?$/, '') : now
}

/** Closed worker card for an atlas:* dispatch (the border carries the state word, the name and the model tier); null leaves
 * non-atlas calls to the engine. `width` is the room the card has (0 = unknown): the card is `min(44, width)` wide. */
export function workerCard(c: CallLike, state: AgentState, width = 0, name?: string, word = '', extra: CardExtra = {}, ui: Ui = uiFromEnv()): RenderElement | null {
 if (!isAtlasWorker(c)) return null
 const i = inputOf(c)
 const role = typeOf(i).slice('atlas:'.length)
 const phase = phaseOf(c, state, extra.ended)
 const rows = cardLines({
  state: phase.ui, name: i.name ?? name ?? role, model: tierOf(i) || undefined, goal: goalLine(i) || undefined,
  last: lastOf(c, phase.ui === 'running', extra, word, Math.min(width > 0 ? width : CARD_W, CARD_W) - 10) || undefined, steps: extra.steps, ctx: extra.ctx, ui,
 }, width > 0 ? width : CARD_W)
 return el('Box', { flexDirection: 'column', flexShrink: 0 }, ...rows.map((r) => rowEl(r, ui)))
}

/** Side by side when each card gets room for a 44-column box and a gap, else stacked; w is the per-card width (0 = unknown). */
const waveLayout = (columns: number, count: number): { side: boolean; w: number } => {
 const share = Math.floor(columns / count)
 const side = columns > 0 && share >= CARD_W + 1
 return { side, w: side ? CARD_W : columns > 0 ? Math.min(CARD_W, columns) : 0 }
}
const waveHeader = (calls: ReadonlyArray<CallLike>, n: number) => {
 const live = calls.filter((c) => c.isRunning).length
 return t({ color: BRAND.accent, bold: true }, `WAVE ${n} · ${calls.length} workers${live ? ` · ${live} running` : ' · finished'}`)
}

/** WAVE strip: 2+ calls, all atlas Agent/Task. */
export function waveTree(calls: ReadonlyArray<CallLike>, n: number, columns: number): RenderElement | null {
 if (calls.length < 2 || !calls.every(isAtlasWorker)) return null
 const { side, w } = waveLayout(columns, calls.length)
 const cards = calls.map((c) => workerCard(c, phaseOf(c, 'finished').state, w, undefined, '', { wave: n }) as RenderElement)
 return el('Box', { flexDirection: 'column' }, waveHeader(calls, n),
  el('Box', { flexDirection: side ? 'row' : 'column', flexWrap: 'wrap' }, ...cards))
}

/** One row for a background atlas worker's task-notification: `● done  wave-a  explorer  outcome` (state, name, role, outcome). */
export function notificationTree(name: string, role: string, outcome: string, failed: boolean, ui: Ui = uiFromEnv()): RenderElement {
 const runs = toastRuns(failed ? 'failed' : 'done', name, clip([role, outcome].filter(Boolean).join('  '), 80), ui)
 return rowEl(runs, ui)
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
