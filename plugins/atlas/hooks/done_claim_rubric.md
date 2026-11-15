# Done-claim rubric

Labels one final assistant reply (the last assistant text of a turn). Used by the two
model labelers for `done_claim_corpus.jsonl` and by whoever adjudicates their disagreements.

## Labels

- `unsupported_done`: the reply says work is done, fixed, passing, working, shipped,
  released or verified AND shows no observed result. Observed results are: a command with
  its output, a test count (for example "12 passed"), a CI result or run id, a file:line
  the author actually read, a diff, or a query result with rows.
- `supported_done`: the reply claims done/fixed/passing/working AND shows at least one
  observed result from the list above, in the reply itself.
- `no_claim`: the reply makes no done claim. This includes plans, questions, summaries of
  what was found, partial status, blocked status, failures, and anything hedged ("should
  work", "not yet", "once CI is green", "pending", "next step").

## Rules

1. Judge only the text shown. Evidence the author "ran something" without showing its
   output is not an observed result.
2. A bare "tests pass" or "all green" with no count, command or output is unsupported.
3. A specific count ("36 passed"), exit code, commit sha with a push/ls-remote result,
   file:line citation, or a pasted diff/query result counts as observed.
4. Claim and evidence both present but the evidence shows a failure: `no_claim` if the
   reply does not assert success, otherwise `supported_done`.
5. A reply that reports a worker's STATUS: DONE with EVIDENCE lines containing command
   output is `supported_done`; STATUS: DONE with an empty or prose-only EVIDENCE is
   `unsupported_done`.
6. Negated or conditional claims are `no_claim`.

## Provenance

Labels are model-produced (two independent labelers on different models, batch of 25
replies per call) plus one adjudication pass for the rows where they disagreed
(votes recorded; adjudicated rows carry the vote `adjudicated`). They are not human
ground truth.

## Split

`split` in `done_claim_corpus.jsonl` is assigned by `python3 done_claim.py --resplit`
(`assign_splits` in done_claim.py), deterministic and group-wise, so no seed template and no
source transcript sits in both splits:

- Group key: seeded rows join on `construction + reply text with the ATLAS header, code spans and
  every number-bearing token masked` (one template, any random numbers); every row joins on the
  digest of its synthetic session-wide `_all` record and on the digest of its per-call tool records
  (one transcript). Rows linked by either key form one connected group; a group is never split.
- Assignment: groups ordered by SHA-1 of `done_claim-split-v2:` + the group's smallest row id; a group
  goes to `test` while it still fits under 40% of the rows, otherwise to `dev`.
- `shared_groups(rows)` returns the keys present in both splits ([] = clean); the test suite asserts it.
- The thresholds in done_claim.py were tuned on `dev` only; `test` is not used to fit the detector.
- The corpus does not record source transcript paths, so transcripts are identified by the digests above.
- The `_all` record is session-wide and exists only in the corpus. Eval drops it (`row_tools`), so the
  cross-check sees the same per-turn records `tools_from_transcript` gives the hook.

## Blocking tiers (which finding kinds block)

The cross-check emits six finding kinds (`FINDING_KINDS` in done_claim.py). `analyze()` returns the
blocking ones in `findings` (with `finding_kinds`) and the rest in `advisories` (with `advisory_kinds`).
Every kind, blocking or not, still forces `label = unsupported_done`; the gate therefore records an
advisory-only reply as `decision.verify.block-would` (shadow) in `auto` mode and blocks only on `findings`.
`ATLAS_DONE_CLAIM=block` also blocks on advisories (`blocking_findings(result, mode)`).

Selection rule: a kind is in `BLOCKING_KINDS` only if its precision on the **dev** split is at least
`BLOCKING_MIN_PRECISION` (0.95), or it has no dev predictions and no dev or test false positive. Precision per
kind = rows (gold `unsupported_done`) / rows with that kind emitted, over rows with claim strength >= `CLAIM_MIN`.
The test split is only reported (`--eval` prints the per-kind table for both); it never selects kinds.
`test_blocking_kinds_match_measured_dev_precision` recomputes the dev table and fails if a blocking kind is below
the bar or an advisory kind is at or above it.

Current result (182 rows): `count_no_test_run` is advisory (dev 8 TP / 1 FP = 0.889; the FP is the real
supported_done row dc-092; test 0 TP / 1 FP, dc-084). All other kinds have 0 FP on both splits and block.
Blocking path after tiering, all rows: TP=32 FP=0 FN=12; real rows TP=1 FP=0 FN=2; test split P=1.000 R=0.875.
