// TODO board reader for the Atlas mod. Pure over FsLike (see ../contract);
// register.ts adapts $.fs onto it. Source: <root>/.atlas/.run/todos.json
// {version, items[]}, replaced atomically by scripts/atlas_todo.py, so the
// poll key is stat mtimeMs (plan §2, docs/plans/2026-10-09-atlas-mod.md).
import type { AtlasSnapshot, Contract, FsLike, PhaseCount, PhaseId, TodoItem } from '../contract';
import type { ContractProgress, TodoGroup } from '../orchestra-types';

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
export interface TodosCache { mtimeMs: number; items: TodoItem[]; backlog: { done: number; total: number } }

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
 * or the content prefix. Missing or corrupt file => empty list, never throws.
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
): Promise<{ items: TodoItem[]; cache: TodosCache; backlog: TodosCache['backlog'] }> {
  const path = `${root.replace(/\/+$/, '')}/.atlas/.run/todos.json`;
  const st = await fs.stat(path).catch(() => undefined);
  if (cache && cache.mtimeMs === (st ? st.mtimeMs : 0)) return { items: cache.items, cache, backlog: cache.backlog };

  // stat undefined => file missing (FsLike read would throw); skip the read.
  const raw = st === undefined ? undefined : await fs.read(path).catch(() => undefined);
  let parsed: TodoItem[] = [];
  if (raw !== undefined) {
    try {
      const data = JSON.parse(raw) as { items?: unknown };
      if (Array.isArray(data?.items)) parsed = data.items as TodoItem[];
    } catch { // corrupt JSON => empty list
    }
  }
  const live = parsed.filter(it => !it.archived);
  const backlog = { done: live.filter(it => it.status === 'completed').length, total: live.length };
  // Unphased items stay unphased (grouped as 'unsorted'); never defaulted to a real phase.
  const items = live
    .filter(it => it.session_id === sessionId ||
      it.status === 'pending' || it.status === 'in_progress')
    .map(it => ({ ...it, phase: resolvePhase(it, contract) }));
  const next: TodosCache = { mtimeMs: st ? st.mtimeMs : 0, items, backlog };
  return { items, cache: next, backlog };
}

/** Board rows carry `origin` (session|carried|manual|advisor) at runtime; TodoItem (locked contract) does not declare it. */
type BoardItem = TodoItem & { origin?: string; created_at?: number | string };
const createdAt = (it: BoardItem): number => Number(it.created_at) || 0;
const isLive = (it: BoardItem, sessionId: string): boolean =>
  it.session_id === sessionId || (it.status !== 'completed' && it.origin !== 'carried');

/** Advisor notes are not operating-contract work: they never join phase groups or progress. */
const isAdvisor = (it: BoardItem): boolean => it.origin === 'advisor';
/** Carried rows are re-stamped with the new session id at boot (atlas_todo.carry) yet belong to an earlier plan. */
const notOwn = (it: BoardItem): boolean => it.origin === 'advisor' || it.origin === 'carried';
/** Session-origin (explicit, or legacy rows without origin owned by this session). */
const isSessionOrigin = (it: BoardItem, sessionId: string): boolean =>
  it.origin === 'session' || (it.origin === undefined && it.session_id === sessionId);

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
    live: isLive(it, sessionId),
  });
  const contractItems = items.filter(it => !notOwn(it));
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
      glyph: phase === 'unsorted' ? '·' : (contract.phases.find(p => p.id === phase)?.glyph ?? '·'),
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

/** done/total per contract phase over THIS session's non-advisor phased todos (phases with none are omitted). */
export function contractProgress(items: TodoItem[], contract: Contract, sessionId: string): ContractProgress[] {
  const out: ContractProgress[] = [];
  for (const phase of contract.todoPhases) {
    const mine = items.filter(it => it.session_id === sessionId && !notOwn(it) && resolvePhase(it, contract) === phase);
    if (mine.length > 0) out.push({ phase, done: mine.filter(it => it.status === 'completed').length, total: mine.length });
  }
  return out;
}

/** AtlasSnapshot['counts']: done/total overall and per contract.todoPhases phase. */
export function computeCounts(items: TodoItem[], contract: Contract): AtlasSnapshot['counts'] {
  const byPhase: Record<string, PhaseCount> = {};
  for (const p of contract.todoPhases) byPhase[p] = { done: 0, total: 0 };
  let done = 0;
  for (const it of items) {
    if (it.status === 'completed') done++;
    const phase = resolvePhase(it, contract);
    if (phase === undefined) continue; // unstamped, no valid prefix: totals only
    const c = byPhase[phase] ??= { done: 0, total: 0 };
    c.total++;
    if (it.status === 'completed') c.done++;
  }
  return { done, total: items.length, byPhase };
}

/** Current phase: header > first in_progress item's phase > 'research'. */
export function currentPhase(
  items: TodoItem[],
  headerPhase: PhaseId | null,
): { phase: PhaseId; source: 'header' | 'todo' | 'default' } {
  if (headerPhase) return { phase: headerPhase, source: 'header' };
  const active = items.find(it => it.status === 'in_progress');
  if (active?.phase) return { phase: active.phase, source: 'todo' };
  return { phase: 'research', source: 'default' };
}

/** done/total over exactly the tasks the route shows: items of the contract-phase groups (advisor notes and unsorted excluded). */
export function routeCounts(groups: readonly TodoGroup[], contract: Contract): { done: number; total: number } {
  const phases: readonly string[] = contract.todoPhases;
  const items = groups.filter((g) => phases.includes(g.phase)).flatMap((g) => g.items);
  return { done: items.filter((i) => i.status === 'completed').length, total: items.length };
}
