# Selection and gap analysis

The intelligence layer of atlas-testing: which test types a target needs, which gaps
close which risk, and how to turn `testscope gaps` output into a ranked plan. Read
`taxonomy.md` first for the TYPE IDs used here, and `workflow.md` before acting on the
recommendation.

## Contents

- Risk signals and recommended types
- Gap complement matrix
- Scoring formula
- Reading testscope gaps output
- Regulated-data emphasis
- Anti-recommendations

## Risk signals and recommended types

Start from the target's signals, not from a fixed checklist. Each signal names the types
it justifies with a priority: must (add before shipping that surface), should (add this
iteration), could (backlog with a named trigger).

| Risk signal | Why it matters | Recommended type ids |
|---|---|---|
| Client data / PII / regulated records | Exposure of nonpublic personal information is the worst failure class. | `authz` (must), `sast` (must), `secrets` (must), `sca` (should), `dast` (should), `data-quality` (should) |
| Authz / permission boundaries | Over-broad access and broken tenant isolation are silent and high impact. | `authz` (must) per role x resource; `e2e` denial-path scenarios (should) |
| Money math / financial calculations | Wrong cents compound; rounding and timezone defects are subtle. | `unit` with exact-decimal oracles (must), `metamorphic` invariants (should), `property-based` on rounding/algebra rules (should), `characterization` when porting legacy math (should) |
| Parsers / serialization / untrusted input | Malformed input is a security and availability risk. | `fuzz` (must), `property-based` round-trip (must), `sast` (should) |
| Concurrency / async / scheduling | Races and lost wakes hide from linear tests. | `property-based` interleaving models (should), `load` (should), `chaos` for degradation (could) |
| Public API / SDK / published interface | Consumers break on silent changes. | `contract` (must), `snapshot-approval` on emitted artifacts (must), `api` (should) |
| UI / user-facing flows | Visual and a11y regressions ship silently. | `component` (must), `accessibility` (must), `visual-regression` (should), `cross-browser` (should), `e2e` for critical journeys (should), `usability` (could, release cadence) |
| IaC / cloud config | Encryption, exposure, and grant defects live here, not in code. | `iac-policy` (must), `container-scan` (must when images ship), `secrets` (must) |
| Data pipelines / ETL / models | Bad data propagates silently downstream. | `data-quality` (must), `db-migration` (must when schema changes), `metamorphic` on transformation invariants (should) |
| SQL / RLS / database schema | Row-level security and migration paths fail outside dev. | `authz` at the data layer incl. RLS (must), `db-migration` up+down (must), `data-quality` (should) |
| Docs with code / notebooks | Published examples rot and mislead. | `docs-examples` (must), `link-check` (should), `notebook` (must when notebooks are deliverables) |
| Network clients / integrations | Third-party drift breaks them without code changes. | `contract` (must), `integration` with recorded responses (must), `differential` on version bumps (could) |
| CI / build pipeline | A broken pipeline blocks every other test. | `ci-pipeline` (must) |
| High change-rate files (git log churn) | Churn predicts new defects. | `unit` (must), `regression` from past bugs in that file (must) |
| Hot paths with perf budgets | Drift is invisible until users feel it. | `benchmark` (must near budget), `load` (should at release) |
| AI/LLM or nondeterministic outputs | Same input, different output; brittle equality asserts. | `metamorphic` relations (must), `differential` across model versions (should), avoid raw snapshot-approval on raw output (see anti-recommendations) |

## Gap complement matrix

What each observation tells you is missing, and which type closes the gap.

| Observation | Uncovered risk | Closing type(s) |
|---|---|---|
| Coverage high, mutation yield low (most mutants survive) | Weak assertions: code executes but nothing is checked. | `mutation`, then strengthen assertions at surviving mutants |
| Only unit tests exist | Cross-boundary wiring and real contract behavior unverified. | `integration`, `contract`, `api` |
| No property/fuzz tests on parsers or serializers | Malformed-input paths never run. | `property-based` round-trip + `fuzz` |
| E2E-heavy, little or no unit layer | Slow suite, poor localization, brittle, pyramid inverted. | `unit` + `component` under the journeys |
| Everything green, legacy module with no tests | Behavior drift undetected; intent unknown. | `characterization` then `snapshot-approval` |
| Flaky tests present (reruns fail sometimes) | Suite results untrustworthy; CI noise trains people to ignore red. | `flakiness` triage, then determinism fixes per `workflow.md` |
| No authz tests on client-data endpoints | Data exposure invisible to every other type. | `authz` incl. data-layer/RLS |
| No migration tests on schema changes | Upgrade/rollback breakage ships. | `db-migration` |
| No pipeline validation after workflow edits | Broken CI blocks all testing. | `ci-pipeline` |
| No secrets/SCA scans | Credential leaks and known-vulnerable deps pass CI. | `secrets`, `sca` |
| No load tests before a launch or infra change | Capacity and degradation unknown. | `load` (stress variant before launch, soak overnight) |
| Docs examples never executed | Published snippets are broken. | `docs-examples` + `link-check` |
| UI with no visual baselines | Silent CSS/layout regressions. | `visual-regression` |
| Rewrite or port in progress against a legacy version | Divergent behavior between old and new. | `differential` |
| Hot path with no benchmark baseline | Perf drift invisible until release. | `benchmark` before-and-after |
| AI/LLM outputs asserted with equality | Constant false failures or vacuous checks. | `metamorphic` + `differential` |
| No accessibility scan on rendered UI | Compliance and usability failures for AT users. | `accessibility` |

## Scoring formula

Rank each candidate (area, type_id) as:

```
score = risk x likelihood_undetected / cost
```

- `risk` (0..1): worst plausible impact of a defect the type would catch. Weight by
  context: client data exposure, authz bypass, wrong money math = ceiling (>= 0.8);
  correctness regression = high (0.5-0.7); developer-facing friction = low (< 0.3).
- `likelihood_undetected` (0..1): chance a defect sits undetected today. Use: file churn
  from git log, existing test presence in the area (no tests = high), boundary/parse
  density, past defect density in the area.
- `cost` (>= 0.1): authoring + run time + infra + maintenance. Human-led types cost
  more; multiply cost of human attention. Cost is also a run-time consideration: a type
  with high run cost may be `should` in CI but `must` on a nightly or release cadence.

Band the score: must (top of the list, act now), should (this iteration), could (backlog
with trigger). Two overrides:

- Regulated floors: where client data is processed, `authz`, data exposure, audit
  logging, encryption-at-rest config, and calculation correctness are `must` regardless
  of score. Never downgrade them (Henssler context: FTC Safeguards Rule, SEC Reg S-P,
  GLBA, Investment Advisers Act).
- Pipeline dependency: if the pipeline is unvalidated, `ci-pipeline` outranks everything
  because a broken pipeline makes all other evidence unreliable.

## Reading testscope gaps output

`testscope gaps` returns one row per (area, type_id) for detected areas:

```json
{"area": "backend/api", "type_id": "contract", "status": "missing", "priority": "must", "reason": "public HTTP API with no consumer contract", "reference": "references/types-functional.md"}
```

Consume it like this:

1. Filter `status == "missing"`. `present` rows confirm the inventory; `n/a` rows mean the
   stack has no surface for that type (e.g. no locale support, so `i18n` is n/a). Do not
   manufacture work for `n/a`; if an `n/a` looks wrong, verify with a quick search of the
   root before challenging it.
2. Sort by priority (must > should > could), then group by `area` to batch work.
3. Read `reason` before trusting priority: it names the signal that fired. If a reason
   does not match the code you see, downgrade and note the discrepancy.
4. Open the file named in `reference` before authoring anything for that type.
5. In `--format md`, the same rows render as the ranked gap table; present that table to
   the user verbatim rather than paraphrasing it away.

The gap table is an input to the scoring above, not a replacement for it: re-rank with
risk context when the target handles regulated data.

## Regulated-data emphasis

For a regulated context (financial client data: FTC Safeguards Rule, SEC Reg S-P, GLBA,
Investment Advisers Act), the following are mandatory floors in any plan, and the report
language must be examiner-readable:

| Area | Minimum evidence |
|---|---|
| Authorization | `authz` tests per role x client-data resource: denial for out-of-scope roles, cross-tenant isolation, privilege escalation attempts refused. |
| Data exposure | Tests that PII fields never appear in logs, error responses, or public payloads; `sast` rules for logging of sensitive fields. |
| Audit logging | Every client-data write produces an immutable audit entry; tests assert entry creation, ordering, and non-tamperability. |
| Encryption at rest | `iac-policy`/config tests asserting storage, backup, and snapshot encryption settings; `container-scan` for shipped images. |
| Calculation correctness | Exact-decimal money math with rounding rules pinned by `unit` tests, `metamorphic` invariants (recomputing totals, order independence), seeded-fault proof per `workflow.md`. |
| Access review support | Coverage report of which client-data surfaces have authz tests, kept where an examiner can read it (evidence directory). |

Frame vendor assessments and gap reports accordingly: name the rule, the surface, the
test evidence, and the residual risk. Avoid vaguer framing like "we test security stuff".

## Anti-recommendations

Do not add a type when it cannot pay for itself. Say no explicitly, with the reason:

| Situation | Why not |
|---|---|
| Throwaway prototype or spike with no lifetime | Only `secrets` (never leak credentials you typed later) and nothing else. |
| Script/CLI with no persistence and < 5 min runtime | `load`, `mutation`, `chaos` are noise; a few `unit` tests suffice. |
| Huge suite with low coverage, considering `mutation` | Thousands of survivors give no signal; raise `coverage` on critical paths first, then mutate those. |
| Single-node dev environment, considering `chaos` | Nothing to fail over; defer to a staging-like topology. |
| Pure-function library with strong property tests | `e2e` adds little; stay at layers 0-2. |
| Human-led types (`exploratory`, `usability`) on every PR | Reserve for release cadence; they need senior attention. |
| `snapshot-approval` on output with volatile bytes (timestamps, ids, random) | Assertion flake factory; normalize output first or the test lies. |
| Chasing 100% coverage as a target | Coverage is a map, not a metric; spend the effort on `mutation` at critical paths. |
| Load test against production or shared infra | Blast radius plus legal exposure; always a dedicated, owned, production-like target. |
| DAST against third-party services you do not own | Unauthorized scanning is both ineffective and noncompliant. |
| `i18n` on a single-locale product | n/a; `testscope` should report it as such. |
| Property tests with weak or trivial generators | Generate real structure first, or the test only re-verifies what unit tests already check. |
| AI/LLM output pinned by raw `snapshot-approval` equality | Constant churn or vacuous pass; use `metamorphic` + `differential` instead. |

State each rejection in the report ("not recommending X because Y") so the user can
override with context you lack.