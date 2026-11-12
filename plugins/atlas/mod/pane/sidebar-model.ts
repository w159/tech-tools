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
    secs: Math.max(0, Math.round((endedAt(w, s.now) - w.startedAt) / 1000)), tools: s.activity[w.name]?.toolCount ?? 0,
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
    const { state, word } = todoState(it.status, owner ? owners.get(owner) : undefined); // the one rule (data/todos todoState) over the HUD's owner map: a failed owner fails the item, a waiting one blocks it, a returned one reads `returned`
    const detail = state === 'done' && word === DONE_DOUBT ? WORKER_FAILED : state === 'blocked' && w ? `blocked: ${w.detail}` : state === 'failed' && w ? w.detail : undefined;
    return { id: it.id, label: one(it.content), state, ...(word ? { word } : {}), owner: owner ? one(owner) : undefined, detail, evidence: it.evidence ?? null };
  });
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const noteOf = (n: ChannelNote): PanelNote => ({ at: hhmm(n.ts), from: n.owner, to: n.to, kind: n.kind, text: n.text, lead: isLead(n.owner) });


const MOOD_STATE: Record<Mood, UiState> = { working: 'running', thinking: 'running', blocked: 'blocked', failed: 'failed', done: 'done', celebrate: 'done', idle: 'waiting' };

export function panelModelOf(m: SidebarModel, ui: Ui = uiFromEnv(), cols: number = Math.max(10, m.columns - 1)): PanelModel {
  const s = m.snapshot;
  const rail = railOf(contractRail(s.contract), s.phase);
  // Other sessions' leads and workers that rested more than two hours ago are not on this team (the roster rules of sidebar-roster.ts).
  const left = new Set(s.squad.filter((a) => isLeadName(a.name) || isStale(a, s.now)).map((a) => a.name));
  const queued = queuedMembers(s).map((name): PanelWorker => ({ name: one(name), role: 'unknown', state: 'queued', detail: 'dispatched, not listed yet' })); // the host does not list them: queued
  const startAt = (name: string): number => s.squad.findIndex((a) => a.name === name); // start order, not liveWorkers' urgency order: a row never moves when a worker's state changes
  const workers = [...liveWorkers(s, s.now).sort((a, b) => startAt(a.name) - startAt(b.name)).filter((w) => !left.has(w.name)).map((w) => workerOf(s, w)), ...queued]; // start order: the layout orders them by task (panel-layout workersByTask)
  const [leadMate] = mates(s);
  const lead: PanelWorker = { name: 'lead', role: 'lead', state: MOOD_STATE[leadMate!.mood], detail: leadMate!.text };

  const ended = new Set(workers.filter((w) => w.state === 'done' || w.state === 'failed').map((w) => w.name)); // a killed worker never gets an end time in the registry, yet it is not in the channel (stoprun-150-e4a8186a-1: shown 2, true 1)
  const live = workers.filter((w) => !ended.has(w.name)).map((w) => w.name);
  const notes = s.notes;
  const lastLead = notes.map((n) => isLead(n.owner)).lastIndexOf(true);
  const people = new Set([...notes.map((n) => n.owner), ...s.members.filter((x) => !x.ended_at && !ended.has(x.name)).map((x) => x.name), ...live]).size;
  const sc = <T extends string | null | undefined>(t: T): T => (typeof t === 'string' ? (scrub(t) as T) : t);
  const gates: PanelGate[] = m.gates.map((g) => ({ id: g.id, title: sc(g.title), error: sc(g.error), lines: g.lines.map((l) => ({ id: l.id, label: sc(l.label), ok: l.ok, detail: sc(l.detail), fix: sc(l.fix) })) }));
  return {
    cols, rows: m.rows, ui, tab: m.ui.view === 'board' ? 'route' : m.ui.view, tick: m.tick ?? 0, now: spinClock(s.now, m.tick ?? 0), // the one spinner clock (atlas-ui): the snapshot clock moves with the ticker, so a spinner turns between data polls
    expanded: m.ui.expanded, recipient: m.ui.recipient,
    phases: rail.ids, phase: s.phase === 'blocked' ? 'blocked' : rail.phase, todos: todosOf(s, workers), workers, lead,
    gates, core: m.core,
    ...(m.motion ? { motion: m.motion } : {}),
    channel: s.channel ?? 'channel', people, unread: notes.length - 1 - lastLead, notes: notes.map(noteOf),
  };
}
