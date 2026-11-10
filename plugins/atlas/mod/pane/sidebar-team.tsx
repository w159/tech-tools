// Sidebar team view: one row per worker (failures first, never folded) in plain words, the lead summary row and the message field.
// Colour only for state, each coloured mark beside a word; a spinner only on a worker with a tool in flight.
import type { ClientElements, RenderElement } from 'claude-code';
import type { SquadAgent } from '../contract';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { fitRuns, rowOf, type Segment } from '../runs';
import { isMessageKind, type Tone, TONE_HEX as T } from '../mission-layout';
import { fitText, spin, textWidth } from '../theme';
import { liveWorkers, type LiveWorker } from '../data/live';
import { scrub } from './chrome';
import { pad, type SidebarHandlers, type SidebarModel } from './sidebar-types';

const isLeadName = (n: string): boolean => n === 'lead' || n.startsWith('lead-');

export type Mate = { name: string; persona: string; state: string; mood: Mood; text: string; line: string; since: number | null };
type Entry = { name: string; persona: string; state: string; text?: string };

const STATE_MOOD: Record<string, Mood> = { running: 'working', spawning: 'working', failed: 'failed', finished: 'done', input: 'blocked', stuck: 'blocked' };

/** A member's bubble is its own words only: never another member's comms, and the lead's channel traffic is not its line. */
const saidBy = (s: LiveSnapshot, name: string): string =>
  isLeadName(name) ? '' : [...s.comms].reverse().find((c) => c.from === name && isMessageKind(c.kind))?.text ?? '';

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

/** A parked, idle or finished member whose last note is older than this drops off the roster. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const RESTING_STATES: ReadonlySet<string> = new Set(['parked', 'idle', 'dead', 'finished']);
function isStale(a: SquadAgent, now: number): boolean {
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
  // A roster entry with role "lead" is a lead whatever its name ("selffix"): herdr.ts leaves it out of the
  // squad, so without this check it surfaced here as an idle "unknown" teammate forever (nothing ever sets ended_at).
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

/** The lead's row mood, shared with the band's dot so the two never disagree. */
export const leadMood = (s: LiveSnapshot): Mood => mates(s)[0]!.mood;

const NOBODY_HINT = 'nobody dispatched yet, ask the lead to start a worker';
/** A dispatch edge younger than this marks a worker as spawned this turn. */
const SPAWN_MS = 90_000;

/** 3s / 40s / 2m / 1h. */
function shortAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/** What a worker is doing, in words: `Edit auth/middleware.ts`, `thinking`, `starting`, `waiting for lead reply`, `failed`, `finished`. */
type Look = { mark: string; tone: Tone; text: string; spinning: boolean };
function lookOf(w: LiveWorker, starting: boolean): Look {
  if (w.state === 'failed') return { mark: '✗', tone: 'bad', text: 'failed', spinning: false };
  if (w.state === 'blocked') return { mark: '⏸', tone: 'warn', text: 'waiting for lead reply', spinning: false };
  if (w.state === 'done') return { mark: '✓', tone: 'ok', text: 'finished', spinning: false };
  if (w.state === 'parked') return { mark: '·', tone: 'muted', text: 'parked', spinning: false };
  if (w.tool) return { mark: '', tone: 'accent', text: scrub(w.target ? `${w.tool} ${w.target}` : w.tool).replace(/\s+/g, ' '), spinning: true };
  if (starting && !w.lastTool) return { mark: '◌', tone: 'muted', text: 'starting', spinning: false };
  return { mark: '', tone: 'muted', text: w.lastTool ? `thinking, last ${w.lastTool}` : 'thinking', spinning: true };
}

const cell = (t: string, w: number, right = false): string => {
  const f = fitText(t, w);
  return right ? ' '.repeat(Math.max(0, w - textWidth(f))) + f : pad(f, w);
};

const NAME_CAP = 14;
const ROLE_CAP = 12;
const AGE_W = 4;
const ROLE_MIN_INNER = 50;

function leadRow(els: ClientElements, ws: LiveWorker[], cols: number): RenderElement {
  const n = (s: LiveWorker['state']) => ws.filter((w) => w.state === s).length;
  // `running` always reads (a zero says nothing is working); the other counts appear only when they are not zero.
  const parts: [string, Tone][] = [[`${n('working')} running`, 'muted']];
  if (n('done')) parts.push([`${n('done')} finished`, 'muted']);
  if (n('blocked')) parts.push([`${n('blocked')} blocked`, 'warn']);
  if (n('failed')) parts.push([`${n('failed')} failed`, 'bad']);
  return rowOf(els, [
    { t: 'lead', bold: true, color: T.text },
    ...parts.reduce<Segment[]>((out, [t, tone], i) => {
      const color = T[tone];
      const last = out[out.length - 1];
      const lead = i ? ' · ' : '  ';
      if (last && last.color === color && !last.bold) last.t += lead + t; // adjacent runs of one colour stay one segment
      else if (color === T.muted) out.push({ t: lead + t, color });
      else if (last && last.color === T.muted) { last.t += lead; out.push({ t, color }); }
      else out.push({ t: lead, color: T.muted }, { t, color });
      return out;
    }, []),
  ], cols);
}

function messageInput(els: ClientElements, m: SidebarModel, on: SidebarHandlers): RenderElement {
  return els.Input({
    key: 'msg',
    label: '▸ to ' + (m.ui.recipient ?? 'lead'),
    placeholder: 'message · Enter sends',
    value: m.ui.draft,
    onInput: (v: string) => on.draftChange(v),
    onSubmit: (v: string) => on.send(v),
  });
}

/** Right-aligned summary beside the Team header. */
export function teamSummary(s: LiveSnapshot): string {
  const working = mates(s).filter((x) => x.name !== 'lead' && (x.state === 'running' || x.state === 'spawning')).length;
  return working ? `lead is conducting ${working}` : 'lead is idle';
}

/** One worker row: `⠋ impl-auth  implementer  Edit auth/middleware.ts  1m10s`. Columns line up across rows; the activity
 * takes the width the name, role and age leave and is cut with an ellipsis when it does not fit. */
function workerSegments(w: LiveWorker, look: Look, tick: number, age: string, inner: number, widths: { name: number; role: number; now: number }): Segment[] {
  const roleW = widths.role;
  const showRole = inner >= ROLE_MIN_INNER;
  const fixed = 2 + AGE_W + 2 + (showRole ? roleW + 2 : 0);
  const nameW = Math.max(4, Math.min(widths.name, inner - fixed - 8));
  const nowW = Math.max(0, Math.min(widths.now, inner - fixed - nameW - 2));
  return [
    { t: look.spinning ? spin(tick) : look.mark, color: T[look.tone], bold: !look.spinning && look.tone !== 'muted' },
    { t: ' ' },
    { t: cell(scrub(w.name), nameW) + '  ', color: T.text, bold: true },
    ...(showRole ? [{ t: cell(w.role, roleW) + '  ', color: T.muted }] : []),
    { t: cell(look.text, nowW) + '  ', color: look.tone === 'accent' ? T.text : T[look.tone] },
    { t: cell(age, AGE_W, true), color: T.muted },
  ];
}

export function teamRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const s = m.snapshot;
  const ws = liveWorkers(s, s.now);
  const toolCount = (w: LiveWorker): number => s.activity[w.name]?.toolCount ?? 0;
  const spawned = (w: LiveWorker): boolean => s.comms.some((c) => c.kind === 'dispatch' && c.to === w.name && s.now - c.ts <= SPAWN_MS);
  const widths = {
    name: Math.min(NAME_CAP, Math.max(4, ...ws.map((w) => textWidth(scrub(w.name))))),
    role: Math.min(ROLE_CAP, Math.max(4, ...ws.map((w) => textWidth(w.role)))),
    now: Math.max(0, ...ws.map((w) => textWidth(lookOf(w, spawned(w)).text))),
  };
  const rows: RenderElement[] = [];
  if (!ws.length) rows.push(rowOf(els, [{ t: NOBODY_HINT, color: T.muted }], inner));
  for (const w of ws) {
    const key = `worker:${w.name}`;
    const open = m.ui.expanded === key;
    const look = lookOf(w, spawned(w));
    rows.push(els.Button({
      key,
      plain: true,
      onPress: () => { on.selectRecipient(w.name); on.toggle(key); },
      children: fitRuns(els, workerSegments(w, look, m.tick ?? 0, shortAge(s.now - w.startedAt), inner, widths), inner),
    }));
    if (open) {
      rows.push(rowOf(els, [{ t: '  ' + fitText(scrub(w.lastLine).replace(/\s+/g, ' ') || w.state, inner - 2), color: T.muted }], inner));
      rows.push(rowOf(els, [{ t: '  ' + fitText(`running ${shortAge(s.now - w.startedAt)} · ${toolCount(w)} tool calls`, inner - 2), color: T.muted }], inner));
    }
  }
  rows.push(leadRow(els, ws, inner), messageInput(els, m, on));
  return rows;
}
