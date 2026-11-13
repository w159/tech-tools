// Transcript restyles for parallel work: filled worker cards (Mocha truecolor, coloured left stripe),
// wave strips, channel bubbles. Pure tree builders (plain element data); restyle.tsx wires them to
// ToolUse / ToolGroup / UserMessage and falls back to next(e) on null or a throw.

import type { RenderElement, RenderNode } from 'claude-code'
import type { AgentState } from '../contract'
import { brandMark, elapsedClock, hexIn, PALETTE5, stateRun, stateWordTone, surfaceHex, uiFromEnv, type Run as UiRun, type Ui, type UiState, runHex } from '../atlas-ui'
import { CARD_W, cardBarTone, toastRuns } from '../panel-layout'
import { cells } from '../atlas-ui'
import { clipE as clip, ELLIPSIS } from '../board-model'
import { displayName } from '../hud'
import { workerFacts, type WorkerFacts } from '../data/live'
import { fitText } from '../theme'
import { wordOf } from '../pane/activity'

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
export interface CardExtra { ui?: Ui; /** 0..1: how far the card's bar has faded 141 -> 245 (placed.ts barFade). */ fade?: number; /** The shared spinner frame (the beat counter): the start card's braille turns with it. */ frame?: number; mark?: string; outcome?: string; ended?: string; now?: string; wave?: number; steps?: { done: number; total: number }; ctx?: number }

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
 const head = toastRuns(phase.ui, cardName, '', ui, false, extra.frame ?? 0, extra.fade ?? 0)
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

/** Wave 31 (critique 29: the framed finish card wrapped to `● don` / `e` at 110 columns and stacked at ragged widths 42/62/61): a finish or failure card is ONE row, as wide as `min(56, cols - 4)` and never wrapped,
 * like a gum toast. `▌ ◆ ATLAS  ● done  beta-explorer  explorer finished  0:13`: the bar, the dim brand mark, the state glyph and word, the name (cut with `…`, `~` in ASCII, before anything else
 * is dropped), what the worker was, and its time flush right. The capture scorer finds a card by `▌ ◆ ATLAS  <glyph> <word> <name>  <role> finished` on one line. Every card's bar fades 141 -> 245
 * (`fade` 0..1, from the card's age), a failure's too (wave 33): the glyph and the word carry the 203. */
export const FINISH_W = 56
export const finishWidth = (cols: number): number => Math.max(24, Math.min(FINISH_W, cols > 0 ? cols - 4 : FINISH_W))
const TIME_RE = /\b\d+:\d\d(?::\d\d)?\b/
export interface FinishOpts { /** The worker's name as the SUBAGENTS row keys it: the card reads its TIME and CALLS cells (data/live workerFacts). */ who?: string; cols?: number; fade?: number; /** The worker's tool calls: `· 3 calls` after the time (wave 34, critique 33: `3 fn` counted tool calls, and the worker had reported 2 functions). Absent: the time alone. */ calls?: number; /** The functions the worker reported: `· 2 fn`. Only a count taken from what the worker reported may say `fn`; nothing in the mod's inputs carries one today. */ fns?: number; /** One more fact after the name (the run card's `5/5 done`). */ fact?: string; /** The run's own finish card: no name, the fact is what follows the state word. */ run?: boolean; /** The TIME and CALLS cells frozen when the card was placed (truth 39: a placed card is never rewritten by a table that moves on); absent: the live cells. */ facts?: WorkerFacts; /** A blocked card: the bar is 203 for good, the word is `blocked`, the name slot holds `· <reason>`. */ blocked?: boolean }

function finishRow(state: 'done' | 'failed' | 'blocked', name: string, fact: string, time0: string, ui: Ui, o: FinishOpts): RenderElement {
 // Wave 37 (critique 36: beta's card with no count beside gamma's `3 calls`): every worker card ends in the same flush-right calls column, a dash where the count is unknown. The run's own card has no such column.
  let time = time0
  // State 38: a worker card prints the TIME and CALLS cells of its SUBAGENTS row (data/live workerFacts) whenever the table has drawn that worker.
 const facts = o.run ? undefined : o.facts ?? (o.who ? workerFacts(o.who) : undefined)
 const count = o.run || o.blocked ? '' : facts ? (facts.calls === '-' ? '-' : `${facts.calls} ${facts.calls === '1' ? 'call' : 'calls'}`) : o.fns !== undefined && o.fns > 0 ? `${o.fns} fn` : o.calls !== undefined && o.calls > 0 ? `${o.calls} ${o.calls === 1 ? 'call' : 'calls'}` : '-'
 if (facts) time = facts.time
 const figure = time && count ? `${time} ${ui.ascii ? '|' : '·'} ${count}` : time || count // `0:12 · 3 calls`, `0:12 · -`: the run time, then what the figure counts
 const w = finishWidth(o.cols ?? 0)
 const g = stateRun(state, ui)
 const bar: UiRun = { t: ui.ascii ? '|' : '▌', tone: ui.ascii ? 'text' : state === 'blocked' ? 'bad' : cardBarTone(o.fade ?? 0) } // wave 33: one bar for every card kind, 141 for the first second, 245 after (a failure too: the state glyph and word carry 203)
 const headOf = (sep: string): UiRun[] => [bar, { t: ' ', tone: 'text' }, ...(ui.ascii ? brandMark(ui) : [{ t: '◆ ', tone: 'accent' } as UiRun, { t: 'ATLAS', tone: 'accent' } as UiRun]), { t: '  ', tone: 'text' }, { ...g, t: `${g.t} ` }, { t: wordOf(state), tone: stateWordTone(state, ui), bold: true }, { t: sep, tone: 'text' }]
 let head = headOf(o.blocked ? ' ' : '  ')
 const tail: UiRun[] = fact ? [{ t: `  ${fact}`, tone: 'sub' }] : []
 const used = (xs: UiRun[]): number => xs.reduce((n, x) => n + cells(x.t), 0)
 let timeW = figure ? cells(figure) + 1 : 0
 let room = w - used(head) - used(tail) - timeW
 if (room < 6 && figure) { timeW = 0; room = w - used(head) - used(tail) } // no room for the time beside a name: the name wins
 if (cells(name) === room + 1) { head = headOf(' '); room += 1 } // one cell short of the whole name: the gap after the state word gives it up before the name is cut
 const label = clip(name, Math.max(1, room)).replace(ELLIPSIS, ui.ascii ? '~' : ELLIPSIS)
 const gap = Math.max(timeW ? 1 : 0, w - used(head) - cells(label) - used(tail) - (timeW ? cells(figure) : 0))
 const runs: UiRun[] = [...head, { t: label, tone: 'text' }, ...tail, ...(timeW ? [{ t: ' '.repeat(gap), tone: 'text' } as UiRun, { t: figure, tone: 'muted' } as UiRun] : [])]
 return el('Box', { flexDirection: 'column', flexShrink: 0 }, rowEl(runs, ui))
}

/** The outcome's time (`0:15`) from `finished · 0:15` or `killed · 0:05`; a bare seconds figure (`15s`) reads as the clock. */
const timeOf = (text: string): string => {
 const m = TIME_RE.exec(text)
 if (m) return m[0]
 const s = /\b(\d+)s\b/.exec(text)
 return s ? elapsedClock(Number(s[1])) : ''
}

/** The blocked card (truth 39): `▌ ◆ ATLAS  ▲ blocked · stop refused  0:36`, a 203 bar, printed once when the band first reads blocked. `reason` is the band's own wording (data/runstate blockedText); `time` the band's clock. */
export function blockedTree(reason: string, time: string, ui: Ui = uiFromEnv(), o: FinishOpts = {}): RenderElement {
 return finishRow('blocked', reason ? `\u00b7 ${reason}` : '', '', time, ui, { ...o, blocked: true, run: false })
}

/** One row for a background atlas worker's task-notification: `● done  wave-a  explorer finished  0:15` (state, name, role, time). The worker's result line lives in the HUD's RESULT column, not on a second row. */
export function notificationTree(name: string, role: string, outcome: string, failed: boolean, ui: Ui = uiFromEnv(), _aged = false, o: FinishOpts = {}): RenderElement {
 const text = stripStatus(outcome)
 if (o.run) return finishRow('done', o.fact ?? '', '', timeOf(text), ui, o)
 if (failed) return finishRow('failed', displayName(name, ''), '', timeOf(text), ui, { ...o, who: name })
 return finishRow('done', displayName(name, role), o.fact ?? '', timeOf(text), ui, { ...o, who: name }) // wave 32 (critique 30): `● done` says it once; no `explorer finished` after the name
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
