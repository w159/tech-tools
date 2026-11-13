// Restyled built-in sites for the Atlas mod (plan docs/plans/2026-10-09_atlas-mod.md §3.3).
// Spinner, ToolUse (Agent/Task atlas personas), AssistantMessage, TurnDuration, PromptHint.
// Every site falls back to the engine's own drawing (`next(e)`) when the snapshot is
// missing, ATLAS_MOD=off, or anything in the draw path throws: restyles decorate, never break.

import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On, RenderElement, RenderNode } from 'claude-code'
import { HEADER_FIRST_LINE_PATTERN } from './contract-pattern'
import { PHASES } from './intents'
import type { AgentState, AtlasSnapshot, Persona, PhaseId } from './contract'
import { glyph } from './theme'
import { shortTool } from './band'
import type { ActivityEntry, LiveSnapshot } from './orchestra-types'
import { openItems } from './data/core'
import { activeCount, liveWorkers } from './data/live'
import type { LiveWorker } from './data/live'
import { bubbleTree, waveTree, workerCard } from './transcript/cards'
import type { CardExtra } from './transcript/cards'
import { cardExtra, launchedId, notificationRow } from './transcript/outcome'
import { barFade, cardAged, cardFade, cardStackHidden, hideNotification, placedTree, runCardPlaced, runSecs } from './transcript/placed'
import { noteDoneChip, onSuperseded } from './transcript/superseded'
import { lookOf } from './look'
import { elapsedClock, hexIn, PALETTE5, uiFromEnv, type Ui } from './atlas-ui'
import { displayDelta, leadOf, leadRow, partialLead, verdictOf } from './transcript/leadheader'
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
export interface ReceiptTracker { done?: number; turnStart?: number | null; /** Wave 34: when the run's first turn began, and whether its closing footer was drawn (the next turn then starts a new run). */ runStart?: number | null; settled?: boolean }

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
export function noisyTree(props: ToolUsePropsLike & { output?: unknown }, ui: Ui = uiFromEnv()): RenderElement | null {
  if (!isNoisyCandidate(props)) return null
  const size = outputSize(props.output)
  if (size < NOISY_BYTES) return null
  return txt({},
    txt({ color: hexIn(PALETTE5.body, ui), bold: true }, `${props.tool} `),
    txt({ color: hexIn(PALETTE5.secondary, ui) }, toolTarget(props.input)),
    txt({ color: hexIn(PALETTE5.secondary, ui), inverse: true }, ` ▸ ${fmtBytes(size)} `),
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
 if (props.tool !== 'Agent' && props.tool !== 'Task') return noisyTree(props, extra.ui ?? uiFromEnv())
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
 return [doingOf(a), `${elapsedClock((snap.now - (a.startedAt ?? a.since)) / 1000)} · ${a.toolCount} tools`].filter(Boolean).join(' · ')
}

// ---- AssistantMessage: the ATLAS contract header drawn on one styled row; headerless replies stay engine-drawn ----

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
export const forgetDrawnHeaders = (): void => { drawnHeaders.clear(); leads.length = 0; leadAt.clear() }

/** The lead headers in the order the transcript first drew them: a header whose phase is the previous header's draws as a quiet continuation (bar and state, no word), so
 * three `◎ RESEARCH` rows in a row read as one (critique 23: three identical chips); the decision is per message id, redrawn from the same neighbour. */
const leads: { id: string; phase: string; sentence: string }[] = []
const leadAt = new Map<string, number>()
const LEADS_MAX = 300
function quietLead(id: string | undefined, text: string, pattern: string): boolean {
 const lead = leadOf(text, pattern)
 if (!id || !lead) return false
 let i = leadAt.get(id)
 if (i === undefined) {
  i = leads.length
  leads.push({ id, phase: lead.phase, sentence: lead.sentence })
  leadAt.set(id, i)
  if (leads.length > LEADS_MAX) { const d = leads.shift()!; leadAt.delete(d.id); for (const [k, v] of leadAt) leadAt.set(k, v - 1); i-- }
 } else leads[i] = { id, phase: lead.phase, sentence: lead.sentence }
 return i > 0 && leads[i - 1]!.phase === lead.phase
}

/** What the run really holds, for the done chip: workers that failed and dispatch rows the store still holds open. Read from the full snapshot where the draw has one, else from the last one `ready` read (the
 * chip answers from the bundled header pattern before any state read, so a done chip drawn that way still knows). */
let health = { failed: 0, open: 0, idle: false }
export function healthOf(snap: AtlasSnapshot): { failed: number; open: number; idle: boolean } {
 try {
  const s = snap as Partial<AtlasSnapshot>
  if (!Array.isArray(s.todos) && !Array.isArray(s.squad)) return health
  const failed = workersOf(snap).filter((w) => w.state === 'failed').length
  const dispatch = (s.todos ?? []).filter((t) => (t as { origin?: string }).origin === 'dispatch')
  return { failed, open: openItems(dispatch, s.sessionId).length, idle: activeCount(workersOf(snap)) === 0 } // idle: no worker runs, so an open dispatch row is what the band calls held (mission-layout dispatchHeld)
 } catch { return health }
}
export const noteHealth = (snap: AtlasSnapshot): void => { health = healthOf(snap) }
export const forgetHealth = (): void => { health = { failed: 0, open: 0, idle: false } }

/** The look the chip draws with, kept from the host's own read (look.ts, async) so the synchronous draw path has a theme without awaiting. */
let leadUi: Ui | null = null
function noteDrawn(snap: AtlasSnapshot, id: string | undefined, text: string): void {
 if (!text.trim()) return
 const key = id ?? text.slice(0, 120)
 drawnHeaders.delete(key) // re-insert last: the oldest drops first
 drawnHeaders.set(key, leadOf(text, snap.contract.headerFirstLinePattern) !== null)
 if (drawnHeaders.size > DRAWN_MAX) drawnHeaders.delete(drawnHeaders.keys().next().value as string)
}

// Wave 37 (critique 36: `▌ done 5/5` under `◆ ATLAS ● done 5/5 · 3 workers`): a sentence that only restates the count or says the run is over (`5/5`, `complete`, `run complete`, `all 5 done`) is the run card again.
const BARE_DONE = /^(?:(?:all|run|everything|work)\s+)?(?:\d+\/\d+\s+)?(?:done|complete|completed|finished|all finished|all done|\d+\/\d+)(?:\s+\d+\/\d+)?[.!]?$/i

/** The lead's header as a chip drawn from either form of the line (contract or display, mod/transcript/leadheader.ts): no fill, a bar in the phase colour, the phase word, the state.
 * `quiet` (the previous header was this phase) drops the word; `superseded` is a done chip a Stop refusal overturned. A finished first line that is no header stays the host's own row. */
export function assistantTree(snap: AtlasSnapshot, props: AssistantPropsLike, columns = 0, superseded = false, ui: Ui = uiFromEnv(), quiet = false): RenderElement | null {
 if (props.isSummary || !props.text) return null
 const lead = leadOf(props.text, snap?.contract.headerFirstLinePattern ?? '')
 if (lead === null) return partialLead(props.text, ui)
 const rest = props.text.slice(lead.first.length).replace(/^\n/, '')
 const h = healthOf(snap)
 // Wave 35 (critique 34: a 179 `done · 1 failed · 1 dispatch open` over a 203 `▲ blocked` band): an open dispatch row with nothing running is what the band calls blocked (dispatchHeld), so the card says it too, Stop refusal or not.
 const blocked = superseded || (h.open > 0 && h.idle)
 const verdict = lead.phase === 'done' ? verdictOf(h.failed, h.open, blocked) : null // wave 33: a done chip over a failed worker or an open dispatch row never reads `all finished`
 // Wave 35 (critique 34: `run 5/5 done` and then `done 5/5`): the run's finish card is placed, so the lead's bare `done 5/5` chip says nothing new and draws no row.
 // Wave 36 (critique 35: `▌ done complete` stacked under the run card): a sentence that only says the run is done (`complete`, `all finished`) is the same line again.
 const twin = lead.phase === 'done' && !verdict && (!lead.sentence || BARE_DONE.test(lead.sentence)) && !superseded && runCardPlaced()
 const row = twin ? { type: 'Box', props: { flexShrink: 0, height: 0 }, children: [] } as RenderElement : leadRow(lead, { ui, columns, superseded, quiet, verdict })
 if (!rest.trim()) return row
 return { type: 'Box', props: { flexDirection: 'column' }, children: [row, { type: 'Markdown', props: { text: rest } }] }
}

// ---- TurnDuration: `▸ run 4:12 · +3 done · 2 workers · ctx 41%` (the band's clock format, frozen once drawn) ----

export function durationTree(snap: AtlasSnapshot, props: TurnDurationPropsLike, tracker: ReceiptTracker, now: number | null = null, ui: Ui = uiFromEnv(), band?: number): RenderElement {
 // The host figure has been seen reading 9m02s for a 77s turn: the mod's own clock caps it.
 const measured = tracker.turnStart != null && now != null ? Math.max(0, now - tracker.turnStart) : null
 const durationMs = measured === null ? props.durationMs : Math.min(props.durationMs, measured)
 const delta = snap.counts.done - (tracker.done ?? snap.counts.done)
 const active = activeCount(workersOf(snap))
 // Wave 34 (critique 33: `turn 0:05` and `turn 0:13` in one run, each with its own clock, against the band's 0:52): a turn that ends while agents still work is no receipt; it draws nothing. The one footer a run keeps
 // is the closing one, and it reads the run's own clock from its first turn: `run 0:52`, the figure the band shows.
 if (active > 0) return { type: 'Box', props: { flexShrink: 0, height: 0 }, children: [] }
 const runMs = tracker.runStart != null && now != null ? Math.max(0, now - tracker.runStart) : null
 if (runMs !== null) tracker.settled = true
 // Wave 36 (critique 35: `run 0:08 · +4 done` and `run 0:31` under a band at 0:39): where the pane says the band's run clock, the footer prints that value and no partial `+N done` beside it.
 const parts = [
  band !== undefined ? `run ${elapsedClock(band)}` : runMs !== null ? `run ${elapsedClock(runMs / 1000)}` : `turn ${elapsedClock(durationMs / 1000)}`, // wave 32 (critique 30: an unlabelled `0:17` in the footer): the time says what it times
  delta > 0 && band === undefined ? `+${delta} done` : null,
  active > 0 ? `${active} ${active === 1 ? 'worker' : 'workers'}` : null, // critique 15 B6: `1 workers` in 69 frames
  snap.contextPct > 0 ? `ctx ${snap.contextPct}%` : null,
 ].filter((part): part is string => part !== null)
 tracker.done = snap.counts.done
 return txt({ dimColor: true },
  txt({ color: hexIn(PALETTE5.dim, ui) }, `${MARK} `),
  parts.join(' · '),
 )
}

// ---- registration ----

/** Resolves the snapshot a site may restyle with: null when the mod is off.
 *  `cache` holds the per-registration ATLAS_MOD read; registerRestyle owns one.
 *  ponytail: read once per registration (one per session); a mid-session flip
 *  to off is picked up on reload. */
async function primeEnv($: EngineInterface, cache: { envOff?: boolean }): Promise<void> {
 if (cache.envOff === undefined) cache.envOff = await $.env.get('ATLAS_MOD').then((v) => v === 'off', () => false)
}

async function ready($: EngineInterface, cache: { envOff?: boolean }): Promise<AtlasSnapshot | null> {
 await primeEnv($, cache)
 if (cache.envOff) return null
 const snap = await read($, snapshotState)
 if (snap) { noteHeaderPattern(snap.contract.headerFirstLinePattern); noteHealth(snap) }
 return snap
}

/** The contract's header pattern as the last snapshot carried it. A header chip needs nothing else from the snapshot, so a new message draws from
 * this copy with no state read: the host paints a new message with its own row until the hook answers (critique 12 C1: 15 raw `● ATLAS | ...`
 * frames, one frame each, always the first draw of a message), and the `await read` was a whole round trip of that wait. */
const bundledPattern = HEADER_FIRST_LINE_PATTERN // the contract's pattern as a code module (the host refuses a .json import); mod/contract-pattern.test.ts pins it to the file
let headerPattern = bundledPattern
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
   const extra = { ...(e.props.tool === 'Agent' || e.props.tool === 'Task' ? await cardExtra($, e.props.output, agents, outcomes) : {}), ui: (await lookOf($)).ui, ...(e.props.tool === 'Agent' || e.props.tool === 'Task' ? { fade: barFade(`start-${e.requestId}`, snap.now) } : {}) }
   return toolUseTree(snap, e.props, agents, e.viewport?.columns ?? 0, extra) ?? next(e)
  } catch { return next(e) }
 })

 // Critique 17 C1: the host paints a new message raw until this hook answers, and an async function answers a tick late even when it awaits nothing.
 // With the env read primed (turn.start, Spinner, ToolUse) and the pattern loaded from the contract at module load, the answer is returned synchronously.
 on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
  const draw = (snap: AtlasSnapshot | null) => {
   if (snap && !e.props.isSummary) noteDrawn(snap, e.requestId, e.props.text)
   const pattern = snap?.contract.headerFirstLinePattern ?? ''
   const superseded = snap && !e.props.isSummary && leadOf(e.props.text, pattern)?.phase === 'done' ? noteDoneChip(e.requestId) : false
   const quiet = snap && !e.props.isSummary ? quietLead(e.requestId, e.props.text, pattern) : false
   return snap ? (assistantTree(snap, e.props, e.viewport?.columns ?? 0, superseded, leadUi ?? uiFromEnv(), quiet) ?? next(e)) : next(e)
  }
  try {
   // A message drawn before anything primed the env read (a session's first reply, a turn the engine started without our turn.start) used to wait on `ready`'s promise and
   // paint the host's raw `● ATLAS | ...` row meanwhile (critique 22: 24 raw frames in 11 of 12 runs). The bundled pattern needs no read, so the chip answers at once; the env read
   // is primed behind it, and ATLAS_MOD=off is honoured from the next draw.
   // The Stop-refusal listener (below) calls `$.ui.invalidate` at the call site: the host refuses `$` stored, passed or returned from a hook, so it is re-armed here per draw.
   onSuperseded(() => { void Promise.resolve().then(() => { try { $.ui.invalidate('ui.render') } catch { /* nothing drawn to refresh */ } }) })
   if (leadUi === null) void lookOf($).then((l) => { leadUi = l.ui }, () => undefined)
   if (cache.envOff === undefined) void primeEnv($, cache).catch(() => undefined)
   const known = cache.envOff !== true ? patternSnap() : null
   if (known) return draw(known)
   return ready($, cache).then(draw, () => next(e))
  } catch { return next(e) }
 })

 // A footer is the receipt of a finished turn: it freezes at the value it was first drawn with. Redrawn live (critique 25), its `+N done` fell to nothing on the second draw (the tracker had moved on)
 // and its `ctx` and worker count followed the next turn's snapshot.
 const frozenFooters = new Map<string, RenderElement>()
 on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
  try {
   const kept = e.requestId ? frozenFooters.get(e.requestId) : undefined
   if (kept) return kept
   const snap = await ready($, cache)
   if (!snap) return next(e)
   const tree = durationTree(snap, e.props, tracker, await nowMs($), (await lookOf($)).ui, runSecs())
   if (e.requestId) frozenFooters.set(e.requestId, tree)
   return tree
  } catch { return next(e) }
 })

 // Turn clock at turn start (the engine allows one un-matchered turn.start per module: this one). The header phase is NOT dropped here: turn.start carries no
 // loop id, so a subagent's turn and a Stop-hook continuation turn start it too, and the route read `research 1/5` beside a DONE chip (critique 17 A5). A person's
 // prompt drops it instead (register.ts, the one prompt.submit hook).
 on('turn.start', async ($, e, next) => {
  await primeEnv($, cache) // so this turn's first AssistantMessage draw answers synchronously
  tracker.turnStart = await nowMs($)
  if (tracker.runStart == null || tracker.settled) { tracker.runStart = tracker.turnStart; tracker.settled = false } // a turn after the closing footer starts a new run
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
   const snap = await ready($, cache)
   if (!snap) return next(e)
   if (e.props.task) return (await notificationRow($, e.props.task, outcomes, (name) => hideNotification(e.requestId, name), () => cardAged(`n-${e.requestId}`, snap.now), e.viewport?.columns ?? 0, () => barFade(`n-${e.requestId}`, snap.now))) ?? next(e)
   return bubbleTree(e.props.text, e.props.from?.name, 'lead', e.viewport?.columns ?? 0, (await lookOf($)).ui) ?? next(e)
  } catch { return next(e) }
 })

 // The finish card the mod placed itself (transcript/placed.ts): drawn as the host's notification row is. Another plugin's row passes.
 on('ui.render', { component: 'Placed' }, async ($, e, next) => {
  try {
   if (e.props.plugin !== 'atlas') return next(e)
   const now = ((await read($, snapshotState)) as AtlasSnapshot | null)?.now ?? 0 // read while drawing: the card redraws as the snapshot's clock moves
   const aged = cardAged(e.props.id, now)
   return placedTree(e.props.id, (await lookOf($)).ui, aged, { cols: e.viewport?.columns ?? 0, fade: cardFade(e.props.id, now), hidden: cardStackHidden(e.props.id, now) }) ?? next(e)
  } catch { return next(e) }
 })

 // Critique 23: the raw `● ATLAS | 🏁 done | ...` rows are not a draw the mod can answer in time. While a reply streams the host paints each flushed batch of whole lines itself and
 // asks `ui.render` for the message only once it is complete (the raw row stood three 0.5 s frames in live-110-513bb41c-1 f0062-f0064, chip at f0065). The classic `MessageDisplay`
 // event sees those batches and rewrites them for the screen alone: the header line leaves as `▌ research 1/3 · state`, so no frame carries the pipes or the emoji. The stored message,
 // the model and the Stop gate keep the contract line; the chip draws from either form (transcript/leadheader.ts).
 on('classic.MessageDisplay', async ($, e, next) => {
  const base = await next(e)
  try {
   await primeEnv($, cache)
   if (cache.envOff || e.index !== 0) return base
   const shown = displayDelta(base?.displayContent ?? e.delta, headerPattern)
   return shown === null ? base : { ...base, displayContent: shown }
  } catch { return base }
 })
}
