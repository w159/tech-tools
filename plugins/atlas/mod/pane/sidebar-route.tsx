// Sidebar route view: one phase rail (never truncated), then the current phase's header and items.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot, TodoGroup } from '../orchestra-types';
import { liveWorkers } from '../data/live';
import { fitRuns, rowOf, type Segment } from '../runs';
import { chartRoom as C, contractGlyph, fitText, glyph, textWidth } from '../theme';
import { scrub } from './chrome';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

type Todo = TodoGroup['items'][number];

const DONE_MIN_COLS = 80;
const phaseGlyph = (s: LiveSnapshot, id: string): string => contractGlyph(s.contract.phases.find((p) => p.id === id)?.glyph ?? glyph.ring);
const stateOf = (i: number, cur: number) => (i < cur ? { g: '✓', color: C.ok } : i === cur ? { g: '◉', color: C.focus } : { g: '○', color: C.muted });

/** `◎ research ✓ ─ … ─ ⚒ implement ◉`; when that overflows, `◎✓ ─ … ─ ⚒◉` (glyph + state only). */
function railRuns(s: LiveSnapshot, phases: string[], cur: number, cols: number): Segment[] {
  const build = (full: boolean): Segment[] =>
    phases.flatMap((p, i): Segment[] => {
      const st = stateOf(i, cur);
      const bold = i === cur;
      return [
        ...(i ? [{ t: ' ─ ', color: i <= cur ? C.ok : C.muted }] : []),
        { t: full ? `${phaseGlyph(s, p)} ${p} ` : phaseGlyph(s, p), color: i === cur ? C.focus : undefined, bold },
        { t: st.g, color: st.color, bold },
      ];
    });
  const full = build(true);
  return full.reduce((n, r) => n + textWidth(r.t), 0) <= cols ? full : build(false);
}

/** Why an owner is blocked, from their live line; blocked owners per liveWorkers only. */
const blockedReason = (s: LiveSnapshot, owner: string | null): string | null => {
  const w = owner ? liveWorkers(s, s.now).find((x) => x.name === owner && x.state === 'blocked') : undefined;
  return w ? scrub(w.lastLine).replace(/\s+/g, ' ') : null;
};

function itemSegments(s: LiveSnapshot, it: Todo, cols: number): Segment[] {
  const reason = it.status === 'completed' ? null : blockedReason(s, it.owner);
  const mark = it.status === 'completed' ? { g: '✓', color: C.ok }
    : reason !== null ? { g: '⏸', color: C.warn }
    : it.status === 'in_progress' ? { g: '◉', color: C.live } : { g: '○', color: C.muted };
  const owner = it.owner ? ` · ${fitText(scrub(it.owner), 12)}` : '';
  const title = scrub(it.content).replace(/\s+/g, ' ');
  // The reason takes only the room the title leaves; the bare tag stays even when the title must be cut.
  const spare = cols - 2 - textWidth(owner) - textWidth(title);
  const why = reason === null ? '' : reason && spare > 14 ? ` ${fitText(`(blocked: ${reason})`, spare - 1)}` : ' (blocked)';
  const room = Math.max(1, cols - 2 - textWidth(owner) - textWidth(why));
  return [
    { t: mark.g, color: mark.color }, { t: ' ' },
    { t: fitText(title, room), color: it.status === 'completed' ? C.muted : undefined },
    { t: owner, color: C.muted }, { t: why, color: C.warn },
  ];
}

function itemRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, it: Todo, cols: number): RenderElement[] {
  const key = `task:${it.id}`;
  const ev = it.evidence ? scrub(it.evidence).replace(/\s+/g, ' ') : 'no evidence yet';
  return [
    els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, itemSegments(m.snapshot, it, cols), cols) }),
    ...(m.ui.expanded === key ? [els.Box({ flexShrink: 0, children: els.Text({ color: C.muted, children: fitText(`  ${ev}`, cols) }) })] : []),
  ];
}

export function routeRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const s = m.snapshot;
  const phases = s.contract.todoPhases.map(String);
  if (phases.length === 0) return [];
  const rail = rowOf(els, railRuns(s, phases, phases.indexOf(s.phase), inner), inner);
  const group = s.todoGroups.find((g) => g.phase === s.phase);
  if (!group || group.items.length === 0) return [rail, rowOf(els, [{ t: 'nothing planned', color: C.faint }], inner)];
  const shown = group.items.filter((it) => it.status !== 'completed' || inner >= DONE_MIN_COLS);
  const doneN = group.items.filter((it) => it.status === 'completed').length;
  return [
    rail,
    rowOf(els, [{ t: `${phaseGlyph(s, s.phase)} ${s.phase}`, color: C.focus, bold: true }, { t: ` ${doneN}/${group.items.length}`, color: C.muted }], inner),
    ...shown.flatMap((it) => itemRow(els, m, on, it, inner)),
  ];
}
