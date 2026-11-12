// Transcript restyles for parallel work: filled worker cards (Mocha truecolor, coloured left stripe),
// wave strips, channel bubbles. Pure tree builders (plain element data); restyle.tsx wires them to
// ToolUse / ToolGroup / UserMessage and falls back to next(e) on null or a throw.

import type { RenderElement, RenderNode } from 'claude-code'
import { BRAND } from '../contract'
import type { AgentState } from '../contract'
import { surfaceHex, uiFromEnv, type Run as UiRun, type Ui, type UiState, runHex } from '../atlas-ui'
import { CARD_W, toastRuns } from '../panel-layout'
import { cells } from '../atlas-ui'
import { clipE as clip } from '../board-model'
import { displayName } from '../hud'
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

/** `STATUS: DONE` is the agent's own shout of a state the card's border already names: a done-like word (DONE, OK, COMPLETE...) is cut, any other
 * caps word (BLOCKED, FAILED) stays as a lowercase word, and what follows it (`STATUS: DONE - read a.py`) is kept. */
const DONE_WORDS: ReadonlySet<string> = new Set(['DONE', 'OK', 'COMPLETE', 'COMPLETED', 'SUCCESS', 'PASS'])
export function stripStatus(line: string): string {
 const m = /^\s*STATUS:\s*([A-Z][A-Z_]*)\b[\s:.,;·-]*([\s\S]*)$/.exec(line)
 if (!m) return line
 const word = DONE_WORDS.has(m[1]!) ? '' : m[1]!.toLowerCase()
 const rest = (m[2] ?? '').trim()
 return word && rest ? `${word}: ${rest}` : word || rest
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

/** The widest a rail card grows when it has the room: its fact (what the worker does, or why a dispatch was denied) is clipped to this. */
const RAIL_W = 100

const tierOf = (i: AgentInput): string => [i.model, i.effort].filter(Boolean).join('·')

/** Run -> Text element on the rev 4 panel (or the run's own fill). */
const cell = (x: UiRun, ui: Ui): RenderNode => {
 return t({ ...(ui.color === 'none' ? {} : { color: runHex(x, ui.theme, ui.color), backgroundColor: surfaceHex(x.bg ?? 'panel', ui) }), ...(x.bold ? { bold: true } : {}) }, x.t)
}
const rowEl = (runs: UiRun[], ui: Ui): RenderElement => el('Box', { flexDirection: 'row', flexShrink: 0 }, ...runs.map((x) => cell(x, ui)))

/** Result text: the worker's outcome when known, else the call's own result; '' while running. */
// The outcome carries no lifecycle word: the border's state word is the only place that says done / failed / blocked.
const resultText = (c: CallLike, outcome = ''): string => (c.isRunning ? '' : stripStatus(outcome || callResult(c)))
const callResult = (c: CallLike): string => (c.isInterrupted ? 'interrupted' : resultLine(c.output))

/** Card extras: `outcome` is the worker's result line without its lifecycle word, `ended` its end word (`finished`,
 * `failed`, `killed`), `now` what a running worker is doing (tool, target, age), `wave` the strip number it was
 * dispatched in, `steps` and `ctx` the worker's plan progress and context held (rows appear only when known).
 * `mark` is accepted for older callers and ignored: the border's state word replaces the spinner chip. */
export interface CardExtra { ui?: Ui; mark?: string; outcome?: string; ended?: string; now?: string; wave?: number; steps?: { done: number; total: number }; ctx?: number }

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
export function workerCard(c: CallLike, state: AgentState, width = 0, name?: string, word = '', extra: CardExtra = {}, ui: Ui = extra.ui ?? uiFromEnv()): RenderElement | null {
 if (!isAtlasWorker(c)) return null
 const i = inputOf(c)
 const role = typeOf(i).slice('atlas:'.length)
 const phase = phaseOf(c, state, extra.ended)
 const cardName = displayName(i.name ?? name ?? role, role, i.description)
 const w = Math.max(20, Math.min(RAIL_W, width > 0 ? width : RAIL_W))
 // One card style (critique 16 C3: the boxed `┌─ ◆ done beta-explorer-2 ─┐` card sat beside the rail card for the same worker in 61 frames): the dispatch card is the
 // rail card the finish uses, `▌ ◆ ATLAS  ◐ running  name  what it is doing`. The name is never cut: the fact is clipped to the room left, the model tag goes first.
 const head = toastRuns(phase.ui, cardName, '', ui)
 const used = head.reduce((n, x) => n + cells(x.t), 0)
 const last = lastOf(c, phase.ui === 'running', extra, word, w - used - 2)
 const fact = last === 'running' ? '' : last // the state word already says it; a host label such as `pending` still shows
 const factRuns: UiRun[] = fact && w - used > 6 ? [{ t: `  ${clip(fact.replace(/\s+/g, ' '), w - used - 2)}`, tone: 'sub' }] : []
 const tag = tierOf(i)
 const left = w - used - factRuns.reduce((n, x) => n + cells(x.t), 0)
 const tagRuns: UiRun[] = tag && left >= cells(tag) + 2 ? [{ t: `  ${tag}`, tone: 'muted' }] : []
 return el('Box', { flexDirection: 'column', flexShrink: 0 }, rowEl([...head, ...factRuns, ...tagRuns], ui))
}

/** Side by side when each card gets room for a 44-column box and a gap, else stacked; w is the per-card width (0 = unknown). */
const waveLayout = (columns: number, count: number): { side: boolean; w: number } => {
 const share = Math.floor(columns / count)
 const side = columns > 0 && share >= CARD_W + 1
 return { side, w: side ? CARD_W : columns > 0 ? Math.min(RAIL_W, columns) : 0 }
}
const waveHeader = (calls: ReadonlyArray<CallLike>, n: number) => {
 const live = calls.filter((c) => c.isRunning).length
 return t({ color: BRAND.accent, bold: true }, `WAVE ${n} · ${calls.length} workers${live ? ` · ${live} running` : ' · finished'}`)
}

/** WAVE strip: 2+ calls, all atlas Agent/Task. */
export function waveTree(calls: ReadonlyArray<CallLike>, n: number, columns: number, ui?: Ui): RenderElement | null {
 if (calls.length < 2 || !calls.every(isAtlasWorker)) return null
 const { side, w } = waveLayout(columns, calls.length)
 const cards = calls.map((c) => workerCard(c, phaseOf(c, 'finished').state, w, undefined, '', { wave: n, ...(ui ? { ui } : {}) }) as RenderElement)
 return el('Box', { flexDirection: 'column' }, waveHeader(calls, n),
  el('Box', { flexDirection: side ? 'row' : 'column', flexWrap: 'wrap' }, ...cards))
}

/** One row for a background atlas worker's task-notification: `● done  wave-a  explorer  outcome` (state, name, role, outcome). */
export function notificationTree(name: string, role: string, outcome: string, failed: boolean, ui: Ui = uiFromEnv(), aged = false): RenderElement {
 if (failed) return failedTree(name, outcome, ui, aged)
 const runs = toastRuns('done', displayName(name, role), clip([role, stripStatus(outcome)].filter(Boolean).join('  '), 80), ui)
 // An old card (critique 17 C3: cards held full colour for 40 frames) keeps its words and drops to the muted tone, unbold: the run has moved on.
 // The rail `▌` is the card's state colour and stays (critique 21: older cards turned wholly grey and lost it); the glyph run and the state word beside it stay too.
 const word = runs.findIndex((x) => x.t === 'done')
 return rowEl(aged ? runs.map((x, i) => (i === 0 || i === word || i === word - 1 ? x : { ...x, tone: 'muted' as const, bold: false })) : runs, ui)
}

/** A failure card carries one verb (critique 19 B4: `■ failed ghost-explorer explorer killed · 6s` said it twice): the end word the outcome leads with (`killed`, `failed`) is the state word,
 * the rest (`· 6s`, or the worker's own line) follows the name. An aged card keeps its glyph and word in the failure colour; only the name and the rest go muted. */
function failedTree(name: string, outcome: string, ui: Ui, aged: boolean): RenderElement {
 const m = /^\s*(killed|failed)\b[\s·:.,;-]*([\s\S]*)$/i.exec(stripStatus(outcome))
 const verb = m ? m[1]!.toLowerCase() : 'failed'
 const rest = clip((m ? m[2]! : stripStatus(outcome)).replace(/\s+/g, ' ').trim(), 80)
 const head = toastRuns('failed', displayName(name, ''), '', ui)
 const word = head.findIndex((x) => x.t === 'failed')
 const runs: UiRun[] = head.map((x, i) => (i === word ? { ...x, t: verb } : x))
 if (rest) runs.push({ t: ` · ${rest}`, tone: 'sub' })
 const stays = (i: number): boolean => i === 0 || (i <= word && i >= word - 1) // the rail, the glyph run and the state word
 return rowEl(aged ? runs.map((x, i) => (stays(i) ? x : { ...x, tone: 'muted' as const, bold: false })) : runs, ui)
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
