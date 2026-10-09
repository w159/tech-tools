# Typed Finding Envelope

The single schema every reviewer returns, synthesis merges, and the report renders. Machine-checkable fields, evidence-gated claims, and no prose findings.

## Per-reviewer artifact (JSON)

```json
{
  "reviewer": "<persona-name>",
  "findings": [ { "...finding object below..." } ],
  "residual_risks": ["<risk this reviewer noticed but cannot evidence to 50-confidence>"],
  "testing_gaps": ["<behavior changed with no test covering it>"]
}
```

`residual_risks` and `testing_gaps` are strings, not findings — they inform the report's Coverage section and the next wave of work but never move the verdict.

## Finding object

| Field | Type | Rules |
|---|---|---|
| `title` | string | one line, states the defect not the area ("JWT expiry not checked" not "auth problem") |
| `severity` | `P0\|P1\|P2\|P3` | P0 = data loss / security breach / broken mainline behavior; P1 = must fix before or at merge; P2 = should fix soon; P3 = worth noting |
| `file` + `line` | string + int | repo-relative path, concrete line in the DIFF (not pre-image) |
| `rationale` | string | why it matters — the concrete failure mode, not "best practice" |
| `evidence` | array of strings | see evidence gates |
| `confidence` | `0\|25\|50\|75\|100` | see anchors |
| `autofix_class` | `gated_auto\|manual\|advisory` | orthogonal to severity — see rubric |
| `owner` | `downstream-resolver\|human\|release` | who acts on it |
| `verification_requirement` | string | the check that proves a fix works ("run `pytest tests/auth/test_expiry.py`") |
| `pre_existing` | bool | true if the defect predates the diff; pre-existing findings are reported separately and never move the verdict |
| `protected_subject` | optional enum | present when the finding implicates memory-safety, concurrency, data-loss, auth (authentication or authorization), injection, public-contracts, secrets, or crypto |
| `suggested_fix` | optional string | only when a fix is defensible without designing; never a design essay |

Severity and autofix class are orthogonal: a P0 with a `protected_subject` tag is `manual` by rule; a P3 typo-class finding can be `gated_auto`.

## Confidence anchors (fixed meanings, not vibes)

| Anchor | Meaning | Disposition |
|---|---|---|
| 0 | Cannot reproduce or locate; speculative | **suppressed** — do not report |
| 25 | Suspected, no supporting evidence | **suppressed** — may surface as a residual_risk string instead |
| 50 | Plausible, partial evidence, reviewer could not confirm | **advisory** — listed under Advisory; only escalates if P0 severity with evidence |
| 75 | Strong evidence, reviewer verified the motivating line but not the full path | **actionable** — validated for P0/P1 |
| 100 | Fully traced: read every path, reproduced or mechanically confirmed | **actionable** — validated for P0/P1 |

**Evidence gate:** any 75/100-confidence finding MUST quote the exact motivating line of code as its first evidence item, verbatim, with file:line. A confidence claim without the quote is downgraded to 50 by synthesis, silently and by rule — no reviewer negotiation. History-dependent claims ("this regressed commit X," "this was handled elsewhere before") additionally require provenance evidence (the commit/file showing the prior state).

## Suppression hierarchy (every persona applies these before returning)

1. Style/lint-only complaints (formatter would fix it, naming preference, comment wording).
2. Pre-existing issues outside the diff (→ `pre_existing: true` only if the diff makes them materially worse; otherwise omit).
3. Intent violations without evidence — "you should have also done X" when X was never claimed.
4. Already-handled issues — the defect is mitigated elsewhere in the diff or an adjacent guard.
5. Speculative concerns — "could theoretically" without a concrete trigger path.

A suppressed finding is deleted, not downgraded. Suppression keeps the report load-bearing; residual_risks is the honest drain for things worth a sentence but not a finding.

## Finding IDs

Reviewers use per-persona local ids (`security-1`, `perf-2`). Global stable IDs (`R-001`, `R-002`, …) are assigned exactly once, at synthesis (`synthesis-and-verdicts.md`), in severity-then-confidence order. IDs are never reused or renumbered after first publication in the report.
