// Sidebar team section: plain member rows (selection, activity, elapsed) and the message field.
import type { ClientElements, RenderElement } from 'claude-code';
import type { SquadAgent } from '../contract';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { fitRuns, rowOf, type Segment } from '../runs';
import { chartRoom as C, fitText, textWidth } from '../theme';
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

const leadText = (tool: string | null | undefined): string => tool || 'idle';

function leadEntry(s: LiveSnapshot, working: number): Entry {
  const tool = s.activity.lead?.tool;
  return { name: 'lead', persona: 'lead', state: working || tool ? 'running' : 'idle', text: leadText(tool) };
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

/** First `cap` mates, with the selected recipient swapped in when it falls past the cap. */
function visibleMates(list: Mate[], cap: number, recipient: string | null): Mate[] {
  const shown = list.slice(0, cap);
  const picked = list.find((x) => x.name === recipient);
  if (picked && !shown.includes(picked)) shown[shown.length - 1] = picked;
  return shown;
}

const isSelected = (x: Mate, recipient: string | null): boolean => recipient === x.name || (x.name === 'lead' && recipient === null);

/** Right-aligned elapsed time, only when the row has a free column for it. */
function ageTail(parts: Segment[], age: string, cols: number): Segment[] {
  const gap = cols - parts.reduce((n, p) => n + textWidth(p.t), 0) - textWidth(age);
  return age && gap >= 1 ? [{ t: ' '.repeat(gap) + age, color: C.muted }] : [];
}

/** `▸ name  tool  1m12`; a member with no tool reads its state ("idle"). */
function memberRow(els: ClientElements, m: SidebarModel, on: SidebarHandlers, x: Mate, nameW: number, cols: number): RenderElement {
  const sel = isSelected(x, m.ui.recipient);
  const parts: Segment[] = [
    { t: sel ? '▸ ' : '  ', color: C.focus },
    { t: pad(fitText(x.name, nameW), nameW), color: sel ? C.focus : undefined, bold: sel },
    { t: `  ${scrub(x.text)}`, color: C.muted },
  ];
  const age = x.since ? ageStr(m.snapshot.now - x.since) : '';
  parts.push(...ageTail(parts, age, cols));
  return els.Button({ key: `member:${x.name}`, plain: true, onPress: () => on.selectRecipient(x.name), children: fitRuns(els, parts, cols) });
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

const NOBODY_HINT = 'nobody dispatched yet, ask the lead to start a worker';

/** Right-aligned summary beside the Team header. */
export function teamSummary(s: LiveSnapshot): string {
  const working = mates(s).filter((x) => x.name !== 'lead' && (x.state === 'running' || x.state === 'spawning')).length;
  return working ? `lead is conducting ${working}` : 'lead is idle';
}

export function teamRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): RenderElement[] {
  const list = mates(m.snapshot);
  const shown = visibleMates(list, teamCap(m.rows), m.ui.recipient);
  const nameW = Math.min(12, Math.max(4, ...shown.map((x) => x.name.length)));
  const more = list.length - shown.length;
  return [
    ...(list.length === 1 ? [rowOf(els, [{ t: NOBODY_HINT, color: C.muted }], cols)] : []),
    ...shown.map((x) => memberRow(els, m, on, x, nameW, cols)),
    ...(more > 0 ? [rowOf(els, [{ t: `  +${more} more`, color: C.muted }], cols)] : []),
    messageInput(els, m, on, cols),
  ];
}
