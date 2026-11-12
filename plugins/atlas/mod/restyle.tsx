// Restyled built-in sites for the Atlas mod (plan docs/plans/2026-10-09_atlas-mod.md §3.3).
// Spinner, ToolUse (Agent/Task atlas personas), AssistantMessage, TurnDuration, PromptHint.
// Every site falls back to the engine's own drawing (`next(e)`) when the snapshot is
// missing, ATLAS_MOD=off, or anything in the draw path throws: restyles decorate, never break.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On, RenderElement, RenderNode } from 'claude-code'
import { BRAND } from './contract'
import { PHASES } from './intents'
import type { AgentState, AtlasSnapshot, Persona, PhaseId } from './contract'
import { contractGlyph, formatDuration, glyph, MOCHA, phaseHue } from './theme'
import { MARK as BRAND_MARK, shortTool } from './band'
import type { ActivityEntry, LiveSnapshot } from './orchestra-types'
import { activeCount, liveWorkers } from './data/live'
import type { LiveWorker } from './data/live'
import { bubbleTree, waveTree, workerCard } from './transcript/cards'
import type { CardExtra } from './transcript/cards'
import { cardExtra, launchedId, notificationRow } from './transcript/outcome'
import { hideNotification, placedTree } from './transcript/placed'
import { lookOf } from './look'
import type { Outcome } from './transcript/outcome'

// The live snapshot is read from $.state while drawing, so a snapshot write redraws
// exactly the restyled sites (null outside an atlas session).
const snapshotState = atom({ plugin: 'atlas', key: 'snapshot' } as const, null)
const headerPhaseState = atom({ plugin: 'atlas', key: 'headerPhase' } as const, null) // register.ts sets it per answer

// ---- structural props the tree builders read (sites' real props satisfy these) ----

export interface ToolUsePropsLike { tool: string; output?: unknown; input: unknown; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }
export interface AssistantPropsLike { text: string; isFirstOfReply?: boolean; isSummary?: true }
export interface TurnDurationPropsLike { durationMs: number }
/** Turn-over-turn memory for the TurnDuration receipt (owned by one registerRestyle call). */
export interface ReceiptTracker { done?: number; turnStart?: number | null }

// ---- plain element builders (StyledElement is plain data; no DOM, no globals) ----

type ElemProps = Record<string, string | number | boolean>
// 10+ call sites across the five sites: locks the StyledElement plain-data shape in one place.
const txt = (props: ElemProps, ...children: RenderNode[]): RenderElement => ({ type: 'Text', props, children })

// Width-safe brand mark (1 cell everywhere).
const MARK = '▸'
export const PHASE_RE = /\b(research|theory|test|validate|implement|verify|done|blocked)\b/

/** The one header parser: PhaseId the answer's first line pins (`ATLAS | <glyph> <phase>[ n/m] | <state>`), else null. */
export function headerPhaseOf(answer: string, snapshot: AtlasSnapshot | null): PhaseId | null {
 const pattern = snapshot?.contract.headerFirstLinePattern ?? ''
 if (pattern === '') return null
 const firstLine = answer.split('\n', 1)[0] ?? ''
 let re: RegExp
 try {
  re = new RegExp(pattern)
 } catch {
  return null
 }
 if (!re.test(firstLine)) return null
 const phase = PHASE_RE.exec(firstLine)?.[1]
 return phase !== undefined && (PHASES as readonly string[]).includes(phase) ? (phase as PhaseId) : null
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

/** Status when the session lists no agent for the call: no output and not running = the call is still being written. */
const fallbackStatus = (props: ToolUsePropsLike): string => {
 if (props.isRunning) return 'running'
 if (props.isErrored) return 'failed'
 if (props.isInterrupted) return 'killed'
 return props.output === undefined ? 'pending' : 'completed'
}

function agentStatus(
 agents: AgentInfo[],
 input: { subagentType?: string; name?: string; description?: string },
 props: ToolUsePropsLike,
): { state: AgentState; label: string; name?: string } {
 const id = launchedId(props.output)
 const agent =
  (id ? agents.find((a) => a.id === id) : undefined) ??
  (input.name ? agents.find((a) => a.name === input.name) : undefined) ??
  (input.description ? agents.find((a) => a.description === input.description) : undefined) ??
  (props.isRunning && input.subagentType
   ? agents.find((a) => a.type === input.subagentType && a.status === 'running')
   : undefined)
 const raw = agent?.status ?? fallbackStatus(props)
 return { state: STATUS_TO_STATE[raw] ?? 'running', label: raw, name: agent?.name }
}

/** Deployment card: bordered `◆ impl-auth · implementer · sonnet·low ● running`. Null keeps the engine's row. */
export function toolUseTree(snap: AtlasSnapshot, props: ToolUsePropsLike, agents: AgentInfo[], columns = 0, extra: CardExtra = {}): RenderElement | null {
 if (props.tool !== 'Agent' && props.tool !== 'Task') return noisyTree(props)
 const input = (props.input ?? {}) as { subagentType?: string; subagent_type?: string; name?: string; description?: string }
 const persona = personaFor(snap, input.subagentType ?? input.subagent_type)
 if (!persona) return null
 const status = agentStatus(agents, { ...input, subagentType: input.subagentType ?? input.subagent_type }, props)
 const call = { ...props, input: { model: persona.model, effort: persona.effort, ...input } }
 const now = nowOf(snap, status.name ?? input.name)
 // A worker the mod saw end is finished whatever the host row still says (cardExtra read the same record the HUD row does).
 const ended = extra.ended !== undefined && extra.ended !== '' && !call.isRunning
 const state = ended && (status.state === 'running' || status.state === 'spawning' || status.state === 'input') ? 'finished' : status.state
 return workerCard(call, state, columns > 8 ? columns - 2 : 0, status.name ?? persona.name, ended && state !== status.state ? 'completed' : status.label, { ...(now ? { now } : {}), ...extra })
}

const activityOf = (snap: AtlasSnapshot, name?: string): ActivityEntry | undefined => (snap as Partial<LiveSnapshot>).activity?.[name ?? '']

/** `ctx_read register.ts` from the tool in flight, else the last one; '' before the first call. */
const doingOf = (a: ActivityEntry): string => {
 const tool = a.tool ?? a.lastTool
 return tool ? `${shortTool(tool)} ${a.target ?? ''}`.trim() : ''
}

/** What a live worker is doing, from the snapshot's activity: `ctx_read register.ts · 1m12s · 9 tools`. */
function nowOf(snap: AtlasSnapshot, name?: string): string {
 const a = activityOf(snap, name)
 if (!a) return ''
 return [doingOf(a), `${formatDuration(snap.now - (a.startedAt ?? a.since))} · ${a.toolCount} tools`].filter(Boolean).join(' · ')
}

// ---- AssistantMessage: the ATLAS contract header drawn on one styled row; headerless replies stay engine-drawn ----

const PILL_NARROW = 40 // below this many columns the header keeps its two pills only
const fixed = { wrap: 'truncate-end' }
const isNarrow = (columns: number): boolean => columns > 0 && columns < PILL_NARROW
const firstText = (k: RenderNode): string => (k as { children: string[] }).children[0] ?? ''

/** ` ◆ ATLAS ` on violet and ` ⚒ IMPLEMENT ` on the phase hue, both dark bold text. */
function pills(mid: string, phase: PhaseId): RenderNode[] {
 const mark = contractGlyph(mid.trim().split(/\s+/)[0] ?? '')
 return [
  txt({ ...fixed, color: MOCHA.base, backgroundColor: MOCHA.violet, bold: true }, ` ${BRAND_MARK} ATLAS `),
  txt({ ...fixed, color: MOCHA.base, backgroundColor: phaseHue(phase), bold: true }, ` ${mark} ${phase.toUpperCase()} `),
 ]
}

/** ` 3/5` muted, then ` sentence` in a Text that wraps: in the pills' row it shrinks to the room left and hangs under itself, so the
 * lead's words are never cut (critique 14 B2: `marking T1 compl...` at the 66 columns a docked transcript has). */
function tailOf(nm: RegExpExecArray | null, sentence: string): RenderNode[] {
 const count = nm ? ` ${nm[1]}/${nm[2]}` : ''
 const rest = sentence ? ` ${sentence}` : ''
 return [txt({ ...fixed, color: MOCHA.muted }, count), txt({ wrap: 'wrap' }, rest)].filter((k) => firstText(k) !== '')
}

/** Filled pills then the state text, never a glued pipe; under 40 columns the two pills only. */
function headerPills(mid: string, phase: PhaseId, nm: RegExpExecArray | null, sentence: string, columns: number): RenderNode[] {
 // Each chip sits in its own non-shrinking Box: a Text cannot opt out of flex shrink, so with a long sentence beside it the host cut the chips
 // (`◆ ATLA… ◎ RESEARC…` at 110, critique 15 C2). The sentence is what gives way.
 const kids = pills(mid, phase).map((chip): RenderNode => ({ type: 'Box', props: { flexShrink: 0 }, children: [chip] }))
 return isNarrow(columns) ? kids : [...kids, ...tailOf(nm, sentence)]
}

/** Every assistant text the transcript drew, by message id: whether its first line is the ATLAS header (a chip). `turn.complete` fires once per turn and
 * `$.session.messages()` is empty live, so the header tally had one answer where the transcript showed a chip per text block (critique 11: `0 of 1`
 * under five chips). Written by the AssistantMessage hook below (a plain Map, not `$.state`: the engine denies state writes while drawing), read by the
 * tally. A streaming text re-draws under one id, so its last draw is the one that counts. */
const drawnHeaders = new Map<string, boolean>();
const DRAWN_MAX = 500;
/** The header contract as the transcript renders it (critique 15 B3): every chip drawn counts, and a headerless text block between tool calls (the lead's `Mark T1 completed...`
 * narration) is not a reply the chip contract judges, so the figure no longer falls from 4/4 to 1/4 as the lead narrates. A run that drew text and not one chip still fails
 * (`0 of n`); Stop's own gate (r/n) judges the final answer of each turn. */
export const drawnHeaderTally = (): { ok: number; total: number } => {
 let ok = 0
 for (const v of drawnHeaders.values()) if (v) ok++
 return { ok, total: ok > 0 ? ok : drawnHeaders.size }
}
export const forgetDrawnHeaders = (): void => drawnHeaders.clear()
function noteDrawn(snap: AtlasSnapshot, id: string | undefined, text: string): void {
 if (!text.trim()) return
 const key = id ?? text.slice(0, 120)
 drawnHeaders.delete(key) // re-insert last: the oldest drops first
 drawnHeaders.set(key, headerPhaseOf(text, snap) !== null)
 if (drawnHeaders.size > DRAWN_MAX) drawnHeaders.delete(drawnHeaders.keys().next().value as string)
}

/** `ATLAS | ⚒ implement 3/5 | sentence` drawn in place as filled pills, body kept under it. */
export function assistantTree(snap: AtlasSnapshot, props: AssistantPropsLike, columns = 0): RenderElement | null {
 if (props.isSummary || !props.text) return null
 const first = props.text.split('\n', 1)[0] ?? ''
 const phase = headerPhaseOf(props.text, snap)
 if (phase === null) return null
 const [, mid = '', ...tail] = first.split('|')
 const nm = /(\d+)\s*\/\s*(\d+)/.exec(mid)
 const rest = props.text.slice(first.length).replace(/^\n/, '')
 const kids = headerPills(mid, phase, nm, tail.join('|').trim(), columns)

 const row: RenderElement = { type: 'Box', props: { flexDirection: 'row', flexShrink: 0 }, children: kids }
 if (!rest.trim()) return row
 return { type: 'Box', props: { flexDirection: 'column' }, children: [row, { type: 'Markdown', props: { text: rest } }] }
}

// ---- TurnDuration: `▸ 4m12s · +3 done · 2 workers · ctx 41%` ----

export function durationTree(snap: AtlasSnapshot, props: TurnDurationPropsLike, tracker: ReceiptTracker, now: number | null = null): RenderElement {
 // The host figure has been seen reading 9m02s for a 77s turn: the mod's own clock caps it.
 const measured = tracker.turnStart != null && now != null ? Math.max(0, now - tracker.turnStart) : null
 const durationMs = measured === null ? props.durationMs : Math.min(props.durationMs, measured)
 const delta = snap.counts.done - (tracker.done ?? snap.counts.done)
 const active = activeCount(workersOf(snap))
 const parts = [
  formatDuration(durationMs),
  delta > 0 ? `+${delta} done` : null,
  active > 0 ? `${active} ${active === 1 ? 'worker' : 'workers'}` : null, // critique 15 B6: `1 workers` in 69 frames
  snap.contextPct > 0 ? `ctx ${snap.contextPct}%` : null,
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
 if (cache.envOff) return null
 const snap = await read($, snapshotState)
 if (snap) noteHeaderPattern(snap.contract.headerFirstLinePattern)
 return snap
}

/** The contract's header pattern as the last snapshot carried it. A header chip needs nothing else from the snapshot, so a new message draws from
 * this copy with no state read: the host paints a new message with its own row until the hook answers (critique 12 C1: 15 raw `● ATLAS | ...`
 * frames, one frame each, always the first draw of a message), and the `await read` was a whole round trip of that wait. */
let headerPattern = ''
export const noteHeaderPattern = (pattern: string | undefined): void => { if (pattern) headerPattern = pattern }
export const forgetHeaderPattern = (): void => { headerPattern = '' }
const patternSnap = (): AtlasSnapshot | null => (headerPattern === '' ? null : ({ contract: { headerFirstLinePattern: headerPattern } } as unknown as AtlasSnapshot))

/** The engine clock in ms, or null where it is unavailable. */
async function nowMs($: EngineInterface): Promise<number | null> {
 try { return await $.clock.now() } catch { return null }
}

export function registerRestyle(on: On): void {
 const cache: { envOff?: boolean } = {}
 const tracker: ReceiptTracker = {}
 const outcomes = new Map<string, Outcome>() // ended workers' result lines, per registration

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
   const extra = { ...(e.props.tool === 'Agent' || e.props.tool === 'Task' ? await cardExtra($, e.props.output, agents, outcomes) : {}), ui: (await lookOf($)).ui }
   return toolUseTree(snap, e.props, agents, e.viewport?.columns ?? 0, extra) ?? next(e)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
  try {
   // Fast path: the mod is on (env read once) and the pattern is known, so the chip is decided with no host round trip.
   const snap = cache.envOff === false ? (patternSnap() ?? (await ready($, cache))) : await ready($, cache)
   if (snap && !e.props.isSummary) noteDrawn(snap, e.requestId, e.props.text)
   return snap ? (assistantTree(snap, e.props, e.viewport?.columns ?? 0) ?? next(e)) : next(e)
  } catch { return next(e) }
 })

 on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
  try {
   const snap = await ready($, cache)
   return snap ? durationTree(snap, e.props, tracker, await nowMs($)) : next(e)
  } catch { return next(e) }
 })

 // Turn clock at turn start. A header phase belongs to the turn that wrote
 // it, so a new turn starts without one (the engine allows one un-matchered turn.start per module: this one).
 // ponytail: turn.start carries no loop id, so a subagent's turn start clears it too; the next answer restores it.
 on('turn.start', async ($, e, next) => {
  tracker.turnStart = await nowMs($)
  await update($, headerPhaseState, () => null).catch(() => undefined)
  return next(e)
 })

 // Waves: 2+ atlas dispatches grouped by the engine draw as one strip. Wave numbers are
 // per registration, keyed by the group's first call id.
 const waves = new Map<string, number>()
 on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
  try {
   if (!(await ready($, cache))) return next(e)
   const calls = (e.props.calls ?? []) as ReadonlyArray<ToolUsePropsLike & { tool_use_id?: string }>
   const key = calls[0]?.tool_use_id ?? String(waves.size)
   if (!waves.has(key)) waves.set(key, waves.size + 1)
   return waveTree(calls, waves.get(key) ?? 1, e.viewport?.columns ?? 0, (await lookOf($)).ui) ?? next(e)
  } catch { return next(e) }
 })

 // Channel / agent messages as chat bubbles; a background atlas worker's notification as its result
 // row (the engine folds a batch's launch rows into a tree no hook sees). Prompts and ctrl+o stay engine-drawn.
 on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
  try {
   if (e.props.isExpanded || e.props.origin?.kind === 'composer') return next(e)
   if (!(await ready($, cache))) return next(e)
   if (e.props.task) return (await notificationRow($, e.props.task, outcomes, (name) => hideNotification(e.requestId, name))) ?? next(e)
   return bubbleTree(e.props.text, e.props.from?.name, 'lead', e.viewport?.columns ?? 0) ?? next(e)
  } catch { return next(e) }
 })

 // The finish card the mod placed itself (transcript/placed.ts): drawn as the host's notification row is. Another plugin's row passes.
 on('ui.render', { component: 'Placed' }, async ($, e, next) => {
  try {
   if (e.props.plugin !== 'atlas') return next(e)
   return placedTree(e.props.id, (await lookOf($)).ui) ?? next(e)
  } catch { return next(e) }
 })
}
