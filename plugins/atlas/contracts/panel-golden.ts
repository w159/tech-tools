// Goldens for the ATLAS side panel, worker card and toast (rev 4). Design strings (sidepanel route head, card, toast) are copied
// verbatim from round2/design/evidence/golden/*.txt; the other tabs are the layout's own rows over the fixture world, reviewed
// against round2/design/mock-sidepanel-*.png and mock-subagents-*.png. Trailing spaces trimmed. Regenerate only on an intended visual change.
export const sidepanelDesign: Record<number, string[]> = {
 "80": [
  "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  "",
  "route  team  channel  gates  core",
  "━━━━━",
  "phase  research 2/4",
  "gates  ● lint   ● test   ■ doctor   2/3"
 ],
 "120": [
  "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  "",
  "route   team   channel   gates   core",
  "━━━━━",
  "",
  "phase   research   2/4",
  "gates   ● lint   ● test   ■ doctor   2 of 3 green"
 ]
};
export const cardDesign: Record<number, string[]> = {
 "80": [
  "┌─ running implementer-band ──────── opus ─┐",
  "│ last  read runs.ts:17                    │",
  "│ steps ███▌░░░░ 4 of 9 · 44%              │",
  "│ ctx   █████░░░ 62%                       │",
  "└──────────────────────────────────────────┘"
 ],
 "120": [
  "┌─ running implementer-band ──────── opus ─┐",
  "│ last  read runs.ts:17                    │",
  "│ steps █████▍░░░░░░ 4 of 9 · 44%          │",
  "│ ctx   █████░░░ 62%                       │",
  "└──────────────────────────────────────────┘"
 ]
};
export const toastDesign: string[] = [
 "● done  implementer-layout  9 of 9 steps",
 "■ failed  implementer-live  tests red 3"
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
      "route   team   channel   gates   core",
      "━━━━━",
      "",
      "phase   research   2/4",
      "gates   ● lint   ● test   ■ doctor   2 of 3 green",
      "todo    ████▎░░░░░ 3 of 7",
      "agents  ◇ 1 queued   ◐ 1 running   ● 2 done   ■ 1 failed",
      "",
      "  ◐ Subagents block                running   implementer-band   elapsed 00:42 of 05:00",
      "  ◇ Gate tests                     queued    runner-land        after Subagents block",
      "  ■ Changelog                      failed    implementer-live   tests red 3",
      "  ▲ Ship board mod                 blocked   you                needs your approval",
      "  ● Wire band to host              done      implementer-layout ran 03:10",
      "  ● Layout grid tiers              done      implementer-layout ran 02:41",
      "  ● Gate golden tests              done      implementer-gates  ran 01:58"
],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "route  team  channel  gates  core",
      "━━━━━",
      "phase  research 2/4",
      "gates  ● lint   ● test   ■ doctor   2/3",
      "todo   ████▎░░░░░ 3 of 7",
      "agents ◇ 1 queued  ◐ 1 running  ● 2 done  ■ 1 failed",
      "",
      "  ◐ Subagents block                running",
      "  ◇ Gate tests                     queued",
      "  ■ Changelog                      failed",
      "  ▲ Ship board mod                 blocked",
      "  ● Wire band to host              done",
      "  ● Layout grid tiers              done",
      "  ● Gate golden tests              done"
],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "route  team  channel  gates  core",
      "━━━━━",
      "phase  research 2/4",
      "gates  ● lint   ● test   ■ doctor   2/3",
      "todo   ████▎░░░░░ 3 of 7",
      "agents ◇ 1 queued  ◐ 1 running  ● 2 done  ■ 1 failed",
      "",
      "  ◐ Subagents block                running",
      "  ◇ Gate tests                     queued",
      "  ■ Changelog                      failed",
      "  ▲ Ship board mod                 blocked",
      "  ● Wire band to host              done",
      "  ● Layout grid tiers              done",
      "  ● Gate golden tests              done"
],
  },
  team: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1 queued · 1 running · 2 done · 1 failed",
      "",
      "route   team   channel   gates   core",
      "        ━━━━",
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
      "route  team  channel  gates  core",
      "       ━━━━",
      "▸ ◐ implementer-band    running",
      "  ■ implementer-live    failed",
      "  ◇ runner-land         queued",
      "  ● implementer-layout  done",
      "  ● implementer-gates   done"
],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "route  team  channel  gates  core",
      "       ━━━━",
      "▸ ◐ implementer-band    running",
      "  ■ implementer-live    failed",
      "  ◇ runner-land         queued",
      "  ● implementer-layout  done",
      "  ● implementer-gates   done"
],
  },
  channel: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ #atlas-board-mod",
      "",
      "route   team   channel   gates   core",
      "               ━━━━━━━",
      "",
      "#atlas-board-mod  6 people · 1 unread",
      "10:02 lead               ▸ implementer-band take T4, then run the gate tests",
      "10:05 implementer-live   ▲ blocked tests red 3, need a decision on the changelog",
      "10:07 implementer-layout ● handoff T1 and T2 merged"
],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ #atlas-board-mod",
      "",
      "route  team  channel  gates  core",
      "             ━━━━━━━",
      "#atlas-board-mod  6 people · 1 unread",
      "10:02 lead       ▸ implementer-band take T4, then run the gate tests",
      "10:05 impleme... ▲ blocked tests red 3, need a decision on the changelog",
      "10:07 impleme... ● handoff T1 and T2 merged"
],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━ #atlas-board-mod",
      "",
      "route  team  channel  gates  core",
      "             ━━━━━━━",
      "#atlas-board-mod  6 people · 1 unread",
      "10:02 lead       ▸ implementer-band take T4, then run...",
      "10:05 impleme... ▲ blocked tests red 3, need a decisi...",
      "10:07 impleme... ● handoff T1 and T2 merged"
],
  },
  gates: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2 of 3 green",
      "",
      "route   team   channel   gates   core",
      "                         ━━━━━",
      "",
      "● lint  passing",
      "● test  passing",
      "■ doctor  1 failing  doctor"
],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2 of 3 green",
      "",
      "route  team  channel  gates  core",
      "                      ━━━━━",
      "● lint  passing",
      "● test  passing",
      "■ doctor  1 failing  doctor"
],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━ 2 of 3 green",
      "",
      "route  team  channel  gates  core",
      "                      ━━━━━",
      "● lint  passing",
      "● test  passing",
      "■ doctor  1 failing  doctor"
],
  },
  core: {
    120: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "route   team   channel   gates   core",
      "                                 ━━━━",
      "",
      "contract  header 3/4 · evidence none · verified none",
      "",
      "verdicts  1 verified · 1 refuted",
      "  ● mean-fix        verified       calc.mean fixed for [2,4,6],[],[1,2],[5]; unittest passes",
      "  ■ mean-iterable   refuted        calc.mean does not accept iterators; mean(iter([1,2,3])) raises TypeError",
      "",
      "offload  17.9k kept in tmux, 608 back (30x)",
      "  implementer-0278  sonnet-5-5   58.8k held   7.0k kept    151 back  $0.16",
      "  verifier-16de     sonnet-5-5   59.4k held   6.8k kept    251 back  $0.15",
      "  verifier-b6e2     sonnet-5-5   59.1k held   4.1k kept    206 back  $0.17",
      "",
      "route  class/effort, then seats, then the model each ran",
      "  verify/low  gencheck  tmux, shared, max 1",
      "    ▸ 1x verifier sonnet/medium  ran sonnet-5-5 ● as planned",
      "  verify/low  meancheck  tmux, shared, max 1",
      "    ▸ 1x verifier sonnet/medium  ran sonnet-5-5 ● as planned",
      "  fix/low  meanfix  tmux, shared, max 1",
      "    ▸ 1x implementer sonnet/medium  ran sonnet-5-5 ● as planned",
      "  in-process dispatches are not shown here"
],
    80: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "route  team  channel  gates  core",
      "                             ━━━━",
      "contract  header 3/4 · evidence none · verified none",
      "",
      "verdicts  1 verified · 1 refuted",
      "  ● mean-fix        verified       calc.mean fixed for [2,4,6],[],[1,2],[5]; ...",
      "  ■ mean-iterable   refuted        calc.mean does not accept iterators; mean(...",
      "",
      "offload  17.9k kept in tmux, 608 back (30x)",
      "  implementer-0278  sonnet-5-5   58.8k held   7.0k kept    151 back  $0.16",
      "  verifier-16de     sonnet-5-5   59.4k held   6.8k kept    251 back  $0.15",
      "  verifier-b6e2     sonnet-5-5   59.1k held   4.1k kept    206 back  $0.17",
      "",
      "route  class/effort, then seats, then the model each ran",
      "  verify/low  gencheck  tmux, shared, max 1",
      "    ▸ 1x verifier sonnet/medium  ran sonnet-5-5 ● as planned",
      "  verify/low  meancheck  tmux, shared, max 1",
      "    ▸ 1x verifier sonnet/medium  ran sonnet-5-5 ● as planned",
      "  fix/low  meanfix  tmux, shared, max 1",
      "    ▸ 1x implementer sonnet/medium  ran sonnet-5-5 ● as planned",
      "  in-process dispatches are not shown here"
],
    56: [
      "◖ ◆ ATLAS ◗ ▸ SIDEPANEL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "route  team  channel  gates  core",
      "                             ━━━━",
      "contract  header 3/4 · evidence none · verified none",
      "",
      "verdicts  1 verified · 1 refuted",
      "  ● mean-fix        verified       calc.mean fixed fo...",
      "  ■ mean-iterable   refuted        calc.mean does not...",
      "",
      "offload  17.9k kept in tmux, 608 back (30x)",
      "  implementer-0278  sonnet-5-5   58.8k held   7.0k ke...",
      "  verifier-16de     sonnet-5-5   59.4k held   6.8k ke...",
      "  verifier-b6e2     sonnet-5-5   59.1k held   4.1k ke...",
      "",
      "route  class/effort, then seats, then the model each ran",
      "  verify/low  gencheck  tmux, shared, max 1",
      "    ▸ 1x verifier sonnet/medium  ran sonnet-5-5 ● as ...",
      "  verify/low  meancheck  tmux, shared, max 1",
      "    ▸ 1x verifier sonnet/medium  ran sonnet-5-5 ● as ...",
      "  fix/low  meanfix  tmux, shared, max 1",
      "    ▸ 1x implementer sonnet/medium  ran sonnet-5-5 ● as",
      "  in-process dispatches are not shown here"
],
  },
};
