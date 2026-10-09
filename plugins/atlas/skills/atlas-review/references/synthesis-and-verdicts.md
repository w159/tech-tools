# Synthesis, Validation, Verdict

Phases 5-7 of `atlas-review`. Synthesis and the report are orchestrator-only — never delegated.

## Phase 5: Synthesis

1. **Hydrate.** Read every reviewer artifact from `.atlas/.run/review/<run-id>/`. A reviewer with prose-only output gets its artifact written by you, marked as hydrated.
2. **Apply the mechanics gates** (`findings-envelope.md`): drop 0/25-confidence findings; downgrade 75/100 findings missing their motivating-line quote to 50; drop style-only and speculative residue that slipped through.
3. **Deduplicate semantically, not textually.** Two findings from different reviewers describing the same defect at the same location merge into one, keeping the highest severity, the highest confidence, and the union of evidence. Disagreements about severity on the same defect are noted in the finding's rationale, not resolved by averaging. Same-location-but-different-defect findings stay separate.
4. **Assign stable IDs** `R-001`… in severity order (P0 → P3), confidence-descending within severity. Published IDs never change.
5. **Partition:** actionable (75/100, not pre-existing) / advisory (50, non-P0) / pre-existing / triage-unclear (anything not fitting cleanly — list it, don't bury it).

## Phase 6: Validation (atlas:verifier)

Every **P0 and P1 actionable finding** is validated by `atlas:verifier` in a fresh context before the report may call it actionable. Optionally also validate any 75-confidence P2 whose evidence is non-mechanical. This is where CE's validator maps onto atlas's existing verifier — same job: re-open the cited lines, re-derive the claim, try to refute it, default to needs-evidence when uncertain.

Dispatch shape — one verifier per finding, batched (~8 in flight; all P0/P1 always run even if that means an extra batch). A verifier CANNOT be the reviewer that found the thing, and never sees the synthesis. Required elements per the subagent-kit contract:

- `GOAL: independently verify or refute finding R-00N (<title>) at <file:line>`
- The finding's full object (rationale, evidence, confidence) — this is the claim under test, not shared conclusions.
- Verdict contract: `verified | rejected | needs-evidence`, with personally gathered evidence.
- MANDATORY final action, per `agents/verifier.md`: stamp the verdict into the ledger —

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
  --id review-<run-id>-R-00N \
  --status verified|rejected|needs-evidence \
  --title "<finding title>" \
  --evidence "<file:line or .atlas/evidence/... path>" \
  --reproduction "<the exact command or read that checked it>"
```

After the wave, re-read `.atlas/.run/findings.json` and confirm one row per validated finding; a missing or truncated row means re-dispatch that verifier.

Disposition of validator outcomes:

- `verified` → reported as actionable.
- `rejected` → **dropped entirely.** Not downgraded to advisory, not mentioned in the report. The refutation itself is evidence the finding was wrong.
- `needs-evidence` → reported with that exact label in Validator outcomes, severity intact but never counted toward the verdict's blocking sets unless it is P0 — a needs-evidence P0 stays blocking (uncertainty about data loss is not reassurance about data loss).

Agreement between reviewers is evidence, never permission to mutate (see SKILL.md hard line 1).

## Phase 7: Verdict rules

Compute from actionable findings only (post-validation, pre-existing excluded):

| Condition | Verdict |
|---|---|
| Any open P0 (verified, or needs-evidence) | **Not-ready** |
| No open P0; ≥1 open P1 without a credible owner | **Not-ready** |
| No open P0; ≥1 open P1 with a stated fix owner | **Ready-with-fixes** |
| No open P0, no open P1 | **Ready-to-merge** |

"Owner" is credible when the finding's `verification_requirement` names a check someone can actually run. Advisory findings never move the verdict in either direction.

## Report format

Render the skeleton from SKILL.md. Non-negotiables:

- Every finding line carries its stable ID, severity, file:line, confidence, and (for P0/P1) the validator verdict.
- Empty severity sections render as "None" — absence must be visible, not omitted.
- Coverage names each reviewer, its trigger, and what it examined; anything no reviewer examined is listed as a gap, not hidden.
- The intent line is marked `inferred` when it came from diff inference.
- Close with the verdict and a one-paragraph recap naming the specific findings that drive it.

## `apply:local`

Only on the explicit flag, only after the report is delivered. Follow the SKILL.md protocol exactly: filter to verified `gated_auto|manual` findings owned by `downstream-resolver`, `protected_subject` findings are `manual` regardless of declared class, require a clean pre-review tree, dispatch `atlas:implementer` per fix group with a minimal-diff brief and a named verification command, then one isolated `fix(review): ...` commit. Never push, never mix with reviewed work, never apply during the review pass.

## After the report

Stamp the run itself into the ledger (one row for the verdict):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
  --id review-<run-id>-verdict \
  --status verified \
  --title "<verdict>: <scope one-liner>" \
  --evidence ".atlas/.run/review/<run-id>/ (reviewer artifacts + validator rows)" \
  --reproduction "synthesis over reviewer artifacts and validator verdicts"
```

The reviewer artifacts stay under `.atlas/.run/review/<run-id>/` as operational state (they are run-scoped, not durable docs). Only write anything under `docs/` if the user explicitly asks for a durable review record — and then via `atlas:docs-curator` conventions, date-first naming.
