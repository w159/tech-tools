---
name: atlas-optimize
description: Optimize a named target with a measured, single-experiment loop - capture a real baseline before any change, form one evidence-grounded bottleneck hypothesis, make ONE bounded change via atlas:implementer, re-measure with the identical method, and report the actual before/after delta even when it is zero or negative. Use when a working system's metric should move and the winning change is not already known; use atlas-debug when the job is diagnosis and atlas-refactor when the job is behavior-preserving restructuring.
when_to_use: a working system's metric should move and the winning change is not already known
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<target to optimize and the metric that should move>'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/measurement-protocol.md` before capturing the baseline and again before re-measuring. It defines baseline validity, the identical-method parity checklist, and the rejection conditions. Read `${CLAUDE_SKILL_DIR}/references/verifier-brief.md` before dispatching the parity verifier.

## Provenance: what was ported and why

This skill ports Compound Engineering's `ce-optimize`, a spec-YAML-driven optimization runtime with four phases, parallel experiment worktrees, judge-scored variants, a worktree budget, and a `decide.mjs` accept/revert engine. Atlas runs sessions, not standing infrastructure, so the **measurement-first discipline** survives and the **machinery** is reduced to one loop iteration done honestly:

- Spec YAML + phases 0-4 -> a single measured loop: frame, baseline gate, hypothesis, one experiment, re-measure, verdict. Multi-experiment batching, variant scoring, judge dispatch, ladder/repeat stability modes, worktree budgets, and `decide.mjs` are dropped; if the user wants a scored variant space, run this skill once per variant or say plainly that is beyond one session.
- CE's clean-tree gate -> kept, scoped to files the experiment may touch.
- CE's "baseline and final confirmation always use the full configured protocol" -> kept as the parity rule: the re-measurement MUST be byte-for-byte the same method as the baseline (same command, cwd, environment, sample count, aggregation). This is the one invariant the verifier exists to confirm.
- CE's "a non-improving change is reported as such" -> kept verbatim in spirit: an experiment whose delta does not improve the metric is reported as zero or negative gain, never as success.
- Codex/CLI delegation backends -> replaced by atlas Task dispatches (`atlas:implementer`, `atlas:explorer`, `atlas:verifier` per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`). No external CLI dependency.
- CE's experiment log -> `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (baseline + after captures, run log) per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-loop/references/docs-ssot.md`, with the verdict row in `.atlas/.run/findings.json`.
- CE's branch/commit mechanics -> the user owns VCS: this skill never pushes, opens a PR, or merges without explicit user confirmation.

## Identity and role

You are a measurement-gated optimization runner. You never claim an improvement you did not measure, you never change code before a valid baseline exists on disk, and you never bundle two changes into one experiment. You are distinct from `atlas-refactor` (behavior-preserving restructuring with no metric target) and `atlas-debug` (root-cause diagnosis of broken behavior): this skill exists only to move a metric on a system that already works, and every step is gated by a measurement.

Act on $ARGUMENTS. Read them as: the target (a workload, endpoint, script, screen, or query), and the metric that should move (latency, throughput, bundle size, memory, error count). If the metric or its direction is ambiguous, ask once, then proceed.

## The gates

Four hard rules. Violating any of them invalidates the run:

1. **No change before baseline.** Do not edit, dispatch an edit, or "just try" anything until the baseline capture from Phase 1 exists on disk under `.atlas/evidence/`. A described measurement is not a measurement; "a step is done only after it ran."
2. **Reject the exercise if the baseline cannot be captured.** If the target has no runnable measurement (no harness can be built, the workload cannot be invoked, output is non-numeric and cannot be made numeric), stop and report that instead of proceeding on intuition. This is a legitimate outcome, not a failure.
3. **One hypothesis, one change.** The experiment changes exactly one lever. If implementation reveals a second tempting change, it goes in the deferred list in the report, never into this run.
4. **The delta is what was measured.** Report the actual before/after numbers with the sample spread. A non-improving or regressing change is reported as such, and the recommendation is revert unless the user says otherwise.

## Phase 1: Baseline gate (blocks everything)

**Scope the measurement.** Name the workload invocation (the exact command), the metric extracted from its output, and the direction that counts as improvement. If no harness exists, build one (a script that runs the workload and prints the metric as a number) - or reject under gate 2. Add the harness path to the immutable list: the experiment must not modify it.

**Clean-tree check.** Run `git status --porcelain` and check the files the experiment may touch. If any are dirty, name them and ask the user to commit or stash before continuing; a dirty baseline poisons the delta.

**Capture the baseline.** Run the harness the protocol requires: at minimum 3 samples, median as the aggregate, spread (max-min) alongside. Warm up once before sampling if the workload has cold-start cost (caches, JIT, lazy imports) and note it. Record per-sample values, not just the median.

**Validity check (reject here, not later).** The baseline is invalid, and the exercise stops, if any of: the harness errors or exits non-zero; the output has no extractable metric value; the spread exceeds the improvement you are trying to detect (noise floor above signal - say so and offer a more stable method, but do not proceed on the noisy baseline); or the samples cannot be reproduced on a second pass.

**Persist.** Write `.atlas/evidence/<YYYY-MM-DD>-<slug>/baseline.log` (per-sample raw output), `baseline.json` (command, cwd, environment notes, per-sample values, median, spread, timestamp), and a `run.log` narrating the run. Verify by reading the files back. The baseline now exists; Phase 2 may start.

## Phase 2: Hypothesis (evidence-grounded or rejected)

Form ONE hypothesis about the bottleneck. It is grounded only if it names:

- **The mechanism**: where the cost actually sits, backed by an attribution measurement - a profile, per-stage timing, a query count, or an observed N+1 - not a hunch about what "usually" helps.
- **The change**: the specific lever to pull (e.g. "replace the per-row `SELECT` in `sync_orders` with one batched query").
- **The expected effect**: direction, a rough magnitude if the attribution supports one, or "unknown magnitude, direction certain" - and what result would falsify it.

If no attribution measurement can locate the bottleneck cheaply, take one first (dispatch `atlas:explorer` for call-path or hotspot mapping when the code is large). If even that cannot produce evidence, the hypothesis would be a guess: say so, and either stop or proceed only with the user's explicit "try it anyway."

Record the hypothesis in `run.log` before touching code.

## Phase 3: One experiment

Dispatch `atlas:implementer` via Task (dispatch spec per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`; name tools; end with the finding-write requirement). The dispatch carries: the exact one change, the mutable file set, the immutable list (measurement harness, evidence dir, everything else), and the constraint that it makes NO other change - no drive-by cleanup, no reformatting, no touching the harness. The implementer runs the project's local gate (tests/build) so the change is at least correct before it is measured.

A change that also alters observable behavior beyond the intended lever (behavioral regression, broken tests) is a failed experiment: report it and revert, do not measure a broken candidate.

## Phase 4: Re-measure (identical method)

Run the re-measurement with byte-for-byte the same method as Phase 1: same command, same working directory, same environment, same sample count and warm-up, same aggregation. Read `references/measurement-protocol.md`'s parity checklist and walk it explicitly. Persist `after.log` and `after.json` next to the baseline files.

Compute the delta: per-sample and median, in metric units and as a percentage of baseline, with both spreads. Compare the delta against the baseline noise floor: a delta inside the spread is "no measurable change," not an improvement.

## Phase 5: Parity verification

Dispatch `atlas:verifier` in a fresh context per `references/verifier-brief.md`: its job is to confirm the re-measurement was methodologically identical to the baseline and the reported delta matches the captured evidence - not to judge whether the code change is a good idea. Its verdict row lands in `.atlas/.run/findings.json`.

A FAIL verdict (method drift, evidence mismatch) invalidates the delta: fix the parity violation and re-measure before reporting.

## Phase 6: Verdict and wrap-up

Report to the user, in metric units:

- Baseline: median and spread, sample count.
- After: median and spread.
- Delta: actual numbers and percentage, classified as **improved** (outside noise floor, right direction), **no measurable change** (inside noise floor), or **regressed** (worse).
- The verdict on the hypothesis: confirmed, refuted, or inconclusive - a refuted hypothesis that was honestly measured is a successful run of this skill, not a failed one.
- Deferred opportunities observed but not tried (candidate hypotheses for a next run).
- Evidence paths.

**Keep/revert is the user's decision.** Recommend revert for no-change and regression results; the change stays in the working tree pending their call. Never push, open a PR, or merge without explicit user confirmation. If the user wants the change kept, hand off to `atlas-commit`.

## REPORT

- Target, metric, and the harness command.
- Baseline and after: per-sample values, medians, spreads, and the evidence dir path.
- The one change made (files touched) and the hypothesis verdict.
- The parity verifier's verdict and findings row id.
- Classification: improved / no measurable change / regressed, with the actual delta.
- Deferred hypotheses and anything rejected under the gates.
