// Plain-text goldens of the TODO and SUBAGENTS surfaces, regenerated from mod/hud-surface.ts (round 5: closed boxes, a k9s table). Rev 4 rows came from round2/design/evidence/golden (gen4.py).
// `@SPIN@` stands for the shared spinner glyph at frame 0 (hud-surface.test.ts swaps it in). Each block is a closed rounded box: the top edge `╭─ ◖ ◆ ATLAS ◗ ▸ TITLE` carries the count, the meter (TODO) or the
// spinner and counts (SUBAGENTS) INSIDE the rule, which runs to the last cell and ends in `╮`; a `╰───╯` edge closes the block under its rows in every state. The host draws its own `[-]` in the five cells
// it adds to the right of the tree's first row, so the corners stand against those cells (mod/hud-surface.ts titleRow).
// Rows have no side border (the capture scorer reads a row by its glyph, which must start the line). The brand stays, quiet (no fill, 240), because the capture scorer locates a block by it.
// SUBAGENTS is a table: AGENT STATE [MODEL from 120 columns] TASK LAST, then RESULT when width allows; LAST is always the elapsed clock (the world worker's age), RESULT the dim last tool or outcome.
// Trailing spaces are trimmed; the surface is padded to its width when painted. Update only by regenerating from the code (the generator is the test: hud-surface.test.ts compares these rows).
// Critique 19 B2: MODEL (7 cells and a gap) and TASK (7 cells and a gap) are fixed-width columns. Critique 21: the AGENT column keeps a 2-cell gutter before STATE.

export const todo_120 = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────────────────────────────────────────────╮",
  "  ● Wire band to host         done          ran 03:10",
  "  ● Layout grid tiers         done          ran 02:41",
  "  ● Gate golden tests         done          ran 01:58",
  "▸ ◐ Subagents block           running       elapsed 00:42 of 05:00",
  "  ◇ Gate tests                queued        after Subagents block",
  "  ■ Changelog                 failed        tests red 3",
  "  ▲ Ship board mod            blocked       needs your approval",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const todo_120_rich = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────────────────────────────────────────────╮",
  "● 1 plan  ──  ▸ 2 research  ──  ◇ 3 build  ──  ◇ 4 verify",
  "  ● Wire band to host          DONE         ran 03:10",
  "  ● Layout grid tiers          DONE         ran 02:41",
  "  ● Gate golden tests          DONE         ran 01:58",
  "▸ ◐ Subagents block            RUNNING      elapsed 00:42 of 05:00",
  "  ◇ Gate tests                 QUEUED       after Subagents block",
  "  ■ Changelog                  FAILED       tests red 3",
  "  ▲ Ship board mod             BLOCKED      needs your approval",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const todo_80 = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────╮",
  "  ● Wire band to host     done",
  "  ● Layout grid tiers     done",
  "  ● Gate golden tests     done",
  "▸ ◐ Subagents block       running",
  "  ◇ Gate tests            queued",
  "  ■ Changelog             failed",
  "  ▲ Ship board mod        blocked",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
];

export const todo_40 = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 ▰▰▰▱▱▱▱▱ ───╮",
  "  ● Wire band to host  done",
  "  ● Layout grid tiers  done",
  "  ● Gate golden tests  done",
  "▸ ◐ Subagents block    running",
  "  ◇ Gate tests         queued",
  "  ■ Changelog          failed",
  "  ▲ Ship board mod     blocked",
  "╰──────────────────────────────────────╯",
];

export const subagents_120 = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS @SPIN@ 1 running · 1 failed · 1 queued · 2 done ─────────────────────────────────────────────────╮",
  "    AGENT                STATE    TASK                                                                  LAST    RESULT",
  "  ● implementer-layout   done     T1,T2                                                                 5:51    -",
  "  ● implementer-gates    done     T3                                                                    1:58    -",
  "▸ ◐ implementer-band     running  T4                                                                    0:42    -",
  "  ◇ runner-land          queued   T5                                                                    0:00    -",
  "  ■ implementer-live     failed   T6                                                                    1:35    -",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const subagents_120_rich = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS @SPIN@ ──────────────────────────────────────────────────────────────────────────────────────────╮",
  "    AGENT                STATE         CTX                 MODEL   LAST    RESULT",
  "  ● implementer-layout    DONE                             opus    5:51    9 of 9 steps",
  "  ● implementer-gates     DONE                             sonnet  1:58    golden tests written",
  "▸ ◐ implementer-band      RUNNING      ctx █████░░░ 62%    opus    0:42    read runs.ts:17",
  "  ◇ runner-land           QUEUED                           opus    0:00    waits on implementer-live",
  "  ■ implementer-live      FAILED       ctx ████████ 100%   opus    1:35    tests red 3",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const subagents_80 = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS @SPIN@ 1 running · 1 failed · 1 queued · 2 done ─────────╮",
  "    AGENT                STATE    TASK                          LAST    RESULT",
  "  ● implementer-layout   done     T1,T2                         5:51    -",
  "  ● implementer-gates    done     T3                            1:58    -",
  "▸ ◐ implementer-band     running  T4                            0:42    -",
  "  ◇ runner-land          queued   T5                            0:00    -",
  "  ■ implementer-live     failed   T6                            1:35    -",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
];

