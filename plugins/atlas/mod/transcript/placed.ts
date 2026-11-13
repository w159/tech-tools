// The finish card the mod places itself. The host puts a background worker's result row into the lead's transcript only when the lead
// takes the task-notification up, 5 s after the worker ended in the slowest live runs (critique 14: card lag 5.07 / 5.32 s while the HUD
// row landed in 1.0 s). `$.ui.place` puts a row of the mod's own at the transcript's end, drawn through the `Placed` render site, so the
// card is stamped from the same rebuild tick as the HUD row. The host's own notification row for that worker is then drawn empty (one
// card per finish, never two), and drawn whole when no card was placed (no surface, a failed place, the host row won the race).

import type { EngineInterface, RenderElement } from 'claude-code'
import type { AtlasSnapshot } from '../contract'
import type { LiveSnapshot } from '../orchestra-types'
import { endedAt, liveWorkers } from '../data/live'
import { notificationTree, type FinishOpts } from './cards'
import { forgetFailed, killedNames, outcomeText } from './outcome'
import type { Ui } from '../atlas-ui'

/** One finished worker, as the card needs it. */
export interface FinishedWorker { name: string; role: string; failed: boolean; durationMs: number; /** Tool calls the worker made (the card's `· 2 fn`). */ calls?: number }
/** A placed card's data, kept until the `Placed` site draws it. */
export interface PlacedRow { name: string; role: string; text: string; failed: boolean; calls?: number }

const MAX_ROWS = 200

const rows = new Map<string, PlacedRow>() // placed id -> card
const unclaimed = new Map<string, number>() // worker name -> cards placed that no host notification has claimed yet
const heard = new Map<string, number>() // worker name -> host notifications drawn before any card was placed
const decided = new Map<string, boolean>() // notification requestId -> hidden: one decision per message, however often it redraws
const owed = new Map<string, { w: FinishedWorker; tries: number }>() // worker name -> a finish whose card the host refused: retried on the next builds
const MAX_TRIES = 30
let counter = 0

const bump = (m: Map<string, number>, k: string, by: number): void => { m.set(k, Math.max(0, (m.get(k) ?? 0) + by)) }
const capped = <K, V>(m: Map<K, V>): void => { while (m.size > MAX_ROWS) m.delete(m.keys().next().value as K) }

/** Squad + activity as live workers; a bare snapshot has no activity. */
const workersOf = (s: AtlasSnapshot) => liveWorkers({ activity: {}, comms: [], todoGroups: [], ...s, squad: (s.squad ?? []).filter((a) => a?.name) } as LiveSnapshot, s.now)

/** Workers that moved into done or failed between two snapshots (first sight of a worker is no finish; null prev yields nothing). The
 * duration is the worker's own run, the figure the HUD, the team tab and the card all print. */
export function finishedWorkers(prev: AtlasSnapshot | null, next: AtlasSnapshot): FinishedWorker[] {
  if (!prev) return []
  const before = new Map(workersOf(prev).map((w) => [w.name, w.state]))
  const out: FinishedWorker[] = []
  for (const w of workersOf(next)) {
    const was = before.get(w.name)
    // First sight of a worker is no finish, unless it is failed: a killed worker drops out of the host list, so the build that shows it failed can be the
    // first that lists it (critique 16 C4: no failed card in stoprun-110-e4a8186a-3). A done worker first seen done is an old row, not a finish.
    if ((was === undefined && w.state !== 'failed') || was === w.state || (w.state !== 'done' && w.state !== 'failed')) continue
    if (was === 'failed') continue // failure is terminal: a failed worker read done later (critique 15: the killed ghost-explorer) gets no done card
    out.push({ name: w.name, role: w.role, failed: w.state === 'failed', durationMs: Math.max(0, endedAt(w, next.now) - w.startedAt), ...(w.calls?.length ? { calls: w.calls.length } : {}) })
  }
  return out
}

/** `finished · 13s` / `failed · 13s`, the words the host's own row carries. */
const textOf = (w: FinishedWorker, killed = false): string => outcomeText({ status: w.failed ? (killed ? 'killed' : 'failed') : 'completed', line: '', ...(w.durationMs > 0 ? { durationMs: w.durationMs } : {}) })

/** Place a card for each worker that finished between `prev` and `next`, and for each finish whose place the host refused on an earlier build
 * (critique 15 A2: one refused place lost the failed card for good in 3 of 6 stop runs). Never throws: a card is display only. */
export async function placeFinished($: EngineInterface, prev: AtlasSnapshot | null, next: AtlasSnapshot): Promise<void> {
  const fresh = finishedWorkers(prev, next)
  const todo = [...fresh, ...[...owed.values()].map((o) => o.w).filter((o) => !fresh.some((f) => f.name === o.name))]
  const killed = todo.some((w) => w.failed) ? await killedNames($) : new Set<string>()
  for (const w of todo) {
    const tries = (owed.get(w.name)?.tries ?? 0) + 1
    owed.delete(w.name)
    try {
      if ((heard.get(w.name) ?? 0) > 0) { bump(heard, w.name, -1); continue } // the host row already drew this finish
      const id = `done-${w.name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 50)}-${++counter}`
      rows.set(id, { name: w.name, role: w.role, text: textOf(w, killed.has(w.name)), failed: w.failed, ...(w.calls ? { calls: w.calls } : {}) })
      capped(rows)
      const res = await $.ui.place({ id })
      if (res.isPlaced) bump(unclaimed, w.name, 1)
      else { rows.delete(id); if (tries < MAX_TRIES) owed.set(w.name, { w, tries }) }
    } catch {
      // no surface to place into: the host's notification row draws the finish; the card is tried again on the next build
      if (tries < MAX_TRIES) owed.set(w.name, { w, tries })
    }
  }
}

/** The card behind a `Placed` row id, drawn as the host's own notification row is (one shape, one look). */
export function placedTree(id: string, ui: Ui, aged = false, opts: FinishOpts & { hidden?: boolean } = {}): RenderElement | null {
  const r = rows.get(id)
  if (!r) return null
  if (opts.hidden && !r.failed) return { type: 'Text', props: {}, children: [] } as RenderElement // a finish card that two newer ones replaced draws nothing (critique 29: at most two stacked)
  return notificationTree(r.name, r.role, r.text, r.failed, ui, aged, r.calls ? { ...opts, calls: r.calls } : opts)
}

/** A card dims once the run has moved on (critique 17 C3): 20 s after it was first drawn, or 5 s after a later card was drawn. `now` is the snapshot's clock. */
const AGE_MS = 20_000
const SUPERSEDED_MS = 5_000
const drawn = new Map<string, { at: number; seq: number }>() // card key -> its first draw, in order
let drawSeq = 0
export function cardAged(key: string, now: number): boolean {
  if (!Number.isFinite(now) || now <= 0) return false
  let first = drawn.get(key)
  if (!first) { first = { at: now, seq: ++drawSeq }; drawn.set(key, first); capped(drawn) }
  const age = now - first.at
  return age >= AGE_MS || (first.seq < drawSeq && age >= SUPERSEDED_MS)
}

/** How long a card's bar takes to fade 141 -> 245 (critique 29). */
export const FADE_MS = 1000
/** 0..1: how far a card's bar has faded, from its first draw on the snapshot clock (`cardAged` registers the draw). */
export function cardFade(key: string, now: number): number {
  const first = drawn.get(key)
  return first && Number.isFinite(now) && now > 0 ? Math.max(0, Math.min(1, (now - first.at) / FADE_MS)) : 0
}
/** At most two finish cards stack, the newest replacing the oldest: a card with two newer ones drawn after it, and itself aged, is hidden. */
export function cardStackHidden(key: string, now: number): boolean {
  const mine = drawn.get(key)
  if (!mine || !cardAged(key, now)) return false
  let newer = 0
  for (const [k, v] of drawn) if (k.startsWith('done-') && v.seq > mine.seq) newer++
  return newer >= 2
}

/** Whether the host's notification row `requestId` for worker `name` is a repeat of a card already placed: true draws it empty. */
export function hideNotification(requestId: string, name: string): boolean {
  const known = decided.get(requestId)
  if (known !== undefined) return known
  const hide = (unclaimed.get(name) ?? 0) > 0
  if (hide) bump(unclaimed, name, -1)
  else bump(heard, name, 1)
  decided.set(requestId, hide)
  capped(decided)
  return hide
}

/** Forget every placed card and decision (a new session, a test). */
export function forgetPlaced(): void {
  rows.clear(); unclaimed.clear(); heard.clear(); decided.clear(); owed.clear(); drawn.clear(); drawSeq = 0; counter = 0; forgetFailed()
}
