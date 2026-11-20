// Plain-text goldens of the TODO and SUBAGENTS surfaces, regenerated from mod/view/hud/hud-frame.ts (redesign: `╭─ TITLE ──── counts ─╮`, a column-name row, rows inside `│` walls with the focus bar `▌` in the left cell,
// `╰───╯` under each box) and, for the rich form (rich=true, 120 columns and up), from mod/view/hud/hud-surface.ts. Rev 4 rows came from round2/design/evidence/golden (gen4.py).
// TODO is ITEM STATE OWNER TIME; SUBAGENTS is AGENT ROLE STATE NOW / RESULT [ACT] [CALLS] [FN] TIME, columns nobody fills dropped, TIME right-aligned. The resting render: no motion view, so no sweep, flash or breath.
// Trailing spaces are trimmed; the surface is padded to its width when painted. Update only by regenerating from the code (the generator is the test: hud-surface.test.ts compares these rows).


export const todo_120 = [
  "╭─ TODO ──────────────────────────────────────────────────────────────────────────────────────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                                        STATE                                                                  │",
  "│ ✓ Wire band to host                           done                                                                   │",
  "│ ✓ Layout grid tiers                           done                                                                   │",
  "│ ✓ Gate golden tests                           done                                                                   │",
  "▌ ◐ Subagents block                             running                                                                │",
  "│ ○ Gate tests                                  queued                                                                 │",
  "│ ✗ Changelog                                   failed      tests red 3                                                │",
  "│ ▲ Ship board mod                              blocked     needs your approval                                        │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const todo_120_rich = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 · ■1 ▰▰▰▰▱▱▱▱ ──────────────────────────────────────────────────────────────────────────────╮",
  "✓ 1 plan  ──  ▸ 2 research  ──  ○ 3 build  ──  ○ 4 verify",
  "  ✓ Wire band to host          DONE         ran 03:10",
  "  ✓ Layout grid tiers          DONE         ran 02:41",
  "  ✓ Gate golden tests          DONE         ran 01:58",
  "▸ ◐ Subagents block            RUNNING      elapsed 00:42 of 05:00",
  "  ○ Gate tests                 QUEUED       after Subagents block",
  "  ✗ Changelog                  FAILED       tests red 3",
  "  ▲ Ship board mod             BLOCKED      needs your approval",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const todo_80 = [
  "╭─ TODO ──────────────────────────────────────────────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                                        STATE                          │",
  "│ ✓ Wire band to host                           done                           │",
  "│ ✓ Layout grid tiers                           done                           │",
  "│ ✓ Gate golden tests                           done                           │",
  "▌ ◐ Subagents block                             running                        │",
  "│ ○ Gate tests                                  queued                         │",
  "│ ✗ Changelog                                   failed      tests red 3        │",
  "│ ▲ Ship board mod                              blocked     needs your approv… │",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
];

export const todo_40 = [
  "╭─ TODO ──────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                    STATE      │",
  "│ ✓ Wire band to host       done       │",
  "│ ✓ Layout grid tiers       done       │",
  "│ ✓ Gate golden tests       done       │",
  "▌ ◐ Subagents block         running    │",
  "│ ○ Gate tests              queued     │",
  "│ ✗ Changelog               failed    …│",
  "│ ▲ Ship board mod          blocked   …│",
  "╰──────────────────────────────────────╯",
];

export const subagents_120 = [
  "╭─ SUBAGENTS ────────────────────────────────────────────────────────── ● 1 running  ✗ 1 failed  ○ 1 queued  ✓ 2 done ─╮",
  "│   AGENT                 ROLE         STATE     NOW / RESULT                         TIME                             │",
  "│ ✓ implementer-layout    implementer  done      9 of 9 steps                         5:51                             │",
  "│ ✓ implementer-gates     implementer  done      golden tests written                 1:58                             │",
  "▌ ◐ implementer-band      implementer  running   read runs.ts:17                      0:42                             │",
  "│ ○ runner-land           runner       queued    -                                    0:00                             │",
  "│ ✗ implementer-live      implementer  failed    tests red 3                          1:35                             │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const subagents_120_rich = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS @SPIN@ ──────────────────────────────────────────────────────────────────────────────────────────╮",
  "    AGENT                STATE         CTX                 MODEL   LAST    RESULT",
  "  ✓ implementer-layout    DONE                             opus    5:51    9 of 9 steps",
  "  ✓ implementer-gates     DONE                             sonnet  1:58    golden tests written",
  "▸ ◐ implementer-band      RUNNING      ctx █████░░░ 62%    opus    0:42    read runs.ts:17",
  "  ○ runner-land           QUEUED                           opus    0:00    waits on implementer-live",
  "  ✗ implementer-live      FAILED       ctx ████████ 100%   opus    1:35    tests red 3",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const subagents_80 = [
  "╭─ SUBAGENTS ────────────────── ● 1 running  ✗ 1 failed  ○ 1 queued  ✓ 2 done ─╮",
  "│   AGENT                 ROLE         STATE     NOW / RESULT             TIME │",
  "│ ✓ implementer-layout    implementer  done      9 of 9 steps             5:51 │",
  "│ ✓ implementer-gates     implementer  done      golden tests written     1:58 │",
  "▌ ◐ implementer-band      implementer  running   read runs.ts:17          0:42 │",
  "│ ○ runner-land           runner       queued    -                        0:00 │",
  "│ ✗ implementer-live      implementer  failed    tests red 3              1:35 │",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_todo_120 = [
  "╭─ TODO ──────────────────────────────────────────────────────────────────────────────────────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                                        STATE     OWNER                                                        │",
  "│ ✓ Wire band to host                           done      implementer-layout                                           │",
  "│ ✓ Layout grid tiers                           done      implementer-layout                                           │",
  "│ ✓ Gate golden tests                           done      implementer-gates                                            │",
  "▌ ◐ Subagents block                             running   implementer-band                                             │",
  "│ ○ Gate tests                                  queued    runner-land                                                  │",
  "│ ✗ Changelog                                   failed    implementer-live      tests red 3                            │",
  "│ ▲ Ship board mod                              blocked   you                   needs your approval                    │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_todo_120_rich = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 · ■1 ▰▰▰▰▱▱▱▱ ──────────────────────────────────────────────────────────────────────────────╮",
  "✓ 1 plan  ──  ▸ 2 research  ──  ○ 3 build  ──  ○ 4 verify",
  "  ✓ Wire band to host          DONE         ran 03:10",
  "  ✓ Layout grid tiers          DONE         ran 02:41",
  "  ✓ Gate golden tests          DONE         ran 01:58",
  "▸ ◐ Subagents block            RUNNING      elapsed 00:42 of 05:00",
  "  ○ Gate tests                 QUEUED       after Subagents block",
  "  ✗ Changelog                  FAILED       tests red 3",
  "  ▲ Ship board mod             BLOCKED      needs your approval",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_todo_80 = [
  "╭─ TODO ──────────────────────────────────────────────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                                        STATE     OWNER                │",
  "│ ✓ Wire band to host                           done      implementer-layout   │",
  "│ ✓ Layout grid tiers                           done      implementer-layout   │",
  "│ ✓ Gate golden tests                           done      implementer-gates    │",
  "▌ ◐ Subagents block                             running   implementer-band     │",
  "│ ○ Gate tests                                  queued    runner-land          │",
  "│ ✗ Changelog                                   failed    tests red 3          │",
  "│ ▲ Ship board mod                              blocked   needs your approval  │",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_todo_40 = [
  "╭─ TODO ──────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                    STATE      │",
  "│ ✓ Wire band to host       done       │",
  "│ ✓ Layout grid tiers       done       │",
  "│ ✓ Gate golden tests       done       │",
  "▌ ◐ Subagents block         running    │",
  "│ ○ Gate tests              queued     │",
  "│ ✗ Changelog               failed    …│",
  "│ ▲ Ship board mod          blocked   …│",
  "╰──────────────────────────────────────╯",
];

export const hud_subagents_120 = [
  "╭─ SUBAGENTS ────────────────────────────────────────────────────────── ● 1 running  ✗ 1 failed  ○ 1 queued  ✓ 2 done ─╮",
  "│   AGENT                 ROLE         STATE     NOW / RESULT                         TIME                             │",
  "│ ✓ implementer-layout    implementer  done      9 of 9 steps                         5:51                             │",
  "│ ✓ implementer-gates     implementer  done      golden tests written                 1:58                             │",
  "▌ ◐ implementer-band      implementer  running   read runs.ts:17                      0:42                             │",
  "│ ○ runner-land           runner       queued    -                                    0:00                             │",
  "│ ✗ implementer-live      implementer  failed    tests red 3                          1:35                             │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_subagents_120_rich = [
  "╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS @SPIN@ ──────────────────────────────────────────────────────────────────────────────────────────╮",
  "    AGENT                STATE         CTX                 MODEL   LAST    RESULT",
  "  ✓ implementer-layout    DONE                             opus    5:51    9 of 9 steps",
  "  ✓ implementer-gates     DONE                             sonnet  1:58    golden tests written",
  "▸ ◐ implementer-band      RUNNING      ctx █████░░░ 62%    opus    0:42    read runs.ts:17",
  "  ○ runner-land           QUEUED                           opus    0:00    waits on implementer-live",
  "  ✗ implementer-live      FAILED       ctx ████████ 100%   opus    1:35    tests red 3",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_subagents_80 = [
  "╭─ SUBAGENTS ────────────────── ● 1 running  ✗ 1 failed  ○ 1 queued  ✓ 2 done ─╮",
  "│   AGENT                 ROLE         STATE     NOW / RESULT             TIME │",
  "│ ✓ implementer-layout    implementer  done      9 of 9 steps             5:51 │",
  "│ ✓ implementer-gates     implementer  done      golden tests written     1:58 │",
  "▌ ◐ implementer-band      implementer  running   read runs.ts:17          0:42 │",
  "│ ○ runner-land           runner       queued    -                        0:00 │",
  "│ ✗ implementer-live      implementer  failed    tests red 3              1:35 │",
  "╰──────────────────────────────────────────────────────────────────────────────╯",
];

export const hud_stack_120 = [
  "╭─ TODO ──────────────────────────────────────────────────────────────────────────────────────────── 3/7 · ✗1 ▰▰▰▰▰▰▱ ─╮",
  "│   ITEM                                        STATE     OWNER                  TIME                                  │",
  "│ ✓ Wire band to host                           done      implementer-layout     5:51                                  │",
  "│ ✓ Layout grid tiers                           done      implementer-layout     5:51                                  │",
  "│ ✓ Gate golden tests                           done      implementer-gates      1:58                                  │",
  "▌ ◐ Subagents block                             running   implementer-band       0:42                                  │",
  "│ ○ Gate tests                                  queued    runner-land            0:00                                  │",
  "│ ✗ Changelog                                   failed    implementer-live       1:35  tests red 3                     │",
  "│ ▲ Ship board mod                              blocked   you                       -  needs your approval             │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
  "╭─ SUBAGENTS ────────────────────────────────────────────────────────── ● 1 running  ✗ 1 failed  ○ 1 queued  ✓ 2 done ─╮",
  "│   AGENT                 ROLE         STATE     NOW / RESULT                         TIME                             │",
  "│ ✓ implementer-layout    implementer  done      9 of 9 steps                         5:51                             │",
  "│ ✓ implementer-gates     implementer  done      golden tests written                 1:58                             │",
  "▌ ◐ implementer-band      implementer  running   read runs.ts:17                      0:42                             │",
  "│ ○ runner-land           runner       queued    -                                    0:00                             │",
  "│ ✗ implementer-live      implementer  failed    tests red 3                          1:35                             │",
  "╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯",
];
