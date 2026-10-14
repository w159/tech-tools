// Orchestration data for the Atlas mod: per-agent activity, lead<->worker comms,
// and worktree-merge comms rows. Pure: register/routing/discipline feed
// events through the reducers (state lives in the `orch` $.state atom, JSON only),
// SnapshotBuilder calls deriveOrchestration() to fold that with board notes
// and git output into the AtlasSnapshot fields. No `$` here.
import type { ChannelMember, ChannelNote, SquadAgent } from '../contract';
import type { ActivityEntry, CommsEntry, Mood } from '../orchestra-types';
import { isRawId } from '../theme';

const RAW_ID = /^a?[0-9a-f]{16}$/;
/** Human label for an id: mapped name, else a label unchanged, else a raw id truncated to 6 chars. */
const labelFor = (id: string, names: Record<string, string>): string => (names[id] ? names[id] : RAW_ID.test(id) ? id.slice(0, 6) : id);

export const LEAD = 'lead';
const MAX_COMMS_TEXT = 300; // board notes are free text: clip so a snapshot (and the Client props cut from it) stays small
const MAX_COMMS = 200;
const MAX_LINE = 140;

/** Event-fed state (keys are raw host agent ids, or 'lead' for the main loop). */
export interface Orch {
  activity: Record<string, ActivityEntry>;
  comms: CommsEntry[]; // synthesized, raw ids in from/to
  stage: Record<string, 'spawned' | 'working' | 'reported'>;
  /** agent id -> what the Agent call said at spawn: its `name` (the worker label) and `subagentType` (the persona source). */
  meta: Record<string, SpawnMeta>;
}

export interface SpawnMeta { name?: string; type?: string; at?: number } // at: spawn time (ms)

export const EMPTY_ORCH: Orch = { activity: {}, comms: [], stage: {}, meta: {} };

const firstLine = (text: string): string => {
  const line = (text.split('\n').find((l) => l.trim() !== '') ?? '').replace(/\s+/g, ' ').trim();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 1)}…` : line;
};

/** A bookkeeping line: an ALL-CAPS label (`STATUS: DONE`, `FILES_CHANGED: none`, `SUCCESS_CRITERIA: …`) or a bare marker (`steps 4/4`, `done`, `files changed`): never the finding itself. */
const MARKER_CAPS = /^[A-Z][A-Z_ ]{2,}:\s/;
const MARKER_HEADER = /^[A-Z][A-Za-z_ ]{2,}:\s*$/; // `EVIDENCE:` alone: a section header, its content is on the next lines
const MARKER = /^(?:status|steps?|done|ok|result|files?[_ ]?changed)(?:[: ]|$)/i;

/** A worker's report line: the first line that is not a bookkeeping marker or section header (headings and prose count), bullet stripped, clipped to 160; the first line when all are markers. */
const answerLine = (text: string): string => {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
  const line = (lines.find((l) => !MARKER_CAPS.test(l) && !MARKER_HEADER.test(l) && !MARKER.test(l)) ?? lines[0] ?? '').replace(/^(?:#+|[-*•])\s*/, '');
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
};

const blank = (now: number): ActivityEntry => ({ tool: null, since: now, startedAt: now, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' });

function withComm(o: Orch, entry: Omit<CommsEntry, 'seq'>): CommsEntry[] {
  const seq = (o.comms[o.comms.length - 1]?.seq ?? 0) + 1;
  return [...o.comms, { seq, ...entry }].slice(-MAX_COMMS);
}

// ---- reducers ------------------------------------------------------------------

/** agent.spawn: lead dispatches `id`; the worker joins. */
export function onSpawn(o: Orch, id: string, text: string, now: number, meta?: SpawnMeta): Orch {
  const line = firstLine(text);
  const dispatched = withComm(o, { ts: now, from: LEAD, to: id, text: line || 'task dispatched', kind: 'dispatch' });
  return {
    ...o,
    activity: { ...o.activity, [id]: blank(now) },
    stage: { ...o.stage, [id]: 'spawned' },
    meta: { ...o.meta, [id]: { ...meta, at: now } },
    comms: withComm({ ...o, comms: dispatched }, { ts: now, from: id, to: 'all', text: 'joined', kind: 'join' }),
  };
}

/** A subagent's first tool call moves it to `working`; one that already reported stays reported. */
const workingStage = (o: Orch, agent: string): Orch['stage'] =>
  agent !== LEAD && o.stage[agent] !== 'reported' ? { ...o.stage, [agent]: 'working' } : o.stage;

/** What a tool call touches: a file or path basename, else the first 40 chars of the command, pattern or query first line. `input` is the open args bag of the tool.call event. */
const strOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const baseOf = (v: unknown): string => strOf(v).split('/').pop() ?? '';
const headOf = (v: unknown): string => strOf(v).split('\n', 1)[0]?.slice(0, 40) ?? '';
const targetOf = (input: unknown): string | undefined => {
  const a = (input ?? {}) as Record<string, unknown>;
  return [baseOf(a.file_path), baseOf(a.path), headOf(a.command), headOf(a.pattern), headOf(a.query)].find(Boolean);
};

/** tool.call in flight (before next). */
export function onToolStart(o: Orch, agent: string, tool: string, now: number, input?: unknown): Orch {
  const prev = o.activity[agent] ?? blank(now);
  return {
    ...o,
    activity: { ...o.activity, [agent]: { ...prev, tool, since: now, target: targetOf(input), toolCount: prev.toolCount + 1, mood: 'working' } },
    stage: workingStage(o, agent),
  };
}

/** tool.call answered: the agent is between tools. */
export function onToolEnd(o: Orch, agent: string, now: number): Orch {
  const prev = o.activity[agent] ?? blank(now);
  return {
    ...o,
    activity: { ...o.activity, [agent]: { ...prev, tool: null, since: now, target: undefined, mood: 'thinking' } },
  };
}

/** turn.step (a model request starts): thinking unless a tool is in flight. */
export function onStep(o: Orch, agent: string, now: number): Orch {
  const prev = o.activity[agent] ?? blank(now);
  if (prev.tool !== null) return o;
  return { ...o, activity: { ...o.activity, [agent]: { ...prev, mood: 'thinking', since: prev.mood === 'thinking' ? prev.since : now } } };
}

const MOOD_BY_REASON: Record<string, Mood> = { answer: 'done', aborted: 'idle' }; // any other reason is a failure
const REPORTING_REASONS = new Set(['answer', 'error', 'refusal']);

type Completion = { reason: string; answer: string; tokens: number };

const addTokens = (total: number | null, added: number): number | null => (added > 0 ? (total ?? 0) + added : total);

function completedActivity(o: Orch, agent: string, mood: Mood, line: string, e: Completion, now: number): Orch['activity'] {
  const prev = o.activity[agent] ?? blank(now);
  return { ...o.activity, [agent]: { ...prev, tool: null, since: now, mood, tokens: addTokens(prev.tokens, e.tokens), lastLine: line || prev.lastLine } };
}

/** The worker's report to the lead, then its departure. */
function reportComms(o: Orch, agent: string, mood: Mood, line: string, now: number): CommsEntry[] {
  const reported = withComm(o, { ts: now, from: agent, to: LEAD, text: line || (mood === 'failed' ? 'failed' : 'reported'), kind: 'report' });
  return withComm({ ...o, comms: reported }, { ts: now, from: agent, to: 'all', text: 'left', kind: 'leave' });
}

/** turn.complete: done/failed, tokens, last line; a subagent also reports to the lead and leaves. */
export function onComplete(o: Orch, agent: string, e: Completion, now: number): Orch {
  const mood: Mood = MOOD_BY_REASON[e.reason] ?? 'failed';
  const line = answerLine(e.answer);
  const activity = completedActivity(o, agent, mood, line, e, now);
  if (agent === LEAD) return { ...o, activity };
  const next = { ...o, activity, stage: { ...o.stage, [agent]: 'reported' as const } };
  return { ...next, comms: REPORTING_REASONS.has(e.reason) ? reportComms(next, agent, mood, line, now) : o.comms };
}

// ---- worktree parsing --------------------------------------------------------------

/** One row of `python3 scripts/atlas_wt.py status` (JSON list). */
export interface WtRow { agent: string; branch: string; worktree: string | null; ahead: number; behind: number; dirty: boolean; verified_finding: string | null; merged: boolean }

/** Parse atlas_wt.py status stdout; anything malformed is no worktrees. */
export function parseWt(out: string): WtRow[] {
  try {
    const rows: unknown = JSON.parse(out);
    return Array.isArray(rows) ? rows.filter((r): r is WtRow => r !== null && typeof r === 'object' && typeof (r as WtRow).agent === 'string' && typeof (r as WtRow).branch === 'string') : [];
  } catch {
    return [];
  }
}

/** A label that is only the persona word (`explorer`, `explorer-a06f`) names a role, not one worker. */
const roleOnly = (label: string, persona: string): boolean => {
  const l = label.toLowerCase();
  const p = persona.toLowerCase();
  return l === p || l === 'unknown' || (p !== '' && new RegExp(`^${p.replace(/[^a-z0-9]/g, '.')}-[0-9a-f]{4}$`).test(l));
};

// ---- derive ----------------------------------------------------------------------

export interface DeriveInput {
  orch: Orch;
  names: Record<string, string>; // raw agent id -> display name
  listed: readonly { id: string; status: string }[];
  squad: readonly SquadAgent[];
  notes: readonly ChannelNote[];
  members: readonly ChannelMember[];
  leadNames: readonly string[]; // channel names that mean 'lead'
  wt: readonly WtRow[];
  now: number;
  mergedAt: Record<string, number>; // builder-held memo: first time an agent was seen merged
  finishedAt?: Record<string, number>; // builder-held memo: first time a worker was seen finished (freezes its elapsed counter)
}


type Stage = Orch['stage'][string];
type Row = CommsEntry & { o: number }; // o: stable tiebreak (notes < synthesized < merge)
type AgentRec = { name: string; ids: string[]; squad?: SquadAgent };

const isReported = (s: Stage): boolean => s === 'reported';

const SQUAD_MOOD: Partial<Record<SquadAgent['state'], Mood>> = { input: 'blocked', finished: 'done', failed: 'failed', dead: 'failed', running: 'working' };
const squadMood = (state: SquadAgent['state']): Mood => SQUAD_MOOD[state] ?? 'idle';

const nameOf = (i: DeriveInput, id: string): string => (id === LEAD ? LEAD : labelFor(id, i.names));

// ---- activity ----------------------------------------------------------------------

const FAILED_HOST = new Set<string | undefined>(['failed', 'killed']);
const FAILED_SQUAD = new Set<string | undefined>(['failed', 'dead']);
const ENDED = new Set<Mood>(['done', 'failed']);

const isFailed = (st: string | undefined, sq: string | undefined): boolean => FAILED_HOST.has(st) || FAILED_SQUAD.has(sq);
const isDone = (st: string | undefined, sq: string | undefined, reported: boolean): boolean => st === 'completed' || sq === 'finished' || (reported && st !== 'running');
const finish = (cur: Mood, done: boolean): Mood => (done && cur !== 'failed' ? 'done' : cur);

/** A worker is finished when the host says so (completed/failed/killed), its squad row is terminal, or its own turn.complete arrived (stage 'reported') unless the host still lists it running. */
function moodOf(cur: Mood, st: string | undefined, sq: string | undefined, reported: boolean): Mood {
  if (st === 'waiting') return 'blocked';
  if (isFailed(st, sq)) return 'failed';
  return finish(cur, isDone(st, sq, reported));
}

const memoSince = (memo: Record<string, number>, name: string, now: number): number => (memo[name] ??= now);

/** The finish time is memoized (not the stale tool start), so the elapsed counter freezes instead of ticking. */
function settle(a: ActivityEntry, mood: Mood, memo: Record<string, number>, name: string, now: number): ActivityEntry {
  const ended = ENDED.has(mood) && !ENDED.has(a.mood);
  return ended ? { ...a, mood, tool: null, since: memoSince(memo, name, now) } : { ...a, mood };
}

const squadOnlyEntry = (s: SquadAgent, now: number): ActivityEntry => ({ tool: null, since: now, toolCount: 0, tokens: s.tokens ?? null, mood: squadMood(s.state), lastLine: '' });

function addMissingActivity(activity: Record<string, ActivityEntry>, i: DeriveInput): void {
  for (const s of i.squad) {
    if (activity[s.name] === undefined) activity[s.name] = squadOnlyEntry(s, i.now);
  }
  activity[LEAD] ??= blank(i.now);
}

function deriveActivity(i: DeriveInput): Record<string, ActivityEntry> {
  const status = new Map(i.listed.map((a) => [a.id, a.status]));
  const squadState = new Map(i.squad.map((s) => [s.name, s.state]));
  const memo = i.finishedAt ?? {};
  const activity: Record<string, ActivityEntry> = {};
  for (const [id, a] of Object.entries(i.orch.activity)) {
    const name = nameOf(i, id);
    const mood = moodOf(a.mood, status.get(id), squadState.get(name), i.orch.stage[id] === 'reported');
    activity[name] = settle(a, mood, memo, name, i.now);
  }
  addMissingActivity(activity, i);
  return activity;
}

// ---- comms -------------------------------------------------------------------------

const NOTE_KINDS = new Map<string, CommsEntry['kind']>([['exit', 'leave'], ['join', 'join'], ['dispatch', 'dispatch'], ['report', 'report'], ['merge', 'merge']]);
const noteKind = (kind: string): CommsEntry['kind'] => NOTE_KINDS.get(kind) ?? 'say';
const clip = (text: string): string => (text.length > MAX_COMMS_TEXT ? `${text.slice(0, MAX_COMMS_TEXT - 1)}…` : text);

/** Ids resolve through the names map, then the spawn label; a raw host id is never shown (`worker`). Lead aliases collapse to `lead`. */
function makeResolver(i: DeriveInput): (id: string) => string {
  const leadSet = new Set<string>([LEAD, ...i.leadNames, ...i.members.filter((m) => m.role === 'lead').map((m) => m.name)]);
  const rawOrId = (id: string): string => (isRawId(id) ? 'worker' : id);
  const labelOf = (id: string): string => i.names[id] ?? i.orch.meta[id]?.name ?? rawOrId(id);
  return (id) => {
    const shown = id === LEAD ? LEAD : labelOf(id);
    return leadSet.has(shown) ? LEAD : shown;
  };
}

function noteRows(i: DeriveInput, resolve: (id: string) => string): Row[] {
  let lastTs = 0;
  return i.notes.map((n, idx) => {
    const t = Date.parse(n.ts);
    lastTs = Number.isFinite(t) ? t : lastTs;
    return { o: idx, seq: n.seq, ts: lastTs || i.now, from: resolve(n.owner), to: resolve(n.to ?? 'all'), text: n.text, kind: noteKind(n.kind as string) };
  });
}

const synthRows = (i: DeriveInput, resolve: (id: string) => string): Row[] =>
  i.orch.comms.map((c, idx) => ({ ...c, o: 1e6 + idx, from: resolve(c.from), to: c.to === 'all' ? 'all' : resolve(c.to) }));

const mergeSeen = (rows: readonly Row[], agent: string): boolean => rows.some((r) => r.kind === 'merge' && (r.from === agent || r.to === agent));

/** A board note and a synthesized event can describe the same exchange: keep one. Two synthesized events never duplicate each other (parallel spawns share a ms and, unnamed, a label): o >= 1e6 marks them. */
function dedupeComms(rows: Row[]): CommsEntry[] {
  rows.sort((a, b) => a.ts - b.ts || a.o - b.o);
  const seen = new Map<string, boolean>();
  const comms: CommsEntry[] = [];
  for (const r of rows) {
    const key = `${r.kind}|${r.from}|${r.to}|${r.ts}|${r.text}`;
    const synth = r.o >= 1e6;
    if (seen.has(key) && seen.get(key) !== synth) continue;
    seen.set(key, synth);
    comms.push({ seq: comms.length + 1, ts: r.ts, from: r.from, to: r.to, text: clip(r.text), kind: r.kind });
  }
  return comms;
}

// ---- worktree merges ---------------------------------------------------------------

const SQUAD_STAGE: Record<string, Stage> = { finished: 'reported', running: 'working' };

function collectAgents(i: DeriveInput): AgentRec[] {
  const agents = new Map<string, AgentRec>(i.squad.map((s): [string, AgentRec] => [s.name, { name: s.name, ids: [s.name], squad: s }]));
  for (const id of Object.keys(i.orch.stage)) {
    const name = nameOf(i, id);
    const rec = agents.get(name) ?? { name, ids: [] };
    rec.ids.push(id);
    agents.set(name, rec);
  }
  return [...agents.values()];
}

const liveStage = (i: DeriveInput, a: AgentRec): Stage | undefined => a.ids.map((id) => i.orch.stage[id]).find((s) => s !== undefined);
const squadStage = (squad: SquadAgent | undefined): Stage => SQUAD_STAGE[squad?.state as string] ?? 'spawned';
const reported = (i: DeriveInput, a: AgentRec): boolean => a.squad?.state === 'finished' || isReported(liveStage(i, a) ?? squadStage(a.squad));

/** Names that identify THIS worker: its label (unless that is just the persona word) and its raw ids. */
function identityKeys(a: AgentRec): string[] {
  const others = a.ids.filter((id) => id !== a.name);
  const own = roleOnly(a.name, a.squad?.persona ?? '') ? [] : [a.name];
  return [...new Set([...own, ...others, ...others.map((id) => id.slice(0, 8))])].map((k) => k.toLowerCase()).filter((k) => k.length > 3);
}

const findTree = (wt: readonly WtRow[], keys: readonly string[]): WtRow | undefined =>
  wt.find((t) => keys.some((k) => t.agent.toLowerCase() === k || t.branch.toLowerCase() === `worker/${k}`));

/** A reported worker whose worktree merged gets one `merge` comms row (unless a board note already carries it). */
function pushMergeRow(i: DeriveInput, rows: Row[], a: AgentRec): void {
  const tree = findTree(i.wt, identityKeys(a));
  if (!tree?.merged || !reported(i, a) || mergeSeen(rows, a.name)) return;
  const ts = (i.mergedAt[a.name] ??= i.now);
  rows.push({ o: 2e6, seq: 0, ts, from: LEAD, to: a.name, text: `merged ${tree.branch}`, kind: 'merge' });
}

export function deriveOrchestration(i: DeriveInput) {
  const activity = deriveActivity(i);
  const resolve = makeResolver(i);
  const rows = [...noteRows(i, resolve), ...synthRows(i, resolve)];
  for (const a of collectAgents(i)) pushMergeRow(i, rows, a);
  return { activity, comms: dedupeComms(rows).slice(-MAX_COMMS) };
}
