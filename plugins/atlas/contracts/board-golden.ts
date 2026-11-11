// Golden plain-text rows of the Board for contracts/band-world.ts (round2/design/evidence/golden/board-*.txt, trailing blanks trimmed).
// Mocha and Latte render the same text; only colours differ. The ribbon fills its width exactly, so the design files are 118/119 wide
// once its trailing blanks are trimmed; compare trimmed rows. Asserted on both hosts (mod/board.test.ts, omp/todo-panel.test.ts).

import type { UiState } from "../mod/atlas-ui";
import type { BoardRow } from "../mod/board-model";
import { world } from "./band-world";

/** The state word of each world worker, by name: what a todo's owner is doing (the board shows a failed or waiting owner beside the item). */
export const worldOwnerStates = (): Map<string, UiState> => new Map(world.workers.map((w): [string, UiState] => [w.name, w.state]));

type WorldRow = (typeof world.todos)[number] & { ran_s?: number; elapsed_s?: number; estimate_s?: number };
const rowOf = (t: (typeof world.todos)[number]): WorldRow => t as WorldRow;

/** The fixture world's seven todos as board rows: the running one carries its elapsed seconds and its own estimate, the owner of a failed or waiting item its word. */
export const worldBoardRows = (): BoardRow[] =>
  world.todos.map((t) => {
    const w = rowOf(t);
    const ownerState = worldOwnerStates().get(t.owner);
    const owned = t.state !== "done" && (ownerState === "failed" || ownerState === "waiting" || ownerState === "blocked") && ownerState !== t.state ? ownerState : undefined;
    return {
      label: t.label, state: t.state, owner: t.owner,
      detail: owned ? `owner ${owned} · ${t.detail}` : t.state === "running" ? "" : t.detail,
      ...(t.state === "running" ? { elapsed: { secs: w.elapsed_s!, ...(w.estimate_s ? { of: w.estimate_s } : {}) } } : {}),
      ...(owned ? { ownerState: owned } : {}),
    };
  });

/** The same seven todos as todos.json rows, so the host panels (which take TodoItem-shaped rows and a clock) print the golden:
 * done rows carry claimed/completed stamps (`ran 03:10`), the running one was claimed `elapsed_s` before `WORLD_NOW` and carries its estimate,
 * and each item names its owner's state (`ownerState`), as the hosts attach it from the worker list. */
export const WORLD_NOW = 100_000;
export const worldItems = () => {
  const status = { done: "completed", running: "in_progress", queued: "pending", failed: "failed", blocked: "blocked", waiting: "waiting" } as const;
  const owners = worldOwnerStates();
  return world.todos.map((t) => {
    const w = rowOf(t);
    const ownerState = owners.get(t.owner);
    return {
      id: t.id,
      content: t.label,
      status: status[t.state] as string,
      owner: t.owner,
      ...(t.state === "done" ? { claimed_at: 1_000, completed_at: 1_000 + w.ran_s! } : t.state === "running" ? { claimed_at: WORLD_NOW - w.elapsed_s!, estimate_s: w.estimate_s } : { evidence: t.detail }),
      ...(ownerState ? { ownerState } : {}),
    };
  });
};

export const board_120: string[] = ["◖ ◆ ATLAS ◗ ▸ BOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7 items", "", "ITEM                          STATE       OWNER               DETAIL", "  ● Wire band to host         done        implementer-layout  ran 03:10", "  ● Layout grid tiers         done        implementer-layout  ran 02:41", "  ● Gate golden tests         done        implementer-gates   ran 01:58", "▸ ◐ Subagents block           running     implementer-band    elapsed 00:42 of 05:00", "  ◇ Gate tests                queued      runner-land         after Subagents block", "  ■ Changelog                 failed      implementer-live    tests red 3", "  ▲ Ship board mod            blocked     you                 needs your approval"];
export const board_120_rich: string[] = ["◖ ◆ ATLAS ◗ ▸ BOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "ITEM                          STATE       OWNER               DETAIL", "  ● Wire band to host          DONE       implementer-layout  ran 03:10", "  ● Layout grid tiers          DONE       implementer-layout  ran 02:41", "  ● Gate golden tests          DONE       implementer-gates   ran 01:58", "▸ ◐ Subagents block            RUNNING    implementer-band    elapsed █▍░░░░░░░░ 00:42 of 05:00", "  ◇ Gate tests                 QUEUED     runner-land         after Subagents block", "  ■ Changelog                  FAILED     implementer-live    tests red 3", "  ▲ Ship board mod             BLOCKED    you                 needs your approval"];
export const board_80: string[] = ["◖ ◆ ATLAS ◗ ▸ BOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7 items", "", "  ● Wire band to host     done", "  ● Layout grid tiers     done", "  ● Gate golden tests     done", "▸ ◐ Subagents block       running", "  ◇ Gate tests            queued", "  ■ Changelog             failed", "  ▲ Ship board mod        blocked"];
