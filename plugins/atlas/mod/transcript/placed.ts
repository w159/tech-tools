// The finish card the mod places itself. The host puts a background worker's result row into the lead's transcript only when the lead
// takes the task-notification up, 5 s after the worker ended in the slowest live runs (critique 14: card lag 5.07 / 5.32 s while the HUD
// row landed in 1.0 s). `$.ui.place` puts a row of the mod's own at the transcript's end, drawn through the `Placed` render site, so the
// card is stamped from the same rebuild tick as the HUD row. The host's own notification row for that worker is then drawn empty (one
// card per finish, never two), and drawn whole when no card was placed (no surface, a failed place, the host row won the race).

import type { EngineInterface, RenderElement } from 'claude-code'
import type { AtlasSnapshot } from '../contract'
import type { LiveSnapshot } from '../orchestra-types'
import { endedAt, liveWorkers, workerFacts, type WorkerFacts } from '../data/live'
import { blockedTree, notificationTree, type FinishOpts } from './cards'
import { forgetFailed, outcomeText } from './outcome'
import { elapsedClock, type Ui } from '../atlas-ui'

/** One finished worker, as the card needs it. */
export interface FinishedWorker { name: string; role: string; failed: boolean; durationMs: number; /** Tool calls the worker made (the card's `· 3 calls`). */ calls?: number }
/** A placed card's data, kept until the `Placed` site draws it. */
export interface PlacedRow { name: string; role: string; text: string; failed: boolean; calls?: number; /** The run card's one fact after the name (`5/5 done · 3 workers`). */ fact?: string; /** The SUBAGENTS row's TIME and CALLS cells as they stood when the card was placed: a placed card is never rewritten (truth 39). */ facts?: WorkerFacts; /** A blocked card: the band's reason and clock, frozen at placement. */ blocked?: { reason: string; time: string } }

const MAX_ROWS = 200

const rows = new Map<string, PlacedRow>() // placed id -> card
const unclaimed = new Map<string, number>() // worker name -> cards placed that no host notification has claimed yet
const heard = new Map<string, number>() // worker name -> host notifications drawn before any card was placed
const decided = new Map<string, boolean>() // notification requestId -> hidden: one decision per message, however often it redraws
const owed = new Map<string, { w: FinishedWorker; tries: number }>() // worker name -> a finish whose card the host refused: retried on the next builds
const MAX_TRIES = 30
let counter = 0
let runNote: { secs: number; at: number } | undefined // the band's run clock (register.ts hands it to the pane, the pane notes it here): the run card prints the figure the band prints
const RUN_NOTE_MS = 5_000 // a note older than this is from a pane that is no longer drawn (it may be another run's): the card keeps what it last said
/** State 38 (live-150-1 f0076/f0080: the run card said 0:37 a beat before the band flipped, then rewrote itself to 0:39): the band's CLOSED run clock. undefined: no band speaks (the card places as before); null: the band's run is open,
 * so the run card waits; a number: the band has flipped to done on that figure, the card is placed on it and prints it once, never rewritten. */
let runFinal: number | null | undefined
let runCarded = false // the clean run's finish card is placed once per run: set when placed, cleared when the run is no longer clean
let blockedNote: { reason: string; time: string } | null | undefined // the band reads blocked (its own reason and clock, noted by the render); null: it does not
let blockedCarded = false // the blocked card is placed once per blocked spell: set when placed, cleared when the band leaves blocked
const callsNow = new Map<string, number>() // worker name -> its tool calls as the latest build counts them: a card is drawn with the figure the board shows, not the one known the instant the worker ended (critique 35: alpha's card had none, the board 3)

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

/** Wave 34 (critique 33: a clean run ended on the host's own `verify 5/5 done` and no Atlas card): whether the snapshot is a run that closed clean. Every plan row done, at least one worker, every worker done, and no dispatch row still open. */
export function cleanRun(s: AtlasSnapshot): { done: number; total: number; workers: number; durationMs: number } | null {
  const ws = workersOf(s)
  const open = (s.todos ?? []).some((t) => (t as { origin?: string }).origin === 'dispatch' && t.status !== 'completed')
  if (!s.counts || s.counts.total <= 0 || s.counts.done < s.counts.total || !ws.length || open || ws.some((w) => w.state !== 'done')) return null
  const start = Math.min(...ws.map((w) => w.startedAt))
  const end = Math.max(...ws.map((w) => endedAt(w, s.now)))
  return { done: s.counts.done, total: s.counts.total, workers: ws.length, durationMs: Math.max(0, end - start) }
}

/** `finished · 13s` / `failed · 13s`, the words the host's own row carries. */
const textOf = (w: FinishedWorker): string => outcomeText({ status: w.failed ? 'failed' : 'completed', line: '', ...(w.durationMs > 0 ? { durationMs: w.durationMs } : {}) })

/** Place a card for each worker that finished between `prev` and `next`, and for each finish whose place the host refused on an earlier build
 * (critique 15 A2: one refused place lost the failed card for good in 3 of 6 stop runs). Never throws: a card is display only. */
export async function placeFinished($: EngineInterface, prev: AtlasSnapshot | null, next: AtlasSnapshot): Promise<void> {
  for (const w of workersOf(next)) if (w.calls?.length) callsNow.set(w.name, w.calls.length)
  const fresh = finishedWorkers(prev, next)
  const todo = [...fresh, ...[...owed.values()].map((o) => o.w).filter((o) => !fresh.some((f) => f.name === o.name))]
  for (const w of todo) {
    const tries = (owed.get(w.name)?.tries ?? 0) + 1
    owed.delete(w.name)
    try {
      if ((heard.get(w.name) ?? 0) > 0) { bump(heard, w.name, -1); continue } // the host row already drew this finish
      const id = `done-${w.name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 50)}-${++counter}`
      const calls = callsNow.get(w.name) ?? w.calls // frozen here: the card says what was true when it was placed, never a later count (truth 39: alpha's card read 0:12 then 0:13)
      const facts = workerFacts(w.name)
      rows.set(id, { name: w.name, role: w.role, text: textOf(w), failed: w.failed, ...(calls ? { calls } : {}), ...(facts ? { facts } : {}) })
      capped(rows)
      const res = await $.ui.place({ id })
      if (res.isPlaced) bump(unclaimed, w.name, 1)
      else { rows.delete(id); if (tries < MAX_TRIES) owed.set(w.name, { w, tries }) }
    } catch {
      // no surface to place into: the host's notification row draws the finish; the card is tried again on the next build
      if (tries < MAX_TRIES) owed.set(w.name, { w, tries })
    }
  }
  await placeRun($, prev, next)
  await placeBlocked($)
}

/** Ask the host to draw the transcript's messages again (the chips read `runCardPlaced`). Never throws; `$` is only called here, never stored. */
function redrawChips($: EngineInterface): void {
  try { $.ui.invalidate('ui.render') } catch { /* nothing drawn to refresh */ }
}

/** The run's own finish card, `▌ ◆ ATLAS  ● done  run  5/5 done · 3 workers  0:52`, in the build where the run first reads clean (never twice, never over a failure or an open dispatch row). */
async function placeRun($: EngineInterface, prev: AtlasSnapshot | null, next: AtlasSnapshot): Promise<void> {
  try {
    const clean = cleanRun(next)
    if (!clean) { runCarded = false; return }
    if (runCarded || !prev) return
    if (runFinal === null) return // the band still works: the card flips on the band's own render (noteRunFinal)
    const id = `done-run-${++counter}`
    const banded = typeof runFinal === 'number' ? runFinal : runSecs() // the band's own run clock when the pane has said it: the card opens on the figure the band prints (critique 36: card 0:42, band 0:43)
    rows.set(id, { name: 'run', role: '', text: textOf({ name: 'run', role: '', failed: false, durationMs: banded !== undefined ? banded * 1000 : clean.durationMs }), failed: false, fact: `${clean.done}/${clean.total} \u00b7 ${clean.workers} ${clean.workers === 1 ? 'worker' : 'workers'}` })
    capped(rows)
    const res = await $.ui.place({ id })
    if (res.isPlaced) { runCarded = true; redrawChips($) } // the lead's `done 5/5` chip may have been drawn before this card existed: it draws again, and draws nothing
    else rows.delete(id)
  } catch { /* a card is display only */ }
}

/** The blocked card (truth 39: no stop run printed one): `▌ ◆ ATLAS  ▲ blocked · stop refused  0:36`, placed once when the band first reads blocked, with the band's own reason and clock (data/runstate blockedText). The render notes what the band
 * draws; this runs on the next beat or build, so the card never lands before the band's own blocked slab. */
async function placeBlocked($: EngineInterface): Promise<void> {
  try {
    if (!blockedNote || blockedCarded) return
    const id = `done-blocked-${++counter}`
    rows.set(id, { name: 'blocked', role: '', text: '', failed: true, blocked: blockedNote })
    capped(rows)
    const res = await $.ui.place({ id })
    if (res.isPlaced) blockedCarded = true
    else rows.delete(id)
  } catch { /* a card is display only */ }
}
/** The band's render says it reads blocked (its reason and clock, as it prints them) or that it does not (null). A new blocked spell prints one new card. */
export function noteBlocked(b: { reason: string; secs?: number | undefined } | null): void {
  if (b === null) { blockedNote = null; blockedCarded = false; return }
  if (blockedNote == null) blockedNote = { reason: b.reason, time: b.secs !== undefined && Number.isFinite(b.secs) ? elapsedClock(Math.max(0, Math.floor(b.secs))) : '' }
}
/** A finish card (the run's, or the blocked one) waits for the next beat: the render notes it, the beat places it, so the card is never drawn before the band that says the same thing. */
export const cardsDue = (): boolean => (typeof runFinal === 'number' && !runCarded) || (!!blockedNote && !blockedCarded)

/** Wave 35 (critique 34: the run card said 0:13, the band 0:33): the band's own run seconds, noted by the pane every frame; the run card reads them when it draws. Absent (no pane open): the card keeps the workers' span. */
/** The band's render says its run clock: a number once it closed (the band reads done on that figure), null while the run is open. */
export const noteRunFinal = (secs: number | null | undefined): number | null | undefined => { const was = runFinal; runFinal = secs; return was }
export const noteRunSecs = (secs: number | undefined): void => { runNote = secs !== undefined && Number.isFinite(secs) && secs >= 0 ? { secs: Math.floor(secs), at: Date.now() } : undefined }
/** The band's own run seconds while the pane keeps saying them (fresh within RUN_NOTE_MS), else undefined: every run-time figure the transcript prints (the run card, the `▸ run` footer) reads this one value. */
export const runSecs = (): number | undefined => (runNote && Date.now() - runNote.at < RUN_NOTE_MS ? runNote.secs : undefined)
/** Whether the clean run's finish card was placed: the lead's own `done 5/5` chip then draws no second line. */
export const runCardPlaced = (): boolean => runCarded

/** The card behind a `Placed` row id, drawn as the host's own notification row is (one shape, one look). */
export function placedTree(id: string, ui: Ui, aged = false, opts: FinishOpts & { hidden?: boolean } = {}): RenderElement | null {
  const r = rows.get(id)
  if (!r) return null
  if (r.blocked) return blockedTree(r.blocked.reason, r.blocked.time, ui, { ...opts }) // truth 39: a placed card is never hidden, replaced or rewritten (`opts.hidden` is ignored)
  const text = r.text
  if (r.name === 'run') return notificationTree('', '', text, false, ui, aged, { ...opts, run: true, ...(r.fact ? { fact: r.fact } : {}) }) // the card says `done` once: the state word, then `5/5 · 3 workers`, then the time
  return notificationTree(r.name, r.role, text, r.failed, ui, aged, { ...opts, ...(r.facts ? { facts: r.facts } : {}), ...(r.calls !== undefined ? { calls: r.calls } : {}) })
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
const firstSeen = new Map<string, number>() // bar key -> its first draw on the snapshot clock
/** 0..1: how far a card's bar has faded 141 -> 245, from its first draw (any card kind: start card, finish card, note). Registers the first draw. */
export function barFade(key: string, now: number): number {
  if (!Number.isFinite(now) || now <= 0) return 0
  let at = firstSeen.get(key)
  if (at === undefined) { at = now; firstSeen.set(key, at); capped(firstSeen) }
  return Math.max(0, Math.min(1, (now - at) / FADE_MS))
}
export function cardFade(key: string, now: number): number {
  const first = drawn.get(key)
  return first && Number.isFinite(now) && now > 0 ? Math.max(0, Math.min(1, (now - first.at) / FADE_MS)) : 0
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
  runCarded = false; blockedNote = undefined; blockedCarded = false; runNote = undefined; runFinal = undefined; callsNow.clear(); rows.clear(); firstSeen.clear(); unclaimed.clear(); heard.clear(); decided.clear(); owed.clear(); drawn.clear(); drawSeq = 0; counter = 0; forgetFailed()
}
