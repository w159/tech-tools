// v3-tabs.test.ts: the side panel's other tabs against frames G1-G3, T1-T3, D1-D3, C1-C3 and K1-K3 of the approved frame spec (critics/mock-final.md section 5), the one phase count of the band and the
// panel, and the gate marks' colour (spec 2.4: a measured pass is green). Every expected row below is the spec's own text (the host border `│` removed, trailing blanks trimmed); the rendered rows from the
// tab's ribbon down to the pinned footer must equal it exactly, at 150 (U=46) and 110 (U=39).
// The tab strip and the ribbon above the content are shared chrome (every tab, omp, the goldens) and are not part of this slice; the frames are cut at the content ribbon.
// One spec figure is not measured by the mod and is left out rather than made up: a worker's `ctx N%` (the detail row of the team tab reads `model · last call` where the spec adds `· ctx N%`).
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from './atlas-ui';
import { NOW } from './live_fixture';
import { lineText, panelLines, type PanelGate, type PanelModel, type PanelNote, type PanelTab, type PanelTodo, type PanelWorker } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { textWidth } from './theme';
import { bandLook } from './band-frame';
import { runHex } from './atlas-ui';
import type { Health, HealthCheck } from './idle-health';
import type { CoreModel } from './data/core';
import { healthCardRows } from './hud-surface';
import { bandLines } from './mission-layout';
import { panelModelOf } from './pane/sidebar-model';
import { busySnap } from './live_fixture';
import { worldModel } from '../contracts/band-world';

const FRAMES: Record<string, string[]> = {
 "G1": [
  " ── GATES ──────────────────── checks   ok fail",
  "  ▸ ○ completion                       1 armed",
  "  ▸ ○ tripwire                         1 armed",
  "  ▸ ○ routing                          8 armed",
  "  ▸ ○ header                           1 armed",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ────────────────▆───            no calls",
  "     0└5m───────────────now",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     41s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "G2": [
  " ── GATES ──────────────────── checks   ok fail",
  "  ▾ ● completion                        1    0",
  "      └ ● Code changes delegated",
  "  ▾ ● tripwire                          1    0",
  "      ├ ○ Team mode                         off",
  "      └ ● Lead hands work to subagents",
  "  ▾ ■ routing                           7    1",
  "      ├ ● lean-ctx calls",
  "      ├ ● context-mode calls",
  "      ├ ● claude-mem calls",
  "      ├ ● Native Read calls",
  "      ├ ■ Native Grep calls      2 calls denied",
  "      │   fix: use ctx_search",
  "      ├ ● Native Glob calls",
  "      ├ ● Native Bash calls",
  "      └ ● Policy denies",
  "  ▾ ● header                            1    0",
  "      └ ● Last reply header matched    research",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "G3": [
  " ── GATES ───────────── checks   ok fail",
  "  ▾ ● completion                 1    0",
  "      └ ● Code changes delegated",
  "  ▾ ● tripwire                   1    0",
  "      ├ ○ Team mode                  off",
  "      └ ● Lead hands work to subagents",
  "  ▾ ■ routing                    7    1",
  "      ├ ● lean-ctx calls",
  "      ├ ● context-mode calls",
  "      ├ ● claude-mem calls",
  "      ├ ● Native Read calls",
  "      ├ ■ Native Grep c…  2 calls denied",
  "      │   fix: use ctx_search",
  "      ├ ● Native Glob calls",
  "      ├ ● Native Bash calls",
  "      └ ● Policy denies",
  "  ▾ ● header                     1    0",
  "      └ ● Last reply header m…  research",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ],
 "T1": [
  " ── TEAM ────────────────────────────────── off",
  "     ◉ lead · master                       0:41",
  "",
  "     Team mode is off.",
  "     no workers registered",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ────────────────▆───            no calls",
  "     0└5m───────────────now",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     41s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "T2": [
  " ── TEAM ──────────────── 3 workers · 1 working",
  "     ◉ lead · master                       3:05",
  "  ▾ ◆ impl-band                   working 1:42",
  "     └ fable · Edit",
  "  ▾ ● explorer-ui                    done 0:58",
  "     └ haiku · Read",
  "  ▾ ■ verifier-1dda               blocked 0:12",
  "     └ sonnet · —",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "     12s  tool.call Edit                    5ms",
  "     15s  tool.call Bash                    2ms",
  "     17s  tool.call Read                    3ms",
  "     20s  tool.call lean-ctx                4ms",
  "     24s  prompt.submit                     5ms",
  "      1m  session.measure                   1ms",
  "      1m  turn.complete                     4ms",
  "      1m  tool.call Bash                    2ms",
  "      2m  tool.call Read                    3ms",
  "      2m  tool.call lean-ctx                2ms",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "T3": [
  " ── TEAM ───────── 3 workers · 1 working",
  "     ◉ lead · master                3:05",
  "  ▾ ◆ impl-band            working 1:42",
  "     └ fable · Edit",
  "  ▾ ● explorer-ui             done 0:58",
  "     └ haiku · Read",
  "  ▾ ■ verifier-1dda        blocked 0:12",
  "     └ sonnet · —",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "     12s  tool.call Edit             5ms",
  "     15s  tool.call Bash             2ms",
  "     17s  tool.call Read             3ms",
  "     20s  tool.call lean-ctx         4ms",
  "     24s  prompt.submit              5ms",
  "      1m  session.measure            1ms",
  "      1m  turn.complete              4ms",
  "      1m  tool.call Bash             2ms",
  "      2m  tool.call Read             3ms",
  "      2m  tool.call lean-ctx         2ms",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ],
 "D1": [
  " ── BOARD ─────────────────────────────────────",
  "     No board items yet.",
  "     plan appears at the first prompt",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ────────────────▆───            no calls",
  "     0└5m───────────────now",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     41s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "D2": [
  " ── BOARD ──────────────────────── ▰▰▱▱▱▱▱▱ 1/5",
  "  ▾ ● map band call path         explorer 0:58",
  "     └ STATUS: DONE · 4 files read",
  "  ▾ ◆ edit band segments         impl     1:42",
  "     └ claimed by impl-band · 1:42",
  "  ▾ ○ unit tests for band        —           —",
  "     └ queued · no owner yet",
  "  ▾ ■ verify at 110 cols         verifier 0:12",
  "     └ BLOCKED: needs a 110-col frame",
  "  ▾ ○ update CHANGELOG           —           —",
  "     └ queued · no owner yet",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "     12s  tool.call Edit                    5ms",
  "     15s  tool.call Bash                    2ms",
  "     17s  tool.call Read                    3ms",
  "     20s  tool.call lean-ctx                4ms",
  "     24s  prompt.submit                     5ms",
  "      1m  session.measure                   1ms",
  "      1m  turn.complete                     4ms",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "D3": [
  " ── BOARD ───────────────── ▰▰▱▱▱▱▱▱ 1/5",
  "  ▾ ● map band call path  explorer 0:58",
  "     └ STATUS: DONE · 4 files read",
  "  ▾ ◆ edit band segments  impl     1:42",
  "     └ claimed by impl-band · 1:42",
  "  ▾ ○ unit tests for band —           —",
  "     └ queued · no owner yet",
  "  ▾ ■ verify at 110 cols  verifier 0:12",
  "     └ BLOCKED: needs a 110-col frame",
  "  ▾ ○ update CHANGELOG    —           —",
  "     └ queued · no owner yet",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "     12s  tool.call Edit             5ms",
  "     15s  tool.call Bash             2ms",
  "     17s  tool.call Read             3ms",
  "     20s  tool.call lean-ctx         4ms",
  "     24s  prompt.submit              5ms",
  "      1m  session.measure            1ms",
  "      1m  turn.complete              4ms",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ],
 "C1": [
  " ── CHAT ───────────────────────── #lead-104043",
  "     No notes yet.",
  "     1 member in channel",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ────────────────▆───            no calls",
  "     0└5m───────────────now",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     41s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "  ✎ message the lead",
  "     atlas 17.23.0 · master"
 ],
 "C2": [
  " ── CHAT ─────────────── #lead-104043 · 4 notes",
  "     12:04 lead",
  "       plan posted: 5 items",
  "     12:06 explorer-ui",
  "       DONE: band call path mapped",
  "     12:09 impl-band",
  "       started band segments",
  "     12:11 verifier-1dda",
  "       BLOCKED: needs a 110-col frame",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "     12s  tool.call Edit                    5ms",
  "     15s  tool.call Bash                    2ms",
  "     17s  tool.call Read                    3ms",
  "     20s  tool.call lean-ctx                4ms",
  "     24s  prompt.submit                     5ms",
  "      1m  session.measure                   1ms",
  "      1m  turn.complete                     4ms",
  "",
  "",
  "",
  "  ✎ message the lead",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "C3": [
  " ── CHAT ──────── #lead-104043 · 4 notes",
  "     12:04 lead",
  "       plan posted: 5 items",
  "     12:06 explorer-ui",
  "       DONE: band call path mapped",
  "     12:09 impl-band",
  "       started band segments",
  "     12:11 verifier-1dda",
  "       BLOCKED: needs a 110-col frame",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "     12s  tool.call Edit             5ms",
  "     15s  tool.call Bash             2ms",
  "     17s  tool.call Read             3ms",
  "     20s  tool.call lean-ctx         4ms",
  "     24s  prompt.submit              5ms",
  "      1m  session.measure            1ms",
  "      1m  turn.complete              4ms",
  "",
  "",
  "",
  "  ✎ message the lead",
  "     atlas 17.23.0 · master   cost $0.01"
 ],
 "K1": [
  " ── CORE ──────────────────────────────────────",
  "     No verdicts yet.",
  "     items done 0 of 0",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ────────────────▆───            no calls",
  "     0└5m───────────────now",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     41s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "K2": [
  " ── CORE ────────────── 1 verified · 1 rejected",
  "     items done▰▰▱▱▱▱▱▱                  1 of 5",
  "     verdicts 1 verified · 1 rejected",
  "     kept out ▰▰▰▰▰▰▰▱           41k of 48k tok",
  "     workers  2 tmux · 1 local",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "     12s  tool.call Edit                    5ms",
  "     15s  tool.call Bash                    2ms",
  "     17s  tool.call Read                    3ms",
  "     20s  tool.call lean-ctx                4ms",
  "     24s  prompt.submit                     5ms",
  "      1m  session.measure                   1ms",
  "      1m  turn.complete                     4ms",
  "      1m  tool.call Bash                    2ms",
  "      2m  tool.call Read                    3ms",
  "      2m  tool.call lean-ctx                2ms",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "K3": [
  " ── CORE ─────── 1 verified · 1 rejected",
  "     items done▰▰▱▱▱▱▱▱           1 of 5",
  "     verdicts 1 verified · 1 rejected",
  "     kept out ▰▰▰▰▰▰▰▱    41k of 48k tok",
  "     workers  2 tmux · 1 local",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "     12s  tool.call Edit             5ms",
  "     15s  tool.call Bash             2ms",
  "     17s  tool.call Read             3ms",
  "     20s  tool.call lean-ctx         4ms",
  "     24s  prompt.submit              5ms",
  "      1m  session.measure            1ms",
  "      1m  turn.complete              4ms",
  "      1m  tool.call Bash             2ms",
  "      2m  tool.call Read             3ms",
  "      2m  tool.call lean-ctx         2ms",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ]
};

/** Frames H1-H5: the card rows (title and sections); the band row under them is the band's own (band-frame.ts). */
const CARDS: Record<string, string[]> = {
 "H1": [
  "◖ ◆ ATLAS ◗ ▸ HEALTH ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  " ── ACTIVITY ──────────── hook events · 5 min    ── GATES ────────────────── checks   ok fail    ── HOOKS ────────────────────── 1 seen · 2ms",
  "                                         1 ev        ○ completion                     1 armed        41s  session.start                   2ms",
  "                                   peak 1/15s        ○ tripwire                       1 armed",
  "       ────────────────▆───          no calls        ○ routing                        8 armed",
  "     0└5m───────────────now                          ○ header                         1 armed"
 ],
 "H2": [
  "◖ ◆ ATLAS ◗ ▸ HEALTH ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  " ── ACTIVITY ──────────── hook events · 5 min    ── GATES ────────────────── checks   ok fail    ── HOOKS ───────────────────── 15 seen · 3ms",
  "                         █              15 ev        ● completion                      1    0         5s  session.measure                 2ms",
  "                 ▂▂▂     █▂        peak 5/15s        ● tripwire                        1    0         6s  tool.call Bash ×2               3ms",
  "       ───────▅──███────▅██           last 5s        ● routing                         8    0        12s  tool.call Edit                  5ms",
  "     0└5m───────────────now                          ● header                          1    0        15s  tool.call Bash                  2ms",
  "                                                                                                     17s  tool.call Read                  3ms",
  " ── CONTEXT ─────────────────────── 64k of 1M                                                        20s  tool.call lean-ctx              4ms",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%           ~78 turns left                                                        24s  prompt.submit                   5ms",
  "     +12k/turn"
 ],
 "H3": [
  "◖ ◆ ATLAS ◗ ▸ HEALTH ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  " ── ACTIVITY ──────────── hook events · 5 min    ── GATES ────────────────── checks   ok fail    ── HOOKS ─────── 34 seen · p50 3ms · p95 5ms",
  "                         █              26 ev        ● completion                      1    0        10s  tool.call Bash                  3ms",
  "           ▄           █▄█         peak 6/15s        ● tripwire                        1    0        11s  session.measure                 1ms",
  "       ──█████─────▄──▄███─          last 10s        ● routing                         8    0        12s  turn.complete                   4ms",
  "     0└5m───────────────now                          ● header                          1    0        14s  tool.call Edit                  2ms",
  "                                                                                                     18s  tool.call Read                  3ms",
  " ── CONTEXT ─────────────────────── 64k of 1M    ── RUNS ───────────────────────────── 3 runs        22s  tool.call lean-ctx              2ms",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%          ~156 turns left        ▅█▆  med 0:42 · max 0:58 · 1 failed             26s  tool.call Bash ×2               4ms",
  "     ▂▂▅██ +6k/turn"
 ],
 "H4": [
  "◖ ◆ ATLAS ◗ ▸ HEALTH ───────────────────────────────────────────────────────────────────────────────",
  " ── ACTIVITY ────────────── hook events · 5 min    ── GATES ──────────────────── checks   ok fail",
  "                                           1 ev        ○ completion                       1 armed",
  "                                     peak 1/15s        ○ tripwire                         1 armed",
  "       ────────────────▆───            no calls        ○ routing                          8 armed",
  "     0└5m───────────────now                            ○ header                           1 armed",
  "",
  "                                                   ── HOOKS ──────────────────────── 1 seen · 2ms",
  "                                                       41s  session.start                     2ms"
 ],
 "H5": [
  "◖ ◆ ATLAS ◗ ▸ HEALTH ───────────────────────────────────────────────────────────────────────────────",
  " ── ACTIVITY ────────────── hook events · 5 min    ── GATES ──────────────────── checks   ok fail",
  "                         █                26 ev        ● completion                        1    0",
  "           ▄           █▄█           peak 6/15s        ● tripwire                          1    0",
  "       ──█████─────▄──▄███─            last 10s        ● routing                           8    0",
  "     0└5m───────────────now                            ● header                            1    0",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M    ── HOOKS ───────── 34 seen · p50 3ms · p95 5ms",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%            ~156 turns left        10s  tool.call Bash                    3ms",
  "     ▂▂▅██ +6k/turn                                    11s  session.measure                   1ms",
  "                                                       12s  turn.complete                     4ms",
  " ── RUNS ─────────────────────────────── 3 runs        14s  tool.call Edit                    2ms",
  "     ▅█▆  med 0:42 · max 0:58 · 1 failed               18s  tool.call Read                    3ms"
 ]
};

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const PHASES = ['research', 'theory', 'test', 'validate', 'implement', 'verify'];

const checks = (bad = false): HealthCheck[] => [
  { id: 'completion', ok: true, lines: 1, pass: 1 },
  { id: 'tripwire', ok: true, lines: 1, pass: 1 },
  { id: 'routing', ok: !bad, lines: 8, pass: bad ? 7 : 8 },
  { id: 'header', ok: true, lines: 1, pass: 1 },
];
const health = (o: Partial<Health>): Health => ({ gates: { total: 4, green: 4, checks: checks() }, version: '17.23.0', branch: 'master', team: 'off', ...o });
const groups = (bad: boolean): PanelGate[] => [
  { id: 'completion', title: 'Completion', lines: [{ id: 'delegated', label: 'Code changes delegated', ok: true }] },
  { id: 'tripwire', title: 'Tripwire', lines: [{ id: 'team', label: 'Team mode', ok: true, detail: 'off' }, { id: 'lead', label: 'Lead hands work to subagents', ok: true }] },
  { id: 'routing', title: 'Tool routing', lines: [
    { id: 'lean', label: 'lean-ctx calls', ok: true }, { id: 'ctxmode', label: 'context-mode calls', ok: true }, { id: 'mem', label: 'claude-mem calls', ok: true }, { id: 'read', label: 'Native Read calls', ok: true },
    bad ? { id: 'grep', label: 'Native Grep calls', ok: false, detail: '2 calls denied', fix: 'use ctx_search' } : { id: 'grep', label: 'Native Grep calls', ok: true },
    { id: 'glob', label: 'Native Glob calls', ok: true }, { id: 'bash', label: 'Native Bash calls', ok: true }, { id: 'policy', label: 'Policy denies', ok: true },
  ] },
  { id: 'header', title: 'Header', lines: [{ id: 'hdr', label: 'Last reply header matched', ok: true, detail: 'research' }] },
];

const EV = { idle: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], work: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2, 2, 0, 0, 0, 0, 1, 5, 2] };
const CTX2 = [{ tokens: 52_000, pct: 5, at: 1 }, { tokens: 64_000, pct: 6, at: 2 }];
const RECENT = [
  { label: 'session.measure', ageSecs: 5, ms: 2 }, { label: 'tool.call Bash', ageSecs: 6, ms: 3 }, { label: 'tool.call Bash', ageSecs: 6, ms: 3 }, { label: 'tool.call Edit', ageSecs: 12, ms: 5 },
  { label: 'tool.call Bash', ageSecs: 15, ms: 2 }, { label: 'tool.call Read', ageSecs: 17, ms: 3 }, { label: 'tool.call lean-ctx', ageSecs: 20, ms: 4 }, { label: 'prompt.submit', ageSecs: 24, ms: 5 },
  { label: 'session.measure', ageSecs: 62, ms: 1 }, { label: 'turn.complete', ageSecs: 70, ms: 4 }, { label: 'tool.call Bash', ageSecs: 80, ms: 2 }, { label: 'tool.call Read', ageSecs: 125, ms: 3 }, { label: 'tool.call lean-ctx', ageSecs: 130, ms: 2 },
];
const IDLE = (): Health => health({
  upSecs: 41, hooks: { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent: [{ label: 'session.start', ageSecs: 41, ms: 2 }], latency: { n: 1, p50: 2, p95: 2 } }, pulse: { events: EV.idle, ctx: [], runs: [] },
});
const WORKING = (bad = false): Health => health({
  gates: { total: 4, green: bad ? 3 : 4, checks: checks(bad), ...(bad ? { denied: 2 } : {}) }, upSecs: 185, ctxPct: 6, tokens: 64_000, window: 1_000_000,
  hooks: { total: 15, byLabel: [{ label: 'prompt.submit', n: 1 }, { label: 'tool.call', n: 6 }], recent: RECENT, lastEventSecs: 5, runTools: 6, runTool: 'Bash', latency: { n: 15, p50: 3, p95: 5 } },
  pulse: { events: EV.work, ctx: CTX2, runs: [], window: 1_000_000, cost: { usd: 0.01 } },
});

const W = (name: string, role: string, state: PanelWorker['state'], model: string, detail: string, secs: number): PanelWorker => ({ name, role, state, model, detail, secs });
const WORKERS: PanelWorker[] = [W('impl-band', 'impl', 'running', 'fable', 'Edit', 102), W('explorer-ui', 'explorer', 'done', 'haiku', 'Read', 58), W('verifier-1dda', 'verifier', 'blocked', 'sonnet', '—', 12)];
const BOARD: PanelWorker[] = [W('explorer-ui', 'explorer', 'done', 'haiku', 'Read', 58), W('impl-band', 'impl', 'running', 'fable', 'Edit', 102), W('verifier-1dda', 'verifier', 'blocked', 'sonnet', '—', 12)];
const TODOS: PanelTodo[] = [
  { id: 'T1', label: 'map band call path', state: 'done', owner: 'explorer-ui', evidence: 'STATUS: DONE · 4 files read' },
  { id: 'T2', label: 'edit band segments', state: 'running', owner: 'impl-band' },
  { id: 'T3', label: 'unit tests for band', state: 'queued' },
  { id: 'T4', label: 'verify at 110 cols', state: 'blocked', owner: 'verifier-1dda', evidence: 'BLOCKED: needs a 110-col frame' },
  { id: 'T5', label: 'update CHANGELOG', state: 'queued' },
];
const NOTES: PanelNote[] = [
  { at: '12:04:10', from: 'lead', text: 'plan posted: 5 items', lead: true }, { at: '12:06:20', from: 'explorer-ui', text: 'DONE: band call path mapped', kind: 'done' },
  { at: '12:09:05', from: 'impl-band', text: 'started band segments' }, { at: '12:11:40', from: 'verifier-1dda', text: 'BLOCKED: needs a 110-col frame', kind: 'blocked' },
];
const CORE = {
  contract: { header: { ok: 1, total: 1 }, evidence: { ok: 1, total: 1 }, open: 4, openGates: 0, verifiedDone: { ok: 1, total: 5 } },
  verdicts: [{ id: 'V1', status: 'verified', title: 'band call path', by: 'verifier', at: 1, evidence: 'ok' }, { id: 'V2', status: 'rejected', title: 'segments', by: 'verifier', at: 2, evidence: 'no' }],
  claims: [], ledger: { verified: 1, refuted: 1, pending: 0, claimed: 0, unchecked: 0 }, offload: { workers: [], kept: 48_000, returned: 7_000, ratio: null },
  routes: [
    { teamId: 't1', name: 'team', cls: 'implement', effort: 'medium', isolation: 'none', maxParallel: 2, seats: [{ role: 'implementer', count: 2, model: 'fable', effort: 'medium', ran: [] }], drift: [], transport: 'tmux' },
    { teamId: 't2', name: 'local', cls: 'fix', effort: 'low', isolation: 'none', maxParallel: 1, seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: [] }], drift: [], transport: 'in-process' },
  ],
} as unknown as CoreModel;

type Spec = { tab: PanelTab; board?: boolean; kind: 'idle' | 'working'; h: () => Health; over: Partial<PanelModel> };
const SPECS: Record<string, [number, Spec]> = {};
const spec = (name: string, cols: number, tab: PanelTab, kind: 'idle' | 'working', h: () => Health, over: Partial<PanelModel> = {}, board = false): void => { SPECS[name] = [cols, { tab, kind, h, over, ...(board ? { board } : {}) }]; };
const idleOver = { workers: [], todos: [], notes: [], gates: groups(false), people: 1 } satisfies Partial<PanelModel>;
for (const [cols, n] of [[150, 1], [110, 3]] as const) {
  const g2 = n === 1 ? 'G2' : 'G3';
  if (n === 1) {
    spec('G1', 150, 'gates', 'idle', IDLE, idleOver);
    spec('T1', 150, 'team', 'idle', IDLE, idleOver);
    spec('D1', 150, 'route', 'idle', IDLE, idleOver, true);
    spec('C1', 150, 'channel', 'idle', IDLE, idleOver);
    spec('K1', 150, 'core', 'idle', IDLE, idleOver);
  }
  spec(g2, cols, 'gates', 'working', () => WORKING(true), { workers: [], todos: [], notes: [], gates: groups(true) });
  spec(`T${n === 1 ? 2 : 3}`, cols, 'team', 'working', () => WORKING(), { workers: WORKERS, todos: [], notes: [], gates: groups(false), lead: { name: 'lead', role: 'lead', state: 'running', detail: '', secs: 185 } });
  spec(`D${n === 1 ? 2 : 3}`, cols, 'route', 'working', () => WORKING(), { workers: BOARD, todos: TODOS, notes: [], gates: groups(false) }, true);
  spec(`C${n === 1 ? 2 : 3}`, cols, 'channel', 'working', () => WORKING(), { workers: [], todos: [], notes: NOTES, gates: groups(false), channel: 'lead-104043', people: 4 });
  spec(`K${n === 1 ? 2 : 3}`, cols, 'core', 'working', () => WORKING(), { workers: [], todos: TODOS, notes: [], gates: groups(false), core: CORE });
}

const world = (name: string): PanelModel => {
  const [cols, s] = SPECS[name]!;
  return panelWorld(s.tab, cols === 150 ? 48 : 41, ui, {
    rows: 39, phases: PHASES, phase: s.kind === 'working' ? 'test' : 'research', entered: s.kind === 'working' ? ['research', 'theory', 'test'] : [], channel: 'lead-104043',
    run: { kind: s.kind, secs: 5, startMs: NOW, frame: 0 }, health: s.h(), ...(s.board ? { board: true } : {}), ...s.over,
  } as never);
};
/** The rows from the content ribbon to the pinned footer, trailing blanks trimmed. */
const body = (m: PanelModel): string[] => {
  const t = panelLines(m).map((l) => lineText(l).trimEnd());
  return t.slice(t.findIndex((l) => l.startsWith(' ── ')));
};

describe('the other tabs are the spec frames G1-K3', () => {
  for (const name of Object.keys(FRAMES)) {
    const [cols] = SPECS[name]!;
    test(`${name}: ${cols} columns, rows from the content ribbon to the footer equal the frame`, () => {
      expect(body(world(name))).toEqual(FRAMES[name]!);
    });
  }
  test('every row is within the panel width and the footer is the pane\'s last row', () => {
    for (const name of Object.keys(FRAMES)) {
      const m = world(name);
      const lines = panelLines(m).map((l) => lineText(l));
      for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(m.cols);
      expect(lines.at(-1)!.trimEnd()).toMatch(/^ {5}atlas 17\.23\.0 · master/);
      expect(lines.length).toBe(m.rows);
    }
  });
});

const DONE = (): Health => health({
  upSecs: 372, ctxPct: 6, tokens: 64_000, window: 1_000_000, last: { secs: 58, done: 5, total: 5, agents: 0, failed: 0, endedAgo: 12 },
  hooks: { total: 34, byLabel: [{ label: 'prompt.submit', n: 3 }, { label: 'tool.call', n: 11 }], lastEventSecs: 10, runTools: 11, latency: { n: 34, p50: 3, p95: 5 }, recent: [
    { label: 'tool.call Bash', ageSecs: 10, ms: 3 }, { label: 'session.measure', ageSecs: 11, ms: 1 }, { label: 'turn.complete', ageSecs: 12, ms: 4 }, { label: 'tool.call Edit', ageSecs: 14, ms: 2 }, { label: 'tool.call Read', ageSecs: 18, ms: 3 },
    { label: 'tool.call lean-ctx', ageSecs: 22, ms: 2 }, { label: 'tool.call Bash', ageSecs: 26, ms: 2 }, { label: 'tool.call Bash', ageSecs: 26, ms: 4 }, { label: 'prompt.submit', ageSecs: 30, ms: 5 },
  ] },
  pulse: { events: [0, 0, 2, 2, 3, 2, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1, 4, 3, 6, 0], ctx: [12_000, 12_000, 36_000, 58_000, 64_000].map((tokens, i) => ({ tokens, pct: Math.round(tokens / 10_000), at: i + 1 })), runs: [{ secs: 33, ok: true, at: 1 }, { secs: 58, ok: false, at: 2 }, { secs: 42, ok: true, at: 3 }], window: 1_000_000, cost: { usd: 0.01 } },
});
const CARD_CASES: Record<string, [number, () => Health]> = { H1: [145, IDLE], H2: [145, () => WORKING()], H3: [145, DONE], H4: [100, IDLE], H5: [100, DONE] };

describe('the health card is the spec frame H1-H5', () => {
  for (const [name, [cols, h]] of Object.entries(CARD_CASES)) {
    test(`${name}: ${cols} columns, the title and the packed sections equal the frame`, () => {
      const rows = healthCardRows(h(), { cols, ui }).map((r) => r.map((x) => x.t).join('').trimEnd());
      expect(rows).toEqual(CARDS[name]!);
    });
  }
});

describe('one phase count: the band and the panel read the contract phases (frame spec 2.10)', () => {
  const lines = (pm: PanelModel): string[] => panelLines(pm).map((l) => lineText(l));
  test('the panel model takes the six contract phases and the band counts `n/6` against the same six', () => {
    const snap = busySnap({ phase: 'implement' } as never);
    expect(snap.contract.todoPhases).toHaveLength(6);
    const pm = panelModelOf({ snapshot: snap, gates: [], core: null, ui: { recipient: null, expanded: null, draft: '', view: 'route' }, look: ui, columns: 121, rows: 40, tick: 0 } as never, ui);
    expect(pm.phases).toEqual(PHASES);
    const band = bandLines(worldModel(150, ui, { rich: false, maxRows: 1, health: WORKING(), phases: PHASES, todoPhases: PHASES, phase: 'implement', run: { kind: 'working', secs: 5, startMs: NOW } } as never));
    expect(band.map((l) => l.runs.map((r) => r.t).join('')).join('\n')).toMatch(/implement 5\/6/);
    const st = panelWorld('route', 80, ui, { rows: 40, phases: PHASES, phase: 'implement', entered: ['research', 'theory', 'test', 'validate', 'implement'], run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: WORKING(), workers: [], todos: [], notes: [], gates: [] } as never);
    expect(lines(st).find((l) => /implement/.test(l) && /\d\/6$/.test(l.trimEnd()))!.trimEnd()).toMatch(/●●●●◆○ 5\/6$/);
  });
  test('the stepper fills only the entered stages; a skipped stage stays empty', () => {
    const mk = (entered: string[], kind: 'working' | 'done', phase: string) => panelWorld('route', 80, ui, { rows: 40, phases: PHASES, phase, entered, run: { kind, secs: 5, startMs: NOW, frame: 0 }, health: WORKING(), workers: [], todos: [], notes: [], gates: [] } as never);
    const row = (m: PanelModel) => lines(m).find((l) => /\d\/6$/.test(l.trimEnd()))!.trimEnd();
    expect(row(mk(['research', 'implement'], 'working', 'verify'))).toMatch(/●○○○●◆ 3\/6$/); // passed + current: two passed, one current
    expect(row(mk(['research', 'implement'], 'done', 'done'))).toMatch(/●●●●●● 6\/6$/); // done fills every pip, whatever the run entered
  });
});

describe('the gate marks: a measured pass is green at every colour depth (spec 2.4; the 256-colour bug)', () => {
  const green = (color: Ui['color']): string[] => {
    const u: Ui = { ...uiFromEnv({}), color };
    const m = panelWorld('gates', 48, u, { rows: 39, phases: PHASES, phase: 'test', entered: [], channel: 'lead-104043', run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: WORKING(), workers: [], todos: [], notes: [], gates: groups(false) } as never);
    return panelLines(m).flatMap((l) => l.runs).filter((r) => r.t === '●' && r.tone === 'ok').map((r) => String(r.fg ?? runHex(r, u.theme, u.color) ?? ''));
  };
  for (const c of ['truecolor', '256'] as const) {
    test(`${c}: every measured ● carries the ok tone and the ok colour`, () => {
      const hexes = green(c);
      expect(hexes.length).toBeGreaterThan(3);
      const ok = bandLook({ ...uiFromEnv({}), color: c }).ok;
      for (const h of hexes) expect(h.toLowerCase()).toBe(ok.toLowerCase());
    });
  }
});

describe('the one control idiom: only filled chips press (frame spec 2.3)', () => {
  const pressed = (pm: PanelModel) => panelLines(pm).filter((l) => l.press !== undefined);
  const filled = (l: { runs: { bgHex?: string }[] }): boolean => l.runs.some((r) => r.bgHex !== undefined);
  test('the gates tab: a group chip flips (`gate:<id>`), a leaf row and a ribbon do not', () => {
    const p = pressed(world('G1'));
    expect(p.map((l) => (l.press as { key: string }).key)).toEqual(['gate:completion', 'gate:tripwire', 'gate:routing', 'gate:header']);
    for (const l of p) { expect((l.press as { kind: string }).kind).toBe('flip'); expect(filled(l)).toBe(true); }
  });
  test('the chat tab: the compose chip is the one `compose` press and it is filled', () => {
    const p = pressed(world('C2'));
    expect(p).toHaveLength(1);
    expect((p[0]!.press as { kind: string }).kind).toBe('compose');
    expect(lineText(p[0]!)).toMatch(/✎ message the lead/);
    expect(filled(p[0]!)).toBe(true);
  });
  test('the team tab: a worker chip flips `worker:<name>`; the board: an item chip flips `item:<id>`', () => {
    expect(pressed(world('T2')).map((l) => (l.press as { key: string }).key)).toEqual(WORKERS.map((w) => `worker:${w.name}`));
    expect(pressed(world('D2')).map((l) => (l.press as { key: string }).key)).toEqual(TODOS.map((t) => `item:${t.id}`));
  });
  test('an expander chevron sits only in a pressable chip row, and `▹` and `▿` never appear', () => {
    for (const name of Object.keys(FRAMES)) for (const l of panelLines(world(name))) {
      const t = lineText(l);
      expect(t).not.toMatch(/[▹▿]/);
      if (/^\s{0,3}[▾▸] /.test(t)) expect(l.press !== undefined).toBe(true);
    }
  });
});
