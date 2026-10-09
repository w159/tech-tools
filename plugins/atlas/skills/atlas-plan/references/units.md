# Phase 2: Structure - question inventory, challenge pass, implementation units

Ported from CE `ce-plan/references/structure.md`, hardened against atlas's execution model: unit fields and evidence strategies align with `atlas-orchestrate/references/implementation-units.md` so the plan is consumable without translation.

## 1. Resolved-vs-deferred question inventory

Every question raised during intake, research, and decomposition lands in exactly one bucket. A question silently dropped is a defect, not a decision.

**Resolved** - the plan decides, with the basis stated:

- `(grounded: <path>)` - repo evidence (a pattern exists, a test home exists, a contract is fixed).
- `(pack: <id>, <path>)` - a matched pack rule, quoted and cited.
- `D-###` - a settled decision carried from the brainstorm artifact (or newly settled with the user this session).
- `A-### -> resolved` - an upstream assumption the research resolved; state what resolved it.

**Deferred** - the plan does not decide; it states the default and the deadline:

- `Q-### <question>` with three mandatory parts:
  - **Default:** what the plan takes if the question is never answered (the plan stays executable without an answer).
  - **Owner:** who can answer it (user, a domain expert, a measurement, execution-time evidence).
  - **Latest safe moment:** the unit or wave after which deciding costs rework (e.g. "before U3, which builds on the choice").

A deferred question with no default is a blocking question you refused to ask - ask it (one bounded round) or resolve it with evidence. An irreversible fork with no safe default is never deferred; it is settled with the user or the plan is blocked.

## 2. Challenge pass

Challenge each unexamined directive once, in one pass. Sources of directives: the upstream Product Contract's phrasing, the user's original wording, a matched pack rule, a "how we did it last time" assumption. For each, three questions: *Why this way? What breaks if it is different? Is there a cheaper shape that satisfies the same requirement?*

Outcomes:

- **Survives:** keep it, and record the one-line rationale in the unit's approach (a challenged-and-kept directive cites its reason; an unexamined one carries nothing).
- **Fails:** raise it as a deferred question with an alternative, or - if it contradicts repo reality or a settled decision - flag the conflict explicitly in the Planning Contract and let the user re-settle it. The planner never silently rewrites a `D-###`.
- **Pack rules are challenged like any other input.** They are evidence, not instructions; a rule that fights the repo's established pattern is quoted, cited, and reconciled - not obeyed or ignored.

Skip the pass only for directives already settled with rationale upstream (`D-###` entries carry their rationale from brainstorm; re-challenging a settled decision without new evidence is churn, not rigor).

## 3. Implementation units - the `U<N>` contract

Decompose the requirements into units. **One unit = one coherent behavior slice that one `atlas:implementer` dispatch could own and one failable check could verify.** Size by verifiability, not line count: a unit too small to outweigh a worker's context ramp-up gets batched into a sibling; a unit that needs three unrelated verifications is two or three units.

**IDs:** `U1`, `U2`, ... stable for the life of the plan. Never renumber; superseded units are marked `[superseded by U<N>]`, never deleted or ID-reused (same rule as `R-###`; see `atlas-orchestrate/references/implementation-units.md` - "do not invent IDs the plan does not supply" cuts both ways: orchestrate sequences THESE IDs, it never mints replacements).

**Traceability is bidirectional:** every unit names the `R-###` requirements it satisfies; every requirement appears in at least one unit or is explicitly carried by a deferred question. A requirement with no unit is a coverage gap; a unit with no requirement is scope creep.

### All eight fields, every unit, every tier

```markdown
### U<N>: <verb-phrase title>

- **Goal:** <one sentence - what exists when this unit is done, stated observably>
- **Requirements:** <R-### list this unit satisfies - the traceability anchor>
- **Dependencies:** <U<N> list + ordering constraints; "none" only when genuinely independent -
  shared types/schemas/lockfiles are dependencies even when no unit is named>
- **Files:** <repo-relative paths expected to change; "expected, not exhaustive" - the implementer
  may touch a test home or generated surface the plan missed>
- **Approach:** <the how: mechanism, the established pattern to follow (grounded: file:line or
  pack citation), what NOT to do; keep challenge-pass rationale here>
- **Test scenarios:** <observable, failable scenarios by category - happy path (always),
  edge cases (boundaries, empty, concurrency), error/failure paths (invalid input, denials,
  downstream failure), integration (cross-layer, real objects, no mocks for the interacting
  layers). "Validates correctly" is not a scenario.>
- **Verification:** <the failable check: exact command or observable, PLUS the evidence strategy
  this unit mandates - `proof-first` | `characterization` | `no-test-exception` (exception needs
  a named replacement verification). These are orchestrate's strategies; naming them here means
  the dispatch prompt is already written.>
- **Definition of done:** <unit-scoped: the verification check passes, the evidence receipt is
  written under `.atlas/evidence/`, and nothing outside Files changed without saying so>
```

**Field-level rules:**

- *Dependencies:* empty is a claim, not a default. The parallel-safety discipline (orchestrate §3) starts from this list; a missing shared-contract dependency discovered at dispatch time serializes a wave the plan said was parallel.
- *Test scenarios:* name the existing test home when one exists (`(grounded: src/x/y.test.ts)`); discovering it is the implementer's fallback, not the plan's excuse. An existing suitable test is strengthened or reused - never duplicated beside.
- *Verification:* must be runnable later by someone who was not in this session. "Works" is not a check; `pnpm test src/auth/retry.test.ts -> red then green` is.
- *no-test-exception:* genuinely appropriate only for trivial renames, pure config/styling, generated artifacts, manual-only surfaces - and it still names its replacement verification. An exception without one is not an exception.

**Calibration:** 3-9 units is typical. Fewer than 3 usually means the units are actually stages; more than 12 usually means the scope needs a question, not more units. Below Lightweight's floor (a single mechanical unit), say so - that is the rare case where `atlas-orchestrate` directly on the requirements would have sufficed, and the plan should be honest that it is a formality.
