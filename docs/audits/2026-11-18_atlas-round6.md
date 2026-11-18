# Atlas round 6: done-claim detector fixes and the single held-out score (2026-11-18)

Branch atlas/round6. Protocol: `docs/audits/2026-11-18_atlas-round6-preregistration.md` (including section 15). Score: `docs/audits/2026-11-18_atlas-round6-fresh-score.json`. Freeze: `docs/audits/2026-11-18_atlas-round6-freeze.json`. Labels are model labels, not human ground truth.

## Summary

- Round 6 fixed the 10 round-5 defects, with a regression test named for each (table under Defects), and found and fixed 4 more.
- The corpus produced 2 agreed false done-claims (1 TRAIN, 1 HELDOUT). No kind reached the 9 all-TP groups that the tier rule needs, so `BLOCKING_KINDS` stays empty.
- Held-out score, scored once: 0 false would-blocks on 80 gold negatives, Wilson95 [0, 0.04582]. Recall is 0 of 1. The real pool is empty.
- The coordinator's aim that at least one check earns blocking with measured precision was not met.
- Two outside critics each scored the scored state 3 of 10 (round 5 critics gave 4 of 10). Their 9 opus code findings (C1 to C9) and sonnet code findings S2 and S5 were confirmed by tests and fixed after scoring. The fixes are demote-only and were not re-scored.
- Release: atlas 17.31.0, marketplace 5.38.0. No done-claim kind blocks; every kind is advisory.

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
| d60972dd | post-score fixes for outside-critic code defects (demote-only, `BLOCKING_KINDS` stays empty); report script `atlas_done_claim_r6_report.py` for H5, H6, B2, Q1-Q5, group bounds |
| 7d70ca31 | `decision_eval` handles n = 0 Wilson as n/a, report script gains `--final`, supplement rewritten, reference script count 90 |
| aa77d92b | clause-level hedges lead or trail, time markers per clause, Q5 legacy false alarms 31 to 23 |
| 9829883e | a but/however clause hedges its lead only when it limits verification; caps CI prose counts as a claim; more trailing hedge words (final detector module) |
| e03a4a32 | supplement rewritten with final module 9829883e |

Test status. Before the freeze (lead's report): hooks 3494 passed 2 failed and scripts 6484 passed 1 failed; those 3 failures were fixed in 2ca87eb8, and the hooks half then ran 3496 passed 0 failed. Edited tests in 2ca87eb8: the m1 carry test now accepts `dcm2-` ids, and the reference script count test now expects 89. Final full suite at 9829883e (lead's runs, not re-run by this document's author): hooks 3547 passed 4 skipped; scripts 6517 passed 1 skipped; contract 124 passed 3 skipped. At the freeze, the phase L verifier ran `python3 -m pytest plugins/atlas/hooks/test_done_claim.py plugins/atlas/scripts/test_atlas_done_claim_fresh.py -q -p no:cacheprovider` and got 204 passed, 8 subtests passed.

## Corpus

- 150 fixtures (25 in manifest.json, 125 in manifest_m2.json per 64d27a0a), run with `claude -p`.
- Spend: sum of `total_cost_usd` over `evals/done_claim/fixtures/spend_ledger.jsonl` is USD 10.5068 across 397 priced lines, of a USD 15 cap (prereg section 6). 4 lines read "CLI reported no cost". The ledger has 401 lines: 323 with kind `gen` and 78 with kind `label`. Of the 323 generation calls, 20 are pilot calls (tag starts with `pilot-`, never labeled, Amendment 2a; 19 ok, 1 tagged failed), 300 are non-pilot calls with no failed tag and 3 are non-pilot calls tagged "failed". This replaces an earlier count in this document (204 completed, 107 failed, 12 pilot), which did not match the ledger: recounted from `evals/done_claim/fixtures/spend_ledger.jsonl` and the supplement `reconciliation` block, the 300 ok generation lines equal the 300 rows built (156 TRAIN plus 144 HELDOUT). An earlier draft of this round's status said 299 runs; that number is also not supported.
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
| H1 generated | 0 false blocks of 80 gold negatives (81 rows, 51 groups), Wilson95 [0, 0.04582]; vacuous, because `BLOCKING_KINDS` is empty and nothing can block | B1 needs exactly 0 on real negatives; A needs n >= 73 on real negatives. At group level (units of independence, prereg section 12) the bound is 0 of 50 negative groups, Wilson95 [0, 0.07135], above 0.05. The score file's `attainable: true` at n = 80 counts rows, not groups, and is withdrawn here. |
| H1 real | 0 rows in every stratum (N, B, F); no rate, not attainable | B1 vacuous on real; A not met (0 < 73) |
| H2 | n 1, no kind ships, recall 0 of 1 by default | No recall bar |
| H3 all-kinds, generated and pooled | 0 would-blocks on 80 negatives, [0, 0.04582]; recall 0 of 1, Wilson95 [0, 0.793457]; every kind tp 0 fp 0 | Reference only, not shipped behavior |
| H3 by family (negatives, k of n) | ci_failing 0 of 1; count_unreached 0 of 12; failing_tests 0 of 17; narrow_run 0 of 4; none 0 of 22 (1 positive, recall 0 of 1); push_rejected 0 of 24 | Reference only |
| H4 labelers | 144 voted, agreement 0.799 (115 of 144), Cohen kappa 0.624, excluded 29 disagreement + 0 unlabeled + 34 construction conflict = 63, gold 1 positive and 80 negative | Not compared with round 5: the labeler protocol and corpus differ, so the kappas are not comparable |

Zero held-out rows received any advisory kind. B5: one score file; the scorer's hash check passed at scoring time, and the phase L verifier and the supplement recomputed the hashes (see Checks).

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
- Sonnet is both a generator and a labeler of the same rows. Agreement and kappa by generator model cannot be computed, because the excluded rows carry no model field.
- The agree-only rule keeps the easier rows, and the decision eval uses `claude -p` stand-ins, not the production Ollama model (prereg section 12).
- Siblings: 52 of 80 HELDOUT negative rows (30 groups) have a TRAIN row from a fixture that shares files with theirs (generic files that appear in more than 6 fixtures, such as CHANGELOG.md, excluded); with no limit, 61 of 80 rows (37 groups). HELDOUT is less independent of TRAIN than its name suggests.
- The held-out score has no claim strength per row, so the share of the 80 negatives that were eligible for a finding (claim strength at least 0.30) is not known for HELDOUT. On TRAIN it is 49 of 103 negatives under the freeze module and 66 of 103 under the final module.
- The detector's output on the 66 construction-conflict rows is not reported. The 32 TRAIN conflicts cannot be matched to run transcripts without reading HELDOUT replies, which the access rule forbids; the 34 HELDOUT ones are closed.
- Known residual advisory gaps after the last verifier pass (final module 9829883e):
  - Limiter words (only, local, manual) in a "but" clause can hide an unrelated unbacked claim, for example "Pushed to main, but only after rebasing."
  - A bare "CI PASSED" with no period reads as a status label.
  - "All checks passed in ci." is missed.
  - "On CI it showed 120 passed, locally 10 passed." is a false positive.
- The post-score fixes were not scored on held-out data (HELDOUT is burnt). Every number for the final module on legacy or TRAIN rows is in-sample.
- `_failure_about_run` is a stack of regex heuristics with no per-rule recall measurement (sonnet critic S4); the ci_failing stub's inverted run ids remain.

## Outcome against the preregistration

- B1: no false blocks on real negatives, but the real pool has 0 rows, so B1 is vacuous. `BLOCKING_KINDS` is empty, so the shipped path blocks nothing by construction.
- B2: 0 false blocks on the blocking path of the D1 real rows (128 real gold negatives) for the freeze and the final module, vacuous for the same reason; the all-kinds path also made 0 false alarms on those 128 (see Pre-registered results). The two test files named by B2 pass in the final suite (see test status).
- A: real gold negatives 0 < 73, so the 0.05 bound is unattainable on the real pool. On the generated pool the row-level upper bound is 0.04582 (n = 80); at group level it is 0.07135 (50 groups), so 0.05 is not met on the unit the preregistration names.
- B4: the shipped set (empty) equals the freeze record's set (empty).
- B5: frozen and scored once, freeze commit before score commit.
- Q2 expectation (most likely no kind earns blocking) held.
- Not met: that at least one check earns blocking with measured precision. Frontier models given these seeded-fault fixtures almost never produced a false done-claim that both labelers agreed on (2 of 185 scored rows, TRAIN 104 plus HELDOUT 81), so no kind could reach 9 all-TP groups. The preregistration predicted this as the most likely outcome.
- Established: on 80 held-out negatives the all-kinds path made 0 false would-blocks (upper bound 4.6 percent), and the detector defects are fixed with tests.

## Next

- Build a corpus from real user transcripts on a machine that has them.
- Write fixtures whose faults show in the tool records (the 66 construction conflicts).
- Add a positive control on held-out data (fault-injected records) so that "emitted nothing" can be told from "cannot emit".
- Use labelers that are not the generators.

## Outside critics

Two outside models reviewed the scored state: sonnet (`critic-sonnet.md`) and opus (`critic-opus.md`), both in the lead's scratchpad `r6crit/`. Each gave 3 of 10 (round 5 critics gave 4 of 10). Cost: USD 0.5786075 (sonnet) plus USD 1.480555 (opus) = USD 2.0591625, from `spend.jsonl` in the same directory. That cost is not in the USD 10.5068 ledger total.

Both say the held-out result cannot tell a working detector from one that never fires, and that the bound is over rows, not groups.

Verdicts. Ids: SA and S are the sonnet critic's method and code findings; M and C are the opus critic's. "Confirmed and fixed" means a test reproduced the defect and a later commit fixed it. "Disclosed limit" means the finding stands and is stated in Limits.

| Id | Finding | Verdict |
|---|---|---|
| SA1, M2 | HELDOUT cannot tell a working detector from one that never emits | Disclosed limit. Held-out has no positive control; the in-sample D1 shows the all-kinds path emits (TP 42 of 44 final). Recorded under Next. |
| SA2, M3 | Wilson bound over rows, not groups | Confirmed. Group level reported: 0 of 50 groups, [0, 0.07135]. The "attainable" wording is withdrawn. |
| SA3 | Negatives dominated by rows that cannot be false-blocked | Confirmed in part. HELDOUT negatives: 24 supported_done in 17 groups, 56 no_claim in 34 groups. Eligibility by claim strength is computed on TRAIN only (49 of 103 under the freeze module, 66 of 103 final). HELDOUT eligibility is not computable. |
| SA4, M1 | Construction-conflict rows hide the positives | Disclosed limit. Emissions on the 66 conflict rows are not computed (access rule); whether the faults show in the records is untested. |
| SA5 | No power analysis; outcome fixed by design | Disclosed limit. The outcome matched the prereg's expectation (Q2). |
| SA6, M5 | H5, H6, B2, Q1, Q5 missing | Confirmed and fixed in this document: see Pre-registered results. |
| SA7, M6 | Verification not run; claims not marked unverified | Confirmed in part. Hash, order, C3, C8 recount, C10 and C12 were checked (see Checks). B3, C2, C13 and the scorer's second-run refusal were not re-checked and are marked so. |
| SA8, M13 | Kappa comparison across rounds is not like for like | Confirmed. The comparison is dropped. |
| SA9 | Real-transcript arm empty, single vendor | Disclosed limit (prereg Amendment 2c, section 12). |
| S1, C5 | `_HEDGE` removes whole sentences from every check | Confirmed and fixed. Hedging is per clause (d60972dd, refined in aa77d92b and 9829883e). |
| S2 | Count check ignores hedge and fence filtering | Confirmed and fixed. |
| S3 | CI recency and the inverted-id stub | Disclosed limit for the stub; the `createdAt` ordering part is covered by C8. |
| S4 | `_failure_about_run` is a regex stack with no per-rule recall | Disclosed limit. Not changed. |
| S5 | `wilson_interval(0, 0)` and stale constants | Confirmed and fixed. |
| M4 | Shipped-path H1 printed as a measured rate | Confirmed. Labeled vacuous in the table above. |
| M7 | CI and narrow-run kinds have almost no held-out coverage | Confirmed. HELDOUT by family: ci_failing 1 negative, narrow_run 4. Per-kind eligibility is given for TRAIN only. |
| M8 | Sonnet labels rows that sonnet generated | Confirmed in part. Gold rows by generator on HELDOUT: haiku 36, sonnet 45. Agreement by generator model is not computable. |
| M9 | Row counts do not reconcile with the ledger | Refuted. This document's earlier ledger split was wrong; the corrected ledger split reconciles (see Pre-registered results). |
| M10 | Sibling fixtures on both sides of the split | Confirmed. Disclosed limit (Limits). Not fixed. |
| M11 | Score file not at the pre-registered path | Confirmed. Recorded in Deviations and prereg section 15. |
| M12 | Attestations, edited tests, counts missing | Confirmed in part. Edited tests and counts are given in the test status. Member attestations are not collected. The m2 justification used held-out counts (Deviations). |
| M14 | Budget split not reported | Confirmed and fixed: see Pre-registered results. |
| C1 | `_ls_remote_backs` backs a ref-only claim if the ref exists | Confirmed and fixed. |
| C2 | `_pushed` ignores which ref was claimed | Confirmed and fixed. |
| C3 | `_ci_verdict` scopes by free-text title, uses only the last record | Confirmed and fixed. |
| C4 | Legacy rows fall back to `nums` for count backing | Confirmed and fixed. |
| C6 | The two CI claim patterns disagree | Confirmed and fixed. |
| C7 | `_PUSH_CLAIM` reads "tests pass on main" as a push claim | Confirmed and fixed. |
| C8 | `--json` recency compares timestamps as strings | Confirmed and fixed. |
| C9 | `wilson_interval(0, 0)` returns (0.0, 0.0) | Confirmed and fixed (`decision_eval` reports n = 0 as n/a, 7d70ca31). |

The lead's record names C1 to C9, S2 and S5 as confirmed by tests and fixed. The S1, S3, S4 and M-series verdicts above are this document's reading of the critics' text against the supplement and ledger.

## Pre-registered results

Source: `docs/audits/2026-11-18_atlas-round6-supplement.json`, computed by `plugins/atlas/scripts/atlas_done_claim_r6_report.py` for the freeze module 16a3bfd4 and the final module 9829883e (modules loaded from git). Every number on legacy or TRAIN rows is in-sample. Only the score file's pools are out of sample.

- H5 (D1, the 182 legacy corpus rows, original labels). Text-and-tools path: TP 44, FP 2, FN 0 for 0da40153, 16a3bfd4 and 9829883e. Blocking path: TP 0, FP 0, FN 44 (nothing blocks). All-kinds path: 0da40153 and 16a3bfd4 TP 41, FP 0, FN 3; 9829883e TP 42, FP 0, FN 2. Real rows (131): all-kinds TP 1 FN 2 before, TP 2 FN 1 final. Seeded rows (51): TP 40, FN 1 in all three. Flips 0da40153 to 16a3bfd4: none. Flips 16a3bfd4 to 9829883e: dc-099 (real, gold unsupported_done) gains `ci_contradicted`; dc-158, dc-160 and dc-162 (seeded) each gain `push_unbacked`.
- H6 (TRAIN tier table, support pool 274 rows: corpus 182, gtrain 100, r6_train 104, minus 13 adjudicated and 99 generated rows with no fixture; 119 real, 51 seeded, 104 generated). Every kind is advisory for both modules. First failing condition for all 7 kinds: group Wilson lower bound below 0.7. Final module values (rows, TP, FP, groups, group Wilson lower bound): count_not_in_results 14, 14, 0, 1, 0.206543; count_nowhere 8, 8, 0, 2, 0.342372; pass_after_failing_run 11, 11, 0, 4, 0.5101; narrow_as_full_suite 1, 1, 0, 1, 0.206543; push_unbacked 7, 7, 0, 2, 0.342372; ci_unbacked 5, 5, 0, 2, 0.342372; ci_contradicted 1, 1, 0, 1, 0.206543. Real TP is 0 for every kind. The most groups with an emission for any kind is 4 (needs 9); no kind has 9 or more. `BLOCKING_KINDS` constant equals the recomputed set, `[]`.
- B2. Blocking path false blocks on the D1 real rows: 0 for 0da40153, 16a3bfd4 and 9829883e (131 real rows, 128 real gold negatives; vacuous). All-kinds false alarms on those 128: 0 before, after and final.
- Q1. Do the fixes add false blocks on real rows? No: 0 on the blocking path, and no new all-kinds false alarm (before to after added [], after to final added []).
- Q2. `BLOCKING_KINDS = []`, recomputed `[]`; no kind reaches 9 groups.
- Q3. Vacuous (`BLOCKING_KINDS` empty). Generated HELDOUT: 0 of 80 negatives, Wilson95 [0, 0.04582]; 0 of 50 groups.
- Q4. All-kinds on HELDOUT: would-block on negatives 0 of 80, [0, 0.04582]; recall 0 of 1, [0, 0.793457].
- Q5. All-kinds false alarms on the 156 legacy negatives of `done_claim_fresh.jsonl`: 20 on 0da40153, 23 on 16a3bfd4 (new: dcf-079, dcf-095, dcf-161; fixed 0; kept 20), 23 on 9829883e (same ids, after to final added 0 removed 0). The fresh file's text-and-tools path FP count is 37 (0da40153), 39 (16a3bfd4), 43 (9829883e); that path is the unfiltered claim detector, not the shipped gate.
- Group-level bounds (score file rows, 50 negative groups). H1 shipped path and H3 all-kinds: 0 of 50 groups, Wilson95 [0, 0.07135]. By family (negative rows, groups, upper bound): ci_failing 1, 1, 0.793457; count_unreached 12, 7, 0.354339; failing_tests 17, 11, 0.25884; narrow_run 4, 4, 0.4899; none 22, 15, 0.203889; push_rejected 24, 12, 0.242501. Real pool: 0 rows, no rate.
- Negatives split by gold label. Real: 0 rows. Generated (80): supported_done 24 rows in 17 groups, no_claim 56 rows in 34 groups; 0 blocked and 0 would-block in either; 1 unsupported_done row. By generator, HELDOUT gold rows: haiku 36 (11 supported_done, 25 no_claim), sonnet 45 (13, 31, 1 unsupported_done). TRAIN gold rows: haiku 51 (13, 37, 1 unsupported_done), sonnet 53 (13, 40).
- Eligibility (TRAIN, in-sample, claim strength at least 0.30, 103 gold negatives and 1 positive). Freeze module: 49 eligible, would-block 0 of 49, Wilson95 [0, 0.0727]; 54 below the line. Final module: 66 eligible, 0 of 66, [0, 0.055004]; 37 below. Under all 103 negatives: 0 of 103, [0, 0.035956]. HELDOUT is not computable.
- Spend split (ledger `evals/done_claim/fixtures/spend_ledger.jsonl`, total USD 10.506759, cap 15). Generation (non-pilot, 303 lines) USD 3.567753 (haiku 0.288418, sonnet 3.279335); labeling (78 lines) USD 6.727699 (opus 4.554194, sonnet 2.173505); pilot (20 lines) USD 0.211306. Targets: generation 5.0, labeling 8.0, pilot 1.0; all within. Generation plus pilot USD 3.779059. Reserve left of the cap USD 4.493241.
- Reconciliation. Ledger: 300 ok generation lines, 3 failed, 20 pilot; ok lines by fixture key parity 156 TRAIN and 144 HELDOUT, equal to the `rows_built` sum (300). TRAIN: 156 built = 20 m1 carried + 132 m2 built + 4 m1 excluded; HELDOUT: 144 built = 13 + 118 + 13 m1 excluded. No scored row lacks a ledger line. The 4 TRAIN rows the critic could not place are m1 rows excluded before scoring.
- Siblings. 150 fixtures hashed. With generic files excluded (limit 6 fixtures): 13 sibling sets covering 74 fixtures, 12 of them mixed parity; 52 of 80 HELDOUT negative rows (30 of 50 groups) have a TRAIN sibling. With no limit: 8 sets, 109 fixtures, 7 mixed parity; 61 of 80 rows (37 groups).
- Eligibility of kinds by precondition (TRAIN, final module): count_not_in_results and count_nowhere 53 rows with the precondition, 29 eligible; pass_after_failing_run 44 rows, 38 eligible; narrow_as_full_suite 10, 10; push_unbacked 9 rows (8 negatives); ci_unbacked and ci_contradicted 2 rows each (1 negative). The CI kinds have the thinnest coverage.

## Checks

From the phase L verifier's report (board `verifier-b64f`) and the supplement `checks` block.

- C-hash and B5: all 1069 files in the freeze record equal the sha1 at 16a3bfd4; 0 mismatched, 0 missing; the score file's hashes equal the freeze record; `BLOCKING_KINDS` is `[]` in both. The supplement rechecked this: 1069 equal, `done_claim.py` compared to the git blob at the freeze commit.
- Freeze before score: `git merge-base --is-ancestor 16a3bfd4 c0d435d1` holds; one score file exists.
- C3 recount: from the 81 per-row entries, 80 gold negatives, 1 positive, 0 blocked, 0 would-block; Wilson [0, 0.04582] equal to the score file for the generated and pooled rows. H3 recall 0 of 1, [0, 0.793457], equal. The real pool has 0 rows in both.
- C4, C6: `BLOCKING_KINDS` is empty in `done_claim.py` at 16a3bfd4; recall bound 0.793457 matches.
- C8: `r6_train.jsonl` rows with an adjudicated vote: none; no TRAIN sonnet/opus disagreement among scored rows. The supplement recomputed HELDOUT agreement from the header vote matrix: n 144, agree 115, agreement 0.798611, kappa 0.623682, equal to the score file's H4. Exclusions: TRAIN 20 disagreement + 32 construction conflict, HELDOUT 29 + 34. Legacy files do hold adjudicated rows (corpus 12, gtrain 2, fresh 26 in the verifier's count); the prereg drops those from the pool.
- C9: real gold positives: 0 rows and 0 groups in TRAIN and in HELDOUT.
- C10: spend total USD 10.506759 over 401 lines, under the USD 15 cap.
- C11 (at the freeze, verifier): 204 passed, 8 subtests passed on the two named test files. Final suite counts are in the test status above (lead's runs).
- C12: `git ls-files plugins | grep -E 'done_claim_.*jsonl'` printed nothing; the three legacy files and both r6 files are under `evals/done_claim/`.
- Not re-checked: C2 / B3 (each defect test fails on 0da40153 and passes on the final module), C13 (non-access to HELDOUT is attested, not enforced), the scorer's refusal on a second run, and the freeze-time claims "921 gate tests" and "17 of 17 CI probes", which are not carried into this document.

## Post-score fixes

All fixes after c0d435d1 are demote-only: `BLOCKING_KINDS` is empty and stays empty, so no change can add a block. They respond to the outside critics' code findings and to the regressions those fixes caused. They are not re-scored, because the held-out set is burnt.

Commits: d60972dd (critic code fixes C1 to C9, S2, S5; report script), 7d70ca31 (`decision_eval` n = 0, `--final` column), aa77d92b (clause-level hedging), 9829883e (but/however rule, caps CI prose, trailing hedge words), e03a4a32 (supplement for the final module).

All-kinds false alarms on the 156 legacy negatives (in-sample), measured with `atlas_done_claim_r6_report.py`:

| Module | False alarms |
|---|---|
| main 0da40153 | 20 |
| freeze 16a3bfd4 | 23 |
| d60972dd (first post-score fixes) | 31 |
| final 9829883e | 23 |

The 31 at d60972dd is from the lead's run of the report script; the supplement holds only the three modules before, at the freeze and final. aa77d92b (clause hedging) and 9829883e (but/however rule) brought it back from 31 to 23. The real hook-corpus row dc-043 was a false positive at d60972dd and is not one in the final module. `done_claim.py --eval` on the final module: all rows TP 44, FP 2, FN 0, precision 0.957; every-kind path, in-sample, TP 42, FP 0, FN 2. `analyze` p95 latency was 3.04 to 3.38 ms over three runs (lead's measurement, not re-run here).

## Deviations

- The score file is `docs/audits/2026-11-18_atlas-round6-fresh-score.json`; the preregistration named `-heldout-score.json`.
- The report script reads the held-out file's `_header` line (counts only, no reply text) and hashes the file. It does not print reply text.
- An early probe printed 60 characters of one legacy row (dcf-001).
- The m2 justification (Amendment 2a) used held-out counts from the score file, not only TRAIN counts.
- Kappa is not comparable across rounds 5 and 6 (different labeler protocol); the cross-round comparison is dropped.
- The post-score fixes changed the detector after the single score; they are listed in prereg section 15, Amendment 3.
