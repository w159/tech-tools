// The side panel, worker card and toast of the fixture world (contracts/band-world.ts): every number derives from `world`.
// Goldens: contracts/panel-golden.ts. Both hosts feed these models to the shared layout (mod/panel-layout.ts).
import type { Ui } from "../mod/atlas-ui";
import type { CardModel, PanelModel, PanelTab } from "../mod/panel-layout";
import { world } from "./band-world";

/** People on the channel: everyone who spoke and every worker not finished (the rule of mod/pane/sidebar-model.ts). */
const worldPeople = (): number => new Set([...world.notes.map((n) => n.from), ...world.workers.filter((w) => w.state !== "done").map((w) => w.name)]).size;
/** Notes after the lead last spoke (every note when it never did). */
const worldUnread = (): number => world.notes.length - 1 - world.notes.map((n) => "lead" in n && n.lead === true).lastIndexOf(true);

export const panelWorld = (tab: PanelTab, cols: number, ui: Ui, over: Partial<PanelModel> = {}): PanelModel => ({
  cols, rows: 40, ui, tab, tick: 0, expanded: null, recipient: null,
  phases: world.phases.map((p) => p.id as string),
  phase: world.phases.find((p) => p.state === "active")!.id,
  todos: world.todos.map((t) => ({ id: t.id, label: t.label, state: t.state, owner: t.owner, detail: t.detail })),
  workers: world.workers.map((w) => ({ name: w.name, state: w.state, model: w.model, task: w.task, detail: w.last_tool, secs: 42 })),
  gates: world.gates.map((g) => ({ id: g.name, title: g.name, lines: [{ id: g.name, label: g.name, ok: g.state === "done" }] })),
  channel: "atlas-board-mod", people: worldPeople(), unread: worldUnread(),
  notes: world.notes.map((n) => ({ at: n.at, from: n.from, ...("to" in n ? { to: n.to } : {}), ...("kind" in n ? { kind: n.kind } : {}), text: n.text, ...("lead" in n ? { lead: n.lead } : {}) })),
  ...over,
});

/** The running worker of the world as a card: `last`, steps 4 of 9, ctx 62%. */
export const worldCard = (ui: Ui): CardModel => {
  const w = world.workers.find((x) => x.state === "running")!;
  return { state: "running", name: w.name, model: w.model, last: w.last_tool, steps: { done: w.steps_done, total: w.steps_total }, ctx: w.ctx ?? undefined, ui };
};
