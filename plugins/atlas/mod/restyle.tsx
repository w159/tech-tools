// Restyled built-in sites for the Atlas mod (plan docs/plans/2026-10-09-atlas-mod.md §3.3).
// Spinner, ToolUse (Agent/Task atlas personas), AssistantMessage, TurnDuration, PromptHint.
// Every site falls back to the engine's own drawing (`next(e)`) when the snapshot is
// missing, ATLAS_MOD=off, or anything in the draw path throws: restyles decorate, never break.

import { atom, read } from 'claude-code'
import type { AgentInfo, EngineInterface, On, RenderElement, RenderNode } from 'claude-code'
import { BRAND } from './contract'
import type { AgentState, AtlasSnapshot, Persona, PhaseId } from './contract'
import { fitText, glyph, phaseColor, stateColor, textWidth } from './theme'
import { activeCount, liveWorkers } from './data/live'
import type { LiveWorker } from './data/live'

// The live snapshot is read from $.state while drawing, so a snapshot write redraws
// exactly the restyled sites (null outside an atlas session).
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null)

// ---- structural props the tree builders read (sites' real props satisfy these) ----

export interface ToolUsePropsLike { tool: string; output?: unknown; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
export interface AssistantPropsLike { text: string; isFirstOfReply?: boolean; isSummary?: true }
export interface TurnDurationPropsLike { durationMs: number }
/** Turn-over-turn memory for the TurnDuration receipt (owned by one registerRestyle call). */
export interface ReceiptTracker { done?: number; costStart?: number | null }

// ---- plain element builders (StyledElement is plain data; no DOM, no globals) ----

type ElemProps = Record<string, string | number | boolean>
// 10+ call sites across the five sites: locks the StyledElement plain-data shape in one place.
const txt = (props: ElemProps, ...children: RenderNode[]): RenderElement => ({ type: 'Text', props, children })

// theme wrapper used at three sites; the try/catch is the never-throw acceptance contract
const phaseCol = (phase: PhaseId): string => {
 try { return phaseColor(phase) || BRAND.accent } catch { return BRAND.accent }
}

// Width-safe brand mark (1 cell everywhere).
const MARK = '▸'
export const PHASE_RE = /\b(research|theory|test|validate|implement|verify|done|blocked)\b/

// ---- pure formatters (exported for tests) ----

export function formatDuration(ms: number): string {
 const s = Math.max(0, Math.round(ms / 1000))
 if (s < 60) return `${s}s`
 const m = Math.floor(s / 60)
 if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
 return `${Math.floor(m / 60)}h${m % 60}m`
}

/** The persona behind an `atlas:<name>` subagentType, from the snapshot's roster. */
export function personaFor(snap: AtlasSnapshot, subagentType?: string): Persona | undefined {
 if (!subagentType || !subagentType.startsWith('atlas:')) return undefined
 const name = subagentType.slice('atlas:'.length)
 return snap.personas.find((p) => p.name === name)
}

// ---- Spinner: the engine's own spinner plus ` · ⏸ blocked · working tool` (header/band own phase and counts) ----

/** Squad + activity as live workers; a bare AtlasSnapshot has no activity, so every worker reads as working. */
const workersOf = (snap: AtlasSnapshot): LiveWorker[] => liveWorkers({ activity: {}, comms: [], todoGroups: [], ...snap }, snap.now)

export function spinnerSuffix(snap: AtlasSnapshot): string {
 const ws = workersOf(snap)
 const blocked = ws.find((w) => w.state === 'blocked')
 const parts = [
  ...(blocked ? [`⏸ ${blocked.name}`] : []),
  ...ws.filter((w) => w.state === 'working').slice(0, 2).map((w) => `${w.name} ${w.tool ?? ''}`.trim()),
 ]
 return parts.length ? ` ${glyph.dot} ${parts.join(` ${glyph.dot} `)}` : ''
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

// ---- AssistantMessage: the ATLAS contract header drawn on one styled row; headerless replies stay engine-drawn ----

/** `ATLAS | ⚒ implement 3/5 | sentence` — the header line drawn in place verbatim, body kept under it. */
export function assistantTree(snap: AtlasSnapshot, props: AssistantPropsLike, columns = 0): RenderElement | null {
 if (props.isSummary || !props.text) return null
 const first = props.text.split('\n', 1)[0] ?? ''
 let re: RegExp
 try { re = new RegExp(snap.contract.headerFirstLinePattern) } catch { return null }
 if (!re.test(first)) return null
 const [, mid = '', ...tail] = first.split('|')
 const phase = (PHASE_RE.exec(mid)?.[1] ?? snap.phase) as PhaseId
 const nm = /(\d+)\s*\/\s*(\d+)/.exec(mid)
 const label = (nm ? mid.replace(nm[0], '') : mid).trim()
 const rest = props.text.slice(first.length).replace(/^\n/, '')
 const fixed = { wrap: 'truncate-end' }
 const kids: RenderNode[] = [
  txt({ ...fixed, color: BRAND.accent, inverse: true, bold: true }, ' ATLAS '),
  txt(fixed, '| '),
  txt({ ...fixed, color: phaseCol(phase), bold: true }, label),
 ]
 if (nm) kids.push(txt({ ...fixed, color: BRAND.dim, dimColor: true }, ` ${nm[1]}/${nm[2]}`))
 const sentence = tail.join('|').trim()
 if (sentence) {
  kids.push(txt(fixed, ' | '))
  const used = kids.reduce<number>((n, k) => n + textWidth((k as { children: string[] }).children[0] ?? ''), 0)
  // ponytail: columns 0 = width unknown, sentence drawn whole; the truncate-end wrap is the backstop.
  kids.push(txt({ wrap: 'truncate-end' }, columns > used ? fitText(sentence, columns - used) : sentence))
 }
 const row: RenderElement = { type: 'Box', props: { flexDirection: 'row', flexShrink: 0 }, children: kids }
 if (!rest.trim()) return row
 return { type: 'Box', props: { flexDirection: 'column' }, children: [row, { type: 'Markdown', props: { text: rest } }] }
}

// ---- TurnDuration: `▸ 4m12s · +3 done · 2 workers · ctx 41% · $0.12` ----

/** This turn's dollar cost: the engine's session total at turn end minus at turn start.
 *  null when either reading is absent or the delta is 0: no figure beats a guessed one. */
export function turnCostText(start: number | null | undefined, end: number | null | undefined): string | null {
 if (start == null || end == null || end <= start) return null
 return `$${(end - start).toFixed(2)}`
}

export function durationTree(snap: AtlasSnapshot, props: TurnDurationPropsLike, tracker: ReceiptTracker, costNow: number | null = null): RenderElement {
 const delta = snap.counts.done - (tracker.done ?? snap.counts.done)
 const active = activeCount(workersOf(snap))
 const parts = [
  formatDuration(props.durationMs),
  delta > 0 ? `+${delta} done` : null,
  active > 0 ? `${active} workers` : null,
  snap.contextPct > 0 ? `ctx ${snap.contextPct}%` : null,
  turnCostText(tracker.costStart, costNow),
 ].filter((part): part is string => part !== null)
 tracker.done = snap.counts.done
 return txt({ dimColor: true },
  txt({ color: BRAND.accent }, `${MARK} `),
  parts.join(' · '),
 )
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
 const tracker: ReceiptTracker = {}

 // The clock that bumps spinnerTick lives in register.ts; reading it while drawing
 // subscribes this Spinner instance so each tick redraws the globe.
 on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   return next(snap ? { ...e, props: { ...e.props, suffix: spinnerSuffix(snap) } } : e)
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
   return snap ? (assistantTree(snap, e.props, e.viewport?.columns ?? 0) ?? next(e)) : next(e)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   return snap ? durationTree(snap, e.props, tracker, await sessionCostUsd($)) : next(e)
  } catch { return next(e) }
 })

 // Cost baseline at turn start; the receipt prints the delta.
 on('turn.start', async ($, e, next) => {
  tracker.costStart = await sessionCostUsd($)
  return next(e)
 })
}
