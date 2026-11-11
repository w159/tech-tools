# Atlas round 2: before and after against the 200% bar (2026-11-11)

Scope: Jerry's round 2 ask of 2026-11-10:
- Polished, branded TODO, Subagents, Board and Side panel mods on Claude Code and omp.
- A reliability sweep of the operating contract, hooks, skills, subagents, tmux, doctor and scripts.
- A measured improvement of at least 200%, with evidence.
- Adversarial review.

Before: atlas 17.5.0 at `c5ef6d71`. After: atlas 17.11.0, with code at `8271cfc8`. The 17.7.0 (`4a9ade00`), 17.8.0 (`08a1451b`), 17.9.0 (`74d8931b`) and 17.10.0 (`f93b4e85`) columns are kept for reference.
Raw evidence is in `/mnt/project-files/atlas-ui-redesign/round2/`:
- `metrics.md`: metric definitions and the before numbers.
- `baseline/`: the before runs.
- `after/`: the after runs and the reviews.

## How "200%" is read

"200% better" is read as a 3x factor on the error side of each metric. The failure count, survivor count, invisible share or gap to a perfect score must fall to 1/3 of its before value or less. Pass counts cannot triple past their cap, so they are tracked as must-not-regress. This reading was fixed in `round2/metrics.md` before any change was made.

## Result

At 17.11.0 the 3x bar is met on 13 of the 19 lines that carry a 3x target (14 of 19 at 17.10.0). It is not met on 6:
- events never shown, per surface (2 lines);
- first-appearance lag (2 lines);
- the side panel gates tab (1 line, new at 17.11.0: the scorer no longer finds a `verified n of m` line, see the note on M5 gates);
- the hostile design critic.

Release 17.11.0 does NOT meet "200% on everything". Two lines more are must-not-regress, and both hold.

Correction to the 17.8.0 version of this table: it said 13 of 18. An independent verifier recounted it as 14 lines met out of 19 with a 3x target, and found that the lag max used the median of the three run maxes against a single-run baseline. The lag max below is now the max over the three runs at 17.8.0 and later.

Live numbers are the mean of 3 runs per width (lag: the median of the run medians, and the max over the runs). The 17.11.0 column is 3 runs per width on build `8271cfc8`; Factor and 3x met are computed from the 17.5.0 Before values with the same error-side rule as before: (100 - before) / (100 - after) for percent-correct rows, before / after for lag and never-shown rows, (10 - before) / (10 - after) for the critic.

| # | Metric | Before (17.5.0) | 17.7.0 | 17.8.0 | 17.9.0 | 17.10.0 | After (17.11.0) | Factor on error side | 3x met |
|---|---|---|---|---|---|---|---|---|---|
| M1 | Reliability defects that block use or give wrong output | 5 | 0 | 0 | 0 | 0 | 0 | all fixed | yes |
| M2 | All ledger reliability items | 11 | 0 open | 0 open | 0 open | 0 open | 0 open | all closed | yes |
| M4 | Mutation survivors, 20 mutants per module, seed 1105 | 51 of 300 (17.0%) | 13 of 320 (4.1%) | not re-run | not re-run | not re-run | not re-run | 4.2x (at 17.7.0) | yes (at 17.7.0) |
| M4a | Same, only the 7 TS modules present in both trees | 24 of 140 | 4 of 140 | not re-run | not re-run | not re-run | not re-run | 6.0x (at 17.7.0) | yes (at 17.7.0) |
| M5 | TODO tree visibility, 150 cols | 22.5% | 97.6% | 97.6% | 84.3% | 80.0% (85.5% with `returned` counted right, see note) | 82.5% (runs 83.6, 82.4, 81.5) | 4.4x | yes |
| M5 | TODO tree visibility, 110 cols | 23.1% | 97.5% | 97.0% | 85.4% | 79.7% (86.4% with `returned` counted right) | 82.0% (runs 81.6, 83.2, 81.2) | 4.3x | yes |
| M5 | Band task count, 150 cols | 23.0% | 95.1% | 94.9% | 96.1% | 95.6% | 94.7% (runs 93.5, 94.8, 95.8) | 14.5x | yes |
| M5 | Band task count, 110 cols | 26.2% | 78.9% | 79.5% | 78.6% | 77.0% | 78.6% (runs 76.6, 81.3, 77.8) | 3.4x | yes |
| M5 | Running workers on any Atlas surface, 150 cols | 65.4% | 91.9% | 94.6% | 93.0% | 91.3% | 94.8% (runs 97.1, 93.5, 93.8) | 6.7x | yes |
| M5 | Running workers on any Atlas surface, 110 cols | 26.7% | 90.6% | 91.6% | 92.7% | 89.2% | 93.2% (runs 94.8, 87.8, 97.1) | 10.8x | yes |
| M5 | Side panel route tab (both widths) | 0% | 100% | 100% | 100% | 100% | 100% | from 0 | yes |
| M5 | Side panel gates tab, 150 / 110 cols | 66.7% | 88.9% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 66.7% / 66.7% (see note on M5 gates) | 1.0x / 1.0x | not met |
| M5 | Side panel team tab, 150 / 110 cols | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | held | must-not-regress, held |
| M5 | Transcript cards, 150 / 110 cols | 96.9% / 96.5% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | to 0 | yes |
| M6 | Events never shown on any Atlas surface, 150 / 110 cols | 10 of 22 / 11 of 22 | 0 of 66 / 0 of 66 | 0 of 66 / 0 of 61 | 0 of 65 / 0 of 64 | 0 of 66 / 0 of 66 | 0 of 22 / 0 of 21 per run | to 0 | yes |
| M6 | Events never shown, per surface, 150 cols | 14 of 31 (45.2%) | 20 of 118 (16.9%) | 18 of 111 (16.2%) | 18 of 110 (16.4%) | 18 of 111 (16.2%) | 6 of 37 per run (16.2%) | 2.8x | not met |
| M6 | Events never shown, per surface, 110 cols | 17 of 31 (54.8%) | 27 of 111 (24.3%) | 27 of 106 (25.5%) | 27 of 109 (24.8%) | 27 of 111 (24.3%) | 9 of 37 per run, 9 of 36 in one run (24.3%) | 2.3x | not met |
| M6 | First-appearance lag median / max, 150 cols | 1.22 s / 4.33 s | 1.12 s / 13.4 s | 0.90 s / 4.51 s | 1.08 s / 4.23 s | 0.94 s / 4.98 s | 0.70 s / 3.6 s | 1.7x / 1.2x | not met |
| M6 | First-appearance lag median / max, 110 cols | 0.63 s / 5.79 s | 1.01 s / 4.36 s (median of maxes) | 0.85 s / 5.54 s | 1.03 s / 5.21 s | 1.00 s / 5.07 s | 1.00 s / 3.3 s | worse / 1.8x | not met |
| M7 | Hostile design critic, gap to 10 | 3.5 (gap 6.5) | 5.7, critique 6 | 5.9, critique 8 | 6.1 (gap 3.9), critique 9 | 6.2 (gap 3.8), critique 10 | 6.4 (gap 3.6), critique 12 | 1.8x | not met (target 8.2) |
| M10 | Doctor FAIL on the repo | 0 FAIL, 4 WARN | 1 FAIL, 4 WARN | 0 FAIL, 4 WARN | 0 FAIL, 4 WARN | 0 FAIL, 4 WARN | 0 FAIL | must-not-regress | held |

Note on M5 gates at 17.11.0. The side panel gates tab scores 66.7% at both widths in all six runs, the same as the 17.5.0 baseline, against 100% at 17.10.0. The route seat count (3 of 3) and the four gate rows are right in every run; the check that fails is `verdict_line_shown`, which the scorer reads as `N verified` or `verified n of m` on the gates or core tab. Critique 11 slice B3 made the core row drop `contract n/m evidence` when done items exist and none carry evidence, so that text no longer appears. The metric definition is not altered here, so the strict number stands and the line is counted as not met; whether the scorer should accept the new wording is Jerry's call.

Note on M5 TODO at 17.11.0. The scorer's glyph map does not know `◃` (returned) or `◍`; `unknown_glyphs` lists both in the 150-column run 1 metrics. Rows drawn with them are graded as unknown, so the 82.5% and 82.0% are strict numbers and likely understate the build.

Note on M5 TODO. 17.9.0 shows a TODO row as `running` while its owner agent runs, and 17.10.0 shows `returned` once the owner has ended but the lead has not yet written the row. The scorer checks each row against the TodoWrite store, which says `pending` or `in_progress` until the lead writes it, so it grades both as wrong. The metric definition was fixed before any change and is not altered here; the strict number is the one in the table and it still clears 3x.

Correction to the 17.9.0 version of this note. It said an explorer traced the whole drop from 97.6% to 84.3% to the `running` rule. An independent verifier recounted the six 17.9.0 runs: of 273 wrong TODO frames, 196 (72%) are that rule and 77 (28%) are other errors, mostly rows the store had completed still drawn pending or unknown after the owner ended, plus pending rows drawn running with no live owner.

At 17.10.0 an explorer re-scored every frame of all twelve runs (17.9.0 and 17.10.0). The fall from 84.3% to 80.0% is the `returned` rows alone: 16 to 26 frames per run, with 0 caused by the new row order. Counting those rows as right gives 85.5% (150) and 86.4% (110). Running workers on any surface fell 1-3 points; every missed frame is the first 1-2 s after an agent starts, before its row is first drawn, in both builds.

Why the four M6 misses are where they are:
- **Per surface.** Every event never shown on a given surface at 17.10.0 is one of two kinds:
  - A band worker row. Since 17.6.0 the band does not draw worker rows by design; the HUD SUBAGENTS block lists them.
  - The side panel Subagents check at 110 columns, where the side panel is not docked.

  Across all Atlas surfaces together, 0 of 132 events go unseen. Reaching 3x on this line means drawing workers twice, which the critiques count against density.
- **Lag.** The capture itself and the host set a floor under lag:
  - Frames are sampled every 0.5 s.
  - The host's own native agent list shows an agent start 0.65 s after the Agent call (median, `native_agent_list_control`).

  A 3x cut on the 110-column baseline median of 0.63 s would need 0.21 s, which is under the frame period.

M9 (suites, must not regress) at 17.11.0:
- bun `mod omp`: 2606 pass, 0 fail, both with `COLORTERM=truecolor` and with it unset (2513 pass at 17.10.0).
- Doctor: 0 FAIL.
- pytest: hooks 1166 passed; scripts 121 passed.
- Host plugin test: 0 failures outside the test files the host loader does not load by design.

M9 (suites, must not regress) at 17.10.0:
- bun `mod omp`: 2513 pass, 0 fail, both with `COLORTERM=truecolor` and with it unset (1762 pass before).
- `tsc -p mod/tsconfig.json --noEmit`: exit 0.
- `claude plugin test .`: 0 failures outside the test files the host loader does not load by design (they import `bun:test`).
- pytest: hooks (completion gate, gates, contract, tripwire, worker report gate) 1166 passed; scripts `test_atlas_todo*.py` 121 passed.

## Scorer fix, applied to every run

`round2/tools/live_capture.py` read only the first `atlas_todo.py set '<json>'` in a shell command. A chained `set A && set B` therefore left the scorer's truth one plan behind, and it scored correct frames as stale. Run 150-3 at the wave 8 build read 52.9% TODO visibility for this reason. The parser now reads every `set` in the command.

All 12 runs at 4a9ade00 and 7e3539ad were rescored with the fixed parser, and the 17.8.0 runs were scored with it. The pre-fix copy and metrics are kept in the session scratchpad. Some 4a9ade00 runs still hold 2-3 events in command forms the parser does not read; they are left unscored rather than guessed.

## A stall found and fixed in 17.8.0

At 17.7.0, the lead stalled on Stop in 4 of 6 runs. Two causes were found:
- The Board drew three open dispatch rows as done.
- The Stop team gate (s) counted read-only explorers, which contradicts decision D11 in the dispatch gate.

While stalled, the lead's AskUserQuestion modal held one frame for 41 captures, and the tab keys went into the prompt as text. 17.8.0 fixes both causes:
- The dispatch row closes when its agent ends, even on a retry stop.
- (s) skips explorer and db-prober, as the dispatch gate does (`READ_ONLY_ROLES`, `hooks/completion_gate_core.py`).

An independent verifier re-ran the gate tests and could not refute the change. Its one caveat is that the built-in `Explore` agent type is still counted, which can only over-count.

## A regression found and fixed before 17.7.0

The 256-colour painters merged in `cd9cf960` recomputed the palette search for every run on every frame. In live runs:
- The Claude Code process sat at 110-150% CPU.
- Subagents took 60-180 s instead of 13-18 s.
- Running-worker visibility fell to 19% (150 cols) and 27% (110 cols), with lag max of 104-184 s.

Bisecting live captures with a CPU sampler found it. `4a9ade00` caches the lookups:

| Build | Host CPU mean | Agent run length | Workers on any surface |
|---|---|---|---|
| c2be624f | 30% | 17-19 s | 93% |
| a32b81d6 (before the cache) with the gate poll off | 67% | 80-83 s | 0% |
| 4a9ade00 (the cache), 6 runs | not sampled | 11-19 s | 87.8-93.8% |

## Live runs

Each run is the real `claude` CLI in tmux on a fixed scenario: three explorers read three files, then the lead closes the plan. The run is recorded frame by frame and scored against the transcript and the board by `round2/tools/live_capture.py`.

| Run | Directory |
|---|---|
| Before, 150 x 45 | `round2/baseline/live-150` |
| Before, 110 x 40 | `round2/baseline/live-110` |
| 17.8.0, 150 x 45 | `round2/after/live-150-08a1451b-1`, `-2`, `-3` |
| 17.8.0, 110 x 40 | `round2/after/live-110-08a1451b-1`, `-2`, `-3` |
| 17.8.0 motion frames (256-colour) | `round2/after/motion-08a1451b` |
| 17.9.0, 150 x 45 | `round2/after/live-150-74d8931b-1`, `-2`, `-3` |
| 17.9.0, 110 x 40 | `round2/after/live-110-74d8931b-1`, `-2`, `-3` |
| 17.9.0 motion frames (256-colour) | `round2/after/motion-74d8931b` |
| 17.10.0, 150 x 45 | `round2/after/live-150-f93b4e85-1`, `-2`, `-3` |
| 17.10.0, 110 x 40 | `round2/after/live-110-f93b4e85-1`, `-2`, `-3` |
| 17.10.0 motion frames (256-colour) | `round2/after/motion-f93b4e85` |
| 17.11.0, 150 x 45 | `round2/after/live-150-8271cfc8-1`, `-2`, `-3` |
| 17.11.0, 110 x 40 | `round2/after/live-110-8271cfc8-1`, `-2`, `-3` |
| 17.11.0 motion frames (256-colour) | `round2/after/motion-8271cfc8` |

## Adversarial review

Eleven hostile reviews (the baseline and critiques 3 to 12) used the same rubric: hierarchy, legibility, consistency, brand, density and truthfulness, and motion.

| Review | Basis | Score |
|---|---|---|
| 17.5.0 baseline | | 3.5 |
| Critique 3 | fixture frames | 6.2 |
| Critique 4 | live frames | 6.1 |
| Critique 5 | live frames | 5.8 |
| Critique 6 | live frames | 5.7 |
| Critique 7 | live frames | 5.8 |
| Critique 8 | live frames | 5.9 |
| Critique 9 | live frames | 6.1 |
| Critique 10 | live frames | 6.2 |
| Critique 11 | live frames, build `5d6a53ef` | 6.2 (Band 6.2, HUD 6.8, Subagents 7.0, Board 5.7, Side panel 6.0, Cards 5.5) |
| Critique 12 | live frames, build `8271cfc8` | 6.4 (Band 6.3, HUD 7.0, Subagents 7.2, Board 5.8, Side panel 6.0, Cards and toasts 5.8) |

Each live critique reads the earlier ones and judges the fixes against a harsher basis, so a fixed defect is replaced by the next one found. Critique 8 (`round2/after/critique-8.md`) confirms most critique 7 items fixed:
- the spinner phase lock;
- the doubled verb;
- `STATUS:` caps;
- the plan-sized Board;
- the unique transition glyph;
- the 110-column SUBAGENTS header;
- one TODO count format;
- real 256-colour motion frames.

Its top findings at 17.8.0:
- The band says `BLOCKED` when a tripwire failed but Stop did not block (4 of 6 runs).
- The team tab's durations are about 4x the agents' real run time.
- The Board tab shows 5 items while the board helper reports 8 (the 3 dispatch rows).
- A TODO row reads `queued` while its owner agent is running.
- Headers are still raw for 1-2 frames.

## Fixed in 17.9.0 (critique 8 findings)

- The band reads `BLOCKED` only when Stop refused. The completion gate records its verdict in `.atlas/.run/stop-verdict.json`, and a failing check without a refused Stop reads `<gate> warning`. 0 of 6 runs end on a false BLOCKED (4 of 6 at 17.8.0).
- The team tab's lead row takes the same verdict, and the core and gates tabs share one header evaluation.
- The band drops `phase n/m` when a plan exists, so `phase 1/5 · todo 4/5` cannot appear.
- The board helper reports plan items and dispatches apart, and the Board tab names the folded dispatches.
- A TODO row reads `running` while its owner agent runs.
- Agent durations stop at each agent's own end, and the toast duration matches the card.
- The 256-colour fade starts on frame 0 with a visible step.
- LAST shows each agent's last distinct tool and target.

## Fixed in 17.10.0 (critique 9 findings)

- The stall seen in 1 of 6 17.9.0 runs: a dispatch row now closes when its agent ends even when the member is named `<slice>-<role>` and the launch recorded no agent id. Stop, the gates rows, the core counts and the band share one open-work rule, and the band reads `todo 5/5 · 1 open` while Stop would refuse.
- The Board footer names an open folded dispatch, and the plan row it folds into re-opens.
- A TODO row whose owner returned reads `returned`, never `queued`; the HUD and the route tab derive row state from one function, and SUBAGENTS rows sort by their task.
- The band reads a Stop refusal on the poll that sees the verdict file change (it was about 3.5 s late), with plain reasons such as `blocked: 1 todo open`, never `stop: r`. The 110-column band keeps the contract row and draws no gauge track.

## Fixed in 17.11.0 (critique 10 and 11 findings, waves 12 and 13)

- The HUD and the side panel draw one tick for the same TODO and agent row, because both take the motion driver's frame clock. `returned` has its own hollow `◃` mark in the accent tone, never the amber `▲`, and one function sets the tone of a state word on both surfaces.
- The 256-colour fade steps one palette colour per beat and the done ramp holds each step for 200 ms, so the whole ramp lasts 600 ms.
- The band and gates tab agree: a failing check without a Stop refusal reads `warning`, one amber `▲` marks it everywhere, and the band never reads `idle` while the lead runs its own tool. It counts open work from the same snapshot as the plan and names open dispatch rows (`5/5 · 1 dispatch open`). A 110 and a 150 band draw the same rows.
- A planned route reads in plain words (`planned audit team (low effort), ran 3 explorers`) instead of `audit/low`.
- The side panel route tab reads a plan row's state the same way the HUD does, and agent rows keep one order by task on the HUD, the route tab and the team tab, so a row never moves when a worker finishes.
- A new Agent or Task call draws its SUBAGENTS row at once, running, with no second row and no gap; a new row never hides its state word.
- The team tab names the lead once, the core tab counts in-process dispatches apart from tmux teams, and the gates counts agree with the transcript (`3 of 3`).
- Team tab rows and LAST text follow the plan like the HUD; the channel tab, route labels and empty states line up with every other list; the Board in the side panel has no nested ribbon and says `N items` once.
- The `● done ... +N more` toast counts only toasts of its own kind and fits in 40 cells. The HUD's first rule reaches the last cell, done task titles are struck through in the side panel, and the header tally counts every assistant text the transcript drew.
- The self-referencing `plugins/atlas/.claude-plugin/types` symlink that a wave 12 merge added is untracked and ignored (commit `8271cfc8`).

## Open after 17.11.0

Critique 12 (`round2/after/critique-12.md`) scores 6.4. Its top 5 changes, ranked by score gain:
1. Make the 110 layout work: show the side panel during runs at 110 (about 30 frames per run), stop the route tab cutting titles to `read ...` by dropping the owner column there, keep the tab strip on one row, and use one band layout and separator set at both widths.
2. Give one truth everywhere: remove or reconcile `contract no done items yet` beside `todo 1/5` and core `evidence 0/5` beside `todo 5/5`, make the core `off plan` agree with `routing passing`, use one count format inside the panel, collapse `1 dispatch open · ◐ 1 running` into one phrase, and never show `idle` once a prompt is submitted.
3. Prove the untested paths live and give the board a title: capture board rows going running to done, a failed row, an open folded row, a Stop block and a band state change, and put back a single board title so users and the capture script can find it.
4. Fix cards and toasts: show the header chip from frame 0 (15 raw frames), stop host toasts clipping the transcript at 150, and bring card lag under 1.5 s at both widths.
5. Finish the polish: move `[-]` inside the box background, colour every `◃ returned` glyph and word the same, keep the SUBAGENTS column header stable, show the outcome rather than the last action in done agent rows, drop the duplicate team lines, indent the core labels, replace jargon (`observed-behavior proof`, `Colony channel`, `phase research 1 of 5`, raw channel IDs) with plain words, and hold the ramp for at least 600 ms.

Also open:
- The six unmet lines above.
- The live-capture scorer glyph map lacks `◃` and `◍` (critique 12, `metrics.json` `unknown_glyphs`), so rows drawn with them score as unknown.
- The side panel gates tab scores 66.7% because the scorer expects a `verified n of m` line that the core row no longer prints.
- The team tab duration needs the host's `duration_ms`.
- A git stash entry, `stash@{0}` `data-impl-a89479`, left by a worker whose drop was denied by its own permissions. It is kept for Jerry to keep or drop.
