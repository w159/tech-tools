// Sidebar route view: a vertical phase list (✓ done, spinner current, ○ next) with the current phase's items nested under it.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot, TodoGroup } from '../orchestra-types';
import { liveWorkers } from '../data/live';
import { isPlanItem, ownTodos } from '../data/todos';
import { TONE_HEX as T } from '../mission-layout';
import { fitRuns, rowOf, type Segment } from '../runs';
import { DONE_GLYPH, fitText, spin, textWidth } from '../theme';
import { scrub } from './chrome';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

type Todo = TodoGroup['items'][number];

const DONE_MIN_COLS = 80;
const INDENT = '  ';

/** Position of the current phase; `done` (off the todo rail) is past every phase, so the list reads all ✓. */
const railIndex = (phases: string[], phase: string): number => (phase === 'done' && !phases.includes('done') ? phases.length : phases.indexOf(phase));

/** One row per phase: `✓ research`, `⠋ implement 1/3` (accent, bold, with its done count), `○ verify`.
 * The spinner turns only while a tick is supplied; static `⠋` otherwise. */
function phaseRuns(phase: string, i: number, cur: number, count: string, tick?: number): Segment[] {
  if (i < cur) return [{ t: DONE_GLYPH, color: T.ok }, { t: ` ${phase}`, color: T.muted }];
  if (i > cur) return [{ t: '○', color: T.muted }, { t: ` ${phase}`, color: T.muted }];
  return [{ t: tick === undefined ? '⠋' : spin(tick), color: T.accent, bold: true }, { t: ` ${phase}`, color: T.accent, bold: true }, { t: count, color: T.muted }];
}

/** What to say when the current phase has no items: the board elsewhere, not a bare "nothing planned". */
function emptyLine(s: LiveSnapshot): Segment[] {
  const items = s.todoGroups.flatMap((g) => g.items);
  const open = items.filter((it) => it.status !== 'completed').length;
  if (items.length === 0) return [{ t: 'nothing planned', color: T.dim }];
  if (open === 0) return [{ t: '✓ ', color: T.ok }, { t: `all ${items.length} done`, color: T.muted }];
  return [{ t: `nothing in ${s.phase}`, color: T.dim }, { t: ` · ${open} open in other phases`, color: T.muted }];
}

/** Why an owner is blocked, from their live line; blocked owners per liveWorkers only. */
const blockedReason = (s: LiveSnapshot, owner: string | null): string | null => {
  const w = owner ? liveWorkers(s, s.now).find((x) => x.name === owner && x.state === 'blocked') : undefined;
  return w ? scrub(w.lastLine).replace(/\s+/g, ' ') : null;
};

function itemSegments(s: LiveSnapshot, it: Todo, cols: number): Segment[] {
  const reason = it.status === 'completed' ? null : blockedReason(s, it.owner);
  const mark = it.status === 'completed' ? { g: DONE_GLYPH, color: T.ok }
    : reason !== null ? { g: '⏸', color: T.warn }
    : it.status === 'in_progress' ? { g: '◉', color: T.accent } : { g: '○', color: T.muted };
  const owner = it.owner ? ` · ${fitText(scrub(it.owner), 12)}` : '';
  const title = scrub(it.content).replace(/\s+/g, ' ');
  // The reason takes only the room the title leaves; the bare tag stays even when the title must be cut.
  const spare = cols - 2 - textWidth(owner) - textWidth(title);
  const why = reason === null ? '' : reason && spare > 14 ? ` ${fitText(`(blocked: ${reason})`, spare - 1)}` : ' (blocked)';
  const room = Math.max(1, cols - 2 - textWidth(owner) - textWidth(why));
  return [
    { t: mark.g, color: mark.color }, { t: ' ' },
    { t: fitText(title, room), color: it.status === 'completed' ? T.muted : T.text },
    { t: owner, color: T.muted }, { t: why, color: T.warn },
  ];
}

/** A nested item row: indented under its phase, evidence one level deeper when opened. */
function itemRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, it: Todo, cols: number): RenderElement[] {
  const key = `task:${it.id}`;
  const ev = it.evidence ? scrub(it.evidence).replace(/\s+/g, ' ') : 'no evidence yet';
  const room = cols - INDENT.length;
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, [{ t: INDENT }, ...itemSegments(m.snapshot, it, room)], cols) }),
    ...(m.ui.expanded === key ? [els.Box({ flexShrink: 0, children: els.Text({ color: T.muted, children: fitText(`${INDENT}${INDENT}${ev}`, cols) }) })] : []),
  ];
}

const nested = (segs: Segment[]): Segment[] => [{ t: INDENT }, ...segs];

/** The current phase's rows: its own group, then board rows no group holds (unphased, e.g. the dispatch rows of a
 * board with no plan yet). Dispatch rows are listed only while the board has no plan item, as in the header count. */
function phaseItems(s: LiveSnapshot, group: TodoGroup | undefined): Todo[] {
  const own = group?.items ?? [];
  const held = new Set(s.todoGroups.flatMap((g) => g.items.map((it) => it.id)));
  const mine = ownTodos(s.todos, s.sessionId);
  const loose = mine.filter((t) => !held.has(t.id) && (!t.phase || !s.contract.todoPhases.includes(t.phase)));
  const planned = mine.some(isPlanItem);
  const extra = loose.filter((t) => planned ? isPlanItem(t) : true).map((t): Todo => ({ id: t.id, content: t.content, status: t.status, owner: t.owner ?? null, evidence: t.evidence ?? null, live: true }));
  return [...own, ...extra];
}

export function routeRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const s = m.snapshot;
  const phases = s.contract.todoPhases.map(String);
  if (phases.length === 0) return [];
  const cur = railIndex(phases, s.phase);
  const group = s.todoGroups.find((g) => g.phase === s.phase);
  const items = phaseItems(s, group);
  const doneN = items.filter((it) => it.status === 'completed').length;
  const count = items.length > 0 ? ` ${doneN}/${items.length}` : '';
  return phases.flatMap((p, i): RenderElement[] => {
    const head = rowOf(els, phaseRuns(p, i, cur, count, m.tick), inner);
    if (i !== cur) return [head];
    if (items.length === 0) return [head, rowOf(els, nested(emptyLine(s)), inner)];
    const shown = items.filter((it) => it.status !== 'completed' || inner >= DONE_MIN_COLS);
    return [head, ...shown.flatMap((it) => itemRow(els, m, on, it, inner))];
  }).concat(cur >= phases.length ? [rowOf(els, emptyLine(s), inner)] : []);
}
