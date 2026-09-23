# Phase 0: Intake

Ported from CE `ce-plan/references/intake.md`, adapted to atlas sources: the upstream artifact is the `atlas-brainstorm` requirements plan (date-first, `docs/plans/`), not CE's unified-plan contract, and bug routing goes to `atlas-debug`.

## Source precedence

| # | Source | Intake shape |
|---|---|---|
| 1 | Explicit artifact path in the arguments | Read it, verify it is requirements-shaped (Goal Capsule + Product Contract, `R-###` IDs). If it is already implementation-ready (has `## Implementation Units`), switch to resume semantics below. |
| 2 | Existing brainstorm artifact for this topic | Glob `docs/plans/*-brainstorm.md`, match by topic. If several match, ask exactly one question: `Found <N> requirements plans for <topic>: <paths>. Which one am I planning?` Do not guess. |
| 3 | Bare feature description | Compose a minimal Goal Capsule + Product Contract inline as part of the plan artifact (next section). Mark `product_contract_source: atlas-plan (inline intake)`. |

## What the brainstorm artifact gives you

`atlas-brainstorm` writes `docs/plans/<YYYY-MM-DD>-<slug>-brainstorm.md` containing:

- **Goal Capsule** - model of success, primary actor, non-goals.
- **Product Contract** - stable `R-###` requirements (actor-observable, no mechanism), **A-### assumptions**, **D-### settled decisions**, prior-art citations (repo paths and `(pack: <id>, <path>)` pack matches).
- **No implementation content by design** - if you find units, file lists, or test plans in it, the upstream was not produced by atlas-brainstorm; treat its content as input claims to verify, not settled contract.

### Preservation rules

- `R-###` IDs carry forward verbatim: same ID, same meaning. Refine wording only when the original is ambiguous, and keep the observable outcome intact.
- `D-###` settled decisions are binding. The challenge pass may QUESTION one; the user re-settles it or it stands. The planner never silently overrides a settled decision.
- `A-###` assumptions convert during planning: each either resolves (becomes part of the Planning Contract with its basis) or survives as a deferred question. An assumption carried forward unchanged and unexamined is a defect.
- Non-goals are scope fences. A unit that satisfies no `R-###` is out of scope; a requirement with no unit is a coverage gap caught in Phase 3.

## Bare-description intake

When no artifact exists: distill the description into a Goal Capsule and a Product Contract with `R-###` IDs, following the requirement-statement rules of the brainstorm contract (observable outcome, not mechanism; one requirement per ID). Then ask AT MOST one bounded clarification round (atlas-prompt discipline: up to 3 questions, options + recommendation first) - and only for genuine blockers: an actor you cannot infer, a success criterion you cannot infer, or a fork that changes the unit decomposition. Everything else becomes an explicit `A-###` assumption in the plan. Do not run a full brainstorm dialogue here; if the gaps exceed what one round can close, recommend `atlas-brainstorm` and stop.

## Depth tiers

Assess; never ask. The tier bounds research breadth and confirmation depth - NEVER the unit contract (all eight fields at every tier).

- **Lightweight** - one clear requirement cluster, an obvious pattern to follow in the repo, no architectural forks. Abbreviated research (direct reads, learnings search may be a single targeted grep), inline grounding instead of an explorer dispatch, no confirmation round.
- **Standard** - the default. Full research phase, explorer grounding, one scope-confirmation question only if synthesis leaves a genuine fork.
- **Deep** - multiple actors or integrations, irreversible forks (data model, security posture, public API), or explicitly high-stakes. Adds flow analysis (trace the end-to-end flow across layers before decomposing), full confirmation round, and external docs research where unfamiliar APIs appear.

## Bug routing

A symptom-shaped request - "X is broken", "Y throws when Z" - is not a plan; it is `atlas-debug`. Say so and stop. A plan is written only for the *prevention or structural* work that survives diagnosis (e.g. "hardening the retry path after the outage fix"), with the root cause cited as grounding. Never plan a fix for an undiagnosed defect: a plan over a guessed cause is a confident patch over the wrong layer.

## Resume semantics

An existing `docs/plans/*-plan.md` for this topic means continue, not rewrite:

- Existing `U<N>` IDs are immutable. Never renumber on resume - the ID is what makes a unit resumable across sessions (see `atlas-orchestrate/references/implementation-units.md`).
- A unit that is no longer wanted is marked `[superseded by U<N>]` or `[dropped: <reason>]` - never deleted, never ID-reused.
- New units take the next free `U<N>`; a split unit keeps its ID for the cohesive remainder and mints IDs for the new slices.
- Re-validate the Verification Contract and DoD against the current tree: work landed by a prior session may already satisfy units - plan the delta, and let execution's idempotency check confirm.

## Confirmation rules

One blocking question per turn; only questions discovery cannot answer; options + "Other" per the atlas-prompt bounded-question pattern. Standard/Deep may ask exactly one scope-confirmation question when synthesis leaves a genuine fork (two defensible decompositions, or an irreversible choice). Lightweight never asks. Everything not asked about becomes an explicit assumption or deferred question - never an implicit one.
