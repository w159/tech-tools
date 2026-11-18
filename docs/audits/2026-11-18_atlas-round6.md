# Atlas round 6: done-claim detector fixes and the single held-out score (2026-11-18)

Branch atlas/round6. Protocol: `docs/audits/2026-11-18_atlas-round6-preregistration.md` (including section 15). Score: `docs/audits/2026-11-18_atlas-round6-fresh-score.json`. Freeze: `docs/audits/2026-11-18_atlas-round6-freeze.json`. Labels are model labels, not human ground truth.

## Summary

- Round 6 fixed the 10 round-5 defects, with a regression test named for each (table under Defects), and found and fixed 4 more.
- The corpus produced 2 agreed false done-claims (1 TRAIN, 1 HELDOUT). No kind reached the 9 all-TP groups that the tier rule needs, so `BLOCKING_KINDS` stays empty.
- Held-out score, scored once: 0 false would-blocks on 80 gold negatives, Wilson95 [0, 0.04582]. Recall is 0 of 1. The real pool is empty.
- The coordinator's aim that at least one check earns blocking with measured precision was not met.

## What changed

Commits on atlas/round6 (`git log --oneline origin/main..HEAD`), oldest first:

| Commit | Subject |
|---|---|
| 711aa06c | preregistration, freeze and Holm code, defect tests, data moved to evals/ |
| 000078ca | done-claim defects 1-6 fixed, freeze hashes scorer, positives builder, first generated rows |
| a16e1f8c | preregistration amendment 2, corpus moved to evals/ |
| 903d831b | push claims need the named ref to hold the sha, fail words must be about the claimed run, corpus loads only from evals/ |
| 64d27a0a | second fixture manifest (125 fixtures, 250 runs), rows relabeled agree-only, train and held-out rebuilt |
| 0c8b8f17 | disable rules 1a/1b, r6_train loader guard, newest-run CI rule, scorer emits prereg H1-H4 |
| 6edd253f | CI newest run per workflow: createdAt then run id for --json, print order for tables; workflow-scoped CI claims |
| 2ca87eb8 | isolation import in positives test, m1 carry test accepts dcm2 ids, reference script count 89 |
| 16a3bfd4 | freeze record: 1069 files hashed, blocking_kinds empty |
| c0d435d1 | the single held-out score |

Test status as reported by the lead (not re-run by this document's author): before the freeze, hooks 3494 passed 2 failed and scripts 6484 passed 1 failed; those 3 failures were fixed in 2ca87eb8, and the hooks half then ran 3496 passed 0 failed. 921 gate tests pass; 17 of 17 independent CI probes pass. The scorer emits every pre-registered metric (66 of 66 fields matched an independent recompute on a synthetic file).

## Corpus

- 150 fixtures (25 in manifest.json, 125 in manifest_m2.json per 64d27a0a), run with `claude -p`.
- Spend: sum of `total_cost_usd` over `evals/done_claim/fixtures/spend_ledger.jsonl` is USD 10.5068 across 397 priced lines, of a USD 15 cap (prereg section 6). 4 lines read "CLI reported no cost". The ledger has 401 lines: 323 with kind `gen` and 78 with kind `label`. Of the 323 generation calls, 12 are pilot calls (never labeled, Amendment 2a), 204 are tagged as completed and 107 are tagged "failed" (the `claude -p` call did not return a usable final reply). An earlier draft of this round's status said 299 runs; the ledger does not support that number, and the counts above replace it.
- Rows scored: TRAIN 104, HELDOUT 81 (`r6_train.jsonl` `_header`: rows_built 156, rows_scored 104, rows_m1_carried 20, rows_m2_built 132, rows_m2_scored 84; HELDOUT count from the score file H1).
- Agreed false done-claims (both labelers sonnet and opus, agree-only): 2 rows. One TRAIN (dcm2-083, family ci_failing). One HELDOUT (family none, a clean twin with no record signal).
- Exclusions: construction conflicts 66 combined, 32 TRAIN (`r6_train.jsonl` `_header`) plus 34 HELDOUT (score file H4). Disagreements 49 combined, 20 TRAIN plus 29 HELDOUT. Unlabeled 0 in both.
- Real-transcript mining yielded no usable rows on this machine (prereg amendment 2c).

## Selection on TRAIN

Prereg section 7 with Amendment 1 selects no kind. No kind reaches 9 groups with an emission that are all true positive. `BLOCKING_KINDS` is empty in the freeze file and the score file (`blocking_kinds: []`). Two independent computations agreed (lead's report).

## Held-out score

Scored once at 2026-11-18T18:46:55Z, after the freeze at 18:46:41Z (freeze commit 16a3bfd4 precedes score commit c0d435d1).

| Metric | Result | Bar or reference |
|---|---|---|
| H1 generated | 0 false blocks of 80 gold negatives (81 rows, 51 groups), Wilson95 [0, 0.04582] | B1 needs exactly 0 on real negatives; A needs n >= 73. Attainable for generated (80). |
| H1 real | 0 rows in every stratum (N, B, F); no rate, not attainable | B1 vacuous on real; A not met (0 < 73) |
| H2 | n 1, no kind ships, recall 0 of 1 by default | No recall bar |
| H3 all-kinds, generated and pooled | 0 would-blocks on 80 negatives, [0, 0.04582]; recall 0 of 1, Wilson95 [0, 0.793457]; every kind tp 0 fp 0 | Reference only, not shipped behavior |
| H3 by family (negatives, k of n) | ci_failing 0 of 1; count_unreached 0 of 12; failing_tests 0 of 17; narrow_run 0 of 4; none 0 of 22 (1 positive, recall 0 of 1); push_rejected 0 of 24 | Reference only |
| H4 labelers | 144 voted, agreement 0.799 (115 of 144), Cohen kappa 0.624, excluded 29 disagreement + 0 unlabeled + 34 construction conflict = 63, gold 1 positive and 80 negative | Round 5 fresh kappa was 0.539 |

Zero held-out rows received any advisory kind. B5: one score file; the scorer's hash check passed at scoring time. This document did not independently recompute the hashes.

## Defects

Status is from the round-5 list ("Round-6 defects" in `docs/audits/2026-11-16_atlas-round5.md`). Commit is the commit whose subject covers it; a per-defect commit was not isolated for every row.

| Id | Defect | Status | Commit | Test |
|---|---|---|---|---|
| 1 | `_ci_verdict` grouping on real `gh run list` output | fixed | 000078ca, 6edd253f | `test_done_claim.py:790` gh_run_list_groups_by_workflow_name_and_latest_run_decides; `:823` to `:926` newest-run tests |
| 2 | `_ls_remote_backs`: ref overrides mismatched sha | fixed | 903d831b | `test_done_claim.py:252` to `:267` |
| 3 | opaque phrase disables count kinds | fixed (disable only with an `_inj` record) | 000078ca | `test_done_claim.py:970`, `:975` |
| 4 | `NUMS_CAP` and bare numbers back counts | fixed | 000078ca | `test_done_claim.py:982`, `:986`, `:994` |
| 5 | any fail word disables `pass_after_failing_run` | fixed (must refer to the claimed run) | 903d831b | `test_done_claim.py:998`, `:1003` |
| 6 | generated rows grouped by masked reply text | fixed (group by fixture) | 000078ca | `test_done_claim.py:1013`, `:1026` |
| 7 | opus both labeler and adjudicator | fixed by prereg section 6 (agree-only, no adjudication), built in `atlas_done_claim_positives.py` | not isolated in the log | `test_atlas_done_claim_positives.py:149` (two calls, no adjudication), `:178` (kappa includes disagreements) |
| 8 | freeze hashes only five data files | fixed (every scored file; scorer refuses on mismatch or existing output) | 711aa06c, 000078ca | `test_atlas_done_claim_fresh.py:438` to `:556` |
| 9 | McNemar tests without multiplicity control | fixed (Holm) | 711aa06c | `test_atlas_decision_eval.py:198`, `:208` |
| 10 | done-claim data shipped in the plugin | fixed (moved to `evals/done_claim`, loaders return [] when absent) | 711aa06c, a16e1f8c, 903d831b | `test_done_claim.py:612`, `:639` |

Defects found and fixed during round 6:

| Defect | Commit | Test |
|---|---|---|
| `pass_after_failing_run` disable rule 1a: an elsewhere marker shared with the pass claim names the claimed system | 0c8b8f17 | `test_done_claim.py:1110`, `:1119` |
| Disable rule 1b: clause-level subject | 0c8b8f17 | `test_done_claim.py:1069`, `:1080` |
| `r6_train` loader accepted a non-train row | 0c8b8f17 | `test_done_claim.py:616` |
| CI rule gap exposed by the one TRAIN positive (dcm2-083): newest run per workflow decides, by createdAt then run id for gh --json, print order for tables | 0c8b8f17, 6edd253f | `test_done_claim.py:852` to `:926` |

The prereg B3 check (each test fails on the `0da40153` module and passes on the final one) was not re-run for this document.

## Limits

- The m1 scratch worktree was deleted before commit, so the m1 `runs.jsonl` and label cache were lost; m1 rows were carried from the committed r6 files.
- m1 push fixtures 01 to 04 used the earlier push checker.
- m2 rows use the `dcm2-` id prefix, where the prereg said `dcp-`.
- The spend ledger has no timestamps, so the preregistered ordering of spend against the manifest post cannot be shown from it.
- The ci_failing fixture stub prints run ids in inverted order, which real gh does not.
- 66 construction conflicts mean many seeded faults were invisible in the tool records.
- The held-out set has no real rows, so H1 real and the real strata are not attainable. Only 1 gold positive exists, so recall has no usable interval (upper bound 0.793).
- The round-5 freeze's `done_claim.py` hash no longer matches, because round 6 changed the detector after round 5's one-shot score. The round-5 data files still match their hashes.
- One vendor labels and writes the code; HELDOUT non-access is attested, not enforced (prereg section 12).

## Outcome against the preregistration

- B1: no false blocks on real negatives, but the real pool has 0 rows, so B1 is vacuous. `BLOCKING_KINDS` is empty, so the shipped path blocks nothing by construction.
- A: real gold negatives 0 < 73, so the 0.05 bound is unattainable on the real pool. On the generated pool n = 80 and the upper bound is 0.04582.
- B4: the shipped set (empty) equals the freeze record's set (empty).
- B5: frozen and scored once, freeze commit before score commit.
- Q2 expectation (most likely no kind earns blocking) held.
- Not met: that at least one check earns blocking with measured precision. Frontier models given these seeded-fault fixtures almost never produced a false done-claim that both labelers agreed on (2 of 185 scored rows, TRAIN 104 plus HELDOUT 81), so no kind could reach 9 all-TP groups. The preregistration predicted this as the most likely outcome.
- Established: on 80 held-out negatives the all-kinds path made 0 false would-blocks (upper bound 4.6 percent), and the detector defects are fixed with tests.

## Next

- Build a corpus from real user transcripts on a machine that has them.
- Write fixtures whose faults show in the tool records (the 66 construction conflicts).
- Add outside critic scores (below).

## Outside critics

Pending: scores from two outside models are added by the lead.
