// A background worker's end state for its transcript card and its task-notification row. The Agent
// call's own output is only the launch notice (`async_launched`), so the result comes from the worker's
// transcript ($.session.messages({ agentId })) and the duration from the lead's task-notification.

import { atom, read } from 'claude-code'
import type { AgentInfo, EngineInterface, RenderElement } from 'claude-code'
import { EMPTY_ORCH } from '../data/orchestration'
import { formatDuration, spin } from '../theme'
import { notificationTree, resultLine } from './cards'
import type { CardExtra } from './cards'

// Read-only views of register.ts's atoms (same plugin/key): the spinner clock and spawn metadata.
const spinnerTick = atom({ plugin: 'atlas', key: 'spinnerTick' } as const, 0)
const orchRef = atom({ plugin: 'atlas', key: 'orch' } as const, EMPTY_ORCH)

interface Outcome { status: string; line: string; durationMs?: number }
type Msg = { role: string; text: string; toolUses?: ReadonlyArray<{ tool: string; input: Record<string, unknown> }> }
/** A worker as the transcript names it: host row first, spawn metadata for one that left the host list. */
type Who = { id: string; status: string; name: string; type: string }

/** Host statuses after which a worker has nothing left to run (`idle`: a background subagent between turns). */
const ENDED = new Set(['completed', 'failed', 'killed', 'idle'])

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

/** `done · STATUS: DONE · 29s` (failed / killed keep their word). */
export function outcomeText(o: Outcome): string {
 const word = o.status === 'completed' || o.status === 'idle' ? 'done' : o.status
 return [word, o.line, o.durationMs !== undefined ? formatDuration(o.durationMs) : ''].filter(Boolean).join(' · ')
}

const rows = (r: unknown): Msg[] => (Array.isArray(r) ? (r as Msg[]) : [])

/** Outcome of an ended worker; memoized per id:status once its duration is known (the notification lands after the status flips). */
async function workerOutcome($: EngineInterface, who: Who, memo: Map<string, Outcome>, durationMs?: number): Promise<Outcome> {
 return memo.get(`${who.id}:${who.status}`) ?? (await readOutcome($, who, memo, durationMs))
}

async function readOutcome($: EngineInterface, who: Who, memo: Map<string, Outcome>, durationMs?: number): Promise<Outcome> {
 const line = reportOf(rows(await $.session.messages({ agentId: who.id }).catch(() => [])))
 const ms = durationMs ?? notifiedMs(rows(await $.session.messages().catch(() => [])).map((m) => m.text), who.id)
 const o: Outcome = { status: who.status, line, ...(ms !== undefined ? { durationMs: ms } : {}) }
 if (ms !== undefined) memo.set(`${who.id}:${who.status}`, o)
 return o
}

const firstOf = (...xs: (string | undefined)[]): string => xs.find((x) => !!x) ?? ''

/** An atlas worker by host id: spawn metadata names it (the band's label), the host row gives its status; a
 * finished worker drops out of the host list, so a missing row reads completed. */
async function whoIs($: EngineInterface, id: string, agents: readonly AgentInfo[]): Promise<Who | undefined> {
 const row: Partial<AgentInfo> = agents.find((a) => a.id === id) ?? {}
 const meta = (await read($, orchRef)).meta[id] ?? {}
 const who = { id, type: firstOf(row.type, meta.type), status: firstOf(row.status, 'completed'), name: firstOf(meta.name, row.name, row.description, id.slice(0, 6)) }
 return who.type.startsWith('atlas:') ? who : undefined
}

/** A background launch's agent id (`async_launched` output), '' for any other result. */
export const launchedId = (output: unknown): string => {
 const o = (output ?? {}) as { status?: unknown; agentId?: unknown }
 return o.status === 'async_launched' && typeof o.agentId === 'string' ? o.agentId : ''
}

/** A background launch's live spinner or its end result; {} for any other call. */
export async function cardExtra($: EngineInterface, output: unknown, agents: readonly AgentInfo[], memo: Map<string, Outcome>): Promise<CardExtra> {
 const id = launchedId(output)
 const who = id ? await whoIs($, id, agents) : undefined
 if (!who) return {}
 if (!ENDED.has(who.status)) return { mark: spin(await read($, spinnerTick), 'implement') }
 return { outcome: outcomeText(await workerOutcome($, who, memo)) }
}

/** Notification row for a background atlas worker; null leaves any other task's row to the engine. */
export async function notificationRow($: EngineInterface, task: { id?: string; status?: string; durationMs?: number }, memo: Map<string, Outcome>): Promise<RenderElement | null> {
 const who = await whoIs($, task.id ?? '', await $.agent.list().catch(() => [] as AgentInfo[]))
 if (!who) return null
 const o = await workerOutcome($, { ...who, status: firstOf(task.status, who.status) }, memo, task.durationMs)
 return notificationTree(who.name, who.type.slice('atlas:'.length), outcomeText(o), FAILED.has(o.status))
}
const FAILED = new Set(['failed', 'killed'])

export type { Outcome }
