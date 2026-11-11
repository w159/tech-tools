# Atlas round 2: before and after against the 200% bar (2026-11-11)

Scope: Jerry's round 2 ask of 2026-11-10 (polished, branded TODO, Subagents, Board and Side panel mods on Claude Code and omp; a reliability sweep of the operating contract, hooks, skills, subagents, tmux, doctor and scripts; a measured improvement of at least 200% with evidence; adversarial review).

Before: atlas 17.5.0 at `c5ef6d71`. After: atlas 17.7.0 (code at `4a9ade00`). The 17.6.0 column is kept for reference.
Raw evidence: `/mnt/project-files/atlas-ui-redesign/round2/` (`metrics.md` holds the metric definitions and before numbers, `baseline/` the before runs, `after/` the after runs and reviews).

## How "200%" is read

200% better is read as a 3x factor on the error side of each metric. The failure count, survivor count, invisible share or gap to a perfect score must fall to 1/3 of its before value or less. Pass counts cannot triple past their cap, so they are tracked as must-not-regress. This reading was fixed in `round2/metrics.md` before any change was made.

## Result

At 17.7.0 the 3x bar is met on 13 of the 18 lines that carry a 3x target. It is not met on 5: events never shown per surface (2 lines), first-appearance lag (2 lines) and the hostile design critic. Release 17.7.0 does NOT meet "200% on everything".

Live numbers at 17.7.0 are the mean of 3 runs per width (17.6.0 was 1 run per width).

| # | Metric | Before (17.5.0) | 17.6.0 | After (17.7.0) | Factor on error side | 3x met |
|---|---|---|---|---|---|---|
| M1 | Reliability defects that block use or give wrong output | 5 | 0 | 0 | all fixed | yes |
| M2 | All ledger reliability items | 11 | 0 open | 0 open | all closed | yes |
| M4 | Mutation survivors, 20 mutants per module, seed 1105 | 51 of 300 (17.0%) | 28 of 320 | 13 of 320 (4.1%): TS 12 of 260 on 13 modules, Python 1 of 60 | 4.2x | yes |
| M4a | Same, only the 7 TS modules present in both trees | 24 of 140 | 12 of 140 | 4 of 140 | 6.0x | yes |
| M5 | TODO tree visibility, 150 cols | 22.5% | 97.8% | 97.6% | 32x | yes |
| M5 | TODO tree visibility, 110 cols | 23.1% | 87.0% | 97.5% | 31x | yes |
| M5 | Band task count, 150 cols | 23.0% | 92.7% | 95.1% | 15.7x | yes |
| M5 | Band task count, 110 cols | 26.2% | 78.9% | 78.9% | 3.5x | yes |
| M5 | Running workers on any Atlas surface, 150 cols | 65.4% | 82.8% | 91.9% | 4.3x | yes |
| M5 | Running workers on any Atlas surface, 110 cols | 26.7% | 87.9% | 90.6% | 7.8x | yes |
| M5 | Side panel route tab (both widths) | 0% | 100% | 100% | from 0 | yes |
| M5 | Side panel gates tab, 150 / 110 cols | 66.7% | 100% | 88.9% / 100% | 3.0x / to 0 | yes |
| M5 | Side panel team tab, 150 / 110 cols | 100% / 100% | 75% / 100% | 100% / 100% | held | must-not-regress, held |
| M5 | Transcript cards, 150 / 110 cols | 96.9% / 96.5% | 75.0% / 100% | 100% / 100% | to 0 | yes |
| M6 | Events never shown on any Atlas surface, 150 / 110 cols | 10 of 22 / 11 of 22 | not scored | 0 of 66 / 0 of 66 | to 0 | yes |
| M6 | Events never shown, per surface, 150 cols | 14 of 31 (45.2%) | 13 of 44 | 20 of 118 (16.9%) | 2.7x | not met |
| M6 | Events never shown, per surface, 110 cols | 17 of 31 (54.8%) | 7 of 37 | 27 of 111 (24.3%) | 2.3x | not met |
| M6 | First-appearance lag median / max, 150 cols | 1.22 s / 4.33 s | 1.48 s / 2.58 s | 1.12 s / 3.98 s (median of 3 maxes; one run 13.4 s) | 1.1x / 1.1x | not met |
| M6 | First-appearance lag median / max, 110 cols | 0.63 s / 5.79 s | 1.58 s / 17.65 s | 1.01 s / 4.36 s | worse / 1.3x | not met |
| M7 | Hostile design critic, gap to 10 | 3.5 (gap 6.5) | 6.1 (critique 4) | 5.7 (gap 4.3), critique 6 | 1.5x | not met (target 8.2) |
| M10 | Doctor FAIL on the repo | 0 FAIL, 4 WARN | 0 FAIL, 4 WARN | 1 FAIL, 4 WARN | must-not-regress | regressed: `enforcement-rates` reports that the native Grep/Glob gate denied 0 of 62 calls in this machine's last 7 days; open, under investigation |

Why the four M6 misses are where they are:
- Per surface, every never-shown event at 17.7.0 is a band worker row, plus the side panel Subagents check at 110 columns. Since 17.6.0 the band does not draw worker rows by design (the HUD SUBAGENTS block lists them), and at 110 columns the side panel is not docked. On any Atlas surface 0 of 132 events go unseen.
- Lag is bounded below by the capture itself and by the host. Frames are sampled every 0.5 s, and the host's own native agent list shows an agent start 0.65 s after the Agent call (median, `native_agent_list_control` in the 17.7.0 metrics). A 3x cut on the 110-column baseline median of 0.63 s would need 0.21 s, under the frame period.

M9 (suites, must not regress): bun `mod omp` 1762 pass before, 2380 pass, 31 skip, 0 fail at 17.7.0; `tsc -p mod/tsconfig.json --noEmit` exit 0; `claude plugin test .` 1431 pass, and all 204 failures are test files the host loader does not load by design (they import `bun:test`). M11 (bandTree render time) was not re-run as a bench at 17.7.0. The painters were measured directly instead: 4000 256-colour paints took 6038 ms before the palette cache and 27 ms after (`mod/paint-cost.test.ts`).

## A regression found and fixed before release

The 256-colour painters merged in `cd9cf960` recomputed the palette search for every run on every frame. In live runs the Claude Code process sat at 110-150% CPU, and subagents took 60-180 s instead of 13-18 s. This made the 93198523 captures fall to 19% (150 cols) and 27% (110 cols) running-worker visibility, with lag max of 104-184 s.

It was found by bisecting live captures with a CPU sampler:

| Build | Host CPU mean | Agent run length | Workers on any surface |
|---|---|---|---|
| c2be624f | 30% | 17-19 s | 93% |
| 6a5e398f plus the loader fix | 33% | 16-19 s | 94% |
| a32b81d6 (before the cache) with the gate poll off | 67% | 80-83 s | 0% |
| 4a9ade00 (the cache), 6 runs | not sampled | 11-19 s | 87.8-93.8% |

`4a9ade00` caches the lookups, and the three 4a9ade00 runs per width show agent runs of 11-19 s again.

## Live runs

Each run is the real `claude` CLI in tmux on a fixed scenario (three explorers read three files, then the lead closes the plan), recorded frame by frame and scored against the transcript and the board by `round2/tools/live_capture.py`.

| Run | Directory |
|---|---|
| Before, 150 x 45 | `round2/baseline/live-150` |
| Before, 110 x 40 | `round2/baseline/live-110` |
| 17.7.0, 150 x 45 | `round2/after/live-150-4a9ade00-1`, `-2`, `-3` |
| 17.7.0, 110 x 40 | `round2/after/live-110-4a9ade00-1`, `-2`, `-3` |
| 17.7.0 motion frames | `round2/after/motion-4a9ade00` |

## Adversarial review

Six hostile reviews on the same rubric (hierarchy, legibility, consistency, brand, density and truthfulness, motion): 17.5.0 3.5, critique 3 6.2 (fixture frames), critique 4 6.1, critique 5 5.8 and critique 6 5.7 (live frames, harsher basis each round). Critique 6 is in `round2/after/critique-6.md`. Its top findings at 17.7.0:
- The Board shows dispatch rows as done while the store still counts them open.
- The band, the gates tab and the transcript chip name different blockers.
- One agent shows under up to three names across the HUD, cards and the route tab.
- The LAST column leaks raw transcript text.
- The 110-column strip falls back to two-letter tab names.

## What changed

- One ATLAS visual system for the band, the HUD (TODO and SUBAGENTS), the Board and the side panel, shared by Claude Code (`plugins/atlas/mod/`) and omp (`plugins/atlas/omp/`).
- 17.7.0:
  - Run-state truth: the band reads `BLOCKED` with its reason.
  - The last-run worker count comes from real dispatches.
  - Names are shown whole and the lead reads `lead`.
  - The side panel gate tally and fill height.
  - 256-colour painters on stable palette colours, so the navy fill is gone from the HUD.
  - One shared spinner clock.
  - Gate checks re-run within 5 s of a gate change without blocking the poll.
  - The palette cache.
  - Mutation-killing tests for 14 more survivors. The other 10 are shown equivalent in `mod/*.mut.test.ts` comments.

Per-commit detail is in `plugins/atlas/CHANGELOG.md` under 17.7.0.

## Open after 17.7.0

- The five unmet lines above, and the critique 6 findings.
- Stale TODO rows (L3) in 11-14 frames per run and wrong group counts (L7) in 5-9.
- The motion demo renders 24-bit colour even when run with TERM=xterm-256color and no COLORTERM, because `colorMode` reads an unset COLORTERM as truecolor.
