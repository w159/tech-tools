# Jev decisions: the contract (typesafe connector)

Everything in this file is true of **every** Jev call atlas makes. The recipes that
use it live in `jev-patterns.md` next door; read this first, then pick a pattern.

Backing model: TypeSafe's Jev (`docs.typesafe.ai`), reached through the `typesafe` MCP
connector (`plugins/atlas/mcp/typesafe/`). Jev is a System One model: it answers typed
Choice/Score/Noul questions against a `state` and returns calibrated probabilities, never
free text.

## What Jev is, and what it is never

Jev is a fast, calibrated, typed **second opinion**. It supplements the project's real
gate (typecheck/lint/test/build) and independent `atlas:verifier` review.

- It is **never a source of truth**. A claim is `verified` because something ran and
  produced output, never because Jev scored it well.
- It **never blocks** a report, a gate, or a delivery on its own.
- It is **always optional**. Every use of it degrades to silence.
- It does not explain itself. If you need a reason, you need a reader, not Jev.

## The three primitives, and the answers they return

`typesafe_decide` takes a `state` and 1-20 `questions`, each keyed by an id you choose.

| Type | Ask it when | Answer fields |
|---|---|---|
| `noul` | the answer is yes/no | `noul` (probability of yes) |
| `choice` | pick exactly one of up to 255 named options | `choice`, `probabilities`, `confidence` |
| `score` | rate against 2-10 ordered levels, lowest to highest | `score`, `legend`, `probabilities`, `confidence` |

**A Noul answer carries no `confidence` field, and no `probabilities`.** Only Choice and
Score do. Threshold a Noul on its own probability - distance from 0.5 is the only
uncertainty signal it has. Never write a `confidence` rule against a Noul; there is
nothing there to read.

`confidence` is derived from how concentrated `probabilities` is: all the mass on one
option is 1.0, a flat spread is near 0. You always get the raw `probabilities` too, so
you are free to compute a different statistic when this one does not fit.

## House rule 1: normalize before you compare

A Score's raw value is an index into that question's own levels. Comparing raw scores
across questions, or against a constant, silently couples the threshold to the level
count - edit the rubric and every threshold shifts meaning.

    normalized = score / (len(legend) - 1)      # 0.0 .. 1.0

Compare, threshold, and weight the **normalized** value. Always.
`${CLAUDE_PLUGIN_ROOT}/scripts/jev_reduce.py` does this arithmetic for you; prefer it over
doing it in your head.

## House rule 2: one call, every question

Questions are evaluated independently and in parallel server-side, and one question's
result never becomes hidden context for another. So batching is free accuracy-wise and
large savings otherwise: TypeSafe's own measurement of 13 questions over one document
found batching **12.2x cheaper and 10.0x faster** than one-question-per-call, with no
change in the answers.

Consequences, and they are the whole reason the patterns file exists:

- Ask everything you might need in one call, up to the 20-question cap.
- Include **speculative** questions whose relevance depends on another answer. Filter in
  code afterward. An extra question is close to free; an extra call is not.
- Never chain Jev calls to "refine" an answer. Two calls are justified when the second
  one sees genuinely new state (see rank-then-verify in `jev-patterns.md`), not when it
  re-asks the same thing.

## House rule 3: send state, not files

Budget is 64k tokens total, of which 32k covers the state plus the longest single
question. It is not enforced client-side, so overrunning it fails at the vendor.

Send the diff, the changed hunk, or the extracted span - not the whole file. Give each
question only what it needs. If a question needs context another question does not, that
is usually a sign the state should be narrower and the questions more specific.

## Structured instructions and criteria

`instructions`, Choice option descriptions, Score level descriptions, and Noul
`true`/`false` all accept a string **or** JSON (object or array). Jev is trained to read
structure. Use JSON when a question has labelled parts, or when the criteria already
exist as a schema, taxonomy, or record - passing the real object beats flattening it into
a prose template. See `jev-patterns.md`, "Structured criteria".

## The standard code-quality question set

The four qualities atlas enforces during implementation, research, and validation:
type-safety adherence, deduplication, simplification, and reduced code frailty. Send the
diff under review as `state` (or, if no diff exists yet, the changed function/module).
All four go in **one** call:

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

Room remains for up to 16 more questions in the same call. If the surface you are on has
its own questions to ask, add them here rather than making a second call.

## Thresholds

Starting points - tune per project, but keep the constants in this one file so they stay
reviewable. A result past a threshold is **surfaced as a note or finding, never silently
auto-fixed and never silently dropped**:

- `type_safety` normalized `< 0.5` -> note: type-safety gap.
- `duplication.noul > 0.7` -> note: likely duplication, name the suspected original.
- `simplicity` normalized outside `0.34 .. 0.67` -> note: over-engineered (low) or
  needlessly indirect (high). This rubric's middle level is the good one.
- `frailty` normalized `< 0.5` -> note: fragile.
- Choice/Score `confidence < 0.5` -> inconclusive; fall back to human or verifier
  judgment. Never act on a low-confidence signal alone.
- Noul in `0.4 .. 0.6` -> inconclusive, same treatment. A Noul has no confidence field;
  its distance from 0.5 is the signal.

Risk-tiered variants of these bands are in `jev-patterns.md`, "Confidence-gated routing".

## Feature-detect before use

The typesafe MCP server may not be configured (no `TYPESAFE_API_KEY` and no
`OPENROUTER_API_KEY`). Call `typesafe_status` once per session/task if unsure; if it
reports no provider resolved, or the tool is absent from the catalog entirely, skip every
Jev-backed step silently and continue without it. Never treat a missing or unconfigured
Jev as a blocker.

## Model capabilities and request budgets

Jev is not a chat model and its request surface is correspondingly narrow. On OpenRouter
(verified against live endpoint metadata): 32k-token context, `max_completion_tokens`
28800, **no sampling parameters** (temperature/top_p/etc. are unsupported), output tokens
billed at $0 - only input tokens are charged, reported per call as `usage.cost`. The
connector sends an explicit small `max_tokens` (default 4096, capped at 28800) on every
OpenRouter call because OpenRouter's credit precheck otherwise reserves the model's full
65536-token output budget against your key when the field is omitted, 402-rejecting
credit-limited keys for a call that actually costs fractions of a cent. A 402 from
OpenRouter arrives as error code `INSUFFICIENT_CREDITS` - it means the key's monthly
limit is below the precheck reservation, not that your state was too large: shrink
`max_tokens` (tool arg `max_tokens`, or `OPENROUTER_MAX_TOKENS`) or raise the key limit.
Never try to "fix" it by trimming the state.

## Graceful degradation

Every Jev use in atlas is additive and optional. If the typesafe MCP tools are absent, or
a call returns a `MISSING_CREDENTIALS` tool error, note it once and continue. This must
never block delivery, never fail a gate, and never be reported as `verified` on Jev's word
alone.

## Where this is used

- **`implementer`** - the standard set on the finished diff, before the final gate run.
- **`verifier`** - the standard set when the claim under verification concerns code
  quality rather than "does it pass tests".
- **`explorer`** - rank-then-verify over candidate files/patterns.
- **`planner`, `atlas-orchestrate`** - intent routing onto the right agent.
- **`atlas-debug`** - speculative fan-out over competing hypotheses.
- **`atlas-audit`, `atlas-refactor`, `atlas-validate`** - composite scoring.
- **`/atlas menu <need>`** - rank-then-verify over the skill roster.

Each of those names a pattern. The patterns are in `jev-patterns.md`.

## Validation status

The typesafe connector is UNVERIFIED against a live TypeSafe or OpenRouter account: it
was built and boot-probed without either key present, so no real vendor endpoint has been
contacted. The request shapes here follow the published API, and the connector's own
credential-resolution paths are covered by `npm run test:boot`, but the first live call
from any project should be treated as the first live call.
