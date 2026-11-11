// sidebar-roster.ts: who is on the team, the way the Team tab lists them (restored from the f4e6c29c `mates`). The lead is always the
// first entry; the squad follows (other sessions' leads and long-resting workers left out); roster members the squad does not know
// follow as `unknown` teammates. Pure over the snapshot: the panel model (sidebar-model.ts) turns these into rows.
import type { SquadAgent } from '../contract';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { isMessageKind } from '../mission-layout';
import { scrub } from './chrome';

export const isLeadName = (n: string | undefined): boolean => !!n && (n === 'lead' || n.startsWith('lead-'));

export type Mate = { name: string; persona: string; state: string; mood: Mood; text: string; line: string; since: number | null };
type Entry = { name: string; persona: string; state: string; text?: string };

const STATE_MOOD: Record<string, Mood> = { running: 'working', spawning: 'working', failed: 'failed', finished: 'done', input: 'blocked', stuck: 'blocked' };

/** A member's line is its own words only: never another member's comms, and the lead's channel traffic is not its line. */
const saidBy = (s: LiveSnapshot, name: string): string =>
  isLeadName(name) ? '' : [...s.comms].reverse().find((c) => c.from === name && isMessageKind(c.kind))?.text ?? '';

const defaultText = (tool: string | null | undefined, state: string): string => tool || (state === 'running' ? 'working' : state);

type Activity = LiveSnapshot['activity'][string] | undefined;

const moodOf = (a: Activity, state: string): Mood => a?.mood ?? STATE_MOOD[state] ?? 'idle';
/** The mate's last words: its last line, else its own latest message, else its state; scrubbed, one line, 160 cells at most. */
export const LINE_MAX = 160;
const lineOf = (s: LiveSnapshot, a: Activity, e: Entry): string =>
  scrub(a?.lastLine || saidBy(s, e.name) || e.state).replace(/\s+/g, ' ').slice(0, LINE_MAX);
const sinceOf = (a: Activity): number | null => (a?.tool ? a.since : null);

function mateOf(s: LiveSnapshot, e: Entry): Mate {
  const a = s.activity[e.name];
  return { ...e, mood: moodOf(a, e.state), text: e.text ?? defaultText(a?.tool, e.state), line: lineOf(s, a, e), since: sinceOf(a) };
}

/** A parked, idle, dead or finished member whose last note is older than this drops off the roster. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const RESTING_STATES: ReadonlySet<string> = new Set(['parked', 'idle', 'dead', 'finished']);
export function isStale(a: SquadAgent, now: number): boolean {
  const at = a.lastNoteTs ? Date.parse(a.lastNoteTs) : NaN;
  return RESTING_STATES.has(a.state) && Number.isFinite(at) && now - at > STALE_AFTER_MS;
}

const leadText = (tool: string | null | undefined): string => tool || 'idle';

function leadEntry(s: LiveSnapshot, working: number): Entry {
  const tool = s.activity.lead?.tool;
  return { name: 'lead', persona: 'lead', state: working || tool ? 'running' : 'idle', text: leadText(tool) };
}

export function mates(s: LiveSnapshot): Mate[] {
  const squad = s.squad.filter((a: SquadAgent) => !isLeadName(a.name) && !isStale(a, s.now));
  const working = squad.filter((a) => a.state === 'running' || a.state === 'spawning').length;
  // Other sessions' leads ("lead-01a118") are never teammates of this one.
  // A roster entry with role "lead" is a lead whatever its name ("selffix"): herdr.ts leaves it out of the squad, so without this
  // check it surfaced as an idle "unknown" teammate forever (nothing ever sets ended_at).
  // A roster member that has a squad entry (even a stale one dropped above) is never re-added as an "unknown" teammate.
  const inSquad = new Set(s.squad.map((a) => a.name));
  const others = s.members.filter((x) => !x.ended_at && x.role !== 'lead' && !isLeadName(x.name) && !inSquad.has(x.name));
  const entries: Entry[] = [
    leadEntry(s, working),
    ...squad.map((a) => ({ name: a.name, persona: a.persona, state: a.state })),
    ...others.map((x) => ({ name: x.name, persona: 'unknown', state: 'idle' })),
  ];
  const seen = new Set<string>();
  return entries.filter((e) => !seen.has(e.name) && !!seen.add(e.name)).map((e) => mateOf(s, e));
}

/** The lead row's mood, shared with the band's dot so the two never disagree. */
export const leadMood = (s: LiveSnapshot): Mood => mates(s)[0]!.mood;

/** Right-aligned summary beside the Team header. */
export function teamSummary(s: LiveSnapshot): string {
  const working = mates(s).filter((x) => x.name !== 'lead' && (x.state === 'running' || x.state === 'spawning')).length;
  return working ? `lead is conducting ${working}` : 'lead is idle';
}
