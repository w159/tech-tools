// TODO board reader for the Atlas mod. Pure over FsLike (see ../contract);
// register.ts adapts $.fs onto it. Source: <root>/.atlas/.run/todos.json
// {version, items[]}, replaced atomically by scripts/atlas_todo.py, so the
// poll key is stat mtimeMs (plan §2, docs/plans/2026-10-09_atlas-mod.md).
import type { AtlasSnapshot, Contract, FsLike, PhaseCount, PhaseId, TodoItem } from '../contract';
import type { TodoGroup } from '../orchestra-types';
import { contractGlyph } from '../theme';
import { DONE_DOUBT, type UiState } from '../atlas-ui';
import { DONE_RETRIED, itemState, titleOwner, WORKER_DOWN } from '../board-model';

/** The one derived state of a plan row, shared by the HUD TODO block and the side panel's route tab: the board's rule (board-model itemState),
 * plus `returned` (attention tone, so state `blocked`): the owner agent has ended but the store row is not completed, which never reads `queued`.
 * `word` is the state word as drawn when it differs from `state`. */
export function todoState(status: string, ownerState?: UiState, retried = false): { state: UiState; word?: string } {
  const state = itemState(status, ownerState);
  if (state === 'done') return ownerState === 'failed' ? { state, word: DONE_DOUBT } : retried ? { state, word: DONE_RETRIED } : { state }; // critique 17 A1: a completed row whose worker failed reads `done` in the amber tone, never the green one; critique 19 A3: its re-dispatch finished, `retried · done`
  if (ownerState === 'done' && (state === 'queued' || state === 'running' || status === 'ended')) return { state: 'blocked', word: 'returned' };
  if (state === 'queued' && ownerState === 'failed') return { state, word: WORKER_DOWN }; // critique 19 A3: the store row is still pending (the glyph stays queued), its worker failed: the word says so
  return { state };
}

/** Phase -> department label (the single copy; pane/board.tsx imports it). */
export const DEPT: Record<string, string> = {
  research: 'ARCHIVE',
  theory: 'OBSERVATORY',
  test: 'TEST LAB',
  validate: 'GATE',
  implement: 'FORGE',
  verify: 'TRIBUNAL',
  done: 'HARBOUR',
};

/** Reusable read result: items already filtered + phase-stamped for one (root, session, members) caller. */
export interface TodosCache { mtimeMs: number; items: TodoItem[]; size?: number }

/** Why a todos.json that exists could not be used; a missing file is a true empty board, not an error. */
export type TodosError = 'corrupt' | 'unreadable';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prefixRegex(contract: Contract): RegExp | null {
  const i = contract.itemPhasePrefix.indexOf('<phase>');
  if (i < 0) return null;
  return new RegExp(
    '^' + escapeRe(contract.itemPhasePrefix.slice(0, i)) +
    '([a-z]+)' +
    escapeRe(contract.itemPhasePrefix.slice(i + '<phase>'.length)));
}

/** Explicit `phase` field or valid `[<phase>] ` content prefix; undefined when neither. */
function resolvePhase(item: TodoItem, contract: Contract): PhaseId | undefined {
  const todoPhases: readonly string[] = contract.todoPhases;
  if (item.phase && todoPhases.includes(item.phase)) return item.phase;
  const m = prefixRegex(contract)?.exec(item.content);
  if (m && m[1] !== undefined && todoPhases.includes(m[1])) return m[1] as PhaseId;
  return undefined;
}

/**
 * Read and slice the board's todos. Keep non-archived items that are open
 * (status 'pending' or 'in_progress', any session: the backlog) or belong to
 * this session (so completed counts stay session-scoped). `phase` is stamped on every returned item from the field
 * or the content prefix. Missing file => empty list; a corrupt or unreadable one keeps the previous items and sets `error`. Never throws.
 * Cache is reused verbatim (no re-filter, no re-read) while stat mtimeMs is
 * unchanged; it is only valid for the same root/session/memberNames context.
 */
export async function readTodos(
  fs: FsLike,
  root: string,
  sessionId: string,
  memberNames: string[],
  contract: Contract,
  cache?: TodosCache,
): Promise<{ items: TodoItem[]; cache: TodosCache; error?: TodosError }> {
  const path = `${root.replace(/\/+$/, '')}/.atlas/.run/todos.json`;
  const st = await fs.stat(path).catch(() => undefined);
  if (cache && cache.mtimeMs === (st ? st.mtimeMs : 0) && (cache.size ?? st?.size) === st?.size) return { items: cache.items, cache }; // mtime AND size: the poll fingerprint keys on both, a rewrite inside one mtime tick must not serve the old rows

  // stat undefined => file missing (the true empty board); skip the read.
  const raw = st === undefined ? undefined : await fs.read(path).catch(() => undefined);
  let parsed: TodoItem[] = [];
  let error: TodosError | undefined;
  if (st !== undefined && raw === undefined) error = 'unreadable';
  else if (raw !== undefined) {
    try {
      const data = JSON.parse(raw) as { items?: unknown };
      if (Array.isArray(data?.items)) parsed = data.items as TodoItem[];
      else error = 'corrupt';
    } catch {
      error = 'corrupt';
    }
  }
  // A file that exists but cannot be used keeps the last good items on screen (cached under the bad mtime so it is not re-read).
  if (error !== undefined && st !== undefined) {
    const items = cache?.items ?? [];
    return { items, cache: { mtimeMs: st.mtimeMs, size: st.size, items }, error };
  }
  // Unphased items stay unphased (grouped as 'unsorted'); never defaulted to a real phase.
  const items = parsed
    .filter(it => !it.archived)
    .filter(it => it.session_id === sessionId || it.session_id === '' ||
      it.status === 'pending' || it.status === 'in_progress')
    .map(it => ({ ...it, phase: resolvePhase(it, contract) }));
  const next: TodosCache = { mtimeMs: st ? st.mtimeMs : 0, size: st?.size, items };
  return { items, cache: next };
}

/** Board rows carry `origin` (session|carried|manual|advisor) at runtime; TodoItem (locked contract) does not declare it. */
type BoardItem = TodoItem & { origin?: string; created_at?: number | string };
const createdAt = (it: BoardItem): number => Number(it.created_at) || 0;
const isLive = (it: BoardItem, sessionId: string): boolean =>
  it.session_id === sessionId || it.session_id === '' || (it.status !== 'completed' && it.origin !== 'carried');

/** A stub row carries no work: empty content, or the literal `placeholder` some boards hold. It never counts. */
export const isStubRow = (it: object): boolean => {
  const c = (it as { content?: unknown }).content;
  if (typeof c !== 'string') return false; // no content field at all (a bare status object) is not a stub
  const t = c.trim().toLowerCase();
  return t === '' || t === 'placeholder';
};

/** The lead's own plan: hook-added dispatch rows (one per subagent dispatch) are bookkeeping, advisor notes are not
 * operating-contract work, and stub rows hold no work; none of them is a plan item. */
export const isPlanItem = (it: object): boolean => {
  const origin = (it as { origin?: string }).origin;
  return origin !== 'dispatch' && origin !== 'advisor' && !isStubRow(it);
};

/** This session's own rows: carried rows are re-stamped with the session id at boot yet belong to an earlier plan, and
 * another session's rows (a different session id; the open backlog readTodos keeps for the board) are not this run's work.
 * A carried row completed since boot is this session's finished work and counts (carry_over archives older completed
 * ones, so a completed carried row is always this session's). Without a session id the caller has already scoped the rows. */
const ownRow = (it: object, sessionId?: string): boolean => {
  const r = it as { origin?: string; session_id?: string; status?: string };
  const carriedDone = r.origin === 'carried' && r.status === 'completed';
  // session_id '' is a plan written by `atlas_todo.py set` with no --session: the lead's own rows (carry_over re-stamps stale ones at boot)
  return (r.origin !== 'carried' || carriedDone) && (sessionId === undefined || !r.session_id || r.session_id === sessionId);
};

/** This session's rows as the board lists them (dispatch rows included; open carried and other sessions' rows left out). */
export const ownTodos = <T extends object>(items: readonly T[], sessionId?: string): T[] => {
  const own = items.filter((it) => ownRow(it, sessionId));
  // A plan row that names its worker in the title (`T1 read alpha.py (alpha-explorer)`) while the store holds no owner gets that worker as its owner when a
  // dispatch row of this board is the worker's: the HUD, band and side panel then match owner to agent as the Board fold does. The title is left as written.
  const workers = new Set(own.map((it) => it as { origin?: string; owner?: string }).filter((it) => it.origin === 'dispatch' && it.owner).map((it) => it.owner!));
  if (workers.size === 0) return own;
  return own.map((it) => {
    const r = it as { origin?: string; owner?: string; content?: unknown };
    const m = r.origin !== 'dispatch' && !r.owner && typeof r.content === 'string' ? titleOwner(r.content, workers) : undefined;
    return m ? { ...it, owner: m.name } : it;
  });
};

/** The one count basis: this session's plan items. Every surface (band, HUD, board, side panel, snapshot.counts) counts this set. */
export const planBasis = <T extends object>(items: readonly T[], sessionId?: string): T[] =>
  items.filter((it) => ownRow(it, sessionId) && isPlanItem(it));

/** The plan rows every surface lists: the plan basis over this session's rows with a title-named worker made the owner (ownTodos). The HUD, the side panel's
 * route tab and the board all read this one set, so a row whose worker is named only in its title (`T1 read alpha.py (alpha-explorer)`) gets that owner's state everywhere. */
export const ownPlan = <T extends object>(items: readonly T[], sessionId?: string): T[] => planBasis(ownTodos(items, sessionId), sessionId);

/** The open dispatch row Stop refuses on, named for a person (critique 17 A4): the plan row that names its worker, as `T2 read ghost.py` (its T-id and title, the worker
 * parenthesis left off), else the agent's name; never the dispatch prompt (`Read ghost.py first, then...`), which reads cut mid-phrase on the band. `plan` is ownPlan(...)
 * (a title-named worker already is the row's owner). */
export function openRowName(plan: readonly object[], open: object | undefined): string | undefined {
  const d = open as { owner?: string | null; content?: unknown } | undefined;
  if (!d) return undefined;
  const owner = d.owner ? String(d.owner) : '';
  if (!owner) return typeof d.content === 'string' && d.content.trim() !== '' ? d.content.replace(/\s+/g, ' ').trim() : undefined;
  const row = plan.map((p) => p as { content?: unknown; owner?: string | null }).find((p) => typeof p.content === 'string' && (p.owner === owner || titleOwner(p.content, { has: (n) => n === owner })));
  if (!row) return owner;
  const content = String(row.content);
  const m = titleOwner(content, { has: (n) => n === owner });
  return (m ? content.slice(0, m.at) : content).replace(/\s+/g, ' ').trim() || owner;
}

/** Advisor notes are not operating-contract work: they never join phase groups or progress. */
const isAdvisor = (it: BoardItem): boolean => it.origin === 'advisor';
/** Carried rows are re-stamped with the new session id at boot (atlas_todo.carry) yet belong to an earlier plan. */
const notOwn = (it: BoardItem): boolean => it.origin === 'advisor' || (it.origin === 'carried' && it.status !== 'completed'); // a carried row finished this session is its own work (ownRow)
/** Session-origin (explicit, or legacy rows without origin owned by this session). */
const isSessionOrigin = (it: BoardItem, sessionId: string): boolean =>
  it.origin === 'session' || (it.origin === undefined && (it.session_id === sessionId || it.session_id === ''));

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Contract groups (todoPhases order) hold only phased items or phase-less session-origin items ('unsorted');
 * open advisor notes form one final 'advisor' group (the pane keeps it collapsed). Live items first, empty groups dropped.
 */
export function groupTodos(items: TodoItem[], contract: Contract, sessionId: string): TodoGroup[] {
  const order: (PhaseId | 'unsorted')[] = [...contract.todoPhases, 'unsorted'];
  const rank: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };
  const row = (it: BoardItem) => ({
    id: it.id, content: clip(it.content, 160), status: it.status, owner: it.owner ?? null, evidence: it.evidence ? clip(it.evidence, 200) : null,
    live: isLive(it, sessionId), ...(it.origin ? { origin: it.origin } : {}),
    // another session's open backlog row: marked so the groups-only count (routeCounts) can leave it out like planCounts does
    ...(it.session_id && it.session_id !== sessionId ? { session_id: it.session_id } : {}),
  });
  const contractItems = items.filter(it => !notOwn(it) && !isStubRow(it)); // a stub row holds no work: no group shows it
  const groups: TodoGroup[] = [];
  for (const phase of order) {
    const mine = contractItems.filter(it => {
      const p = resolvePhase(it, contract);
      return p !== undefined ? p === phase : phase === 'unsorted' && isSessionOrigin(it, sessionId);
    });
    if (mine.length === 0) continue;
    const rows = mine
      .map(row)
      .sort((a, b) => Number(b.live) - Number(a.live) || (rank[a.status] ?? 1) - (rank[b.status] ?? 1));
    groups.push({
      phase,
      dept: phase === 'unsorted' ? 'UNSORTED' : (DEPT[phase] ?? phase.toUpperCase()),
      glyph: phase === 'unsorted' ? '·' : contractGlyph(contract.phases.find(p => p.id === phase)?.glyph ?? '·'),
      items: rows,
      done: rows.filter(r => r.status === 'completed').length,
      total: rows.length,
    });
  }
  // Newest first: the pane shows the two most recent and folds the older ones into "+N more".
  const advisors = items.filter(it => isAdvisor(it) && it.status !== 'completed')
    .sort((a, b) => createdAt(b) - createdAt(a)).map(row);
  if (advisors.length > 0) {
    groups.push({ phase: 'advisor', dept: 'ADVISOR NOTES', glyph: '·', items: advisors, done: 0, total: advisors.length });
  }
  return groups;
}

/** AtlasSnapshot['counts']: done/total overall and per contract.todoPhases phase, over the shared plan basis. */
export function computeCounts(all: TodoItem[], contract: Contract, sessionId?: string): AtlasSnapshot['counts'] {
  const items = planBasis(all, sessionId);
  const byPhase: Record<string, PhaseCount> = {};
  for (const p of contract.todoPhases) byPhase[p] = { done: 0, total: 0 };
  for (const it of items) {
    const phase = resolvePhase(it, contract);
    if (phase === undefined) continue; // unstamped, no valid prefix: totals only
    const c = byPhase[phase] ??= { done: 0, total: 0 };
    c.total++;
    if (it.status === 'completed') c.done++;
  }
  const { done, total } = planCounts(all, sessionId);
  return { done, total, byPhase };
}

/** Phase of the plan itself: the in_progress row's phase; every plan row completed => 'done'; else the earliest open
 * row's phase (the work still to do); else the last completed row's phase. undefined when the plan names no phase.
 * Shared with omp. */
export function planPhase<T extends { status?: string; phase?: string }>(items: readonly T[], sessionId?: string): string | undefined {
  const plan = planBasis(items, sessionId);
  const active = plan.find((it) => it.status === 'in_progress');
  if (active) return active.phase;
  if (plan.length > 0 && plan.every((it) => it.status === 'completed')) return 'done';
  return plan.find((it) => it.status !== 'completed' && it.phase)?.phase
    ?? [...plan].reverse().find((it) => it.status === 'completed' && it.phase)?.phase;
}

/** A dispatch row of this session the store has not closed: Stop counts it and the band says `1 dispatch open`. Archived rows do not count. */
export const dispatchOpen = (items: readonly object[], sessionId?: string): boolean =>
  items.some((it) => {
    const r = it as { origin?: string; archived?: boolean; status?: string; session_id?: string };
    return r.origin === 'dispatch' && !r.archived && r.status !== 'completed' && (sessionId === undefined || !r.session_id || r.session_id === sessionId);
  });

/** Current phase: the lead's reply header (the chip the transcript draws) > the active todo > a finished plan (`done`) > the earliest open row's phase > the last completed row's phase > 'research' (nothing has run).
 * Critique 15: the route said `phase research 1/5` and `phase done 5/5` while the chip said IMPLEMENT; one phase for every surface means the chip decides.
 * `open`: work is still open behind the plan (a dispatch row not closed, a worker listed running). Nothing reads `done` then, whoever says so: the band reads `working`, and a panel that said
 * `phase done` beside it stated something false (critique 27, stoprun-150-46d4825c-1 f0109:6 to f0113:6: `phase done` over `working 0:54 · todo 5/5 · 1 dispatch open`). */
export function currentPhase(
  items: TodoItem[],
  headerPhase: PhaseId | null,
  sessionId?: string,
  open = false,
): { phase: PhaseId; source: 'header' | 'todo' | 'default' } {
  if (headerPhase && !(open && headerPhase === 'done')) return { phase: headerPhase, source: 'header' };
  const plan = planBasis(items, sessionId);
  const active = plan.find((it) => it.status === 'in_progress');
  if (active?.phase) return { phase: active.phase, source: 'todo' };
  if (!open && !active && plan.length > 0 && plan.every((it) => it.status === 'completed')) return { phase: 'done', source: 'todo' };
  const last = open ? (plan.find((it) => it.status !== 'completed' && it.phase)?.phase ?? [...plan].reverse().find((it) => it.phase)?.phase) : planPhase(plan); // open work: a finished plan names its own last phase, never `done`
  return last ? { phase: last as PhaseId, source: 'todo' } : { phase: 'research', source: 'default' };
}

/** done/total over the shared plan basis (this session's plan items; dispatch, advisor, carried and stub rows leave it).
 * A board holding only dispatch rows still reads `0 of 2` like the TODO tree under it. The one count function: band, HUD,
 * board, side panel and snapshot.counts all come through here. */
export function planCounts(items: readonly { status: string }[], sessionId?: string): { done: number; total: number } {
  const plan = planBasis(items, sessionId);
  const basis = plan.length ? plan : items.filter((it) => ownRow(it, sessionId) && !isStubRow(it) && (it as { origin?: string }).origin === 'dispatch');
  return { done: basis.filter((i) => i.status === 'completed').length, total: basis.length };
}

/** The snapshot's count: planCounts over its todos; a snapshot that carries only groups (no flat rows) counts the groups. */
export function todoCounts(s: { todos: readonly { status: string }[]; todoGroups: readonly TodoGroup[]; sessionId?: string }): { done: number; total: number } {
  return s.todos.length ? planCounts(s.todos, s.sessionId) : routeCounts(s.todoGroups, undefined, s.sessionId);
}

/** done/total over group rows, on the same basis as planCounts (ownRow: groupTodos already left stubs and advisor notes
 * out; dispatch rows, other sessions' rows (marked `session_id` by groupTodos) and open carried rows are skipped here). */
export function routeCounts(groups: readonly TodoGroup[], _contract?: Contract, sessionId?: string): { done: number; total: number } {
  const items = groups.filter((g) => g.phase !== 'advisor').flatMap((g) => g.items)
    .filter((it) => ownRow(it, sessionId) && it.origin !== 'dispatch');
  return { done: items.filter((i) => i.status === 'completed').length, total: items.length };
}

// ---- dispatch rows follow their worker (S1) -----------------------------------------------------------------------------

/** How a dispatched worker ended. */
export type Outcome = 'done' | 'failed';

/** Who has ended, from the squad: `finished` is done, `failed` and `dead` are failed; running, parked and waiting workers are not ended. The lead is not a worker. */
export function endedOf(squad: readonly { name: string; state: string }[], orch?: { stage: Record<string, string>; meta: Record<string, { name?: string }>; activity: Record<string, { mood?: string }> }): Record<string, Outcome> {
  const out: Record<string, Outcome> = {};
  // The agent's own completion event (stage `reported`) closes its row even when the squad no longer lists it.
  for (const [id, stage] of Object.entries(orch?.stage ?? {})) {
    const name = orch?.meta[id]?.name;
    if (stage === 'reported' && name && name !== 'lead') out[name] = orch?.activity[id]?.mood === 'failed' ? 'failed' : 'done';
  }
  for (const a of squad) {
    if (a.name === 'lead') continue;
    if (a.state === 'finished') out[a.name] = 'done';
    else if (a.state === 'failed' || a.state === 'dead') out[a.name] = 'failed';
  }
  return out;
}

/** A pending or in_progress dispatch row whose owner has ended reads `ended` (the agent is gone, the store still holds the row
 * open: the screen must not call it done while Stop counts it open) or `failed`; any other row, and a dispatch row whose worker
 * is still running, is returned as written (the very same array when no row changes). The SubagentStop hook is what completes
 * the store row (hooks/worker_report_gate_core.py); until it does, the view says `ended`. */
export function settleDispatch<T extends { status: string; owner?: string; origin?: string }>(items: T[], ended: Readonly<Record<string, Outcome>>): T[] {
  let changed = false;
  const out = items.map((it) => {
    const outcome = it.origin === 'dispatch' && it.owner !== undefined ? ended[it.owner] : undefined;
    if (!outcome || (it.status !== 'pending' && it.status !== 'in_progress')) return it;
    changed = true;
    return { ...it, status: outcome === 'done' ? 'ended' : 'failed' };
  });
  return changed ? out : items; // the same array when nothing settled: the snapshot's todo cache keeps its identity
}
