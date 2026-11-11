# Atlas round 2: before and after against the 200% bar (2026-11-11)

Scope: Jerry's round 2 ask of 2026-11-10:
- Polished, branded TODO, Subagents, Board and Side panel mods on Claude Code and omp.
- A reliability sweep of the operating contract, hooks, skills, subagents, tmux, doctor and scripts.
- A measured improvement of at least 200%, with evidence.
- Adversarial review.

Before: atlas 17.5.0 at `c5ef6d71`. After: atlas 17.8.0, with code at `08a1451b`. The 17.7.0 column (code at `4a9ade00`) is kept for reference.
Raw evidence is in `/mnt/project-files/atlas-ui-redesign/round2/`:
- `metrics.md`: metric definitions and the before numbers.
- `baseline/`: the before runs.
- `after/`: the after runs and the reviews.

## How "200%" is read

"200% better" is read as a 3x factor on the error side of each metric. The failure count, survivor count, invisible share or gap to a perfect score must fall to 1/3 of its before value or less. Pass counts cannot triple past their cap, so they are tracked as must-not-regress. This reading was fixed in `round2/metrics.md` before any change was made.

## Result

At 17.8.0 the 3x bar is met on 13 of the 18 lines that carry a 3x target. It is not met on 5:
- events never shown, per surface (2 lines);
- first-appearance lag (2 lines);
- the hostile design critic.

Release 17.8.0 does NOT meet "200% on everything". It does restore M10 (doctor 0 FAIL), and it removes the stall that ended 4 of 6 runs at 17.7.0.

Live numbers are the mean of 3 runs per width at both 17.7.0 and 17.8.0.

| # | Metric | Before (17.5.0) | 17.7.0 | After (17.8.0) | Factor on error side | 3x met |
|---|---|---|---|---|---|---|
| M1 | Reliability defects that block use or give wrong output | 5 | 0 | 0 | all fixed | yes |
| M2 | All ledger reliability items | 11 | 0 open | 0 open | all closed | yes |
| M4 | Mutation survivors, 20 mutants per module, seed 1105 | 51 of 300 (17.0%) | 13 of 320 (4.1%) | not re-run at 17.8.0; 17.7.0 value | 4.2x | yes (at 17.7.0) |
| M4a | Same, only the 7 TS modules present in both trees | 24 of 140 | 4 of 140 | not re-run at 17.8.0 | 6.0x | yes (at 17.7.0) |
| M5 | TODO tree visibility, 150 cols | 22.5% | 97.6% | 97.6% | 32x | yes |
| M5 | TODO tree visibility, 110 cols | 23.1% | 97.5% | 97.0% | 25.6x | yes |
| M5 | Band task count, 150 cols | 23.0% | 95.1% | 94.9% | 15.1x | yes |
| M5 | Band task count, 110 cols | 26.2% | 78.9% | 79.5% | 3.6x | yes |
| M5 | Running workers on any Atlas surface, 150 cols | 65.4% | 91.9% | 94.6% | 6.4x | yes |
| M5 | Running workers on any Atlas surface, 110 cols | 26.7% | 90.6% | 91.6% | 8.7x | yes |
| M5 | Side panel route tab (both widths) | 0% | 100% | 100% | from 0 | yes |
| M5 | Side panel gates tab, 150 / 110 cols | 66.7% | 88.9% / 100% | 100% / 100% | to 0 | yes |
| M5 | Side panel team tab, 150 / 110 cols | 100% / 100% | 100% / 100% | 100% / 100% | held | must-not-regress, held |
| M5 | Transcript cards, 150 / 110 cols | 96.9% / 96.5% | 100% / 100% | 100% / 100% | to 0 | yes |
| M6 | Events never shown on any Atlas surface, 150 / 110 cols | 10 of 22 / 11 of 22 | 0 of 66 / 0 of 66 | 0 of 66 / 0 of 61 | to 0 | yes |
| M6 | Events never shown, per surface, 150 cols | 14 of 31 (45.2%) | 20 of 118 (16.9%) | 18 of 111 (16.2%) | 2.8x | not met |
| M6 | Events never shown, per surface, 110 cols | 17 of 31 (54.8%) | 27 of 111 (24.3%) | 27 of 106 (25.5%) | 2.2x | not met |
| M6 | First-appearance lag median / max, 150 cols | 1.22 s / 4.33 s | 1.12 s / 3.98 s | 0.90 s / 2.80 s (median of 3 runs) | 1.4x / 1.5x | not met |
| M6 | First-appearance lag median / max, 110 cols | 0.63 s / 5.79 s | 1.01 s / 4.36 s | 0.85 s / 4.66 s | worse / 1.2x | not met |
| M7 | Hostile design critic, gap to 10 | 3.5 (gap 6.5) | 5.7 (gap 4.3), critique 6 | 5.9 (gap 4.1), critique 8 | 1.6x | not met (target 8.2) |
| M10 | Doctor FAIL on the repo | 0 FAIL, 4 WARN | 1 FAIL, 4 WARN | 0 FAIL, 4 WARN | must-not-regress | held (restored) |

Why the four M6 misses are where they are:
- **Per surface.** Every event never shown on a given surface at 17.8.0 is one of two kinds:
  - A band worker row. Since 17.6.0 the band does not draw worker rows by design; the HUD SUBAGENTS block lists them.
  - The side panel Subagents check at 110 columns, where the side panel is not docked.

  Across all Atlas surfaces together, 0 of 127 events go unseen. Reaching 3x on this line means drawing workers twice, which the critiques count against density.
- **Lag.** The capture itself and the host set a floor under lag:
  - Frames are sampled every 0.5 s.
  - The host's own native agent list shows an agent start 0.65 s after the Agent call (median, `native_agent_list_control`).

  A 3x cut on the 110-column baseline median of 0.63 s would need 0.21 s, which is under the frame period.

M9 (suites, must not regress) at 17.8.0:
- bun `mod omp`: 2472 pass, 31 skip, 0 fail, both with `COLORTERM=truecolor` and with it unset (1762 pass before).
- `tsc -p mod/tsconfig.json --noEmit`: exit 0.
- `claude plugin test .`: 1519 pass. All 205 failures are test files the host loader does not load by design (they import `bun:test`).
- pytest on the touched Python tests and the contract test: 1016 passed, 3 skipped.

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

## Adversarial review

Eight hostile reviews used the same rubric: hierarchy, legibility, consistency, brand, density and truthfulness, and motion.

| Review | Basis | Score |
|---|---|---|
| 17.5.0 baseline | | 3.5 |
| Critique 3 | fixture frames | 6.2 |
| Critique 4 | live frames | 6.1 |
| Critique 5 | live frames | 5.8 |
| Critique 6 | live frames | 5.7 |
| Critique 7 | live frames | 5.8 |
| Critique 8 | live frames | 5.9 |

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

## Open after 17.8.0

- The five unmet lines above, and the critique 8 findings.
- Stale TODO rows (L3) in 6-13 frames per run, wrong group counts (L7) in 3-8 and wrong task counts (L6) in 3-8.
- A git stash entry, `data-impl-a89479`, left by a worker whose drop was denied by its own permissions. It is kept for Jerry to keep or drop.
