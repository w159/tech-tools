// Transcript restyles for parallel work: filled worker cards (Mocha truecolor, coloured left stripe),
// wave strips, channel bubbles. Pure tree builders (plain element data); restyle.tsx wires them to
// ToolUse / ToolGroup / UserMessage and falls back to next(e) on null or a throw.

import type { RenderElement, RenderNode } from 'claude-code'
import type { AgentState } from '../contract'
import { hexIn, PALETTE5, surfaceHex, uiFromEnv, type Run as UiRun, type Ui, type UiState, runHex } from '../atlas-ui'
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
 // rail card the finish uses, `▌ ◐ running  name  what it is doing` (no brand: only the finish card carries `◆ ATLAS`). The name is never cut: the fact is clipped to the room left, the model tag goes first.
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
const waveHeader = (calls: ReadonlyArray<CallLike>, n: number, ui: Ui) => {
 const live = calls.filter((c) => c.isRunning).length
 return t({ color: hexIn(PALETTE5.body, ui), bold: true }, `WAVE ${n} · ${calls.length} workers${live ? ` · ${live} running` : ' · finished'}`)
}

/** WAVE strip: 2+ calls, all atlas Agent/Task. */
export function waveTree(calls: ReadonlyArray<CallLike>, n: number, columns: number, ui?: Ui): RenderElement | null {
 if (calls.length < 2 || !calls.every(isAtlasWorker)) return null
 const { side, w } = waveLayout(columns, calls.length)
 const cards = calls.map((c) => workerCard(c, phaseOf(c, 'finished').state, w, undefined, '', { wave: n, ...(ui ? { ui } : {}) }) as RenderElement)
 return el('Box', { flexDirection: 'column' }, waveHeader(calls, n, ui ?? uiFromEnv()),
  el('Box', { flexDirection: side ? 'row' : 'column', flexWrap: 'wrap' }, ...cards))
}

/** Wave 30 (critique 28: the finish card was a bare `▌` line, the weakest element of the transcript): a finish or failure card is a small framed block. A half-block frame in the rule grey (236), a left edge in the
  * state's colour, the title line `▌ ◆ ATLAS  ● done  name  role finished · 0:15` (the capture scorer's one-line shape), and, only when the outcome has more to say, one content line. The card is as wide as its words (40 to 100 cells). */
const RULE = '#303030' // 236: the divider grey (PALETTE5.rule), the frame's rules
const frameCard = (title: UiRun[], content: string, ui: Ui): RenderElement => {
 const ascii = ui.ascii
 const edge = title[0]!.tone ?? 'text'
 const inner = Math.min(100, Math.max(40, cells(title.map((x) => x.t).join('')) + 2, content ? cells(content) + 4 : 0))
 const rule = (l: string, h: string, rr: string, lt: UiRun['tone']): UiRun[] => [{ t: l, tone: lt }, { t: h.repeat(Math.max(0, inner - 2)), tone: 'line', fg: RULE }, { t: rr, tone: 'line', fg: RULE }]
 const side = (runs: UiRun[], used: number): UiRun[] => [...runs, { t: ' '.repeat(Math.max(0, inner - 1 - used)), tone: 'text' }, { t: ascii ? '|' : '▐', tone: 'line', fg: RULE }]
 const titleUsed = cells(title.map((x) => x.t).join(''))
 const rows: UiRun[][] = [
  ascii ? rule('+', '-', '+', 'line') : rule('▛', '▀', '▜', edge),
  side(title, titleUsed),
  ...(content ? [side([{ t: ascii ? '|' : '▌', tone: ascii ? 'line' : edge }, { t: ` ${content}`, tone: 'sub' }], 1 + cells(` ${content}`))] : []),
  ascii ? rule('+', '-', '+', 'line') : rule('▙', '▄', '▟', edge),
 ]
 return el('Box', { flexDirection: 'column', flexShrink: 0 }, ...rows.map((x) => rowEl(x, ui)))
}

/** The outcome's first part (`finished`, `killed`) and time stay on the title line; what comes after the time is the content line. */
const splitOutcome = (text: string): { head: string; content: string } => {
 const parts = text.split(/\s+[·|]\s+/).map((x) => x.trim()).filter(Boolean)
 const timed = parts.length > 1 && /^\d+[smh]$|^\d+:\d\d$/.test(parts[1]!) ? 2 : 1
 return { head: parts.slice(0, timed).join(' · '), content: parts.slice(timed).join(' · ') }
}

/** One framed card for a background atlas worker's task-notification: `● done  wave-a  explorer finished · 0:15` (state, name, role, outcome), a second line only for a result. */
export function notificationTree(name: string, role: string, outcome: string, failed: boolean, ui: Ui = uiFromEnv(), _aged = false): RenderElement {
 if (failed) return failedTree(name, outcome, ui)
 // One grey per role on every card, old or new (critique 26): the name is body text (252), the role and the fact are secondary (245), the brand mark is 240. `_aged` is kept for the callers (transcript/placed.ts).
 const { head, content } = splitOutcome(stripStatus(outcome))
 return frameCard(toastRuns('done', displayName(name, role), clip([role, head].filter(Boolean).join(' '), 80), ui, true), clip(content, 90), ui) // the finish card keeps `◆ ATLAS` (dim, 240): the scorer finds a card by it
}

/** A failure card carries one verb, `killed` (critique 28: `closed`, `worker killed`, `failed` and `killed` were four words for one thing): the rest of the outcome (`6s`, or the worker's own line) follows the name. */
function failedTree(name: string, outcome: string, ui: Ui): RenderElement {
 const m = /^\s*(killed|failed)\b[\s·:.,;-]*([\s\S]*)$/i.exec(stripStatus(outcome))
 const rest = (m ? m[2]! : stripStatus(outcome)).replace(/\s+/g, ' ').trim()
 const { head, content } = splitOutcome(rest)
 const title = toastRuns('failed', displayName(name, ''), clip(head, 40), ui, true) // a finish card, so it keeps the dim `◆ ATLAS` like the done card
 return frameCard(title, clip(content, 90), ui)
}

/** Chat bubble for a message another agent or channel sent; null without a sender. */
export function bubbleTree(text: string, from: string | undefined, to = 'lead', columns = 0, ui: Ui = uiFromEnv()): RenderElement | null {
 if (!from || !text) return null
 const lines = text.split('\n').slice(0, 8)
 const bar = Array(lines.length + 1).fill('▌').join('\n')
 const body = columns > 4 ? lines.map((l) => fitText(l, columns - 3)).join('\n') : lines.join('\n')
 return el('Box', { flexDirection: 'row' },
  t({ color: hexIn(PALETTE5.secondary, ui) }, bar),
  el('Box', { flexDirection: 'column', paddingLeft: 1 },
   t({ color: hexIn(PALETTE5.body, ui), bold: true }, `#atlas ${from} › ${to}`),
   t({ color: hexIn(PALETTE5.body, ui) }, body)))
}
