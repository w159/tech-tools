// sidebar-model.ts: the Claude Code SidebarModel as the host-free PanelModel (mod/panel-layout.ts).
import type { ChannelNote } from '../contract';
import { liveWorkers, type LiveWorker } from '../data/live';
import { planBasis } from '../data/todos';
import { uiFromEnv, type Ui, type UiState } from '../atlas-ui';
import type { PanelGate, PanelModel, PanelNote, PanelTodo, PanelWorker } from '../panel-layout';
import type { LiveSnapshot } from '../orchestra-types';
import { scrub } from './chrome';
import type { SidebarModel } from './sidebar-types';

const isLead = (n: string | undefined): boolean => !!n && (n === 'lead' || n.startsWith('lead-'));
const one = (t: string | null | undefined): string => scrub(t ?? '').replace(/\s+/g, ' ').trim();
const RANK: Record<UiState, number> = { running: 0, blocked: 1, waiting: 2, failed: 3, queued: 4, done: 5 };

/** One worker in the six-word vocabulary: a worker that waits on the lead reads waiting, parked reads queued. */
function workerOf(s: LiveSnapshot, w: LiveWorker): PanelWorker {
  const a = s.squad.find((x) => x.name === w.name);
  const state: UiState = w.state === 'failed' ? 'failed' : w.state === 'blocked' ? 'waiting' : w.state === 'done' ? 'done' : w.state === 'parked' ? 'queued' : 'running';
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
    const state: UiState = it.status === 'completed' ? 'done'
      : w?.state === 'failed' ? 'failed'
      : w?.state === 'waiting' ? 'blocked'
      : it.status === 'blocked' ? 'blocked'
      : it.status === 'in_progress' ? 'running' : 'queued';
    const detail = state === 'blocked' && w ? `blocked: ${w.detail}` : state === 'failed' && w ? w.detail : undefined;
    return { id: it.id, label: one(it.content), state, owner: owner ? one(owner) : undefined, detail, evidence: it.evidence ?? null };
  });
}

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '--:--' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const noteOf = (n: ChannelNote): PanelNote => ({ at: hhmm(n.ts), from: n.owner, to: n.to, kind: n.kind, text: n.text, lead: isLead(n.owner) });

/** Phase names of the rail as the side panel lists them (the off-rail `done` phase reads past the last). */
const railOf = (s: LiveSnapshot): string[] => s.contract.todoPhases.map(String);

export function panelModelOf(m: SidebarModel, ui: Ui = uiFromEnv(), cols: number = Math.max(10, m.columns - 1)): PanelModel {
  const s = m.snapshot;
  const workers = liveWorkers(s, s.now).map((w) => workerOf(s, w)).sort((a, b) => RANK[a.state] - RANK[b.state]);
  const live = workers.filter((w) => w.state !== 'done').map((w) => w.name);
  const notes = s.notes;
  const lastLead = notes.map((n) => isLead(n.owner)).lastIndexOf(true);
  const people = new Set([...notes.map((n) => n.owner), ...s.members.filter((x) => !x.ended_at).map((x) => x.name), ...live]).size;
  const gates: PanelGate[] = m.gates.map((g) => ({ id: g.id, title: g.title, error: g.error, lines: g.lines.map((l) => ({ id: l.id, label: l.label, ok: l.ok, detail: l.detail, fix: l.fix })) }));
  return {
    cols, rows: m.rows, ui, tab: m.ui.view, tick: m.tick ?? 0,
    expanded: m.ui.expanded, recipient: m.ui.recipient,
    phases: railOf(s), phase: s.phase, todos: todosOf(s, workers), workers, gates, core: m.core,
    channel: s.channel ?? 'channel', people, unread: notes.length - 1 - lastLead, notes: notes.map(noteOf),
  };
}
