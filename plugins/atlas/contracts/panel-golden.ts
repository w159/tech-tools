// Goldens for the ATLAS side panel, worker card and toast (rev 4).
//
// DESIGN-SOURCED (byte-identical to the frozen design generator's output; round2/design/evidence/gen4.py run over
// round2/design/evidence/world.json, 7 of 7 compared SAME on 2026-11-11, trailing spaces trimmed):
//   sidepanelDesign (route head, mock-sidepanel-80/120), subagentsDesign (mock-subagents-80/120, the Team tab's worker rows),
//   cardDesign (mock-card-80/120), toastDesign (mock-toast-120).
//
// DEVIATIONS FROM THE MOCKS (critique-3 changes 9 and 10, round 3 panel polish; the mocks were not regenerated): the side panel strip is
// `r: route  t: team  c: channel  g: gates  k: core  o: board` on both hosts (the mock strip has no keys and no board); the card title leads
// with the ATLAS mark `◆`, the two gauges are one width and a blank row separates them; the toast leads with the left bar and `◆ ATLAS`.
// Those lines of sidepanelDesign, cardDesign and toastDesign are written by hand from that decision, everything else in them is the mock's.
//
// NO DESIGN MOCK: the design has no side panel mock for the channel, gates and core tabs, for the 56-column form of any tab,
// for the route tab below its phase and gates rows (todo gauge, agents row, task rows), for the tab strip of a non-route tab
// and the ribbon's right-hand text, or for the Team tab's lead row, roster rows and lead summary. Those expectations in `tabGolden`
// and `teamLiveGolden` are LITERAL TEXT checked against the rev 4 vocabulary (rev4 sections 3 and 5 and the six state words); they are
// not design evidence. At round 3 (panel polish) `tabGolden` was written out from the layout's own rows once, then read row by row
// against the grammar of mod/panel-polish.test.ts and the rendered PNGs; the properties that matter (one state column, whole figures,
// the strip on both hosts) are asserted independently there, so a layout regression fails both.
export const sidepanelDesign: Record<number, string[]> = {
 "80": [
  "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  "",
  "r: route  t: team  c: channel  g: gates  k: core  o: board",
  "   ━━━━━",
  "phase  research 2/4",
  "gates  ● lint   ● test   ■ doctor   2/3"
 ],
 "120": [
  "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  "",
  "r: route  t: team  c: channel  g: gates  k: core  o: board",
  "   ━━━━━",
  "",
  "phase   research   2/4",
  "gates   ● lint   ● test   ■ doctor   2 of 3 green"
 ]
};
export const cardDesign: Record<number, string[]> = {
 "80": [
   "┌─ ◆ running implementer-band ────── opus ─┐",
   "│ last  read runs.ts:17                    │",
   "│ steps ███▌░░░░ 4 of 9 · 44%              │",
   "│                                          │",
   "│ ctx   █████░░░ 62%                       │",
   "└──────────────────────────────────────────┘"
 ],
 "120": [
   "┌─ ◆ running implementer-band ────── opus ─┐",
   "│ last  read runs.ts:17                    │",
   "│ steps █████▍░░░░░░ 4 of 9 · 44%          │",
   "│                                          │",
   "│ ctx   ███████▌░░░░ 62%                   │",
   "└──────────────────────────────────────────┘"
 ]
};
export const toastDesign: string[] = [
  "▌ ◆ ATLAS  ● done  implementer-layout  9 of 9 steps",
  "▌ ◆ ATLAS  ■ failed  implementer-live  tests red 3"
];
export const subagentsDesign: Record<number, string[]> = {
 "80": [
  "▸ ◐ implementer-band    running",
  "  ■ implementer-live    failed",
  "  ◇ runner-land         queued",
  "  ● implementer-layout  done",
  "  ● implementer-gates   done"
 ],
 "120": [
  "▸ ◐ implementer-band    running     opus      T4    read runs.ts:17",
  "  ■ implementer-live    failed      opus      T6    tests red 3",
  "  ◇ runner-land         queued      opus      T5    waits on implementer-live",
  "  ● implementer-layout  done        opus      T1    9 of 9 steps",
  "  ● implementer-gates   done        sonnet    T3    golden tests written"
 ]
};
export const tabGolden: Record<string, Record<number, string[]>> = {
  route: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "   ━━━━━",
      "",
      "phase   research   2/4",
      "gates   ● lint   ● test   ■ doctor   2 of 3 green",
      "todo    ████▎░░░░░ 3 of 7",
      "agents  ◇ 1 queued   ◐ 1 running   ● 2 done   ■ 1 failed",
      "",
      "  ● Wire band to host     done    ran 03:10                                                           implementer-layout",
      "  ● Layout grid tiers     done    ran 02:41                                                           implementer-layout",
      "  ● Gate golden tests     done    ran 01:58                                                            implementer-gates",
      "  ◐ Subagents block       running elapsed 00:42 of 05:00                                                implementer-band",
      "  ◇ Gate tests            queued  after Subagents block                                                      runner-land",
      "  ■ Changelog             failed  tests red 3                                                           implementer-live",
      "  ▲ Ship board mod        blocked needs your approval                                                                you"
    ],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "   ━━━━━",
      "phase  research 2/4",
      "gates  ● lint   ● test   ■ doctor   2/3",
      "todo   ████▎░░░░░ 3 of 7",
      "agents ◇ 1 queued  ◐ 1 running  ● 2 done  ■ 1 failed",
      "",
      "  ● Wire band to host     done                                implementer-layout",
      "  ● Layout grid tiers     done                                implementer-layout",
      "  ● Gate golden tests     done                                 implementer-gates",
      "  ◐ Subagents block       running                               implementer-band",
      "  ◇ Gate tests            queued                                     runner-land",
      "  ■ Changelog             failed                                implementer-live",
      "  ▲ Ship board mod        blocked                                            you"
    ],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: chan  g: gates  k: core  o: board",
      "   ━━━━━",
      "phase  research 2/4",
      "gates  ● lint   ● test   ■ doctor   2/3",
      "todo   ████▎░░░░░ 3 of 7",
      "agents ◇ 1 queued  ◐ 1 running  ● 2 done  ■ 1 failed",
      "",
      "  ● Wire band to host     done        implementer-layout",
      "  ● Layout grid tiers     done        implementer-layout",
      "  ● Gate golden tests     done         implementer-gates",
      "  ◐ Subagents block       running       implementer-band",
      "  ◇ Gate tests            queued             runner-land",
      "  ■ Changelog             failed        implementer-live",
      "  ▲ Ship board mod        blocked                    you"
    ]
  },
  team: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1 queued · 1 running · 2 done · 1 failed",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "             ━━━━",
      "",
      "▸ ◐ implementer-band    running     opus      T4    read runs.ts:17",
      "  ■ implementer-live    failed      opus      T6    tests red 3",
      "  ◇ runner-land         queued      opus      T5    waits on implementer-live",
      "  ● implementer-layout  done        opus      T1    9 of 9 steps",
      "  ● implementer-gates   done        sonnet    T3    golden tests written"
    ],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━ 1 queued · 1 running · 2 done · 1 failed",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "             ━━━━",
      "▸ ◐ implementer-band    running",
      "  ■ implementer-live    failed",
      "  ◇ runner-land         queued",
      "  ● implementer-layout  done",
      "  ● implementer-gates   done"
    ],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: chan  g: gates  k: core  o: board",
      "             ━━━━",
      "▸ ◐ implementer-band    running",
      "  ■ implementer-live    failed",
      "  ◇ runner-land         queued",
      "  ● implementer-layout  done",
      "  ● implementer-gates   done"
    ]
  },
  channel: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ #atlas-board-mod",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "                      ━━━━━━━",
      "",
      "#atlas-board-mod  5 people · 2 unread",
      "    lead                        ▸ implementer-band take T4, then run the gate tests                                10:02",
      "  ▲ implementer-live    blocked tests red 3, need a decision on the changelog                                      10:05",
      "  ● implementer-layout  handoff T1 and T2 merged                                                                   10:07"
    ],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ #atlas-board-mod",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "                      ━━━━━━━",
      "#atlas-board-mod  5 people · 2 unread",
      "    lead                  ▸ implementer-band take T4, then run the gate... 10:02",
      "  ▲ imple...live  blocked tests red 3, need a decision on the changelog    10:05",
      "  ● imple...yout  handoff T1 and T2 merged                                 10:07"
    ],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━ #atlas-board-mod",
      "",
      "r: route  t: team  c: chan  g: gates  k: core  o: board",
      "                      ━━━━",
      "#atlas-board-mod  5 people · 2 unread",
      "    lead                  ▸ implementer-band ta... 10:02",
      "  ▲ imple...live  blocked tests red 3, need a d... 10:05",
      "  ● imple...yout  handoff T1 and T2 merged         10:07"
    ]
  },
  gates: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2 of 3 green",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "                                  ━━━━━",
      "",
      "  ● lint    passing",
      "  ● test    passing",
      "  ■ doctor  failing doctor                                                                                1 of 1 failing"
    ],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2 of 3 green",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "                                  ━━━━━",
      "  ● lint    passing",
      "  ● test    passing",
      "  ■ doctor  failing doctor                                        1 of 1 failing"
    ],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━ 2 of 3 green",
      "",
      "r: route  t: team  c: chan  g: gates  k: core  o: board",
      "                               ━━━━━",
      "  ● lint    passing",
      "  ● test    passing",
      "  ■ doctor  failing doctor                1 of 1 failing"
    ]
  },
  core: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "                                            ━━━━",
      "",
      "contract",
      "  ▲ header   3 of 4",
      "  ◇ evidence none yet",
      "  ◇ verified none yet",
      "",
      "verdicts  1 verified · 1 refuted",
      "  ● mean-fix      verified       calc.mean fixed for [2,4,6],[],[1,2],[5]; unittest passes",
      "  ■ mean-iterable refuted        calc.mean does not accept iterators; mean(iter([1,2,3])) raises TypeError",
      "",
      "offload  17.9k tokens read by workers, 608 returned to the lead, 3% of what they read",
      "    implementer-0278 sonnet-5-5                                               peak 58.8k  read 7.0k  returned 151  $0.16",
      "    verifier-16de    sonnet-5-5                                               peak 59.4k  read 6.8k  returned 251  $0.15",
      "    verifier-b6e2    sonnet-5-5                                               peak 59.1k  read 4.1k  returned 206  $0.17",
      "",
      "dispatch  planned against what ran",
      "    verify/low gencheck  tmux, shared, max 1",
      "  ●   1x verifier    as planned ran sonnet-5-5  sonnet/medium",
      "    verify/low meancheck  tmux, shared, max 1",
      "  ●   1x verifier    as planned ran sonnet-5-5  sonnet/medium",
      "    fix/low meanfix  tmux, shared, max 1",
      "  ●   1x implementer as planned ran sonnet-5-5  sonnet/medium",
      "    in-process dispatches are not shown here"
    ],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: channel  g: gates  k: core  o: board",
      "                                            ━━━━",
      "contract",
      "  ▲ header   3 of 4",
      "  ◇ evidence none yet",
      "  ◇ verified none yet",
      "",
      "verdicts  1 verified · 1 refuted",
      "  ● mean-fix      verified       calc.mean fixed for [2,4,6],[],[1,2],[5]; un...",
      "  ■ mean-iterable refuted        calc.mean does not accept iterators; mean(it...",
      "",
      "offload  17.9k tokens read by workers, 608 returned to the lead",
      "         3% of what they read",
      "    implementer-0278 sonnet-5-5       peak 58.8k  read 7.0k  returned 151  $0.16",
      "    verifier-16de    sonnet-5-5       peak 59.4k  read 6.8k  returned 251  $0.15",
      "    verifier-b6e2    sonnet-5-5       peak 59.1k  read 4.1k  returned 206  $0.17",
      "",
      "dispatch  planned against what ran",
      "    verify/low gencheck  tmux, shared, max 1",
      "  ●   1x verifier    as planned ran sonnet-5-5  sonnet/medium",
      "    verify/low meancheck  tmux, shared, max 1",
      "  ●   1x verifier    as planned ran sonnet-5-5  sonnet/medium",
      "    fix/low meanfix  tmux, shared, max 1",
      "  ●   1x implementer as planned ran sonnet-5-5  sonnet/medium",
      "    in-process dispatches are not shown here"
    ],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "r: route  t: team  c: chan  g: gates  k: core  o: board",
      "                                         ━━━━",
      "contract",
      "  ▲ header   3 of 4",
      "  ◇ evidence none yet",
      "  ◇ verified none yet",
      "",
      "verdicts  1 verified · 1 refuted",
      "  ● mean-fix      verified       calc.mean fixed for ...",
      "  ■ mean-iterable refuted        calc.mean does not a...",
      "",
      "offload  17.9k tokens read by workers",
      "         608 returned to the lead, 3% of what they read",
      "    implementer-0278      read 7.0k  returned 151  $0.16",
      "    verifier-16de         read 6.8k  returned 251  $0.15",
      "    verifier-b6e2         read 4.1k  returned 206  $0.17",
      "",
      "dispatch  planned against what ran",
      "    verify/low gencheck  tmux, shared, max 1",
      "  ●   1x verifier    as planned",
      "      ran sonnet-5-5 sonnet/medium",
      "    verify/low meancheck  tmux, shared, max 1",
      "  ●   1x verifier    as planned",
      "      ran sonnet-5-5 sonnet/medium",
      "    fix/low meanfix  tmux, shared, max 1",
      "  ●   1x implementer as planned",
      "      ran sonnet-5-5 sonnet/medium",
      "    in-process dispatches are not shown here"
    ]
  },
};

/** The Team tab as the live adapter builds it (mod/pane/sidebar-model.ts): the lead's row first, the workers, the roster members the squad
 * does not list, and the lead's tally last. HAND-WRITTEN literal text (no design mock covers it); the world is panelWorld('team') plus a
 * waiting lead (role lead, detail idle) and one roster member `leader` (queued, idle). Trailing spaces trimmed; spinner frame 0. */
export const teamLiveGolden: Record<number, string[]> = {
  120: [
    "  ◉ lead                waiting                     idle",
    "▸ ◐ implementer-band    running     opus      T4    read runs.ts:17",
    "  ■ implementer-live    failed      opus      T6    tests red 3",
    "  ◇ runner-land         queued      opus      T5    waits on implementer-live",
    "  ● implementer-layout  done        opus      T1    9 of 9 steps",
    "  ● implementer-gates   done        sonnet    T3    golden tests written",
    "  ◇ leader              queued                      idle",
    "lead  1 queued · 1 running · 2 done · 1 failed",
  ],
  80: [
    "  ◉ lead                waiting",
    "▸ ◐ implementer-band    running",
    "  ■ implementer-live    failed",
    "  ◇ runner-land         queued",
    "  ● implementer-layout  done",
    "  ● implementer-gates   done",
    "  ◇ leader              queued",
    "lead  1 queued · 1 running · 2 done · 1 failed",
  ],
};
