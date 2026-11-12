// The fixture world (contracts/band-world.ts) as the board and squad data the HUD adapters take: one plan row per world
// todo (its detail as evidence, as a lead writes it) and one agent per world worker. Shared by the Claude Code and omp HUD tests.
import { world } from "./band-world";
import type { HudAgent, HudInput } from "../mod/hud";

const TODO_STATUS = { done: "completed", running: "in_progress", queued: "pending", failed: "abandoned", blocked: "blocked" } as const;
const AGENT_STATE = { running: "working", failed: "failed", queued: "queued", done: "done" } as const;

export const worldPlan = (): HudInput["todos"] =>
  world.todos.map((t) => ({ id: t.id, content: t.label, status: TODO_STATUS[t.state as keyof typeof TODO_STATUS], owner: t.owner, evidence: t.detail }));

export const worldHudAgents = (): HudAgent[] =>
  world.workers.map((w) => ({
    name: w.name, role: w.name.split("-")[0]!, state: AGENT_STATE[w.state as keyof typeof AGENT_STATE], model: w.model, ctx: w.ctx, startedAt: -w.age_s * 1000, since: 0, // the clock LAST reads: the worker's age, ended workers frozen at it
    ...(w.state === "running" ? { tool: "Read", target: "runs.ts:17" } : { lastLine: w.last_tool }),
  }));

export const worldPhases = (): { ids: string[]; active: number } => ({ ids: world.phases.map((p) => p.id), active: world.phases.findIndex((p) => p.state === "active") });
