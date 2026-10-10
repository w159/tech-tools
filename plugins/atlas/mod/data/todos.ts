// TODO board reader for the Atlas mod. Pure over FsLike (see ../contract);
// register.ts adapts $.fs onto it. Source: <root>/.atlas/.run/todos.json
// {version, items[]}, replaced atomically by scripts/atlas_todo.py, so the
// poll key is stat mtimeMs (plan §2, docs/plans/2026-10-09-atlas-mod.md).
import type { AtlasSnapshot, Contract, FsLike, PhaseCount, PhaseId, TodoItem } from '../contract';

/** Reusable read result: items already filtered + phase-stamped for one (root, session, members) caller. */
export interface TodosCache { mtimeMs: number; items: TodoItem[] }

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
 * Read and slice the session's todos. Keep items where
 * `session_id === sessionId` or (status 'in_progress' and owner in memberNames),
 * and never archived. `phase` is stamped on every returned item from the field
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
): Promise<{ items: TodoItem[]; cache: TodosCache }> {
  const path = `${root.replace(/\/+$/, '')}/.atlas/.run/todos.json`;
  const st = await fs.stat(path).catch(() => undefined);
  if (cache && cache.mtimeMs === (st ? st.mtimeMs : 0)) return { items: cache.items, cache };

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
  const items = parsed
    .filter(it => !it.archived)
    .filter(it => it.session_id === sessionId ||
      (it.status === 'in_progress' && it.owner !== undefined && memberNames.includes(it.owner)))
    .map(it => ({ ...it, phase: resolvePhase(it, contract) ?? 'research' as PhaseId }));
  const next: TodosCache = { mtimeMs: st ? st.mtimeMs : 0, items };
  return { items, cache: next };
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
