# Synthesis framework

How atlas-audit turns seven independent dimension reviews into one
prioritized, file:line-anchored report. Read this when you are running
Phase 4 (synthesize and output) of an the code-audit mode run, or when a report came
out unbalanced across dimensions.

## The pipeline shape

```
Phase 1  graph + docs baseline   (sequential, orchestrator-gated)
Phase 2  dimension review        (pipeline: 7 reviewers, no barrier)
Phase 3  adversarial verify       (pipeline: 1 verifier per finding)
Phase 4  synthesize and output    (orchestrator only)
```

Phases 2 and 3 are a `pipeline()`, not a `parallel()` with a barrier:
each dimension flows into its own verify wave as soon as it completes, so
verification starts while later dimensions are still reviewing. Phase 4
does not start until every dimension's verify wave is done.

## What synthesis owns

The orchestrator is the sole author of `report.md` and the handoff
prompts. Synthesis is never delegated. The orchestrator may dispatch
`atlas:planner` to draft a remediation sequencing plan, and
`atlas:docs-curator` to record the audit run in `docs/`, but the
final report and handoffs are written by the orchestrator alone.

The synthesis step does four things, in order:

1. Collect every verified finding from every dimension's verify wave.
   Rejected findings are dropped entirely and do not appear in the
   report, not even as "low confidence."
2. Assign final severity ordering. Reviewers propose a severity during
   review; the verifier confirms or adjusts it. The orchestrator
   resolves ties and produces the HIGH-then-MED-then-LOW master list.
3. Write `report.md`. Each finding carries: dimension, severity,
   `file:line`, a one-sentence description of the flaw, and the
   verifier's evidence.
4. Write handoff prompts for the findings the user accepts for
   remediation, then build the hub so findings are navigable.

## The seven dimensions

Each dimension is one reviewer in Phase 2. The order is the order the
graph ranks them by risk, not a fixed sequence (pipeline shape means the
order of completion does not matter).

1. Correctness / bugs - logic, off-by-one, null propagation, data races.
2. OWASP + security - injection, broken auth, sensitive data exposure,
   vulnerable dependencies, secrets in code. Composes `security-review`
   and `codeql`.
3. SOLID / DRY / KISS + best practices - single-responsibility, open/
   closed, leaky abstractions, local code-smell duplication. Composes
   `quality-playbook`.
4. Risk hotspots - churn rate, coupling, coverage density from the
   graph's god nodes and bridge nodes.
5. Dead code - unreachable branches, unused exports, orphaned modules,
   commented-out blocks that shipped.
6. Test-coverage gaps - untested behavior, critical paths covered only
   by integration tests, missing post-change verification in
   idempotent scripts.
7. Code-vs-docs drift - `docs/` (the SSOT read in Phase 1)
   against live behavior: missing docs for live features, documented
   features that no longer exist, stale examples.

Structural and architectural duplication is out of scope. That belongs
to atlas-audit. A reviewer that surfaces it notes the finding as
out-of-scope and excludes it from its structured return.

## Severity assignment

Reviewer proposes, verifier confirms, orchestrator finalizes.

| Severity | Meaning |
|---|---|
| HIGH | Exploitable security flaw, data-loss risk, or a correctness bug on a hot path. Remediate before next release. |
| MED | A real defect or meaningful principle violation on non-hot-path code, or a coverage gap on a critical path. Remediate soon. |
| LOW | Code smell, stale doc, minor principle violation. Remediate when the area is next touched. |

The verifier can demote a finding (HIGH to MED, MED to LOW) but cannot
promote one. A promotion means the reviewer missed evidence; the finding
goes back to the reviewer for re-review rather than being silently
upgraded at synthesis.

## Handoff prompts

Written only for findings the user accepts. Each handoff is
self-contained: it names the `file:line`, states the flaw and the
acceptance criterion, specifies which atlas squad agent should lead the
fix, and ends with `Remediate with: atlas-launch <finding-id>`. The
`<finding-id>` filename must be a filesystem-safe slug (lowercase, only
`a-z 0-9 . _ -`), because a colon in any audit filename makes the repo
un-checkout-able on Windows.

The hub is built after handoffs, per `atlas-audit`'s
`references/graph-to-hub-pipeline.md`. The same `build_hub.py` script
produces `hub/manifest.json` and `hub/index.html` so the code-audit mode findings are
navigable and one-command launchable.

## The docs gate

After synthesis, the orchestrator dispatches `atlas:docs-curator` to
record the audit run in `docs/CHANGELOG.md` and under
`docs/audits/`. If the curator is unavailable, the orchestrator
writes those entries itself. The audit is not done until the docs gate
is satisfied, the same completion gate atlas-orchestrate enforces.

## Anti-patterns to reject in synthesis

- A "low confidence" section. Rejected findings are dropped, not
  softened and included.
- Re-deriving a finding at synthesis. If the verifier rejected it, the
  orchestrator does not resurrect it. The reviewer can re-raise it in a
  later run with new evidence.
- Mixing in a structural-duplication finding. That is the architecture mode's scope.
  Note it as a one-line cross-reference in the report, do not detail it.
- A report with no `file:line` on a finding. Every finding carries a
  citation or it does not count.