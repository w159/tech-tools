# Atlas round 4: the 12 gaps two outside critics named (2026-11-15)

Status after the second outside review ([2026-11-15_atlas-round4-post-review.md](2026-11-15_atlas-round4-post-review.md)): 2 closed on a narrow scope (gap 2 for the bare-flag path, gap 9 on held-out sonnet only), 7 partly closed, 3 open. Sources: the Sonnet 5.5 critic (12 numbered gaps, used as the list below) and the Opus 5.5 critic (10 gaps, mapped onto the same list). Both are the same vendor's models as the code they reviewed, so this is not independent human review. Evidence numbers were re-run on 2026-11-15 unless marked "from the CHANGELOG".

| # | Gap | Status |
|---|---|---|
| 1 | Decision model did not speak Ollama | partly closed |
| 2 | "Done" was self-attestable | closed for the bare-flag path with stated residuals; (r) still trusts the header |
| 3 | Done-claim check blocked nothing, no numbers | partly closed |
| 4 | No public benchmark | open |
| 5 | Tokens and cost story | partly closed |
| 6 | Routing is a static table | open |
| 7 | No isolation or merge strategy | partly closed (simulation) |
| 8 | Local models are plumbing, not a result | open |
| 9 | Verifier never measured | closed on a held-out tier, sonnet only |
| 10 | Evidence is circular | partly closed |
| 11 | Enforcement may be inert | partly closed (doctor verdict fixed; not shown on a fresh install) |
| 12 | Reporting falls short of the field | partly closed |

## 1. Decision model does not speak Ollama: partly closed

`prompt_decision.ask` now supports `ATLAS_DECISION_PROTOCOL=auto|ollama|systemone` and calls stock Ollama `/api/chat` with a JSON-schema `format`. Evidence: `hooks/test_prompt_decision.py` and `hooks/_decision_stub.py`. Limit: tested only against a stub that follows the documented API. No real model has answered (model downloads are blocked in the build environment). Closing it needs a real Ollama run (ROADMAP).

## 2. "Done" is self-attestable: closed for the bare-flag path, with residuals

A verified finding is credited by gate (b) only when a hook-written record for this session and run backs it: an `atlas:verifier` or `atlas:completeness-critic` dispatch row with `ts` at most `verified_at` + 1 s and a role matching `verified_by`, or a team or crew member record (verifier or completeness-critic role) whose name equals `stamped_by`. A bare `--by atlas:verifier` no longer credits, and the block text no longer suggests `--by`. Test-command credit is an exact canonical match (whitespace collapsed, leading `cd X &&` and env assignments stripped), so `pytest -q --collect-only` no longer satisfies `pytest -q`. Evidence: 11 failing-first tests (`FindingsIdentityBackingTest` in `hooks/test_completion_gate.py`). Residual limits: an in-process verifier still stamps as `lead`, so credit depends on the dispatch row; a lead can pair a real verifier dispatch with a self-stamped row; `ATLAS_WORKER_NAME` can be set by the process environment; an unreadable DB fails open with a stderr line; letter (r) still trusts the model's own header phase. Both outside reviewers had found the earlier design spoofable, so the earlier "closed" verdict was wrong.

## 3. Done-claim check blocked nothing and had no numbers: partly closed

Letter `v` is a deterministic, offline classifier (`hooks/done_claim.py`) that compares claims with this turn's tool results, default `ATLAS_DONE_CLAIM=auto`. Only finding kinds with dev-split precision of 0.95 or better block (`count_not_in_results`, `pass_after_failing_run`, `narrow_as_full_suite`, `push_unbacked`, `ci_unbacked`); `count_no_test_run` (dev 8/9 = 0.889) is an advisory that blocks only with `ATLAS_DONE_CLAIM=block`. Evidence, `python3 plugins/atlas/hooks/done_claim.py --eval`, blocking path: real rows n=131 TP 1 FP 0 FN 2 (precision 1.000, recall 0.333); seeded rows n=51 TP 31 FP 0 FN 10; all rows n=182 TP 32 FP 0 FN 12 (precision 1.000, recall 0.727). Before the second-review fixes the blocking path was all rows TP 30 FP 0 FN 14 and real rows TP 0 FP 0 FN 3. Label metrics on the test split (n=73): precision 0.889, recall 1.000. Text only, all rows: precision 0.913, recall 0.477. Labeler agreement Opus vs Sonnet kappa 0.767. Limits: only 3 real unsupported claims exist in the corpus, so real-world recall is measured on n=3 and real-row precision rests on 1 true positive; 31 of the 32 blocking true positives are seeded rows built from the detector's own rule kinds; labels are model labels, not human ground truth. Text-only predictions are recorded, not blocked. The critics asked for precision 0.95 and recall 0.6 on a held-out set of about 100; the test split is 73 rows, and the corpus was re-split by source transcript and seed template (57 groups, 109 dev, 73 test, no shared group).

## 4. No public benchmark: open

No SWE-bench or Terminal-Bench run exists; hosts were not reachable. What exists: `scripts/atlas_history_bench.py` with 8 validated tasks from this repo's history. The 48-run comparison (Atlas against plain Claude Code, sonnet, n=3) has NOT been run because it spends up to USD 40 and needs the owner's go-ahead. No result from it is reported. The harness gives each arm an empty scratch CLAUDE_CONFIG_DIR and strips CLAUDE* env vars, so check on the target machine that the CLI still authenticates before the 48-run launch. The Atlas arm loads `plugins/atlas` exported from each task's parent commit (`git archive`), so the fix under test is not readable; validate mode passes for all 8 tasks.

## 5. Tokens and cost story: partly closed

The README no longer headlines the 16.4.0 "13% tokens, 30% time" figures. It now shows the 17.21.0 table (n=3 per cell, 8 and 16 module fixtures): 16 modules cold 31% and warm 26% of plain time, tokens 38% and 36%; 8 modules 53% and 49% of time. A quarter of the plain time was not reached at either size. Limits: small n, synthetic fixtures, a plain one-prompt baseline rather than Claude Code with subagents, and a cold crew costs more dollars (about $0.26 against $0.19 on 17.16.0). Cost per resolved task is not reported.

## 6. Routing is a static table: open

`contracts/scope-matrix.json` still fixes each seat's model. Learned or outcome-fed routing is in the ROADMAP. The router's 84/86 is on the corpus it was tuned on and 12/15 on fresh prompts (critic's figure, not re-run here).

## 7. No isolation or merge strategy: partly closed (simulation)

`ATLAS_ISOLATION=auto|shared|worktree`; auto gives each editing worker a git worktree when 2 or more could write the same files, and `atlas_mux.py reap` merges back, aborting on conflict. Evidence: `python3 plugins/atlas/scripts/atlas_isolation_bench.py`, a simulation of 20 overlap cases with 2 edits each (40 edits), the shared tree modeled with Claude Code Edit semantics (exact `old_string` against current content, refused if stale or missing). Per edit: naive overwrite (upper bound) 26 merged, 14 lost; shared 26 merged, 14 refused for retry, 0 lost; worktree 34 merged, 6 conflicted (kept branch, unmerged), 0 lost; auto chose shared for the 6 disjoint cases and worktree for the 14 same-file cases, with the same outcome as worktree. So worktrees avoid 14 retries and leave 6 same-line conflicts on kept branches for the lead. Limits: it is not `spawn-team` with real workers; conflicts are reported, not resolved; best-of-N attempts are not built; the crew path (`atlas_crew.py`) uses no worktrees. The earlier figure "shared 14 of 20 lost, worktree 0 lost" compared against a whole-file overwrite that Claude Code's Edit tool does not perform, and is withdrawn.

## 8. Local models are plumbing, not a result: open

No Ollama model has run a decision or a worker seat; the provider bench has no real row. See gap 1.

## 9. The verifier is never measured: closed on a held-out tier, sonnet only

`docs/audits/2026-11-15_atlas-verifier-seeded-eval.md` (read it for method and runs). The claim-evidence rule in `agents/verifier.md` raised false-claim catches from 3/18 (haiku, sonnet; opus 8/18) to 17/18 (haiku) and 18/18 (sonnet, opus), 0 of 81 good runs refuted per model; that lift was measured on the 6 cases that motivated the rule. After freezing `verifier.md` (hash `9d41bcc904f488e7c553c80c45703e462791f044`), 20 new cases were run with the shipped seat prompt (ToolSearch and findings sections included, MCP off in the sandbox), sonnet, 3 trials, USD 1.32: false-claim catch 30/30 runs (Wilson 88.6% to 100%) and 10/10 cases (72.2% to 100%) over 10 mismatch kinds the rule does not name; false refutes on harmless divergence 2/30 runs (1.8% to 21.3%), both on the ambiguous `absolute_path` case, 0/27 excluding it. Limits: only sonnet was run on the held-out tier; synthetic single-file fixtures by the same author as the rule; the verifier is the same model family as the implementer, so a shared blind spot is not tested.

## 10. Evidence is circular: partly closed

The verifier eval uses a hidden oracle test, not the plugin's own tests, and now has a held-out tier. The done-claim corpus was re-split by source transcript and seed template. Limits: the critic reviews and the code come from the same vendor's models (the second review was also Sonnet 5.5 and Opus 5.5); labels for the done-claim corpus are model labels; the seeded rows are built from the detector's own rule kinds; the new CI jobs have not run on GitHub.

## 11. Enforcement may be inert: partly closed

The "gates are INERT" warning in the build container came from a stale installed 16.2.0 copy and a doctor that counted a cwd when its own check errored. The source doctor no longer counts a cwd when its check errors (`scripts/atlas_doctor.py`, test in `scripts/test_atlas_doctor.py`). Limits: the source fix has not been shown on a fresh install; the SessionStart warning in a session comes from the installed copy, and both outside reviewers still saw it. This fixes the verdict, not the underlying fact that a gate only checks what it checks; the READMEs say so. A related test leak (atlas_mux writing logs into a stray `/tmp/.atlas`) is fixed.

## 12. Reporting falls short of the field: partly closed

The READMEs now state n and fixture type next to each figure, name the baseline, and say what is unmeasured. Limits: no trajectories are published, no confidence intervals are computed on the speed table, and the history bench result does not exist yet.

## Also in the READMEs (critic section C)

Gate count corrected to 20 (letters a to s and v) in both READMEs, `docs/reference/atlas-reference.md`, `skills/atlas-orchestrate/references/hooks-automation.md` and the `completion_gate_core.py` docstring. "Hooks enforce research, test, implement, verify" and "a separate model tries to refute" were rewritten to what the hooks check. "No worktrees" now applies only to the crew path and `ATLAS_ISOLATION=shared`.
