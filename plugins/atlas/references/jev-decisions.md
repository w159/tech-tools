# Jev decision judgments (typesafe connector)

Purpose: give atlas agents a fast, calibrated, typed second opinion — never a
source of truth — on the four qualities the user asked atlas to actively
enforce during implementation, research, and validation: **type-safety
adherence, deduplication, simplification, and reduced code frailty**. This
supplements the project's real gate (typecheck/lint/test/build) and
independent `atlas:verifier` review. It never replaces them, never blocks a
report on its own, and is always optional.

Backing model: TypeSafe's Jev (`docs.typesafe.ai`), reached through the
`typesafe` MCP connector (`plugins/atlas/mcp/typesafe/`). Jev is a System One
model: it answers typed Choice/Score/Noul questions against a `state` and
returns calibrated probabilities, never free text — the right shape for a
code-quality gut-check, not a source of explanations.

## Feature-detect before use

The typesafe MCP server may not be configured (no `TYPESAFE_API_KEY` and no
`OPENROUTER_API_KEY`). Call `typesafe_status` once per session/task if unsure;
if it reports no provider resolved, or the tool is absent from the catalog
entirely, skip every Jev-backed step below silently and continue without it.
Never treat a missing/unconfigured Jev as a blocker.

## Standard question set

Send the diff under review (or, if no diff exists yet, the full changed
function/module) as `state` — prefer the diff; it fits Jev's 32k-token budget
far more often than a whole file. Ask all four questions in **one**
`typesafe_decide` call — they run in parallel server-side, so batching is both
cheaper and faster than four separate calls:

```json
{
  "state": "<diff or changed-code excerpt>",
  "questions": {
    "type_safety": {
      "type": "score",
      "instructions": "How well does this code use the language's static type system to make illegal states unrepresentable?",
      "criteria": [
        "Weakly typed: `any`/untyped escapes, unchecked casts, or type information discarded",
        "Adequately typed: types present and mostly accurate but with gaps (a few unchecked casts or loose types)",
        "Strongly typed: precise types, no unchecked escapes, illegal states are unrepresentable"
      ]
    },
    "duplication": {
      "type": "noul",
      "instructions": "Does this diff introduce logic that duplicates an existing function, module, or pattern elsewhere in the codebase rather than reusing it?",
      "criteria": { "true": "Reimplements something that already exists", "false": "Genuinely new logic, or correctly reuses what exists" }
    },
    "simplicity": {
      "type": "score",
      "instructions": "How simple is this code relative to the problem it actually solves?",
      "criteria": [
        "Over-engineered: unneeded abstraction, indirection, or generality for the real requirement",
        "Reasonable: matches the problem's real complexity",
        "Could be simpler: a shorter or more direct implementation would serve just as well"
      ]
    },
    "frailty": {
      "type": "score",
      "instructions": "How fragile is this code to small changes in inputs, environment, or adjacent code?",
      "criteria": [
        "Fragile: brittle assumptions, magic values, missing error handling, tight coupling to incidental details",
        "Somewhat fragile: mostly sound but with a narrow edge case or two",
        "Robust: handles edge cases, fails loudly and specifically, decoupled from incidental details"
      ]
    }
  }
}
```

## Thresholds

Starting points — tune per project, but keep the constants in this one file
so they stay reviewable (TypeSafe's own guidance: put question/threshold
constants in a single place). A result below threshold is **surfaced as a
note or finding, never silently auto-fixed and never silently dropped**:

- `type_safety.score < 1.0` → note: type-safety gap.
- `duplication.noul > 0.7` → note: likely duplication, name the suspected original.
- `frailty.score < 1.0` → note: fragile.
- Any answer with `confidence < 0.5` → inconclusive; fall back to human/verifier judgment, never act on a low-confidence signal alone.

## Where this is used

- **`implementer`** — one `typesafe_decide` call on the finished diff, after
  the change is complete but before the final gate run. A below-threshold
  result is reported under "Anything you deliberately left out of scope" as a
  note, not silently fixed beyond the assigned change and never a reason to
  withhold the report.
- **`verifier`** — when the claim under verification concerns code quality
  (not just "does it pass tests"), corroborate with the same four questions
  on the diff. A Jev score that disagrees with the claimed verdict is
  evidence to weigh alongside reproduction, never an automatic override — the
  verifier's own reproduction still leads the verdict.
- **`atlas-refactor`** — run `duplication`/`simplicity`/`frailty` before and
  after each refactor step as a supplementary before/after signal alongside
  the behavior-preservation test that skill already requires.
- **`atlas-audit` quality dimension** (SOLID/DRY/KISS) — the quality reviewer
  runs the standard question set against each hot-spot file/diff the graph
  surfaces, folding `duplication`/`simplicity`/`frailty` into its findings as
  supporting signal. The adversarial `atlas:verifier` pass atlas-audit already
  mandates still governs whether a finding survives.
- **`explorer`** (research) — when discovery turns up multiple candidate
  files/patterns for the same job ("which of these three modules is the
  canonical version"), a `choice` question over the candidates is far cheaper
  than reading all of them end-to-end; use it to prioritize which candidate to
  read first, never as a substitute for actually reading the one chosen.

## Graceful degradation

Every use above is additive and optional. If the typesafe MCP tools are
absent, or a call returns a `MISSING_CREDENTIALS` tool error, note it once and
continue without Jev. This must never block delivery, never fail a gate, and
never be reported as `verified` on Jev's word alone.
