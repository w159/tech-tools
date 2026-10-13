// Sidebar team view: an aligned worker table (failures first, never folded), the lead summary row and the message field.
import type { ClientElements, RenderElement } from 'claude-code';
import type { SquadAgent } from '../contract';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { fitRuns, rowOf, type Segment } from '../runs';
import { chartRoom as C, fitText, spin, textWidth } from '../theme';
import { liveWorkers, type LiveWorker } from '../data/live';
import { personaColor } from '../data/personas';
import { scrub } from './chrome';
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

const STATE_LOOK = { failed: ['✗', C.fail], blocked: ['⏸', C.warn], done: ['✓', C.ok], working: ['', C.live] } as const;

/** 3s / 40s / 2m / 1h. */
function shortAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

const nowText = (w: LiveWorker): string =>
  w.state === 'blocked' ? 'awaits lead reply' : w.state === 'failed' ? 'failed' : w.state === 'done' ? 'done' : w.tool || 'working';

const cell = (t: string, w: number, right = false): string => {
  const f = fitText(t, w);
  return right ? ' '.repeat(Math.max(0, w - textWidth(f))) + f : pad(f, w);
};

type Col = { id: 'name' | 'role' | 'now' | 'age' | 'tools'; head: string; cap: number; min: number; right?: boolean; w: number };

function layout(ws: LiveWorker[], now: number, tools: (w: LiveWorker) => number, inner: number): { cols: Col[]; gap: number; last: number } {
  const ids: Col['id'][] = inner >= 70 ? ['name', 'role', 'now', 'age', 'tools'] : inner >= 50 ? ['name', 'now', 'age'] : ['name', 'now'];
  const text: Record<Col['id'], (w: LiveWorker) => string> = {
    name: (w) => w.name, role: (w) => w.role, now: nowText, age: (w) => shortAge(now - w.startedAt), tools: (w) => String(tools(w)),
  };
  const spec: Record<Col['id'], [string, number, number, boolean?]> = {
    name: ['agent', 14, 5], role: ['role', 12, 4], now: ['now', 18, 3], age: ['age', 4, 3, true], tools: ['tools', 5, 5, true],
  };
  const cols = ids.map((id): Col => {
    const [head, cap, min, right] = spec[id];
    return { id, head, cap, min, right, w: Math.min(cap, Math.max(textWidth(head), ...ws.map((w) => textWidth(text[id](w))))) };
  });
  const gap = inner >= 70 ? 2 : 1;
  const left = () => inner - 3 - cols.reduce((n, c) => n + c.w + gap, 0);
  const shrinkable = ['now', 'name', 'role'] as const;
  while (left() < 8) {
    const c = shrinkable.map((id) => cols.find((x) => x.id === id)).filter((x): x is Col => !!x && x.w > x.min).sort((a, b) => b.w - a.w)[0];
    if (!c) break;
    c.w--;
  }
  return { cols, gap, last: Math.max(0, left()) };
}

function leadRow(els: ClientElements, ws: LiveWorker[], cols: number): RenderElement {
  const n = (s: LiveWorker['state']) => ws.filter((w) => w.state === s).length;
  const running = n('working');
  return rowOf(els, [
    { t: '●', color: running ? C.live : C.muted },
    { t: ' lead', bold: true },
    { t: `  running ${running} · ${n('done')} done · ${n('blocked')} blocked`, color: C.muted },
  ], cols);
}

function messageInput(els: ClientElements, m: SidebarModel, on: SidebarHandlers, cols: number): RenderElement {
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

export function teamRows(els: ClientElements, m: SidebarModel, on: SidebarHandlers, inner: number): RenderElement[] {
  const s = m.snapshot;
  const ws = liveWorkers(s, s.now);
  const toolCount = (w: LiveWorker): number => s.activity[w.name]?.toolCount ?? 0;
  const spawned = (w: LiveWorker): boolean => s.comms.some((c) => c.kind === 'dispatch' && c.to === w.name && s.now - c.ts <= SPAWN_MS);
  const { cols, gap, last } = layout(ws, s.now, toolCount, inner);
  const sp = ' '.repeat(gap);
  const rows: RenderElement[] = [];
  if (inner >= 50 && ws.length) {
    const h = (t: string, w: number, right = false): Segment => ({ t: cell(t, w, right) + sp, color: C.muted });
    rows.push(rowOf(els, [{ t: 'st ', color: C.muted }, ...cols.map((c) => h(c.head, c.w, c.right)), ...(last ? [{ t: fitText('last line', last), color: C.muted }] : [])], inner));
  }
  if (!ws.length) rows.push(rowOf(els, [{ t: NOBODY_HINT, color: C.muted }], inner));
  for (const w of ws) {
    const [g, color] = STATE_LOOK[w.state];
    const key = `worker:${w.name}`;
    const open = m.ui.expanded === key;
    const val: Record<Col['id'], string> = { name: w.name, role: w.role, now: nowText(w), age: shortAge(s.now - w.startedAt), tools: String(toolCount(w)) };
    const parts: Segment[] = [
      { t: w.state === 'working' ? spin(m.tick ?? 0) : g, color, bold: w.state !== 'working' },
      { t: spawned(w) ? '▸ ' : '  ', color: C.focus },
      ...cols.flatMap((c): Segment[] => [{
        t: cell(c.id === 'name' ? scrub(val.name) : val[c.id], c.w, c.right) + sp,
        color: c.id === 'name' ? personaColor(w.role) : c.id === 'now' && w.state !== 'working' ? color : c.id === 'role' || c.id === 'age' || c.id === 'tools' ? C.muted : undefined,
        bold: c.id === 'name',
      }]),
      ...(last ? [{ t: fitText(scrub(w.lastLine).replace(/\s+/g, ' '), last), color: C.muted }] : []),
    ];
    rows.push(els.Button({
      key,
      plain: true,
      onPress: () => { on.selectRecipient(w.name); on.toggle(key); },
      children: fitRuns(els, parts, inner),
    }));
    if (open) {
      rows.push(rowOf(els, [{ t: '  ' + fitText(scrub(w.lastLine).replace(/\s+/g, ' ') || w.state, inner - 2), color: C.muted }], inner));
      rows.push(rowOf(els, [{ t: '  ' + fitText(`since ${shortAge(s.now - w.startedAt)} ago · ${toolCount(w)} tools`, inner - 2), color: C.muted }], inner));
    }
  }
  rows.push(leadRow(els, ws, inner), messageInput(els, m, on, inner));
  return rows;
}
