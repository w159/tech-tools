// A background worker's end state for its transcript card and its task-notification row. The Agent
// call's own output is only the launch notice (`async_launched`), so the result comes from the worker's
// transcript ($.session.messages({ agentId })) and the duration from the lead's task-notification.

import { atom, read } from 'claude-code'
import type { AgentInfo, EngineInterface, RenderElement } from 'claude-code'
import { EMPTY_ORCH } from '../data/orchestration'
import { endedAt, liveWorkers } from '../data/live'
import type { ActivityEntry, LiveSnapshot } from '../orchestra-types'
import { spin } from '../theme'
import { msClock } from '../atlas-ui'
import { notificationTree, resultLine, stripStatus } from './cards'
import { lookOf } from '../look'
import { agentName } from '../hud'
import type { CardExtra } from './cards'

// Read-only views of register.ts's atoms (same plugin/key): the spinner clock and spawn metadata.
const spinnerTick = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0)
const orchRef = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH)
const snapshotRef = atom({ plugin: 'atlas', key: 'snapshot' } as const, null)
const killedRef = atom({ plugin: 'atlas', key: 'killed' } as const, [] as string[]) // ids/names a TaskStop ended (discipline.ts)

/** Ids and names of workers the lead stopped (TaskStop) or the host lists `killed`: their finish card reads `killed`, the word the host's own row
 * uses, not the `failed` a mod-placed card said (critique 17 C2: `explorer failed · 3s` where a stopped worker's card is `explorer killed`). Never throws. */
export async function killedNames($: EngineInterface): Promise<Set<string>> {
 const out = new Set<string>()
 try {
  const meta = (await read($, orchRef)).meta
  for (const raw of (await read($, killedRef)) ?? []) { out.add(raw); const n = meta[raw]?.name; if (n) out.add(n) }
  for (const a of await $.agent.list().catch(() => [] as AgentInfo[])) {
   if (a.status !== 'killed') continue
   out.add(a.id)
   const n = meta[a.id]?.name ?? a.name
   if (n) out.add(n)
  }
 } catch { /* a card is display only */ }
 return out
}

interface Outcome { status: string; line: string; durationMs?: number }
type Msg = { role: string; text: string; toolUses?: ReadonlyArray<{ tool: string; input: Record<string, unknown> }> }
/** A worker as the transcript names it: host row first, spawn metadata for one that left the host list. */
type Who = { id: string; status: string; name: string; type: string }

/** Host statuses after which a worker has nothing left to run (`idle`: a background subagent between turns). */
const ENDED = new Set(['completed', 'failed', 'killed', 'idle'])

/** The mod's own end moods (orch activity) as the host status they stand for. */
const MOD_ENDED: Record<string, string> = { done: 'completed', failed: 'failed' }

/** Host words for a task that did not succeed (a stopped task ends `killed`; other hosts say stopped, cancelled, aborted). */
const BAD_STATUS = /^(failed|killed|stopped|cancell?ed|aborted|errored?)$/i
const badWord = (w: string | undefined): string | undefined => (w && BAD_STATUS.test(w.trim()) ? (/^(failed|errored?)$/i.test(w.trim()) ? 'failed' : 'killed') : undefined)

/** Ids of workers seen failed: failure is terminal, so once any surface saw one fail no later row reads it finished (critique 15 A1:
 * the killed ghost-explorer ended as a green `explorer finished` card once the host dropped its row and its notification came up 31 s later). */
const failedSeen = new Set<string>()
export const noteFailed = (key: string): void => { if (key) failedSeen.add(key) }
export const forgetFailed = (): void => failedSeen.clear()

/** `<status>` of the task-notification naming `agentId`, from the lead transcript's texts. */
export function notifiedStatus(texts: readonly string[], agentId: string): string | undefined {
 for (const t of [...texts].reverse()) {
  const at = t.indexOf(`<task-id>${agentId}</task-id>`)
  const st = at < 0 ? null : /<status>([^<]*)<\/status>/.exec(t.slice(at))
  if (st) return st[1]!.trim()
 }
 return undefined
}

const handback = (m: Msg): string => {
 const call = [...(m.toolUses ?? [])].reverse().find((u) => u.tool === 'SubagentHandback')
 return typeof call?.input.message === 'string' ? call.input.message : ''
}

const spoken = (m: Msg): string => (m.role === 'assistant' ? handback(m) || m.text : '')

/** The worker's report line: its SubagentHandback message, else its last assistant text; STATUS line first. */
export function reportOf(msgs: readonly Msg[]): string {
 const last = [...msgs].reverse().map(spoken).find((s) => s.trim())
 return last ? resultLine(last) : ''
}

/** `duration_ms` of the task-notification naming `agentId`, from the lead transcript's texts. */
export function notifiedMs(texts: readonly string[], agentId: string): number | undefined {
 for (const t of [...texts].reverse()) {
  const at = t.indexOf(`<task-id>${agentId}</task-id>`)
  const ms = at < 0 ? null : /<duration_ms>(\d+)<\/duration_ms>/.exec(t.slice(at))
  if (ms) return Number(ms[1])
 }
 return undefined
}

/** `finished · STATUS: DONE · 29s` (failed / killed keep their word). A returned worker is finished, not verified. */
export function outcomeText(o: Outcome): string {
 return [endedWord(o), outcomeDetail(o)].filter(Boolean).join(' · ')
}
/** The lifecycle word, owned here: the notification row leads with it, the card uses it as its row label. */
const endedWord = (o: Outcome): string => (o.status === 'completed' || o.status === 'idle' ? 'finished' : o.status)
/** `29s`: the report line (its `STATUS: DONE` shout cut: the state word says it) and duration, without the lifecycle word. */
const outcomeDetail = (o: Outcome): string => [stripStatus(o.line), o.durationMs !== undefined ? msClock(o.durationMs) : ''].filter(Boolean).join(' · ')

const rows = (r: unknown): Msg[] => (Array.isArray(r) ? (r as Msg[]) : [])

/** Outcome of an ended worker; memoized per id:status once its duration is known (the notification lands after the status flips). */
async function workerOutcome($: EngineInterface, who: Who, memo: Map<string, Outcome>, durationMs?: number): Promise<Outcome> {
 return memo.get(`${who.id}:${who.status}`) ?? (await readOutcome($, who, memo, durationMs))
}

/** The run the team tab prints (data/live endedAt: first sight to the stamped finish) when the mod saw the worker end: the card then reads the same figure, not the host's `duration_ms`, which counts spawn time on another clock (live 6b7f637d: 15s on the tab, 16s on the card). */
async function observedMs($: EngineInterface, id: string): Promise<number | undefined> {
 const a: ActivityEntry | undefined = (await read($, orchRef)).activity[id]
 return a && (a.mood === 'done' || a.mood === 'failed') && a.startedAt !== undefined && a.since > a.startedAt ? a.since - a.startedAt : undefined
}

/** The run the HUD and the team tab print for a worker the snapshot shows ended (data/live: first sight to the stamped finish): the card reads the same two timestamps
 * (critique 26: `15s` on the card, `0:14` in SUBAGENTS), and a stopped worker whose task-notification carries no `duration_ms` still gets its figure (critique 17 C3). */
async function snapshotMs($: EngineInterface, name: string): Promise<number | undefined> {
 const s = ((await read($, snapshotRef)) ?? null) as unknown as LiveSnapshot | null
 if (!s || !Array.isArray(s.squad)) return undefined
 const w = liveWorkers({ ...s, activity: s.activity ?? {} }, s.now).find((x) => x.name === name)
 const ms = w && (w.state === 'failed' || w.state === 'done') ? endedAt(w, s.now) - w.startedAt : 0
 return ms > 0 ? ms : undefined
}

async function readOutcome($: EngineInterface, who: Who, memo: Map<string, Outcome>, durationMs?: number): Promise<Outcome> {
 const line = reportOf(rows(await $.session.messages({ agentId: who.id }).catch(() => [])))
 // One source for an agent's run: the mod's own two timestamps (the snapshot the HUD and the panel read, then the orch record), and only then the host's figures, which count from another clock.
 const ms = (await snapshotMs($, who.name)) ?? (await observedMs($, who.id)) ?? durationMs ?? notifiedMs(rows(await $.session.messages().catch(() => [])).map((m) => m.text), who.id)
 const o: Outcome = { status: who.status, line, ...(ms !== undefined ? { durationMs: ms } : {}) }
 if (ms !== undefined) memo.set(`${who.id}:${who.status}`, o)
 return o
}

const firstOf = (...xs: (string | undefined)[]): string => xs.find((x) => !!x) ?? ''

/** Whether the lead resumed the worker after it stopped it: a `SendMessage` to its name or id comes after the last `TaskStop` that named it (critique 18: beta-explorer was stopped by
 * mistake, resumed and finished, and its finish row still read `failed`). A message sent before the stop is no resume. */
export function resumedAfterStop(msgs: readonly Msg[], who: Pick<Who, 'id' | 'name'>): boolean {
 const names = new Set([who.id, who.name].filter(Boolean))
 const named = (u: { input: Record<string, unknown> }): boolean => Object.values(u.input).some((v) => typeof v === 'string' && names.has(v))
 let stopped = -1
 let resumed = -1
 msgs.forEach((m, i) => { for (const u of m.toolUses ?? []) { if (!named(u)) continue; if (u.tool === 'TaskStop') stopped = i; else if (u.tool === 'SendMessage') resumed = i } })
 return stopped >= 0 && resumed > stopped
}

/** The end word of a failed worker (`failed`, `killed`) from every source the mod holds, else undefined: the task's own status, the host row, the sticky
 * memo, the mod's end record (orch activity), the snapshot's squad row and activity, and (when `notified`) the task-notification in the lead transcript.
 * Critique 18: a worker the lead stopped (TaskStop) reads `killed` whichever source says it failed, one verb on every card; and one the lead stopped, then resumed,
 * is failed no more unless the host itself says so (its finish row read a stale `failed`, stoprun-150-562576ed-3), so its finish reads `finished`. */
async function failureOf($: EngineInterface, who: Who, taskStatus: string | undefined, notified: boolean): Promise<string | undefined> {
 const host = badWord(taskStatus) ?? badWord(who.status)
 const known = host ?? (failedSeen.has(who.id) ? 'failed' : undefined) // by id only: a later worker may reuse a name
 const snap = ((await read($, snapshotRef)) ?? null) as unknown as Partial<LiveSnapshot> | null
 const recorded = (await read($, orchRef)).activity[who.id]?.mood === 'failed' || snap?.activity?.[who.name]?.mood === 'failed' || (snap?.squad ?? []).some((a) => a.name === who.name && (a.state === 'failed' || a.state === 'dead'))
 const lead = host === undefined && (known || recorded || notified) ? rows(await $.session.messages().catch(() => [])) : [] // the lead transcript is read only when a failure could be in play
 if (host === undefined && (known || recorded) && resumedAfterStop(lead, who)) { failedSeen.delete(who.id); return undefined }
 const said = known ?? (recorded ? 'failed' : undefined) ?? (notified ? badWord(notifiedStatus(lead.map((m) => m.text), who.id)) : undefined)
 if (!said) return undefined
 noteFailed(who.id)
 if (said === 'killed') return said
 const stopped = await killedNames($)
 return stopped.has(who.id) || stopped.has(who.name) ? 'killed' : said
}

/** An atlas worker by host id: spawn metadata names it (the band's label), the host row gives its status; a
 * finished worker drops out of the host list, so a missing row reads completed unless a failure is on record. */
async function whoIs($: EngineInterface, id: string, agents: readonly AgentInfo[], taskStatus?: string, notified = false): Promise<Who | undefined> {
 const row: Partial<AgentInfo> = agents.find((a) => a.id === id) ?? {}
 const meta = (await read($, orchRef)).meta[id] ?? {}
 const base = { id, type: firstOf(row.type, meta.type), status: firstOf(row.status, 'completed'), name: firstOf(meta.name, row.name, row.description) }
 if (!base.type.startsWith('atlas:')) return undefined
 // no readable name: the HUD's agentName helper gives the agent type (and a task phrase when any task text exists); the id only as a last resort
 const who = base.name ? base : { ...base, name: agentName(id, base.type.slice('atlas:'.length)) }
 const failed = await failureOf($, who, taskStatus, notified)
 return failed ? { ...who, status: failed } : who
}

/** A background launch's agent id (`async_launched` output), '' for any other result. */
export const launchedId = (output: unknown): string => {
 const o = (output ?? {}) as { status?: unknown; agentId?: unknown }
 return o.status === 'async_launched' && typeof o.agentId === 'string' ? o.agentId : ''
}

/** A background launch's live spinner or its end result; {} for any other call. */
export async function cardExtra($: EngineInterface, output: unknown, agents: readonly AgentInfo[], memo: Map<string, Outcome>): Promise<CardExtra> {
 const id = launchedId(output)
 const found = id ? await whoIs($, id, agents) : undefined
 if (!found) return {}
 // The host row can say running for seconds after the worker's own turn ended; the HUD row reads the mod's record of that turn (data/orchestration
 // onComplete), so the card does too and the two agree in the same tick (critique 14 B3).
 const who = ENDED.has(found.status) ? found : { ...found, status: MOD_ENDED[(await read($, orchRef)).activity[id]?.mood ?? ''] ?? found.status }
 if (!ENDED.has(who.status)) { const frame = await read($, spinnerTick); return { mark: spin(frame, 'implement'), frame } }
 const o = await workerOutcome($, who, memo)
 return { ended: endedWord(o), outcome: outcomeDetail(o) }
}

/** Notification row for a background atlas worker; null leaves any other task's row to the engine. `hide` says the worker's finish card is
 * already in the transcript (transcript/placed.ts): the host's row then draws nothing, so a finish is one card. */
export async function notificationRow($: EngineInterface, task: { id?: string; status?: string; durationMs?: number }, memo: Map<string, Outcome>, hide?: (name: string) => boolean, aged?: () => boolean, cols = 0): Promise<RenderElement | null> {
 const who = await whoIs($, task.id ?? '', await $.agent.list().catch(() => [] as AgentInfo[]), task.status, true)
 if (!who) return null
 if (hide?.(who.name)) return { type: 'Text', props: {}, children: [] }
 const o = await workerOutcome($, { ...who, status: badWord(who.status) ?? firstOf(task.status, who.status) }, memo, task.durationMs)
 return notificationTree(who.name, who.type.slice('atlas:'.length), outcomeText(o), FAILED.has(o.status), (await lookOf($)).ui, aged?.() ?? false, { cols })
}
const FAILED = new Set(['failed', 'killed'])

export type { Outcome }
