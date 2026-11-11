// The fixture world (contracts/band-world.ts) as the inputs the real adapters take, so one frame can be rendered through the Claude Code
// paths (mod/band.tsx missionModel, mod/hud.ts, mod/todo-panel.tsx, mod/pane/sidebar-model.ts panelModelOf) and the omp painters
// (omp/mission-panel.ts, omp/hud-paint.ts, omp/todo-panel.ts, omp/panel-view.ts) from ONE world. Nothing here restates a number: counts,
// phases, gates, worker and todo states and ages all come from `world`. The cross-surface test is mod/consistency.test.ts.
import type { ChannelNote, SquadAgent, TodoItem } from "../mod/contract";
import type { LiveSnapshot } from "../mod/orchestra-types";
import type { GateGroup, SidebarModel, SidebarView } from "../mod/pane/sidebar-types";
import { FIXTURE_CONTRACT } from "../mod/test_helpers";
import { world } from "./band-world";
import { WORLD_NOW } from "./board-golden";

type Row = (typeof world.todos)[number] & { ran_s?: number; elapsed_s?: number; estimate_s?: number };
type Note = (typeof world.notes)[number];

export const NOW_MS = WORLD_NOW * 1000;
export const SESSION = "world";
export const CHANNEL = "atlas-board-mod";

/** The contract phase list as a host reads it: the world's steps with the three ids that are not steps (`validate`, `done`, `blocked`),
 * so a surface that counts them in its rail disagrees with the world (mod/rail.ts is the one rail). */
export const worldContractPhases = (): string[] => [world.phases[0]!.id, "validate", ...world.phases.slice(1).map((p) => p.id), "done", "blocked"];
/** The world's contract: its rail is `world.phases`; the extra ids are the contract's non-steps. */
export const worldContract = () => ({ ...FIXTURE_CONTRACT, phases: worldContractPhases().map((id) => ({ id: id as never, glyph: "·" })), todoPhases: worldContractPhases().filter((id) => id !== "blocked") as never[] });

const TODO_STATUS = { done: "completed", running: "in_progress", queued: "pending", failed: "abandoned", blocked: "blocked", waiting: "pending" } as const;
const SQUAD_STATE = { running: "running", failed: "failed", done: "finished", blocked: "input", waiting: "input" } as const;
const MOOD = { running: "working", failed: "failed", done: "done", blocked: "blocked", waiting: "blocked" } as const;

/** The seven plan rows: done rows carry their stamps, the running one its claim time and estimate, the others their evidence. */
export const worldTodos = (): TodoItem[] =>
  world.todos.map((t): TodoItem => {
    const w = t as Row;
    return {
      id: t.id, content: t.label, status: TODO_STATUS[t.state as keyof typeof TODO_STATUS], owner: t.owner, session_id: SESSION, origin: "session",
      ...(t.state === "done" ? { claimed_at: 1_000, completed_at: 1_000 + w.ran_s! } : t.state === "running" ? { claimed_at: WORLD_NOW - w.elapsed_s!, ...(w.estimate_s ? { estimate_s: w.estimate_s } : {}) } : { evidence: t.detail }),
    };
  });

const isoAt = (hhmm: string): string => { const [h, m] = hhmm.split(":").map(Number); return new Date(2026, 10, 11, h!, m!).toISOString(); };
export const worldNotes = (): ChannelNote[] =>
  world.notes.map((n: Note, i): ChannelNote => ({ ts: isoAt(n.at), seq: i + 1, owner: n.from, ...("to" in n ? { to: n.to } : {}), text: n.text, channel: CHANNEL, ...("kind" in n ? { kind: n.kind } : {}) }));

/** The world's gate groups: one group and one line per gate (the three the hooks report). */
export const worldGates = (): GateGroup[] =>
  world.gates.map((g) => ({ id: g.name as GateGroup["id"], title: g.name, lines: [{ id: g.name, label: g.name, ok: g.state === "done" }] }));

/** The world as a LiveSnapshot. A queued worker is dispatched and not listed by the host yet: a roster row, no squad entry. */
export function worldSnapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  const listed = world.workers.filter((w) => w.state !== "queued");
  const squad: SquadAgent[] = listed.map((w) => ({ name: w.name, persona: w.name.split("-")[0]!, state: SQUAD_STATE[w.state as keyof typeof SQUAD_STATE], source: "task", task: w.task, item: w.task, model: w.model }));
  const activity = Object.fromEntries(listed.map((w) => [w.name, {
    tool: w.state === "running" ? "Read" : null, lastTool: w.state === "running" ? undefined : "Read", target: w.state === "running" ? "runs.ts:17" : undefined,
    since: NOW_MS, startedAt: NOW_MS - w.age_s * 1000, toolCount: w.steps_done, tokens: null, mood: MOOD[w.state as keyof typeof MOOD], lastLine: w.last_tool, calls: [], scope: "implement/medium",
  }]));
  const todos = worldTodos();
  return {
    root: "/r/atlas-board-mod", sessionId: SESSION, channel: CHANNEL, contract: worldContract(), personas: [], todos,
    counts: { done: todos.filter((t) => t.status === "completed").length, total: todos.length, byPhase: {} },
    phase: world.phases.find((p) => p.state === "active")!.id as never, phaseSource: "todo",
    notes: worldNotes(),
    members: world.workers.map((w) => ({ name: w.name, ...(w.state === "done" ? { ended_at: isoAt("10:07") } : {}) })),
    squad, contextPct: Math.round(world.workers.find((w) => w.state === "running")!.ctx! * 100), now: NOW_MS,
    activity: { lead: { tool: null, since: NOW_MS, toolCount: 0, tokens: null, mood: "idle", lastLine: "" }, ...activity } as never,
    comms: world.notes.map((n, i) => ({ seq: i + 1, ts: new Date(2026, 10, 11, ...n.at.split(":").map(Number) as [number, number]).getTime(), from: n.from, to: "to" in n ? n.to : "lead", text: n.text, kind: "kind" in n ? n.kind : "say" })) as never, todoGroups: [],
    ...over,
  };
}

/** The world as the Claude Code side panel's input, on `view` at `columns`. */
export const worldSidebar = (view: SidebarView, columns: number, snapshot: LiveSnapshot = worldSnapshot()): SidebarModel =>
  ({ snapshot, gates: worldGates(), ui: { recipient: null, expanded: null, draft: "", view }, columns: columns + 1, rows: 40, tick: 0 }) as SidebarModel;

/** The world as the omp mission panel's and omp side panel's input: the registry lists the running, failed and done workers; the queued one is a dispatched member not listed yet. */
// Typed loosely on purpose: omp/ is not part of the mod type program (it needs Bun and node types), so this module must not import it.
export function worldOmp(width: number, over: Record<string, unknown> = {}): any {
  const workers = world.workers.map((w) => ({
    name: w.name, secs: w.age_s, role: w.name.split("-")[0]!,
    ...(w.state === "running" ? { tool: { tool: "Read", target: "runs.ts:17", active: true } } : {}),
    ...(w.state === "queued" ? { state: "queued" as const } : w.state === "failed" ? { state: "failed" as const } : w.state === "done" ? { state: "done" as const } : {}),
  }));
  return {
    width, maxLines: 12, phase: world.phases.find((p) => p.state === "active")!.id, phases: worldContractPhases(), spin: "◆", laneSpin: "⠋", tick: 0,
    done: world.todos.filter((t) => t.state === "done").length, total: world.todos.length, workers,
    notes: worldNotes().map((n) => ({ from: n.owner, to: n.to ?? "lead", text: n.text, ts: Date.parse(n.ts) / 1000, ...(n.kind ? { kind: n.kind } : {}) })),
    gates: worldGates() as never, channel: CHANNEL, ctx: world.workers.find((w) => w.state === "running")!.ctx!, todos: worldTodos().map((t) => ({ ...t, status: t.status })) as never, nowSecs: WORLD_NOW,
    ...over,
  };
}

/** The closed run: every plan row done, every worker over, the failed one still failed (an idle band keeps failures visible). */
export function worldIdleSnapshot(): LiveSnapshot {
  const w = worldSnapshot();
  const todos = w.todos.map((t) => ({ ...t, status: "completed" as const }));
  const squad = w.squad.map((a) => (a.state === "failed" ? a : { ...a, state: "finished" as const }));
  const activity = Object.fromEntries(Object.entries(w.activity).map(([k, a]) => [k, k === "lead" || (a as { mood: string }).mood === "failed" ? a : { ...a, tool: null, mood: "done" }]));
  return { ...w, todos, counts: { ...w.counts, done: todos.length }, squad, activity: activity as never, phase: "done" as never, members: world.workers.map((m) => ({ name: m.name, ended_at: isoAt("10:07") })) };
}
