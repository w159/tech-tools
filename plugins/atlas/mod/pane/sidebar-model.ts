// sidebar-model.ts: the Claude Code SidebarModel as the host-free PanelModel (mod/panel-layout.ts).
import type { ChannelNote } from '../contract';
import { liveState, liveWorkers, queuedMembers, type LiveWorker } from '../data/live';
import { planBasis } from '../data/todos';
import { uiFromEnv, type Ui, type UiState } from '../atlas-ui';
import type { PanelGate, PanelModel, PanelNote, PanelTodo, PanelWorker } from '../panel-layout';
import type { LiveSnapshot, Mood } from '../orchestra-types';
import { itemState } from '../board-model';
import { contractRail, railOf } from '../rail';
import { scrub } from './chrome';
import { isLeadName, isStale, mates } from './sidebar-roster';
import type { SidebarModel } from './sidebar-types';

const isLead = isLeadName;
const one = (t: string | null | undefined): string => scrub(t ?? '').replace(/\s+/g, ' ').trim();
const RANK: Record<UiState, number> = { running: 0, blocked: 1, waiting: 2, failed: 3, queued: 4, done: 5 };

/** One worker in the six-word vocabulary: a worker that waits on the lead reads waiting, parked reads queued. */
function workerOf(s: LiveSnapshot, w: LiveWorker): PanelWorker {
  const a = s.squad.find((x) => x.name === w.name);
  const state: UiState = liveState(w);
  const doing = w.tool ? one(w.target ? `${w.tool} ${w.target}` : w.tool) : w.lastTool ? `thinking, last ${w.lastTool}` : 'thinking';
  const detail = state === 'failed' ? one(w.lastLine) || 'failed' : state === 'waiting' ? 'waiting for lead reply' : state === 'done' ? one(w.lastLine) || 'finished' : state === 'queued' ? 'parked' : doing;
  const item = a?.item && a.item.length <= 5 ? a.item.toUpperCase() : undefined;
  return {
    name: one(w.name), role: w.role, state, detail, model: a?.model?.replace(/^claude-/, ''), task: item,
    secs: Math.max(0, Math.round((s.now - w.startedAt) / 1000)), tools: s.activity[w.name]?.toolCount ?? 0,
  };
}

/** The board's plan rows as todos; a row whose owner is blocked or failed says so. */
function todosOf(s: LiveSnapshot, workers: readonly PanelWorker[]): PanelTodo[] {
  const rows = s.todos.length ? planBasis(s.todos, s.sessionId) : s.todoGroups.flatMap((g) => g.items);
  return rows.map((it): PanelTodo => {
    const owner = it.owner ?? undefined;
    const w = owner ? workers.find((x) => x.name === owner) : undefined;
    const state: UiState = itemState(it.status, w?.state); // the board's rule (mod/board-model.ts): a failed owner fails the item, a waiting one blocks it
    const detail = state === 'blocked' && w ? `blocked: ${w.detail}` : state === 'failed' && w ? w.detail : undefined;
    return { id: it.id, label: one(it.content), state, owner: owner ? one(owner) : undefined, detail, evidence: it.evidence ?? null };
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
  const workers = [...liveWorkers(s, s.now).filter((w) => !left.has(w.name)).map((w) => workerOf(s, w)), ...queued].sort((a, b) => RANK[a.state] - RANK[b.state]);
  const [leadMate] = mates(s);
  const lead: PanelWorker = { name: 'lead', role: 'lead', state: MOOD_STATE[leadMate!.mood], detail: leadMate!.text };

  const live = workers.filter((w) => w.state !== 'done').map((w) => w.name);
  const notes = s.notes;
  const lastLead = notes.map((n) => isLead(n.owner)).lastIndexOf(true);
  const people = new Set([...notes.map((n) => n.owner), ...s.members.filter((x) => !x.ended_at).map((x) => x.name), ...live]).size;
  const sc = <T extends string | null | undefined>(t: T): T => (typeof t === 'string' ? (scrub(t) as T) : t);
  const gates: PanelGate[] = m.gates.map((g) => ({ id: g.id, title: sc(g.title), error: sc(g.error), lines: g.lines.map((l) => ({ id: l.id, label: sc(l.label), ok: l.ok, detail: sc(l.detail), fix: sc(l.fix) })) }));
  return {
    cols, rows: m.rows, ui, tab: m.ui.view === 'board' ? 'route' : m.ui.view, tick: m.tick ?? 0,
    expanded: m.ui.expanded, recipient: m.ui.recipient,
    phases: rail.ids, phase: s.phase === 'blocked' ? 'blocked' : rail.phase, todos: todosOf(s, workers), workers, lead,
    gates, core: m.core,
    channel: s.channel ?? 'channel', people, unread: notes.length - 1 - lastLead, notes: notes.map(noteOf),
  };
}
