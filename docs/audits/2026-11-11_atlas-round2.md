# Atlas round 2: before and after against the 200% bar (2026-11-11)

Scope: Jerry's round 2 ask of 2026-11-10 (polished, branded TODO, Subagents, Board and Side panel mods on Claude Code and omp; a reliability sweep of the operating contract, hooks, skills, subagents, tmux, doctor and scripts; a measured improvement of at least 200% with evidence; adversarial review).

Before: atlas 17.5.0 at `c5ef6d71`. After: main at the 17.6.0 release commit (code at `b58d1c1d`).
Raw evidence: `/mnt/project-files/atlas-ui-redesign/round2/` (`metrics.md` holds the metric definitions and before numbers, `baseline/` the before runs, `after/` the after runs and reviews).

## How "200%" is read

200% better is read as a 3x factor on the error side of each metric. The failure count, survivor count, invisible share or gap to a perfect score must fall to 1/3 of its before value or less. Pass counts cannot triple past their cap, so they are tracked as must-not-regress. This reading was fixed in `round2/metrics.md` before any change was made.

## Result

The 3x bar is met on 9 of the 18 lines below that carry a 3x target, not on all of them. Release 17.6.0 does NOT meet "200% on everything". The lines that miss are marked "not met", with their numbers.

| # | Metric | Before (17.5.0) | After | Factor on error side | 3x met |
|---|---|---|---|---|---|
| M1 | Reliability defects that block use or give wrong output | 5 | 0 | all fixed | yes |
| M2 | All ledger reliability items (incl. cosmetic, flake, broken ref) | 11 | 0 open (7 fixed with failing-first tests; D5, D8, D9, D10 shown not to be Atlas defects) | all closed | yes |
| M4 | Mutation survivors, 20 mutants per module, seed 1105 | 51 of 300 (83.0% kill), 15 modules | 28 of 320 (91.3% kill): TS 28 of 260 on 13 modules, Python 0 of 60 | 1.8x | not met (target 17 or fewer) |
| M4a | Same, only the 7 TS modules present in both trees | 24 of 140 | 12 of 140 | 2.0x | not met |
| M5 | TODO tree visibility, 150 cols | 22.5% | 97.8% | 35x | yes |
| M5 | TODO tree visibility, 110 cols | 23.1% | 87.0% | 5.9x | yes |
| M5 | Band task count, 150 cols | 23.0% | 92.7% | 10.5x | yes |
| M5 | Band task count, 110 cols | 26.2% | 78.9% | 3.5x | yes |
| M5 | Running workers on any Atlas surface, 150 cols | 65.4% | 82.8% | 2.0x | not met |
| M5 | Running workers on any Atlas surface, 110 cols | 26.7% | 87.9% | 6.1x | yes |
| M5 | Side panel route tab (both widths) | 0% | 100% | from 0 | yes |
| M5 | Side panel gates tab (both widths) | 66.7% | 100% | to 0 | yes |
| M5 | Side panel team tab, 150 / 110 cols | 100% / 100% | 75% / 100% | regression at 150 | not met |
| M5 | Transcript cards, 150 / 110 cols | 96.9% / 96.5% | 75.0% / 100% | regression at 150 (one duplicate finish card, L15) | not met |
| M5 | Board key (`o`) | no board drawn (null) | 100% at both widths | new | n/a |
| M6 | Events never shown, 150 cols | 14 of 31 (45.2%) | 13 of 44 (29.5%) | 1.5x | not met |
| M6 | Events never shown, 110 cols | 17 of 31 (54.8%) | 7 of 37 (18.9%) | 2.9x | not met |
| M6 | First-appearance lag median / max, 150 cols | 1.22 s / 4.33 s | 1.48 s / 2.58 s | median worse, max better | not met |
| M6 | First-appearance lag median / max, 110 cols | 0.63 s / 5.79 s | 1.58 s / 17.65 s | worse | not met |
| M7 | Hostile design critic, gap to 10 | 3.5 (gap 6.5) | 6.1 (gap 3.9), critique 4 | 1.7x | not met (target 8.2) |
| M10 | Doctor FAIL on the repo | 0 FAIL, 4 WARN | 0 FAIL, 4 WARN | no regression | must-not-regress, held |
| M11 | Render time, bandTree busy-120 median / p95 | 1.065 / 1.975 ms | 0.562 / 1.404 ms | 1.9x faster | must-not-regress, held |

M9 (suites, must not regress): bun `mod omp` 1762 pass before, 2146 pass, 0 fail after; `tsc -p mod/tsconfig.json --noEmit` exit 0; pytest and `check_versions.py` results are in the release note in `docs/CHANGELOG.md`. M8 (hook payload runs, 0 of 39 failing before) was not re-measured as a separate step; the hook test suites run under pytest.

M3 (live UI correctness ledger) is replaced by the per-run defect lists in each run's `metrics.json`, which the scorer writes from the frames. At 150 columns the before run lists 10 UI defect classes (L1, L2, L3, L6, L7, L9, L11, L16, L17, L19) and the after run lists 7 (L3, L6, L7, L9, L11, L22, L23) plus L15; L9 (band worker rows) is by design, because rev 4 moved worker rows into the HUD SUBAGENTS block. Stale rows (L3, L6, L7) still show in 14 of about 290 frames at 150 columns. Not met.

## Live runs

Each run is the real `claude` CLI in tmux on a fixed scenario (three explorers read three files, then the lead closes the plan), recorded frame by frame and scored against the transcript and the board by `round2/tools/live_capture.py`. One run per width per build; the earlier after runs (`after/live-150-8dd03fe7`, `after/live-150-d7e1eca3`) show large run-to-run variance (Subagents lag max 47 s in one run, 3.6 s in the next), so single-run lag numbers are weak evidence.

| Run | Directory |
|---|---|
| Before, 150 x 45 | `round2/baseline/live-150` |
| Before, 110 x 40 | `round2/baseline/live-110` |
| After, 150 x 45 | `round2/after/live-150-b58d1c1d` (`run.gif`, `tab-*.png`, `mod-*.png`) |
| After, 110 x 40 | `round2/after/live-110-b58d1c1d` |

Scorer corrections made during round 2 (each re-applied to the baseline runs, whose scores did not change): board read from the side pane, gate seat count read from the "ran N" figure, agent names taken from the transcript instead of a fixed list, and the route seat truth counted from explorer dispatches only (the 150-column after run also dispatched one runner).

## Adversarial review

Four hostile reviews by fresh `atlas:verifier` critics on the same rubric (hierarchy, legibility, consistency, brand, density and truthfulness, motion): 17.5.0 3.5, critique 3 6.2 (fixture frames), critique 4 6.1 (live frames, harsher basis). Critique 4 is in `round2/after/critique-4.md`. Its top five changes were made in wave 5 (commit d7e1eca3) except real motion with live evidence, replacing the saturated navy fill, and right-edge padding on every tab (blocked by the frozen `contracts/panel-golden.ts`). No critique was run after wave 5, so 6.1 is the latest score.

## What changed

- One ATLAS visual system for the band, the HUD (TODO and SUBAGENTS), the Board and the side panel, shared by Claude Code (`plugins/atlas/mod/`) and omp (`plugins/atlas/omp/`): `mod/atlas-ui.ts` tokens, glyphs, gauges and one count order; `mod/rail.ts` one phase rail; `mod/consistency.test.ts` same-frame checks across surfaces.
- Live truth: the TODO block shows every row the height allows; the band header reads blocked when a gate is blocked or a check fails; hash-like agent names become the description name or the agent type; the side panel route row counts agents that ran; toasts take facts from structured data only.
- Reliability: DELIVERABLE(S) label accepted by the tripwire, read-profile workers can post board notes, `atlas_mux.py wait` reports member failures and timeouts, workers get `--plugin-dir` when atlas is not installed, the doctor no longer headlines warnings as healthy, read-only audit dispatches are not team-gated.
- Mutation-killing tests in `mod/*.edges.test.ts`, `mod/mission-layout.test.ts` and `scripts/test_atlas_mux.py`.

Per-commit detail is in `plugins/atlas/CHANGELOG.md` under 17.6.0.

## Open after 17.6.0

- Motion is limited to the spinner and eased gauges; no live recording shows a state change animating.
- Stale TODO rows in about 5% of frames during fast plan updates.
- Side panel tabs still fill only the top part of the pane; right-edge padding blocked by the frozen golden contract.
- The 110-column layout docks no side panel, so the side panel Subagents check is not scorable there.
- 28 TS mutation survivors on the final tree, per module (band 3, board-model 4, sidebar-model 4, sidebar 6, panel-layout 4, mission-layout 3, hud 2, crew 1, hud-surface 1).
