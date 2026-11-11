// Golden plain-text rows of the Board for contracts/band-world.ts (round2/design/evidence/golden/board-*.txt, trailing blanks trimmed).
// Mocha and Latte render the same text; only colours differ. The ribbon fills its width exactly, so the design files are 118/119 wide
// once its trailing blanks are trimmed; compare trimmed rows. Asserted on both hosts (mod/board.test.ts, omp/todo-panel.test.ts).

import type { BoardRow } from "../mod/board-model";
import { world } from "./band-world";

/** The fixture world's seven todos as board rows (the running one carries its 42 s of a 5 minute budget). */
export const worldBoardRows = (): BoardRow[] =>
  world.todos.map((t) => ({ label: t.label, state: t.state, owner: t.owner, detail: t.state === "running" ? "" : t.detail, ...(t.state === "running" ? { elapsed: { secs: 42, of: 300 } } : {}) }));

/** The same seven todos as todos.json rows, so the host panels (which take TodoItem-shaped rows and a clock) print the golden:
 * done rows carry claimed/completed stamps (`ran 03:10`), the running one was claimed 42 s before `WORLD_NOW`. */
export const WORLD_NOW = 100_000;
export const worldItems = () => {
  const stamp = (secs: number) => ({ claimed_at: 1_000, completed_at: 1_000 + secs });
  const ran = [190, 161, 118];
  const status = { done: "completed", running: "in_progress", queued: "pending", failed: "failed", blocked: "blocked", waiting: "waiting" } as const;
  return world.todos.map((t, i) => ({
    id: t.id,
    content: t.label,
    status: status[t.state] as string,
    owner: t.owner,
    ...(t.state === "done" ? stamp(ran[i]!) : t.state === "running" ? { claimed_at: WORLD_NOW - 42 } : { evidence: t.detail }),
  }));
};

export const board_120: string[] = ["◖ ◆ ATLAS ◗ ▸ BOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7 items", "", "ITEM                          STATE       OWNER               DETAIL", "  ● Wire band to host         done        implementer-layout  ran 03:10", "  ● Layout grid tiers         done        implementer-layout  ran 02:41", "  ● Gate golden tests         done        implementer-gates   ran 01:58", "▸ ◐ Subagents block           running     implementer-band    elapsed 00:42 of 05:00", "  ◇ Gate tests                queued      runner-land         after Subagents block", "  ■ Changelog                 failed      implementer-live    tests red 3", "  ▲ Ship board mod            blocked     you                 needs your approval"];
export const board_120_rich: string[] = ["◖ ◆ ATLAS ◗ ▸ BOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "", "ITEM                          STATE       OWNER               DETAIL", "  ● Wire band to host          DONE       implementer-layout  ran 03:10", "  ● Layout grid tiers          DONE       implementer-layout  ran 02:41", "  ● Gate golden tests          DONE       implementer-gates   ran 01:58", "▸ ◐ Subagents block            RUNNING    implementer-band    elapsed █▍░░░░░░░░ 00:42 of 05:00", "  ◇ Gate tests                 QUEUED     runner-land         after Subagents block", "  ■ Changelog                  FAILED     implementer-live    tests red 3", "  ▲ Ship board mod             BLOCKED    you                 needs your approval"];
export const board_80: string[] = ["◖ ◆ ATLAS ◗ ▸ BOARD ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7 items", "", "  ● Wire band to host     done", "  ● Layout grid tiers     done", "  ● Gate golden tests     done", "▸ ◐ Subagents block       running", "  ◇ Gate tests            queued", "  ■ Changelog             failed", "  ▲ Ship board mod        blocked"];
