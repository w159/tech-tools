// The side panel, worker card and toast of the fixture world (contracts/band-world.ts): every number derives from `world`.
// Goldens: contracts/panel-golden.ts. Both hosts feed these models to the shared layout (mod/panel-layout.ts).
import type { Ui } from "../mod/atlas-ui";
import type { CardModel, PanelModel, PanelTab } from "../mod/panel-layout";
import { world } from "./band-world";

export const panelWorld = (tab: PanelTab, cols: number, ui: Ui, over: Partial<PanelModel> = {}): PanelModel => ({
  cols, rows: 40, ui, tab, tick: 0, expanded: null, recipient: null,
  phases: world.phases.map((p) => p.id as string),
  phase: world.phases.find((p) => p.state === "active")!.id,
  todos: world.todos.map((t) => ({ id: t.id, label: t.label, state: t.state, owner: t.owner, detail: t.detail })),
  workers: world.workers.map((w) => ({ name: w.name, state: w.state, model: w.model, task: w.task, detail: w.last_tool, secs: 42 })),
  gates: world.gates.map((g) => ({ id: g.name, title: g.name, lines: [{ id: g.name, label: g.name, ok: g.state === "done" }] })),
  channel: "atlas-board-mod", people: 6, unread: 1,
  notes: [
    { at: "10:02", from: "lead", to: "implementer-band", text: "take T4, then run the gate tests", lead: true },
    { at: "10:05", from: "implementer-live", kind: "blocked", text: "tests red 3, need a decision on the changelog" },
    { at: "10:07", from: "implementer-layout", kind: "handoff", text: "T1 and T2 merged" },
  ],
  ...over,
});

/** The running worker of the world as a card: `last`, steps 4 of 9, ctx 62%. */
export const worldCard = (ui: Ui): CardModel => {
  const w = world.workers.find((x) => x.state === "running")!;
  return { state: "running", name: w.name, model: w.model, last: w.last_tool, steps: { done: w.steps_done, total: w.steps_total }, ctx: w.ctx ?? undefined, ui };
};
