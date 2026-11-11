// The finish card the mod places itself. The host puts a background worker's result row into the lead's transcript only when the lead
// takes the task-notification up, 5 s after the worker ended in the slowest live runs (critique 14: card lag 5.07 / 5.32 s while the HUD
// row landed in 1.0 s). `$.ui.place` puts a row of the mod's own at the transcript's end, drawn through the `Placed` render site, so the
// card is stamped from the same rebuild tick as the HUD row. The host's own notification row for that worker is then drawn empty (one
// card per finish, never two), and drawn whole when no card was placed (no surface, a failed place, the host row won the race).

import type { EngineInterface, RenderElement } from 'claude-code'
import type { AtlasSnapshot } from '../contract'
import type { LiveSnapshot } from '../orchestra-types'
import { endedAt, liveWorkers } from '../data/live'
import { notificationTree } from './cards'
import { outcomeText } from './outcome'
import type { Ui } from '../atlas-ui'

/** One finished worker, as the card needs it. */
export interface FinishedWorker { name: string; role: string; failed: boolean; durationMs: number }
/** A placed card's data, kept until the `Placed` site draws it. */
export interface PlacedRow { name: string; role: string; text: string; failed: boolean }

const MAX_ROWS = 200

const rows = new Map<string, PlacedRow>() // placed id -> card
const unclaimed = new Map<string, number>() // worker name -> cards placed that no host notification has claimed yet
const heard = new Map<string, number>() // worker name -> host notifications drawn before any card was placed
const decided = new Map<string, boolean>() // notification requestId -> hidden: one decision per message, however often it redraws
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
    if (was === undefined || was === w.state || (w.state !== 'done' && w.state !== 'failed')) continue
    out.push({ name: w.name, role: w.role, failed: w.state === 'failed', durationMs: Math.max(0, endedAt(w, next.now) - w.startedAt) })
  }
  return out
}

/** `finished · 13s` / `failed · 13s`, the words the host's own row carries. */
const textOf = (w: FinishedWorker): string => outcomeText({ status: w.failed ? 'failed' : 'completed', line: '', ...(w.durationMs > 0 ? { durationMs: w.durationMs } : {}) })

/** Place a card for each worker that finished between `prev` and `next`. Never throws: a card is display only. */
export async function placeFinished($: EngineInterface, prev: AtlasSnapshot | null, next: AtlasSnapshot): Promise<void> {
  for (const w of finishedWorkers(prev, next)) {
    try {
      if ((heard.get(w.name) ?? 0) > 0) { bump(heard, w.name, -1); continue } // the host row already drew this finish
      const id = `done-${w.name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 50)}-${++counter}`
      rows.set(id, { name: w.name, role: w.role, text: textOf(w), failed: w.failed })
      capped(rows)
      const res = await $.ui.place({ id })
      if (res.isPlaced) bump(unclaimed, w.name, 1)
      else rows.delete(id)
    } catch {
      // no surface to place into: the host's notification row draws the finish
    }
  }
}

/** The card behind a `Placed` row id, drawn as the host's own notification row is (one shape, one look). */
export function placedTree(id: string, ui: Ui): RenderElement | null {
  const r = rows.get(id)
  return r ? notificationTree(r.name, r.role, r.text, r.failed, ui) : null
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
  rows.clear(); unclaimed.clear(); heard.clear(); decided.clear(); counter = 0
}
