# Atlas round 2: before and after against the 200% bar (2026-11-11)

Scope: Jerry's round 2 ask of 2026-11-10:
- Polished, branded TODO, Subagents, Board and Side panel mods on Claude Code and omp.
- A reliability sweep of the operating contract, hooks, skills, subagents, tmux, doctor and scripts.
- A measured improvement of at least 200%, with evidence.
- Adversarial review.

Before: atlas 17.5.0 at `c5ef6d71`. After: atlas 17.13.0, with code at `4b5b5a94`. The 17.7.0 (`4a9ade00`), 17.8.0 (`08a1451b`), 17.9.0 (`74d8931b`), 17.10.0 (`f93b4e85`), 17.11.0 (`8271cfc8`) and 17.12.0 (`61858003`) columns are kept for reference.
Raw evidence is in `/mnt/project-files/atlas-ui-redesign/round2/`:
- `metrics.md`: metric definitions and the before numbers.
- `baseline/`: the before runs.
- `after/`: the after runs and the reviews.

## How "200%" is read

"200% better" is read as a 3x factor on the error side of each metric. The failure count, survivor count, invisible share or gap to a perfect score must fall to 1/3 of its before value or less. Pass counts cannot triple past their cap, so they are tracked as must-not-regress. This reading was fixed in `round2/metrics.md` before any change was made.

## Result

At 17.13.0 the 3x bar is met on 16 of the 19 lines that carry a 3x target (14 of 19 at 17.12.0, 13 of 19 at 17.11.0). It is not met on 3:
- first-appearance lag (2 lines: 150 and 110 columns);
- the hostile design critic.

The two per-surface "events never shown" lines now clear 3x (3.6x at 150 columns, 3.4x at 110) for the first time. Release 17.13.0 does NOT meet "200% on everything". Two lines more are must-not-regress, and both hold.

Correction to the 17.8.0 version of this table: it said 13 of 18. An independent verifier recounted it as 14 lines met out of 19 with a 3x target, and found that the lag max used the median of the three run maxes against a single-run baseline. The lag max below is now the max over the three runs at 17.8.0 and later.

Live numbers are the mean of 3 runs per width (lag: the median of the run medians, and the max over the runs). The 17.11.0 column is 3 runs per width on build `8271cfc8`, the 17.12.0 column is 3 runs per width on build `61858003` and the 17.13.0 column is 3 runs per width on build `4b5b5a94` (means from `scratchpad/summ-4b5b5a94.txt`, run values from each run's `metrics.json`); Factor and 3x met are computed from the 17.5.0 Before values with the same error-side rule as before: (100 - before) / (100 - after) for percent-correct rows, before / after for lag and never-shown rows, (10 - before) / (10 - after) for the critic.

| # | Metric | Before (17.5.0) | 17.7.0 | 17.8.0 | 17.9.0 | 17.10.0 | 17.11.0 | 17.12.0 | After (17.13.0) | Factor on error side | 3x met |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M1 | Reliability defects that block use or give wrong output | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | all fixed | yes |
| M2 | All ledger reliability items | 11 | 0 open | 0 open | 0 open | 0 open | 0 open | 0 open | 0 open | all closed | yes |
| M4 | Mutation survivors, 20 mutants per module, seed 1105 | 51 of 300 (17.0%) | 13 of 320 (4.1%) | not re-run | not re-run | not re-run | not re-run | not re-run | not re-run | 4.2x (at 17.7.0) | yes (at 17.7.0) |
| M4a | Same, only the 7 TS modules present in both trees | 24 of 140 | 4 of 140 | not re-run | not re-run | not re-run | not re-run | not re-run | not re-run | 6.0x (at 17.7.0) | yes (at 17.7.0) |
| M5 | TODO tree visibility, 150 cols | 22.5% | 97.6% | 97.6% | 84.3% | 80.0% (85.5% with `returned` counted right, see note) | 82.5% (runs 83.6, 82.4, 81.5) | 81.3% (runs 81.8, 81.5, 80.6) | 81.2% (runs 81.8, 80.6, 81.1) | 4.1x | yes |
| M5 | TODO tree visibility, 110 cols | 23.1% | 97.5% | 97.0% | 85.4% | 79.7% (86.4% with `returned` counted right) | 82.0% (runs 81.6, 83.2, 81.2) | 82.5% (runs 82.5, 83.0, 82.0) | 78.5% (runs 78.2, 79.6, 77.8) | 3.6x | yes |
| M5 | Band task count, 150 cols | 23.0% | 95.1% | 94.9% | 96.1% | 95.6% | 94.7% (runs 93.5, 94.8, 95.8) | 94.6% (runs 94.8, 95.2, 93.7) | 94.5% (runs 93.6, 95.7, 94.3) | 14.0x | yes |
| M5 | Band task count, 110 cols | 26.2% | 78.9% | 79.5% | 78.6% | 77.0% | 78.6% (runs 76.6, 81.3, 77.8) | 78.1% (runs 77.3, 79.0, 77.9) | 92.2% (runs 92.0, 92.9, 91.7) | 9.5x | yes |
| M5 | Running workers on any Atlas surface, 150 cols | 65.4% | 91.9% | 94.6% | 93.0% | 91.3% | 94.8% (runs 97.1, 93.5, 93.8) | 93.6% (runs 93.2, 93.2, 94.3) | 94.0% (runs 94.8, 94.8, 92.4) | 5.8x | yes |
| M5 | Running workers on any Atlas surface, 110 cols | 26.7% | 90.6% | 91.6% | 92.7% | 89.2% | 93.2% (runs 94.8, 87.8, 97.1) | 92.8% (runs 91.4, 91.7, 95.2) | 91.4% (runs 93.1, 89.8, 91.4) | 8.5x | yes |
| M5 | Side panel route tab (both widths) | 0% | 100% | 100% | 100% | 100% | 100% | 100% | 100% | from 0 | yes |
| M5 | Side panel gates tab, 150 / 110 cols | 66.7% | 88.9% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 66.7% / 66.7% (see note on M5 gates) | 100% / 100% | 100% / 100% | to 0 | yes |
| M5 | Side panel team tab, 150 / 110 cols | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | held | must-not-regress, held |
| M5 | Transcript cards, 150 / 110 cols | 96.9% / 96.5% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | 100% / 100% | to 0 | yes |
| M6 | Events never shown on any Atlas surface, 150 / 110 cols | 10 of 22 / 11 of 22 | 0 of 66 / 0 of 66 | 0 of 66 / 0 of 61 | 0 of 65 / 0 of 64 | 0 of 66 / 0 of 66 | 0 of 22 / 0 of 21 per run | 0 of 22 / 0 of 22 per run | 0 of 22 / 0 of 21 or 22 per run | to 0 | yes |
| M6 | Events never shown, per surface, 150 cols | 14 of 31 (45.2%) | 20 of 118 (16.9%) | 18 of 111 (16.2%) | 18 of 110 (16.4%) | 18 of 111 (16.2%) | 6 of 37 per run (16.2%) | 6 of 37 per run (16.2%) | 14 of 111 (12.6%; per run 5, 4, 5 of 37) | 3.6x | yes |
| M6 | Events never shown, per surface, 110 cols | 17 of 31 (54.8%) | 27 of 111 (24.3%) | 27 of 106 (25.5%) | 27 of 109 (24.8%) | 27 of 111 (24.3%) | 9 of 37 per run, 9 of 36 in one run (24.3%) | 9 of 37 per run (24.3%) | 18 of 110 (16.4%; per run 6 of 36, 6 of 37, 6 of 37) | 3.4x | yes |
| M6 | First-appearance lag median / max, 150 cols | 1.22 s / 4.33 s | 1.12 s / 13.4 s | 0.90 s / 4.51 s | 1.08 s / 4.23 s | 0.94 s / 4.98 s | 0.70 s / 3.6 s | 1.0 s / 4.6 s (means of the 3 runs: 0.9 / 2.84, 1.09 / 5.32, 1.06 / 5.56) | 1.0 s / 2.4 s (means of the 3 runs: 1.18 / 1.95, 0.96 / 3.64, 0.97 / 1.65) | 1.2x / 1.8x (1.2x on the max over the runs, 3.64 s) | not met |
| M6 | First-appearance lag median / max, 110 cols | 0.63 s / 5.79 s | 1.01 s / 4.36 s (median of maxes) | 0.85 s / 5.54 s | 1.03 s / 5.21 s | 1.00 s / 5.07 s | 1.00 s / 3.3 s | 0.9 s / 2.4 s (means of the 3 runs: 1.08 / 2.78, 0.86 / 2.15, 0.79 / 2.32) | 1.1 s / 1.9 s (means of the 3 runs: 1.15 / 1.67, 1.07 / 2.09, 1.03 / 1.94) | 0.6x (worse) / 3.0x on the mean of the run maxes, 2.8x on the max over the runs (2.09 s) | not met |
| M7 | Hostile design critic, gap to 10 | 3.5 (gap 6.5) | 5.7, critique 6 | 5.9, critique 8 | 6.1 (gap 3.9), critique 9 | 6.2 (gap 3.8), critique 10 | 6.4 (gap 3.6), critique 12 | 6.3 (gap 3.7), critique 14; critique 13 also 6.3 | 6.5 (gap 3.5), critique 20; critiques 15 to 19 were 6.2, 6.3, 6.5, 6.4, 6.5 | 1.9x | not met (target 8.2) |
| M10 | Doctor FAIL on the repo | 0 FAIL, 4 WARN | 1 FAIL, 4 WARN | 0 FAIL, 4 WARN | 0 FAIL, 4 WARN | 0 FAIL, 4 WARN | 0 FAIL | 0 FAIL, 5 WARN | 0 FAIL, 4 WARN | must-not-regress | held |

Note on 17.13.0. The column is 3 runs per width on build `4b5b5a94` (`round2/after/live-150-4b5b5a94-1` to `-3`, `live-110-4b5b5a94-1` to `-3`); `meta.capture_period_s` is 0.5 in every run. Ratios are computed from the 17.5.0 Before column with the error-side rule above:
- TODO 77.5 / 18.8 = 4.1x (150) and 76.9 / 21.5 = 3.6x (110).
- Band 77.0 / 5.5 = 14.0x and 73.8 / 7.8 = 9.5x.
- Workers on any surface 34.6 / 6.0 = 5.8x and 73.3 / 8.6 = 8.5x. The scorer's `hud_subagents` mean is 93.0% (150) and 91.4% (110), the same verdict.
- Never shown per surface: 14 of 111 is 12.6% and 45.2 / 12.6 = 3.6x at 150; 18 of 110 is 16.4% and 54.8 / 16.4 = 3.4x at 110. Both were under 3x at 17.12.0 (2.8x and 2.3x). Across all surfaces together 0 of 22 events go unseen at 150 and 0 of 21 or 22 at 110.
- Lag median at 150: 1.22 / 1.0 = 1.2x, not met. Lag max at 150: 4.33 / 2.4 = 1.8x on the mean of the three run maxes (1.95, 3.64, 1.65 s) and 1.2x on the max over the runs (3.64 s), not met either way.
- Lag median at 110 is worse than the 17.5.0 baseline: 1.1 s against 0.63 s. The reason is the one stated below for 17.10.0: the capture samples every 0.5 s and the host's own agent list shows a start 0.65 s after the Agent call, so no median can sit under about 1 s here. Lag max at 110: 5.79 / 1.9 = 3.0x on the mean of the run maxes (1.67, 2.09, 1.94 s), 2.8x on the max over the runs (2.09 s), the rule stated above. The line is not met because of the median.
- Critic: (10 - 3.5) / (10 - 6.5) = 1.9x, not met (target 8.2).
- Side panel route, team, gates and channel tabs, transcript cards and the board score 100% at both widths in all six runs.

Note on M5 gates at 17.12.0. The side panel gates tab, route tab, team tab and channel tab score 100% at both widths in all six runs on build `61858003`, so the gates line is met again (it was 66.7% at 17.11.0). The lag cells at 17.12.0 are the mean of the three runs (the per-run median and max are in the cell); the rule stated above (median of the run medians, max over the runs) gives 1.06 s / 5.56 s at 150 columns and 0.86 s / 2.78 s at 110, which is the same verdict (not met).

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

M9 (suites, must not regress) at 17.13.0, run on the release branch:
- bun `mod omp`: 3000 pass, 31 skip, 0 fail, both with `COLORTERM=truecolor` and with `env -u COLORTERM` (2636 pass at 17.12.0).
- `bunx tsc -p mod/tsconfig.json --noEmit`: exit 0.
- Doctor: 23 pass, 4 warnings, 0 failures.
- pytest: 7 files (hooks `test_completion_gate`, `test_atlas_gates`, `test_atlas_contract`, `test_dispatch_tripwire`, `test_worker_report_gate`; scripts `test_atlas_todo`, `test_atlas_todo_more`) 1292 passed, 3 skipped.

M9 (suites, must not regress) at 17.12.0:
- bun `mod omp`: 2636 pass, 0 fail, both with `COLORTERM=truecolor` and with it unset (2606 pass at 17.11.0).
- `tsc -p mod/tsconfig.json --noEmit`: exit 0.
- Doctor: 0 FAIL, 5 WARN.
- pytest: hooks 1166 passed, 3 skipped; scripts 121 passed.

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
| 17.12.0, 150 x 45 | `round2/after/live-150-61858003-1`, `-2`, `-3` |
| 17.12.0, 110 x 40 | `round2/after/live-110-61858003-1`, `-2`, `-3` |
| 17.12.0 motion frames (256-colour) | `round2/after/motion-61858003` |
| 17.13.0, 150 x 45 | `round2/after/live-150-4b5b5a94-1`, `-2`, `-3` |
| 17.13.0, 110 x 40 | `round2/after/live-110-4b5b5a94-1`, `-2`, `-3` |
| 17.13.0 motion frames (256-colour) | `round2/after/motion-4b5b5a94` |

## Adversarial review

Nineteen hostile reviews (the baseline and critiques 3 to 20) used the same rubric: hierarchy, legibility, consistency, brand, density and truthfulness, and motion.

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
| Critique 13 | live frames, build `6b7f637d` | 6.3 (Band 6.3, HUD 7.2, Subagents 6.8, Board 6.0, Side panel 6.0, Cards and toasts 5.7) |
| Critique 14 | live frames, build `61858003` | 6.3 (Band 6.2, HUD 7.2, Subagents 7.0, Board 6.0, Side panel 6.0, Cards and toasts 5.5) |
| Critique 15 | live frames, build `95c4a588` | 6.2 (Band 6.3, HUD 7.2, Subagents 6.3, Board 5.5, Side panel 6.0, Cards and toasts 5.8) |
| Critique 16 | live frames, build `e4a8186a` | 6.3 (Band 5.8, HUD 7.0, Subagents 6.7, Board 5.8, Side panel 6.2, Cards and toasts 6.2) |
| Critique 17 | live frames, build `a4fad2f9` | 6.5 (Band 6.5, HUD 7.0, Subagents 6.7, Board 6.0, Side panel 6.2, Cards and toasts 6.8) |
| Critique 18 | live frames, build `562576ed` | 6.4 (Band 6.3, HUD 6.5, Subagents 6.7, Board 6.2, Side panel 6.2, Cards and toasts 6.8) |
| Critique 19 | live frames, build `232567af` | 6.5 (Band 6.5, HUD 6.7, Subagents 6.5, Board 6.2, Side panel 6.3, Cards and toasts 6.7) |
| Critique 20 | live frames, build `4b5b5a94` | 6.5 (Band 6.3, HUD 6.8, Subagents 6.5, Board 6.3, Side panel 6.3, Cards and toasts 6.8) |

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

## Fixed in 17.12.0 (critique 12 and 13 findings, wave 14)

- The band checks row and the side panel count the same way, `2/3 green`, with no `2 of 3 green` left anywhere, and the band never reads `idle` between sending a prompt and the first model step.
- At 110 columns the host places an unasked pane only from 144 columns, so a narrow terminal gets the pane on request; a terminal that starts narrow and is widened to 144 or more docks the pane once. One band form serves 90 to 119 columns, so 110 and a docked 150 read alike.
- The route tab keeps full titles: it drops the owner column on a row whose title already names its owner, so `read ...` and the doubled owner are gone at 110 and 150.
- One routing verdict: a route that ran off its plan fails routing on the band, the gates tab and the core row alike. The band no longer prints `contract no done items yet` beside a todo count, and the core row says why `evidence` and `verified` are 0. `1 dispatch open` is not repeated beside `1 running`.
- The channel tab shows the real channel name again. A finished worker's card duration matches the team tab. A shell call in SUBAGENTS LAST reads `run atlas_todo.py`, not the raw command. A done name in the panel grid is struck through without the spaces after it.
- The header chip is drawn from a cached pattern the moment a message arrives, routine toasts come one at a time (folded into `+N more`), and the last beat of a ramp is held bold so each step in the 600 ms window differs from rest.
- The side panel Board opens with one `BOARD  5 items` row, a done agent row shows the evidence of its plan row, and the team tab drops a `last` line that repeats `task`.

## Fixed in 17.13.0 (critique 14 to 19 findings, waves 15 to 20)

- Wave 15 (critique 14, 110 layout). The side panel tab strip is one row at the 110-column pane, the first prompt docks the pane once at 110 to 143 columns, the SUBAGENTS column-name row stays in every frame the slot can hold it, and route and core rows are wrapped on words instead of cut. The header chip keeps the lead's whole sentence, a finish card is placed within a second, routine starts and finishes raise no host toast, and the band never reads `idle` under a running spinner. A wave 15 merge that registered a second unmatched `prompt.submit` hook stopped the whole mod loading in the live host; it was found live and fixed.
- Wave 16 (critique 15). Failure is terminal on every surface: a stopped worker no longer ends as a green `explorer finished` card, and a failed id is remembered after the host drops its row. Phase, gates, blocked and the board read one truth (the lead's header chip is the phase). The SUBAGENTS block is back at 110 columns, and the gates tab is back to 100% (a waived `verified` row had dropped its figure).
- Wave 17 (critique 16). Blocked is one red `■` on every surface and the amber `▲` is warnings only; the band's todo figure is the plan's own `n/m`; the gates figure no longer flickers (Stop-only conditions read pending); the 256-colour ramp falls instead of popping; one card style; the host toast box is sent only for a wait or a note to the person.
- Wave 18 (critique 17). A row whose owner failed or was killed never reads plain green `done`; blocked has its own glyph; SUBAGENTS LAST is the outcome, not the tool echo; the header chip is answered synchronously from the contract's pattern (read through `mod/contract-pattern.ts`, because the live host refuses a `.json` import from a hooks module); the HUD and the panel read one frame clock.
- Wave 19 (critique 18). One truth on the band, route, gates and core (a refusal is read against the store, the gates figure counts green marks, a lead waiting on the person is the blocked phase). The HUD draws every plan row while ribbon, rows and agents fit; a killed worker reads `killed` on every card; the side panel tab strip is one row of whole words from 36 to 52 cells.
- Wave 20 (critique 19). The HUD TODO truth holds under a retry (a row is judged by its owner's latest run); the SUBAGENTS grid is fixed and LAST is an outcome; the board draws each owner whole beside its row; `atlas_todo.py counts` leads with a plain summary so 8 rows are never read as an 8-item plan; the Stop refusal names `1 open dispatch row`; the channel tab carries kills and refusals; the band draws compact worker rows in the rows the HUD leaves spare.

## Critic trend

The hostile critic scored the 17.5.0 baseline at 3.5. After that: critique 6 (17.7.0) 5.7, critique 7 5.8, critique 8 (17.8.0) 5.9, critique 9 (17.9.0) 6.1, critique 10 (17.10.0) 6.2, critique 11 (build `5d6a53ef`) 6.2, critique 12 (build `8271cfc8`) 6.4, critique 13 (build `6b7f637d`) 6.3, critique 14 (build `61858003`) 6.3, critique 15 (build `95c4a588`) 6.2, critique 16 (build `e4a8186a`) 6.3, critique 17 (build `a4fad2f9`) 6.5, critique 18 (build `562576ed`) 6.4, critique 19 (build `232567af`) 6.5 and critique 20 (build `4b5b5a94`) 6.5. The last seven reviews (critiques 14 to 20) are 6.3, 6.2, 6.3, 6.5, 6.4, 6.5 and 6.5: the score has been flat between 6.2 and 6.5 for seven builds, and 6.4 to 6.5 for the last four. Each review is harsher than the last and replaces a fixed defect with the next one found, and several asks that critiques 12, 14 and 20 list are not in the mod's hands. They are host-owned, or need the capture scenario changed: docking the side panel at 110 columns (the host places an unasked pane only from 144 columns), the host toast box and its position, the host-drawn `[-]` in the gutter, the raw header frame the host paints before the hook answers, the tab strip width under the host's hotkey prefixes, and a fixed capture scenario that has no mid-run board tab or Stop transition on every run, which caps the Board motion score at 4 and the Band at 6. The Board went from 5.5 (critique 15) to 6.3 (critique 20) and the Cards and toasts surface from 5.8 to 6.8; the Band and Side panel moved least.

## Open after 17.13.0

Critique 20 (`round2/after/critique-20.md`) scores 6.5, flat on critique 19. Its top 5 changes, ranked by score gain:
1. Flip on the same tick as the refusal (band, panel phase and chip driven off the Stop hook's own write; `blocked` over `routing warning`; one blocked colour 214 everywhere; keep `1 dispatch open` and `failed` unclipped at 110; add a `working` / `idle` state word). About +0.25.
2. Render the header chip on frame 0 (removes all 34 raw frames, including the raw `⛔ blocked` in 150-1). About +0.15.
3. Make LAST and the agent grid hold under every width and state (column header row while running, LAST filled at 110, no board-closure notes in an agent's LAST, every spinner on one shared phase clock). About +0.15.
4. HUD truth and polish (cut L3, which is 146 and 138 frames in the two non-refusal stop runs; render `T2 -> blocked`; give `worker failed` the `■` 217 glyph and the same colour in the panel; truncate owners consistently at 110; `[-]` inside the box; the 110 gap; bold through the colour landing). About +0.15.
5. Make the board and the channel carry their weight (a board-tab row captured mid-fade to lift Board M above 4; items and dispatch rows reported apart; show how an open row was closed; kills, refusals and closures in the channel with full names; remove the core duplicate). About +0.15.

Lines not met at 17.13.0, with the evidence for each:
- **(a) Raw header frames.** The raw `● ATLAS | ...` header frame is the host painting a new message before the worker-hop hook answers. The mod already answers on the sync path (`mod/restyle.tsx` AssistantMessage hook, about :332-342: a known cached pattern returns the tree with no promise), and the host log shows the hook settling in 14 to 183 ms. The host's redraw contract is in `.claude-plugin/types/claude-code/index.d.ts` (about :2400-2412). The chip cannot be on frame 0 from the mod's side. This is critique 20 change #2.
- **(b) The `[-]` collapse marker.** The host draws it in the gutter beside the band tree and reserves five cells for it (`index.d.ts` about :11227, :11241-11245 and :11263-11269), so the mod cannot move it inside the box background. Part of critique 20 change #4.
- **(c) Board motion capped at 4.** The capture cannot open the board tab mid-run: the pane needs focus through `/atlas-cc`, which queues while the lead is busy, so `fade_glyph_tabs` is `[]` in all six stop runs of critique 20 and the Board motion score stays at 4. Critique 20 change #5 depends on a capture-scenario change, not a mod change.
- **(d) Band worker rows.** While agents run the band owns one row, because `hudSlotCap` in `mod/register.ts` gives the other rows to the HUD, so the SUBAGENTS block is the worker surface. The per-surface "never shown" lines now clear 3x (12.6% and 16.4%); their remaining misses are the band worker rows (`L9`, 31 frames in 150-1) and the side panel Subagents check (`L11`, 4 frames in 150-1). Workers on any surface is the line above, and it holds at 94.0% and 91.4%.
- **(e) First-appearance lag median.** It is floored by the 0.5 s capture period (`meta.capture_period_s` is 0.5 in all six runs) and by the host's own agent list, which shows a start about 0.65 s after the Agent call. The 110-column median of 1.1 s is worse than the 17.5.0 baseline of 0.63 s: a 3x cut of that baseline needs 0.21 s, which is under the frame period. The 150-column median (1.0 s) and max (2.4 s mean, 3.64 s worst run) are better than the baseline and under 3x.
- **(f) The design critic.** The score has been flat at 6.2 to 6.5 for the last seven builds (critiques 14 to 20) while each review names new, smaller defects; the target is 8.2. Critique 20's top 5 headings are the open list above.

Also open:
- The live-capture scorer undercounts: `stop_refusal_frames` and `band_blocked_frames` are 0 in all six 17.13.0 stop-run `metrics.json` files although critique 20 sees both in the frames (`stoprun-150-2/f0107.ans:37`, `stoprun-150-2` `f0106`, `stoprun-110-2` `f0114`). Its glyph map also lacks `◃` and `◍` (`unknown_glyphs` in the 17.12.0 `metrics.json`).
- The team tab duration needs the host's `duration_ms`.
- A git stash entry, `stash@{0}` `data-impl-a89479`, left by a worker whose drop was denied by its own permissions. It is kept for Jerry to keep or drop.
