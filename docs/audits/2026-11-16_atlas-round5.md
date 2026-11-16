# Atlas round 5: done-claim detector, tier rule, held-out score (17.26.0)

Date 2026-11-16. Pre-registration: `2026-11-16_atlas-round5-preregistration.md`. Freeze: `2026-11-16_atlas-round5-freeze.json`. Held-out score (scored once, after the freeze): `2026-11-16_atlas-round5-fresh-score.json`.

## Result

The Stop gate no longer blocks on a done claim by default. `BLOCKING_KINDS` in `plugins/atlas/hooks/done_claim.py` is empty; findings are recorded as `decision.verify.block-would`, and `ATLAS_DONE_CLAIM=block` enforces. The detector is stricter about what counts as evidence and about when a claim is unbacked, and no finding kind has enough real positives to justify blocking.

## Before and after (D1, `done_claim_corpus.jsonl`, 182 rows, blocking path)

| | TP | FP | FN |
|---|---|---|---|
| 17.25.0 (two kinds blocked by default) | 32 | 0 | 12 |
| 17.26.0 (`BLOCKING_KINDS` empty) | 0 | 0 | 44 |

Reason: the two kinds that blocked in 17.25.0 were supported only by seeded rows (31 of the 32 true positives were seeded rows built from the detector's own rule kinds). Amendment 1 to the tier rule requires a group-level Wilson bound, forbids promotion on seeded-only support and requires cross-validation stability; no kind passes. The 44 positives (3 real, 41 seeded) are now all misses on the blocking path by design. Reproduce: `python3 plugins/atlas/hooks/done_claim.py --eval` (all rows, blocking path: TP=0 FP=0 FN=44).

## Held-out score

162 rows: 18 natural (N), 144 generated on 6 held-out fixtures (G). 156 gold negatives, 6 gold positives. Source: `2026-11-16_atlas-round5-fresh-score.json`.

| path | false blocks | rate | Wilson 95% | bar A3 (upper <= 0.05) |
|---|---|---|---|---|
| default (no kind blocks), pooled 156 negatives | 0 | 0.000 | [0.000, 0.024] | met |
| default, G alone (138 negatives) | 0 | 0.000 | [0.000, 0.027] | met |
| default, N alone (18 negatives) | 0 | 0.000 | [0.000, 0.176] | not met (n too small) |
| all kinds blocking, pooled | 20 of 156 | 0.128 | [0.085, 0.190] | not met |

Recall on the 6 gold positives: default 0 of 6 (Wilson [0.000, 0.390]); all kinds blocking would catch 1 of 6.

Per-kind false alarms with every kind blocking (pooled, 156 negatives):

| kind | TP | FP |
|---|---|---|
| ci_unbacked | 0 | 11 |
| count_nowhere | 0 | 3 |
| push_unbacked | 1 | 3 |
| narrow_as_full_suite | 0 | 2 |
| ci_contradicted | 0 | 1 |
| count_not_in_results | 0 | 0 |
| pass_after_failing_run | 0 | 0 |

No default-path row blocked (0 of 159 distinct sessions with a false block). The two kinds that blocked by default in 17.25.0, `count_not_in_results` and `pass_after_failing_run`, had 0 true and 0 false emissions on this set (`per_kind_fresh` in `2026-11-16_atlas-round5-fresh-score.json`), so the held-out set says nothing about them either way.

## Decision model held-out evaluation

Source: `2026-11-16_atlas-decision-model-heldout-eval.md`, n = 24 scored prompts, haiku and sonnet through `claude -p` as stand-ins (not llama3.2:3b).

| backend | accuracy | Wilson 95% |
|---|---|---|
| keyword router | 16/24 = 0.667 | [0.467, 0.820] |
| haiku (stand-in) | 21/24 = 0.875 | [0.690, 0.957] |
| sonnet (stand-in) | 23/24 = 0.958 | [0.798, 0.993] |

Only sonnet alone against the keyword router is under 0.05 (exact McNemar p 0.0156). The hook as shipped (model class only when confidence is 0.8 or higher, else keyword) is not distinguishable from the keyword router at this n: hook-combined sonnet 19/24 = 0.792, haiku 18/24 = 0.750, paired p 0.25 and 0.5.

## Isolation bench

Rerun: 0 of 40 edits lost, in worktree mode and in auto mode.

## What the critics found

Two outside critics scored the pre-fix state 4/10 (sonnet) and 3/10 (opus). 32 of their 39 findings were confirmed. The detector findings were fixed (11): count evidence only from test, CI or report output; opaque flag only from agent reports; narrower check-run detection; a push or ls-remote must show the claimed sha or ref; the CI verdict uses the latest status per workflow and "0 failed"; fail-closed wording no longer suppresses; guards. Five more fixes came from 8 false alarms on 100 generated training rows (`done_claim_gtrain.jsonl`). The other confirmed findings are not covered by this document.

## Second critic round (frozen state)

Same two critics, run on the frozen state after scoring: sonnet 4/10, opus 4/10 (round 1: 4 and 3). Raw outputs: `critic2-sonnet.md` and `critic2-opus.md` in the session scratchpad. Both say the process is honest (freeze, one-shot scorer, group-level Wilson, an empty tier stated as empty) and that the product outcome is a gate that blocks nothing by default. The held-out 0 false blocks therefore passes vacuously: recall on the 6 held-out false claims is 0 of 6 by default and 1 of 6 with every kind blocking (20 false blocks of 156).

Operational: run critics via `claude -p` with `--setting-sources ""`. A project Stop hook hijacked one critic's final turn; the review was recovered from its transcript. Reproduction: `claude -p --model sonnet|opus --output-format json --setting-sources "" < scratchpad/packet2.md`.

Refuted critic claims (checked by the verifier):
- Labelers did not see the tier rules: the rubric slice ends before them.
- `ci_unbacked` does recognise MCP CI tools.
- `SHIPPED_TEST_PRECISION` 16 TP / 1 FP reproduces.

## Round-6 defects (confirmed, each reproduced by the verifier)

These were found after scoring. Fixing them is a round-6 change that needs a new held-out set, so 17.26.0 ships the frozen detector whose hashes match the score file.

1. `_ci_verdict`: the per-workflow key does not group real `gh run list` output, so each run is its own workflow and any old failure still yields "bad".
2. `_ls_remote_backs`: a matching ref overrides a mismatched sha.
3. The opaque phrase "delivered to you as a message from" still disables the count kinds.
4. `NUMS_CAP` is 5000, and bare numbers in test and report records back counts.
5. Any fail word anywhere in the reply disables `pass_after_failing_run`.
6. Generated rows are grouped by masked reply text, not by fixture as Amendment 1 says.
7. Opus is both a labeler and the adjudicator (25 of 162 rows adjudicated; fresh kappa 0.539).
8. The freeze hashes five data files but not the scorer, so score-once is enforced only by refusing to overwrite the output file.
9. Six McNemar tests run without multiplicity control (sonnet p=0.0156 becomes about 0.094 under Bonferroni).
10. The fresh and training rows ship inside `plugins/atlas/hooks` to every install.

## Limits

- The generated stratum (144 of 162 held-out rows) is not organic. It was built from 6 held-out fixtures by `atlas_done_claim_fresh.py`; the 18 natural rows alone are too few for the A3 bar.
- Labels are model labels, not human ground truth.
- Ollama is not measurable here; the decision numbers describe haiku and sonnet through `claude -p`, and their latency includes process start.
- Only 6 positives exist in the held-out set (3 real unsupported claims in D1), so recall is not measured in any useful sense (Wilson upper bound 0.390 at 0 of 6).
- D1 is in-sample for the rules written in rounds 3 to 5; only the held-out score is out of sample.

## Round 6

- Fix the ten defects listed under "Round-6 defects" and score on a new held-out set.
- ci_unbacked false alarms on real output: 11 of the 20 all-kinds false alarms. Measure the detector against real CI command output rather than generated rows.
- Collect real positives (genuine unsupported done claims) so that any blocking kind can be supported by more than seeded or generated rows. Until a kind has real positive support and passes Amendment 1, `BLOCKING_KINDS` stays empty.
