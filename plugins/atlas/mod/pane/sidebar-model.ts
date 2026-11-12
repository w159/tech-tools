// sidebar-model.ts: the Claude Code SidebarModel as the host-free PanelModel (mod/panel-layout.ts).
import type { ChannelNote } from '../contract';
import { endedAt, liveState, liveWorkers, queuedMembers, type LiveWorker } from '../data/live';
import { isPlanItem, ownPlan, ownTodos, todoState } from '../data/todos';
import { lastText } from '../data/lasttext';
import { DONE_DOUBT, WORKER_FAILED, spinClock, uiFromEnv, type Ui, type UiState } from '../atlas-ui';
import type { PanelGate, PanelModel, PanelNote, PanelTodo, PanelWorker } from '../panel-layout';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { contractRail, railOf } from '../rail';
import { hudAgents, lastOf, ownerStatesOf } from '../hud';
import { ownerOutcome } from '../board-model';
import { failureNotes, isoTs, noteRefusal, refusalNotes } from '../data/channels';
import { gateTally } from '../data/runstate';
import { scrub } from './chrome';
import { isLeadName, isStale, mates } from './sidebar-roster';
import type { SidebarModel } from './sidebar-types';

const isLead = isLeadName;
const one = (t: string | null | undefined): string => scrub(t ?? '').replace(/\s+/g, ' ').trim();

/** The evidence of every row `name` owns on the board: plan rows first, then the hook's dispatch row (which holds the worker's report). */
const ownEvidence = (s: LiveSnapshot, name: string): (string | null | undefined)[] => {
  const mine = ownTodos(s.todos ?? [], s.sessionId).filter((t) => t.owner === name);
  return [...mine.filter(isPlanItem), ...mine.filter((t) => !isPlanItem(t))].map((t) => t.evidence);
};

/** One worker in the six-word vocabulary: a worker that waits on the lead reads waiting, parked reads queued. */
function workerOf(s: LiveSnapshot, w: LiveWorker): PanelWorker {
  const a = s.squad.find((x) => x.name === w.name);
  const state: UiState = liveState(w);
  // The HUD's LAST (hud lastOf): a finished worker's outcome (its rows' evidence), a live or failed one's call (`read gamma.py`), never the result text that followed it.
  const call = one(lastText(lastOf(w, state, ownEvidence(s, w.name))));
  const detail = state === 'failed' ? call || 'failed' : state === 'waiting' ? 'waiting for lead reply' : state === 'done' ? call || 'finished' : state === 'queued' ? 'parked' : call || 'thinking';
  const item = a?.item && a.item.length <= 5 ? a.item.toUpperCase() : undefined;
  return {
    name: one(w.name), role: w.role, state, detail, model: a?.model?.replace(/^claude-/, ''), task: item, ...(a?.task ? { goal: one(a.task) } : {}),
    secs: Math.max(0, Math.floor((endedAt(w, s.now) - w.startedAt) / 1000)), startMs: w.startedAt, endMs: endedAt(w, s.now), tools: s.activity[w.name]?.toolCount ?? 0,
  };
}

/** The board's plan rows as todos, from the rows and the owner states the HUD uses (data/todos ownPlan, hud ownerStatesOf): a row whose worker is named only in its
 * title reads that worker's state here too, and a row whose owner is blocked or failed says so. */
function todosOf(s: LiveSnapshot, workers: readonly PanelWorker[]): PanelTodo[] {
  const rows = s.todos.length ? ownPlan(s.todos, s.sessionId) : s.todoGroups.flatMap((g) => g.items);
  const owners = ownerStatesOf(hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)));
  return rows.map((it): PanelTodo => {
    const owner = it.owner ?? undefined;
    const w = owner ? workers.find((x) => x.name === owner) : undefined;
    const oc = owner ? ownerOutcome(owners, owner) : undefined; // the owner's latest instance (`beta-explorer #2`): the same state as the HUD and the board (critique 19 A3)
    const { state, word } = todoState(it.status, oc?.state, oc?.retried); // the one rule (data/todos todoState) over the HUD's owner map: a failed owner fails the item, a waiting one blocks it, a returned one reads `returned`
    const detail = state === 'done' && word === DONE_DOUBT ? WORKER_FAILED : state === 'blocked' && w ? `blocked: ${w.detail}` : state === 'failed' && w ? w.detail : undefined;
    return { id: it.id, label: one(it.content), state, ...(word ? { word } : {}), owner: owner ? one(owner) : undefined, detail, evidence: it.evidence ?? null };
  });
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return iso === '' ? '' : Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** A kill is a failure, not a block: the store's row for a killed worker says `worker killed` under the blocked kind, the channel draws it `■ failed`. */
const kindOf = (n: ChannelNote): string | undefined => (n.kind === 'blocked' && /^worker killed/.test(n.text) ? 'failed' : n.kind);
const noteOf = (n: ChannelNote): PanelNote => ({ at: hhmm(n.ts), from: n.owner, to: n.to, ...(kindOf(n) ? { kind: kindOf(n)! } : {}), text: n.text, lead: isLead(n.owner) });


/** A kill, a refusal and a closure are three timed rows (critique 22): one the store gave no time (a refusal, a closure) is stamped with the latest time on the log before it, else `fallback`. */
function timed(rows: readonly ChannelNote[], fallback: string): ChannelNote[] {
  let last = '';
  return rows.map((n) => { if (n.ts) { last = n.ts; return n; } return { ...n, ts: last || fallback }; });
}

/** When a worker ended, from the host list (the instant a killed worker left it), else undefined: the row then draws no time rather than the clock. */
const endedMsOf = (s: LiveSnapshot, name: string): number | undefined => {
  const w = liveWorkers(s, s.now).find((x) => x.name === name);
  return w ? endedAt(w, s.now) : undefined;
};

const MOOD_STATE: Record<Mood, UiState> = { working: 'running', thinking: 'running', blocked: 'blocked', failed: 'failed', done: 'done', celebrate: 'done', idle: 'waiting' };

export function panelModelOf(m: SidebarModel, ui: Ui = uiFromEnv(), cols: number = Math.max(10, m.columns - 1)): PanelModel {
  const s = m.snapshot;
  const rail = railOf(contractRail(s.contract), s.phase);
  // Other sessions' leads and workers that rested more than two hours ago are not on this team (the roster rules of sidebar-roster.ts).
  const left = new Set(s.squad.filter((a) => isLeadName(a.name) || isStale(a, s.now)).map((a) => a.name));
  const queued = queuedMembers(s).map((name): PanelWorker => ({ name: one(name), role: 'unknown', state: 'queued', detail: 'dispatched, not listed yet' })); // the host does not list them: queued
  const startAt = (name: string): number => s.squad.findIndex((a) => a.name === name); // start order, not liveWorkers' urgency order: a row never moves when a worker's state changes
  const owned = [...new Set(s.todos.map((t) => t.owner).filter((o): o is string => !!o))];
  // A name the host list streams in half written (`beta-e` while the plan row says `beta-explorer`) reads as the one whole name the board knows, else as it is: whole or nothing (critique 22).
  const whole = (n: string): string => (owned.includes(n) ? n : ((c) => (c.length === 1 ? c[0]! : n))(owned.filter((o) => o.length > n.length && o.startsWith(n))));
  const workers = [...liveWorkers(s, s.now).sort((a, b) => startAt(a.name) - startAt(b.name)).filter((w) => !left.has(w.name)).map((w) => ({ ...workerOf(s, w), name: one(whole(w.name)) })), ...queued]; // start order: the layout orders them by task (panel-layout workersByTask)
  const [leadMate] = mates(s);
  const lead: PanelWorker = { name: 'lead', role: 'lead', state: MOOD_STATE[leadMate!.mood], detail: leadMate!.text };

  const ended = new Set(workers.filter((w) => w.state === 'done' || w.state === 'failed').map((w) => w.name)); // a killed worker never gets an end time in the registry, yet it is not in the channel (stoprun-150-e4a8186a-1: shown 2, true 1)
  const live = workers.filter((w) => !ended.has(w.name)).map((w) => w.name);
  const notes = s.notes;
  const lastLead = notes.map((n) => isLead(n.owner)).lastIndexOf(true);
  const people = new Set([...notes.map((n) => n.owner), ...s.members.filter((x) => !x.ended_at && !ended.has(x.name)).map((x) => x.name), ...live]).size;
  const spoken = new Set(notes.filter((n) => n.kind === 'blocked').map((n) => n.owner)); // a worker that already posted its own block needs no second row
  const failures = failureNotes({
    workers: workers.filter((w) => !spoken.has(w.name)).map((w) => ({ name: w.name, state: w.state, endedMs: endedMsOf(s, w.name), detail: w.state === 'failed' ? undefined : w.detail })),
    stop: null, // the refusal is a remembered row below, so it stays after Stop passes (data/channels.ts noteRefusal)
    channel: s.channel ?? '',
  });
  noteRefusal(gateTally(m.gates).stop, s.now, s.channel ?? '');
  // The closure is a post too (wave 24): a plan row the lead closed over a failed worker reads `T2 dispatch closed after Stop refusal · ghost-explorer`, whole names, from the lead.
  const stop = gateTally(m.gates).stop;
  const todos = todosOf(s, workers);
  const closures: ChannelNote[] = todos.filter((t) => t.state === 'done' && t.word === DONE_DOUBT && t.owner).map((t) => ({ ts: '', seq: 0, owner: 'lead', to: 'all', text: `${/^T\d+\b/i.exec(t.label)?.[0] ?? 'row'} dispatch closed${stop?.blocked ? ' after Stop refusal' : ''} · ${t.owner}`, channel: s.channel ?? '', kind: 'done' }));
  const sc = <T extends string | null | undefined>(t: T): T => (typeof t === 'string' ? (scrub(t) as T) : t);
  const gates: PanelGate[] = m.gates.map((g) => ({ id: g.id, title: sc(g.title), error: sc(g.error), lines: g.lines.map((l) => ({ id: l.id, label: sc(l.label), ok: l.ok, detail: sc(l.detail), fix: sc(l.fix) })) }));
  return {
    cols, rows: m.rows, ui, tab: m.ui.view === 'board' ? 'route' : m.ui.view, tick: m.tick ?? 0, now: spinClock(s.now, m.tick ?? 0), // the one spinner clock (atlas-ui): the snapshot clock moves with the ticker, so a spinner turns between data polls
    expanded: m.ui.expanded, recipient: m.ui.recipient,
    phases: rail.ids, phase: s.phase === 'blocked' ? 'blocked' : rail.phase, todos, workers, lead,
    gates, core: m.core,
    ...(m.motion ? { motion: m.motion } : {}),
    // Critique 19 C5: a kill, a blocked worker and a refused Stop are rows too, after the board's own notes (the store's facts, built the same on every render).
    channel: s.channel ?? 'channel', people, unread: notes.length - 1 - lastLead, notes: timed([...notes, ...failures, ...refusalNotes(s.channel ?? ''), ...closures], isoTs(s.now)).map(noteOf),
  };
}
