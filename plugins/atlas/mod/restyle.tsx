// Restyled built-in sites for the Atlas mod (plan docs/plans/2026-10-09-atlas-mod.md §3.3).
// Spinner, ToolUse (Agent/Task atlas personas), AssistantMessage, TurnDuration, PromptHint.
// Every site falls back to the engine's own drawing (`next(e)`) when the snapshot is
// missing, ATLAS_MOD=off, or anything in the draw path throws: restyles decorate, never break.

import { atom, read } from 'claude-code'
import type { AgentInfo, EngineInterface, On, RenderElement, RenderNode } from 'claude-code'
import { BRAND } from './contract'
import type { AgentState, AtlasSnapshot, Persona, PhaseId } from './contract'
import { bar, dim, glyph, phaseColor, stateColor } from './theme'

// The live snapshot is read from $.state while drawing, so a snapshot write redraws
// exactly the restyled sites (null outside an atlas session).
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null)

// ---- structural props the tree builders read (sites' real props satisfy these) ----

export interface SpinnerPropsLike { word: string; message: string | null }
export interface ToolUsePropsLike { tool: string; output?: unknown; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
export interface AssistantPropsLike { text: string; isFirstOfReply?: boolean; isSummary?: true }
export interface TurnDurationPropsLike { durationMs: number }
/** Turn-over-turn memory for the TurnDuration receipt (owned by one registerRestyle call). */
export interface ReceiptTracker { phase?: PhaseId; done?: number; costStart?: number | null; usage?: TurnUsageLike | null }
/** The token counts a turn.complete carries (the API's own spelling). */
export interface TurnUsageLike { input_tokens: number; output_tokens: number; cache_read_input_tokens: number }

// ---- plain element builders (StyledElement is plain data; no DOM, no globals) ----

type ElemProps = Record<string, string | number | boolean>
// 10+ call sites across the five sites: locks the StyledElement plain-data shape in one place.
const txt = (props: ElemProps, ...children: RenderNode[]): RenderElement => ({ type: 'Text', props, children })

// theme wrapper used at three sites; the try/catch is the never-throw acceptance contract
const phaseCol = (phase: PhaseId): string => {
 try { return phaseColor(phase) || BRAND.accent } catch { return BRAND.accent }
}

/** Braille spinner: 8 one-cell frames.
 *  ponytail: text glyphs, not a Raster 4x2 — Raster is terminal-only and needs blit plumbing;
 *  upgrade via sprites/grid.ts frameToCells when the pixel globe is wanted. */
const GLOBE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧'] as const
const GLOBE_TICK_MS = 120
// Width-safe brand mark (1 cell everywhere).
const MARK = '▸'
// contract: types/index.d.ts (PluginState.atlas.spinnerTick)
const SPINNER_TICK = { plugin: 'atlas', key: 'spinnerTick' } as const

export const PHASE_RE = /\b(research|theory|test|validate|implement|verify|done|blocked)\b/

// ---- pure formatters (exported for tests) ----

export function formatDuration(ms: number): string {
 const s = Math.max(0, Math.round(ms / 1000))
 if (s < 60) return `${s}s`
 const m = Math.floor(s / 60)
 if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
 return `${Math.floor(m / 60)}h${m % 60}m`
}

export function fmtTok(n: number): string {
 if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
 if (n >= 1000) return `${Math.round(n / 1000)}k`
 return String(Math.round(n))
}

export function phaseCount(snap: AtlasSnapshot, phase: PhaseId): { done: number; total: number } {
 return snap.counts.byPhase[phase] ?? { done: 0, total: 0 }
}

/** `⟦implement 3/5⟧` — the phase capsule (counts omitted when the phase has no items). */
export function capsule(snap: AtlasSnapshot, phase: PhaseId = snap.phase): string {
 const { done, total } = phaseCount(snap, phase)
 return total > 0 ? `⟦${phase} ${done}/${total}⟧` : `⟦${phase}⟧`
}

/** The persona behind an `atlas:<name>` subagentType, from the snapshot's roster. */
export function personaFor(snap: AtlasSnapshot, subagentType?: string): Persona | undefined {
 if (!subagentType || !subagentType.startsWith('atlas:')) return undefined
 const name = subagentType.slice('atlas:'.length)
 return snap.personas.find((p) => p.name === name)
}

// ---- Spinner: `◐ ⟦implement 3/5⟧ ▰▰▰▱▱ Sauteing · impl-auth editing hooks/…` ----

export function spinnerTree(snap: AtlasSnapshot, props: SpinnerPropsLike, tickMs: number): RenderElement {
 const { done, total } = phaseCount(snap, snap.phase)
 const frame = GLOBE[Math.floor(tickMs / GLOBE_TICK_MS) % GLOBE.length] ?? '⠋'
 const activity: string[] = [props.message || props.word]
 const live = snap.squad.filter((a) => a.state === 'running' || a.state === 'spawning')
 if (live.length > 0) activity.push(`${live.length} agent${live.length === 1 ? '' : 's'}`)
 for (const a of live.slice(0, 1)) activity.push(`${a.name} ${a.task ?? ''}`.trim())
 const meter = total > 0 ? ` ${bar((done / total) * 100, 5)}` : ''
 return txt({},
  txt({ color: BRAND.accent }, `${frame} `),
  txt({ color: phaseCol(snap.phase), inverse: true, bold: true }, `${capsule(snap)}${meter}`),
  txt({}, ' '),
  txt({ dimColor: true }, activity.join(` ${glyph.dot} `)),
 )
}

// ---- ToolUse: deployment card for persona spawns; one-line summary for huge Bash/Read/Grep output ----

const NOISY = new Set(['Bash', 'Read', 'Grep'])
const NOISY_BYTES = 8000

function fmtBytes(n: number): string {
 return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}MB` : n >= 1000 ? `${(n / 1000).toFixed(1)}kB` : `${n}B`
}

const isSettled = (p: ToolUsePropsLike): boolean => !p.isRunning && !p.isErrored && !p.isInterrupted

const isNoisyCandidate = (p: ToolUsePropsLike & { output?: unknown }): boolean =>
  NOISY.has(p.tool) && isSettled(p) && p.output != null

const outputSize = (output: unknown): number => {
  try { return typeof output === 'string' ? output.length : JSON.stringify(output).length } catch { return 0 }
}

const targetText = (i: { command?: string; file_path?: string; pattern?: string }): string =>
  String(i.command ?? i.file_path ?? i.pattern ?? '')

const toolTarget = (input: unknown): string =>
  targetText((input ?? {}) as { command?: string; file_path?: string; pattern?: string }).split('\n', 1)[0]?.slice(0, 60) ?? ''


/** `Bash npm test ▸ 48.2kB` for a finished call whose output is huge; null keeps the engine's row. */
export function noisyTree(props: ToolUsePropsLike & { output?: unknown }): RenderElement | null {
  if (!isNoisyCandidate(props)) return null
  const size = outputSize(props.output)
  if (size < NOISY_BYTES) return null
  return txt({},
    txt({ color: BRAND.subagent, bold: true }, `${props.tool} `),
    txt({ color: BRAND.dim }, toolTarget(props.input)),
    txt({ color: BRAND.accent, inverse: true }, ` ▸ ${fmtBytes(size)} `),
  )
}

const STATUS_TO_STATE: Record<string, AgentState> = {
 pending: 'spawning', running: 'running', waiting: 'input', idle: 'idle',
 completed: 'finished', failed: 'failed', killed: 'dead',
}

function agentStatus(
 agents: AgentInfo[],
 input: { subagentType?: string; name?: string; description?: string },
 props: ToolUsePropsLike,
): { state: AgentState; label: string; name?: string } {
 const agent =
  (input.name ? agents.find((a) => a.name === input.name) : undefined) ??
  (input.description ? agents.find((a) => a.description === input.description) : undefined) ??
  (props.isRunning && input.subagentType
   ? agents.find((a) => a.type === input.subagentType && a.status === 'running')
   : undefined)
 const raw =
  agent?.status ??
  (props.isRunning ? 'running' : props.isErrored ? 'failed' : props.isInterrupted ? 'killed' : 'completed')
 return { state: STATUS_TO_STATE[raw] ?? 'running', label: raw, name: agent?.name }
}

/** Deployment card: `▸ impl-auth implementer sonnet·low · running`. Null keeps the engine's row. */
export function toolUseTree(snap: AtlasSnapshot, props: ToolUsePropsLike, agents: AgentInfo[]): RenderElement | null {
 if (props.tool !== 'Agent' && props.tool !== 'Task') return noisyTree(props)
 const input = (props.input ?? {}) as { subagentType?: string; name?: string; description?: string }
 const persona = personaFor(snap, input.subagentType)
 if (!persona) return null
 const status = agentStatus(agents, input, props)
 const name = input.name ?? status.name ?? persona.name
 let statusHex: string
 try { statusHex = stateColor(status.state) || BRAND.idle } catch { statusHex = BRAND.idle }
 return txt({},
  txt({ color: BRAND.accent, bold: true }, `${MARK} `),
  txt({ color: BRAND.text, bold: true }, `${name} `),
  txt({ color: BRAND.subagent }, `${persona.name} `),
  txt({ color: BRAND.dim }, `${persona.model}·${persona.effort}`),
  txt({ color: statusHex }, ` ${glyph.dot} ${status.label}`),
 )
}

// ---- AssistantMessage: header line as a coloured phase pill; else a dim inferred pill ----

/** ` ▸ implement 3/5 ` pill, reply body kept under it (header line swapped for the pill). */
export function assistantTree(snap: AtlasSnapshot, props: AssistantPropsLike): RenderElement | null {
 if (props.isSummary || !props.text) return null
 const first = props.text.split('\n', 1)[0] ?? ''
 let re: RegExp
 try { re = new RegExp(snap.contract.headerFirstLinePattern) } catch { return null }
 if (!re.test(first)) {
  if (!props.isFirstOfReply) return null
  let inferred: string
  try { inferred = dim(phaseCol(snap.phase), 0.55) || BRAND.dim } catch { inferred = BRAND.dim }
  return {
   type: 'Box',
   props: { flexDirection: 'column' },
   children: [
    txt({ color: inferred, dimColor: true }, `${MARK} ${snap.phase} · inferred`),
    { type: 'Markdown', props: { text: props.text } },
   ],
  }
 }
 const phase = (PHASE_RE.exec(first)?.[1] ?? snap.phase) as PhaseId
 const nm = /(\d+)\s*\/\s*(\d+)/.exec(first)
 const count = nm && nm[1] && nm[2] ? ` ${nm[1]}/${nm[2]}` : ''
 const rest = props.text.slice(first.length).replace(/^\n/, '')
 const kids: RenderNode[] = [
  txt({ color: phaseCol(phase), inverse: true, bold: true }, ` ${MARK} ${phase}${count} `),
 ]
 if (rest.trim()) kids.push({ type: 'Markdown', props: { text: rest } })
 return { type: 'Box', props: { flexDirection: 'column' }, children: kids }
}

// ---- TurnDuration: `▸ 4m12s · research ▸ implement · +3 done · 2 agents · 12k in / 1k out · turn $0.12` ----

/** This turn's dollar cost: the engine's session total at turn end minus at turn start.
 *  null when either reading is absent (the host keeps no ledger): no figure beats a guessed one. */
export function turnCostText(start: number | null | undefined, end: number | null | undefined): string | null {
 if (start == null || end == null || end < start) return null
 return `turn $${(end - start).toFixed(2)}`
}

/** Tokens the turn spent, as the API reported them on turn.complete (never context-window fill). */
export function turnTokensText(usage: TurnUsageLike | null | undefined): string | null {
 if (!usage) return null
 const cached = usage.cache_read_input_tokens > 0 ? ` (+${fmtTok(usage.cache_read_input_tokens)} cached)` : ''
 return `${fmtTok(usage.input_tokens)} in / ${fmtTok(usage.output_tokens)} out${cached}`
}

function receiptFigures(snap: AtlasSnapshot, tracker: ReceiptTracker, costNow: number | null): string[] {
 const ctx = snap.contextPct > 0 ? `ctx ${snap.contextPct}%` : null
 return [turnTokensText(tracker.usage), ctx, turnCostText(tracker.costStart, costNow)].filter((part): part is string => part !== null)
}

export function durationTree(snap: AtlasSnapshot, props: TurnDurationPropsLike, tracker: ReceiptTracker, costNow: number | null = null): RenderElement {
 const parts: string[] = [formatDuration(props.durationMs)]
 parts.push(tracker.phase && tracker.phase !== snap.phase ? `${tracker.phase} ▸ ${snap.phase}` : snap.phase)
 const delta = snap.counts.done - (tracker.done ?? snap.counts.done)
 if (delta > 0) parts.push(`+${delta} done`)
 if (snap.squad.length > 0) parts.push(`${snap.squad.length} agents`)
 parts.push(...receiptFigures(snap, tracker, costNow))
 tracker.phase = snap.phase
 tracker.done = snap.counts.done
 return txt({ dimColor: true },
  txt({ color: BRAND.accent }, `${MARK} `),
  parts.join(' · '),
 )
}

// ---- PromptHint: contextual chords + the next contract step as the box's dim suggestion ----

export const HINT_TAIL = `/atlas-cc Command Center ${glyph.dot} /atlas-say @name …`

/** The next contract step to propose after a turn (`check: impl-auth …`), or null when none. */
export function nextStepText(snap: AtlasSnapshot): string | null {
 const wip = snap.todos.find((td) => td.status === 'in_progress')
 const open = snap.todos.find((td) => td.status === 'pending')
 const pick = wip ?? open
 if (!pick) return snap.counts.total > 0 ? 'atlas: record evidence and close the run' : null
 const who = wip?.owner ? ` ${wip.owner}` : ''
 const text = `${wip ? 'check' : 'next'}:${who} ${pick.content}`
 return text.length > 72 ? `${text.slice(0, 71)}…` : text
}

// ---- registration ----

/** Resolves the snapshot a site may restyle with: null when the mod is off.
 *  `cache` holds the per-registration ATLAS_MOD read; registerRestyle owns one.
 *  ponytail: read once per registration (one per session); a mid-session flip
 *  to off is picked up on reload. */
async function ready($: EngineInterface, cache: { envOff?: boolean }): Promise<AtlasSnapshot | null> {
 if (cache.envOff === undefined) cache.envOff = (await $.env.get('ATLAS_MOD')) === 'off'
 return cache.envOff ? null : await read($, snapshotState)
}

/** The engine-measured session cost in USD, or null where the host keeps no ledger. */
async function sessionCostUsd($: EngineInterface): Promise<number | null> {
 try { return (await $.session.usage()).cost?.usd ?? null } catch { return null }
}

export function registerRestyle(on: On): void {
 const cache: { envOff?: boolean } = {}
 const lastSuggest: { text?: string } = {}
 const tracker: ReceiptTracker = {}

 // The engine caches a ui.render answer, so the globe would freeze between data changes.
 // Reading $.state while drawing subscribes this one instance: each tick write redraws
 // only the Spinner. The timer runs only while the Spinner is mounted (a turn is working).
 const ticker: { n: number; isDrawn: boolean; cancel?: () => void } = { n: 0, isDrawn: false }

 on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   if (!snap) return next(e)
   const { value } = await $.state.get(SPINNER_TICK)
   ticker.isDrawn = true
   if (!ticker.cancel) {
    const handle = $.clock.every(GLOBE_TICK_MS, () => {
     // Each tick write redraws a mounted Spinner, which sets isDrawn again. A tick that
     // finds it unset means the Spinner unmounted (turn over): stop, nothing ticks idle.
     // (routing.ts already owns the one matcherless turn.complete hook, so no second.)
     if (!ticker.isDrawn) { ticker.cancel?.(); ticker.cancel = undefined; return }
     ticker.isDrawn = false
     ticker.n += 1
     void $.state.set(SPINNER_TICK, ticker.n).catch(() => undefined)
    })
    ticker.cancel = () => handle.cancel()
   }
   return spinnerTree(snap, e.props, (value ?? 0) * GLOBE_TICK_MS)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   if (!snap) return next(e)
   const agents = await $.agent.list().catch(() => [] as AgentInfo[])
   return toolUseTree(snap, e.props, agents) ?? next(e)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   return snap ? (assistantTree(snap, e.props) ?? next(e)) : next(e)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   return snap ? durationTree(snap, e.props, tracker, await sessionCostUsd($)) : next(e)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   if (!snap) return next(e)
   if (!e.props.isDraft && !e.props.isWorking) {
    const text = nextStepText(snap)
    if (text && text !== lastSuggest.text) {
     lastSuggest.text = text
     void $.prompt.suggest({ text }).catch(() => undefined)
    }
   }
   return next({ ...e, props: { ...e.props, tail: HINT_TAIL } })
  } catch { return next(e) }
 })

 // Per-turn figures: cost baseline at turn start, token counts from the main loop's turn.complete.
 on('turn.start', async ($, e, next) => {
  tracker.costStart = await sessionCostUsd($)
  tracker.usage = null
  return next(e)
 })

 on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
  if (e.agentId === undefined) tracker.usage = e.usage ?? null
  return next(e)
 })
}
