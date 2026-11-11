// The single fixture world for the rev 4 design (ported from round2/design/evidence/world.json). Every number on
// every surface derives from this one object: todo 3 of 7, phase 2/4, gates 2 of 3, five workers (1 running, 1 failed,
// 1 queued, 2 done). Surfaces and tests import it; none of them restate a count. A .ts module because the mod test
// host loads only code files (no fs).
//
// Single fixture world for every rev 4 mock. Every number in every mock is derived from these lists.

import type { Ui, UiState } from "../mod/atlas-ui";
import type { MissionModel, WorkerState } from "../mod/mission-layout";

export type WorldTodo = { id: string; label: string; state: UiState; owner: string; detail: string };
export type WorldWorker = { name: string; state: UiState; model: string; task: string; ctx: number | null; last_tool: string; steps_done: number; steps_total: number };

export const world = {
  "scenario": "Plan 'atlas-board-mod' in progress, phase 2 of 4 (research). Seven todos. Five workers.",
  "phases": [
    {
      "id": "plan",
      "state": "done"
    },
    {
      "id": "research",
      "state": "active"
    },
    {
      "id": "build",
      "state": "queued"
    },
    {
      "id": "verify",
      "state": "queued"
    }
  ],
  "todos": [
    {
      "id": "T1",
      "label": "Wire band to host",
      "state": "done",
      "owner": "implementer-layout",
      "detail": "ran 03:10"
    },
    {
      "id": "T2",
      "label": "Layout grid tiers",
      "state": "done",
      "owner": "implementer-layout",
      "detail": "ran 02:41"
    },
    {
      "id": "T3",
      "label": "Gate golden tests",
      "state": "done",
      "owner": "implementer-gates",
      "detail": "ran 01:58"
    },
    {
      "id": "T4",
      "label": "Subagents block",
      "state": "running",
      "owner": "implementer-band",
      "detail": "elapsed 00:42 of 05:00"
    },
    {
      "id": "T5",
      "label": "Gate tests",
      "state": "queued",
      "owner": "runner-land",
      "detail": "after Subagents block"
    },
    {
      "id": "T6",
      "label": "Changelog",
      "state": "failed",
      "owner": "implementer-live",
      "detail": "tests red 3"
    },
    {
      "id": "T7",
      "label": "Ship board mod",
      "state": "blocked",
      "owner": "you",
      "detail": "needs your approval"
    }
  ],
  "workers": [
    {
      "name": "implementer-band",
      "state": "running",
      "model": "opus",
      "task": "T4",
      "ctx": 0.62,
      "last_tool": "read runs.ts:17",
      "steps_done": 4,
      "steps_total": 9
    },
    {
      "name": "implementer-live",
      "state": "failed",
      "model": "opus",
      "task": "T6",
      "ctx": 1.0,
      "last_tool": "tests red 3",
      "steps_done": 0,
      "steps_total": 0
    },
    {
      "name": "runner-land",
      "state": "queued",
      "model": "opus",
      "task": "T5",
      "ctx": null,
      "last_tool": "waits on implementer-live",
      "steps_done": 0,
      "steps_total": 0
    },
    {
      "name": "implementer-layout",
      "state": "done",
      "model": "opus",
      "task": "T1",
      "ctx": null,
      "last_tool": "9 of 9 steps",
      "steps_done": 9,
      "steps_total": 9
    },
    {
      "name": "implementer-gates",
      "state": "done",
      "model": "sonnet",
      "task": "T3",
      "ctx": null,
      "last_tool": "golden tests written",
      "steps_done": 6,
      "steps_total": 6
    }
  ],
  "gates": [
    {
      "name": "lint",
      "state": "done"
    },
    {
      "name": "test",
      "state": "done"
    },
    {
      "name": "doctor",
      "state": "failed"
    }
  ],
  "toasts": [
    {
      "state": "done",
      "name": "implementer-layout",
      "fact": "9 of 9 steps"
    },
    {
      "state": "failed",
      "name": "implementer-live",
      "fact": "tests red 3"
    }
  ],
  "spark": {
    "window_s": 60,
    "peak": 180,
    "now": 124,
    "values": [
      95,
      116,
      135,
      148,
      156,
      157,
      153,
      147,
      139,
      133,
      130,
      129,
      129,
      130,
      128,
      122,
      111,
      95,
      76,
      56,
      38,
      25,
      20,
      20,
      24,
      36,
      50,
      64,
      76,
      85,
      91,
      94,
      96,
      99,
      105,
      114,
      127,
      142,
      156,
      167,
      180,
      171,
      163,
      148,
      129,
      109,
      91,
      76,
      66,
      61,
      59,
      60,
      60,
      59,
      55,
      48,
      41,
      35,
      32,
      124
    ]
  },
  "ctx_window": "of window",
  "states": [
    "queued",
    "running",
    "done",
    "failed",
    "blocked",
    "waiting"
  ]
} as const;

const WORKER_STATE: Record<string, WorkerState> = { queued: "starting", running: "running", done: "done", failed: "failed", blocked: "waiting", waiting: "waiting" };

/** The world as a MissionModel for the band: phases from `world.phases`, todo counts from `world.todos`, worker counts
 * from `world.workers`, ctx from the running worker. Tick 0, so the spinner is its first frame. */
export function worldModel(cols: number, ui: Ui, over: Partial<MissionModel> = {}): MissionModel {
  const phases = world.phases.map((p) => p.id as string);
  const running = world.workers.find((w) => w.state === "running");
  return {
    cols,
    maxRows: 12,
    tick: 0,
    project: "atlas-board-mod",
    phases,
    phase: world.phases.find((p) => p.state === "active")!.id,
    done: world.todos.filter((t) => t.state === "done").length,
    total: world.todos.length,
    workers: world.workers.map((w) => ({ name: w.name, state: WORKER_STATE[w.state]!, secs: 0 })),
    checks: null,
    ctx: running?.ctx ?? undefined,
    ui,
    ...over,
  };
}
