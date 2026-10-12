// Sidebar team portrait: sprite beside a speech bubble for the active or selected member.
import type { ClientElements, RenderElement } from 'claude-code';
import type { Mood } from '../orchestra-types';
import { fromBubble, fromSprite, rowOf } from '../runs';
import { speechBubble, spriteRows, spriteWidth } from '../sprites/api';
import type { Mate } from './sidebar-team';
import type { SidebarModel } from './sidebar-types';

const BUBBLE_MAX_COLS = 36;
const ACTIVE_MOODS: ReadonlySet<Mood> = new Set<Mood>(['working', 'thinking', 'blocked']);

/** Portrait beside a speech bubble, one Box row per line so every line is measurable. */
function portraitRows(els: ClientElements, x: Mate, cols: number, tick: number): RenderElement[] {
  const w = spriteWidth('m');
  const art = spriteRows(x.persona, x.mood, tick, 'm');
  const bub = speechBubble(x.line, Math.min(BUBBLE_MAX_COLS, cols - w - 1), 'l');
  const lines = Math.max(art.length, bub.length);
  return Array.from({ length: lines }, (_, i) =>
    rowOf(els, [...(art[i]?.map(fromSprite) ?? [{ t: ' '.repeat(w) }]), { t: ' ' }, ...(bub[i]?.map(fromBubble) ?? [])], cols));
}

/** Portrait only with room (a bordered pane with rows to spare), and only for an active member or one the person picked. */
const wantsPortrait = (x: Mate, m: SidebarModel, bordered: boolean): boolean =>
  bordered && m.rows >= 28 && (ACTIVE_MOODS.has(x.mood) || m.ui.recipient !== null);

export function portraitFor(els: ClientElements, m: SidebarModel, list: Mate[], cols: number, bordered: boolean): RenderElement[] {
  const sel = list.find((x) => x.name === (m.ui.recipient ?? 'lead'));
  if (!sel || !wantsPortrait(sel, m, bordered)) return [];
  return portraitRows(els, sel, cols, m.tick ?? 0);
}
