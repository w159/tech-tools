// Sidebar team frame: member rows with badges, optional portrait, and the message field.
import type { ClientElements, RenderElement } from 'claude-code';
import type { SquadAgent } from '../contract';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { fromBubble, fromSprite, fitRuns, rowOf, type Segment } from '../runs';
import { badge, speechBubble, spriteRows, spriteWidth } from '../sprites/api';
import { chartRoom as C, fitText, glyph, spin, textWidth } from '../theme';
import { ageStr, scrub } from './chrome';
import { pad, type SidebarHandlers, type SidebarModel } from './sidebar-types';

const isLeadName = (n: string): boolean => n === 'lead' || n.startsWith('lead-');

export type Mate = { name: string; persona: string; state: string; mood: Mood; text: string; line: string; since: number | null };
type Entry = { name: string; persona: string; state: string; text?: string };

const STATE_MOOD: Record<string, Mood> = { running: 'working', spawning: 'working', failed: 'failed', finished: 'done', input: 'blocked', stuck: 'blocked' };

/** A member's bubble is its own words only: never another member's comms, and the lead's channel traffic is not its line. */
const saidBy = (s: LiveSnapshot, name: string): string =>
  isLeadName(name) ? '' : [...s.comms].reverse().find((c) => c.from === name)?.text ?? '';

const defaultText = (tool: string | null | undefined, state: string): string => tool || (state === 'running' ? 'working' : state);

type Activity = LiveSnapshot['activity'][string] | undefined;

const moodOf = (a: Activity, state: string): Mood => a?.mood ?? STATE_MOOD[state] ?? 'idle';
const lineOf = (s: LiveSnapshot, a: Activity, e: Entry): string =>
  scrub(a?.lastLine || saidBy(s, e.name) || e.state).replace(/\s+/g, ' ').slice(0, 160);
const sinceOf = (a: Activity): number | null => (a?.tool ? a.since : null);

function mateOf(s: LiveSnapshot, e: Entry): Mate {
  const a = s.activity[e.name];
  return { ...e, mood: moodOf(a, e.state), text: e.text ?? defaultText(a?.tool, e.state), line: lineOf(s, a, e), since: sinceOf(a) };
}

const leadText = (tool: string | null | undefined, working: number): string => tool || (working ? `conducting ${working}` : 'idle');

function leadEntry(s: LiveSnapshot, working: number): Entry {
  const tool = s.activity.lead?.tool;
  return { name: 'lead', persona: 'lead', state: working || tool ? 'running' : 'idle', text: leadText(tool, working) };
}

export function mates(s: LiveSnapshot): Mate[] {
  const squad = s.squad.filter((a: SquadAgent) => !isLeadName(a.name));
  const working = squad.filter((a) => a.state === 'running' || a.state === 'spawning').length;
  // Other sessions' leads ("lead-01a118") are never teammates of this one.
  const others = s.members.filter((x) => !x.ended_at && !isLeadName(x.name));
  const entries: Entry[] = [
    leadEntry(s, working),
    ...squad.map((a) => ({ name: a.name, persona: a.persona, state: a.state })),
    ...others.map((x) => ({ name: x.name, persona: 'unknown', state: 'idle' })),
  ];
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.name) && !!seen.add(e.name)).map((e) => mateOf(s, e));
}

/** Cap on Team rows so the whole sidebar stays on screen; the rest fold into "+N more". */
const teamCap = (rows: number): number => (rows >= 30 ? 6 : rows >= 20 ? 4 : 2);

const MOOD_MARK: Record<Mood, { g: string; color?: string }> = {
  idle: { g: glyph.dot, color: C.muted }, working: { g: '', color: C.live }, thinking: { g: '…', color: C.live },
  blocked: { g: '!', color: C.warn }, done: { g: '✓', color: C.ok }, failed: { g: '✗', color: C.fail }, celebrate: { g: glyph.star, color: C.ok },
};

const BUBBLE_MAX_COLS = 36;

/** Portrait beside a speech bubble, one Box row per line so every line is measurable. */
function portraitRows(els: ClientElements, x: Mate, cols: number, tick: number): RenderElement[] {
  const w = spriteWidth('m');
  const art = spriteRows(x.persona, x.mood, tick, 'm');
  const bub = speechBubble(x.line, Math.min(BUBBLE_MAX_COLS, cols - w - 1), 'l');
  const lines = Math.max(art.length, bub.length);
  return Array.from({ length: lines }, (_, i) =>
    rowOf(els, [...(art[i]?.map(fromSprite) ?? [{ t: ' '.repeat(w) }]), { t: ' ' }, ...(bub[i]?.map(fromBubble) ?? [])], cols));
}

/** First `cap` mates, with the selected recipient swapped in when it falls past the cap. */
function visibleMates(list: Mate[], cap: number, recipient: string | null): Mate[] {
  const shown = list.slice(0, cap);
  const picked = list.find((x) => x.name === recipient);
  if (picked && !shown.includes(picked)) shown[shown.length - 1] = picked;
  return shown;
}

const isSelected = (x: Mate, recipient: string | null): boolean => recipient === x.name || (x.name === 'lead' && recipient === null);

/** Right-aligned age, only when the row has a free column for it. */
function ageTail(parts: Segment[], age: string, cols: number): Segment[] {
  const tail = age ? ` ${age}` : '';
  const gap = cols - parts.reduce((n, p) => n + textWidth(p.t), 0) - textWidth(tail);
  return tail && gap >= 1 ? [{ t: ' '.repeat(gap) + tail, color: C.muted }] : [];
}

const spinTick = (x: Mate, tick: number): number => (x.mood === 'working' ? tick : 0);
const selMark = (sel: boolean): Segment => ({ t: sel ? '▸' : ' ', color: C.focus });
const nameSeg = (x: Mate, nameW: number, sel: boolean): Segment =>
  ({ t: ` ${pad(fitText(x.name, nameW), nameW)}`, color: sel ? C.focus : undefined, bold: sel });
const moodSeg = (x: Mate, tick: number): Segment =>
  ({ t: ` ${x.mood === 'working' ? spin(tick) : MOOD_MARK[x.mood].g}`, color: MOOD_MARK[x.mood].color });

function memberRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, x: Mate, nameW: number, cols: number): RenderElement {
  const tick = m.tick ?? 0;
  const parts: Segment[] = [
    selMark(isSelected(x, m.ui.recipient)),
    ...badge(x.persona, x.mood, spinTick(x, tick)).map(fromSprite),
    nameSeg(x, nameW, isSelected(x, m.ui.recipient)),
    moodSeg(x, tick),
    { t: ` ${scrub(x.text)}`, color: C.muted },
  ];
  const age = x.since ? ageStr(m.snapshot.now - x.since) : '';
  parts.push(...ageTail(parts, age, cols));
  return els.Button({ key: `member:${x.name}`, plain: true, onPress: () => on.selectRecipient(x.name), children: fitRuns(els, parts, cols) });
}

const ACTIVE_MOODS: ReadonlySet<Mood> = new Set<Mood>(['working', 'thinking', 'blocked']);
/** Portrait only with room (a bordered pane with rows to spare), and only for an active member or one the person picked. */
const wantsPortrait = (x: Mate, m: SidebarModel, bordered: boolean): boolean =>
  bordered && m.rows >= 28 && (ACTIVE_MOODS.has(x.mood) || m.ui.recipient !== null);

function portraitFor(els: ClientElements, m: SidebarModel, list: Mate[], cols: number, bordered: boolean): RenderElement[] {
  const sel = list.find((x) => x.name === (m.ui.recipient ?? 'lead'));
  if (!sel || !wantsPortrait(sel, m, bordered)) return [];
  return portraitRows(els, sel, cols, m.tick ?? 0);
}

function messageInput(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): RenderElement {
  return els.Input({
    key: 'msg',
    label: fitText(`To ${m.ui.recipient ?? 'lead'}`, cols),
    placeholder: cols < 40 ? 'message' : 'type a message, Enter sends',
    value: m.ui.draft,
    onInput: (v: string) => on.draftChange(v),
    onSubmit: (v: string) => on.send(v),
  });
}

const NOBODY_HINT = ' nobody dispatched yet, ask the lead to start a worker';

export function teamRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number, bordered: boolean): RenderElement[] {
  const list = mates(m.snapshot);
  const shown = visibleMates(list, teamCap(m.rows), m.ui.recipient);
  const nameW = Math.min(12, Math.max(4, ...shown.map((x) => x.name.length)));
  const more = list.length - shown.length;
  return [
    ...(list.length === 1 ? [rowOf(els, [{ t: NOBODY_HINT, color: C.muted }], cols)] : []),
    ...shown.map((x) => memberRow(els, m, on, x, nameW, cols)),
    ...(more > 0 ? [rowOf(els, [{ t: `   +${more} more`, color: C.muted }], cols)] : []),
    ...portraitFor(els, m, list, cols, bordered),
    messageInput(els, m, on, cols),
  ];
}
