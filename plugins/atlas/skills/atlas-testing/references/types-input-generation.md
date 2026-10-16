# Input generation: property-based, fuzz, metamorphic, combinatorial, differential, model-based (TYPE IDs: `property-based`, `fuzz`, `metamorphic`, `combinatorial`, `differential`, `model-based`)

## Contents

- Definition
- Property-based testing (TYPE ID: `property-based`)
- Fuzzing (TYPE ID: `fuzz`)
- Metamorphic testing (TYPE ID: `metamorphic`)
- Combinatorial / pairwise testing (TYPE ID: `combinatorial`)
- Differential testing (TYPE ID: `differential`)
- Model-based / stateful testing (TYPE ID: `model-based`)
- PR vs nightly strategy
- Interpreting results and thresholds
- Regulated-data priority (Henssler Financial)
- Sources

## Definition

These families generate inputs rather than hand-write them, then check the result against an **oracle**: the thing that decides pass/fail. The oracle is the whole game; a generator without an oracle only checks for crashes. Pick the family by the oracle you can actually express.

## Property-based testing (TYPE ID: `property-based`)

Generates random/structured inputs, shrinks failures to minimal counterexamples, and replays saved failures so regressions stay fixed. Needs three oracle shapes:

- **Invariant**: property must hold for all inputs (`roundtrip(decode(encode(x))) == x`, output is sorted, no panic).
- **Metamorphic relation**: change the input in a known way, expect a known output change (see metamorphic section).
- **Model/spec**: compare against a simple reference implementation or a formal model (see model-based section).

Weak-oracle anti-pattern: property tests that only assert "doesn't crash" - still useful as a fuzzing tier, but write the invariant you actually care about.

| Language | Tool (verified 2026-10-14 unless noted) | Status | Stateful support | Notes |
|---|---|---|---|---|
| Python | Hypothesis 6.169.3 | Very active | `RuleBasedStateMachine` (sequential) | Gold standard: strategies composable, `.example()` for exploration, failure databases per test, derived-from (`st.data()`), Hypothesis for pytest/unittest/pytest-benchmark integration. Property-based + stateful in one tool. |
| JS / TS | fast-check (4.x line) | Active | `fc.modelCommand` model-based runner | Property syntax `fc.property(...)`/`fc.asyncProperty`; built-in arbitrary combinators, biased shrinker. |
| .NET / F# | FsCheck (3.x; active Apr 2026) | Active | Experimental stateful testing | F#-first with C# API. |
| .NET / C# | CsCheck (AnthonyLloyd) | Active | Yes | Pure C#, no F# needed; also used for benchmark/property combos. |
| Java | jqwik (jqwik-team; active) | Active | `@Property` stateful lifecycle (`jqwik.stateful`) | Integrates as a JUnit Platform engine. |
| Rust | proptest 1.12.0 (Oct 2026) | Active (passive maintenance per crate) | `proptest-state-machine` crate (sequential) | Strategy-based (explicit strategies, not type-derived); failure persistence in `proptest-regressions/` (commit those files). |
| Rust | quickcheck 1.1.0 (Feb 2026) | Stable, low-churn | No | Type-derived `Arbitrary`; simpler, fewer knobs. proptest is the more flexible default. |
| Go | rapid (flyingmutant/rapid; updated Apr 2026) | Active | Sequential stateful | `rapid.Check`; regexp- and schema-derived generators. |
| Go | gopter (leanovate/gopter) | Low activity (feature requests open since 2017) | Commands-based stateful | Still functional; prefer rapid for new code. |
| PHP | Eris 1.2.1 (Packagist, 2026) | Active (PHP 8.1-8.4, PHPUnit 10-13) | No | PHPUnit-integrated, shrinking via round-robin. |
| PHP | PhpQuickCheck (steos/quickcheck 2.0.2) | Stale - last release 2022, self-described experimental | No | Prefer Eris. |
| Ruby | rantly (rantly-rb/rantly) and prop_check (Qqwy/ruby-prop_check, Mar 2025) | Small communities | prop_check has stateful props | Ruby footprint is small; either is fine for spot properties. |
| Swift | SwiftCheck (typelift) | Stale - last release 0.12.0 in 2019 | No | Works but effectively unmaintained; treat as legacy. |
| Erlang | PropCheck (alfert/propcheck, on PropEr) | Active | Yes (PropEr statem) | PropEr itself supports sequential + parallel stateful testing. |

Gotchas common to all: commit the shrinking/failure-persistence files (Hypothesis database, `proptest-regressions/`, fast-check recorded failures) so a found bug never disappears; property tests are slow - run fewer cases on PR, more nightly (Hypothesis `max_examples`, fast-check `numRuns`, proptest `cases`); random single-value edge cases (i64::MIN, empty string) are almost never hit by sampling - pin known edge cases as ordinary unit tests alongside properties.

## Fuzzing (TYPE ID: `fuzz`)

Coverage-guided mutation of inputs, hunting crashes, sanitizer violations, hangs, and assertions. Oracles: sanitizers (ASan/UBSan/MSan), process crashes, explicit invariants inside the target, and bug detectors. Long-running, blind to business logic; ideal for parsers, deserializers, protocol handlers, file/network input.

| Language | Tool (verified 2026-10-14 unless noted) | Notes |
|---|---|---|
| Python | Atheris (Google) | libFuzzer-based for CPython extensions and pure-Python entry points; pairs with ASan/UBSan for C-extension bugs. |
| Java / JVM | Jazzer (CodeIntelligence) | Back under Apache 2.0 since Dec 2024 after the 2024 license episode; active (PRs through Sep 2026). Integrates with OSS-Fuzz; JUnit integration, sanitizers for path traversal/SSRF/deserialization. |
| Node.js | Jazzer.js (CodeIntelligence) | v4.0.0 (Apr 2026, re-open-sourced with ESM support, arm64, prototype-pollution/eval/command-injection bug detectors, Jest runner). History: deprecated on npm during the 2024 licensing dispute, restored; pin the version and check the repo before adopting. |
| Go | Native Go fuzzing (`go test -fuzz`) | Stable since Go 1.18; in-process coverage-guided, seeds in `testdata/fuzz/`, corpus persisted automatically. Zero extra tooling - the default choice. |
| Rust | cargo-fuzz (libFuzzer) | Coverage-guided on a nightly toolchain; fuzz targets in `fuzz/`. For in-process pure-Rust targets prefer `arbitrary` crate data. |
| C / C++ | libFuzzer (clang), AFL++ | libFuzzer for in-process; AFL++ (AFLplusplus, active) for persistent targets, queues, and hardware without instrumentation gaps. |
| .NET | SharpFuzz (active) | .NET instrumentation over libFuzzer; fuzz entry points as normal C# methods. |
| CI at scale | OSS-Fuzz / ClusterFuzzLite | OSS-Fuzz = continuous fuzzing service for open-source projects (supported integration point for Jazzer etc.); ClusterFuzzLite = the same engine running in your own repo's CI on every push/PR. |
| HTTP APIs | Schemathesis, RESTler | Spec-driven API fuzzing: generate from OpenAPI schemas, oracle = spec conformance + crash detection (5xx, schema violations). Schemathesis (Python, active); RESTler (Microsoft, stateful REST inference). |

Fuzzing strategy: seed with real corpora (production-sanitized request samples, existing fixtures), run seconds-per-target on PR (smoke) and hours nightly; every crash becomes a pinned regression test with the crashing input committed (`testdata/fuzz/` for Go, corpus dirs elsewhere). Never point fuzzers at third-party services or production data; sanitize seeds of client PII before committing them (GLBA: a corpus is a data store).

## Metamorphic testing (TYPE ID: `metamorphic`)

Oracle = a **relation** between outputs of transformed inputs: `f(x) <= f(2x)` for a tax calculator, `sort(sort(x)) == sort(x)`, adding an unrelated user must not change another user's balance. Invaluable where no reference implementation exists (the classic hard cases: search ranking, recommendation, report totals under presentation-only changes).

- Most property-based tools express it directly: a property takes `x` and the transform's result, asserts the relation (Hypothesis/fast-check/proptest all work; no special tooling needed).
- API level: replay a request, then the mutated request, compare responses under the relation (script it with the HTTP client you already use; Schemathesis stateful testing is a cousin).
- Watch for violated relations caused by legitimate nondeterminism - pin orderings with sort keys before comparing.

## Combinatorial / pairwise testing (TYPE ID: `combinatorial`)

Oracle = expected results for generated combinations of parameter values (policy features, browser/OS matrices, configuration flags, jurisdiction x product type x account type). Pairwise (2-way) covers every pair of parameter values; often enough because most defects are triggered by single values or pairs.

| Tool | Language/platform | Status | Notes |
|---|---|---|---|
| PICT (microsoft/pict) | CLI, model in plain text | Functional but development-inactive; still the reference tool | `param:value` model file; supports constraints, weights, seeded models. |
| allpairspy | Python library | Stable; no release since 2023 (pairwise-testing org ecosystem) | `AllPairs([...])` yields combinations; filters via `predicate`. |

When to use: the matrix is bigger than ~3 parameters or combinations explode (>50 hand cases) and tests are expensive (full workflows, licensed system tests). Skip when a property test or a small explicit table covers it. For regulated matrices (e.g. account type x trustee role x jurisdiction authorization), include the identity of the generated combination in test names so auditors can trace coverage of a claimed matrix.

## Differential testing (TYPE ID: `differential`)

Oracle = **agreement between two implementations** of the same contract: old vs refactored code (safety net for rewrites), your service vs a reference library (decimal math vs Python's `decimal`), Python vs TypeScript implementations of the same rule engine, primary vs shadow deployment. Same input in both, compare outputs; disagreements are defects or spec gaps (triage which).

- Harness: for pure functions, a property-based loop over both implementations (Hypothesis/proptest) is the standard pattern - generate once, run twice, `assert a == b`.
- For services, record-and-replay: capture production-shaped traffic (sanitized), replay against both versions, diff normalized responses. Shadow-compare with alerts before cutover.
- Cross-language checks belong here, not in unit tests: a `contract` test suite run against both implementations with identical fixtures.
- Misses: shared-wrong assumptions (both implementations inherit the same misreading of the spec) - differential tests confirm consistency, not correctness; pair with the spec-as-oracle (model-based) where the spec is decidable.

## Model-based / stateful testing (TYPE ID: `model-based`)

Oracle = a **state machine model** you write that mirrors the real system's rules. Each step: the framework picks a command from the model, executes it against the real system, and updates both model state and real state; on mismatch, it shrinks the sequence to a minimal failing command list. This is the strongest oracle available for stateful systems (order flows, account lifecycle, session handling, cache invalidation).

| Tool | Model style | Notes |
|---|---|---|
| Hypothesis `RuleBasedStateMachine` (Python) | `@rule()` commands mutating `state`, `@invariant()` checks | The default for Python backends; rules can reference outputs of prior rules via `Bundle`. |
| fast-check model-based (TS/JS) | `fc.commands` + `ModelCommand` with a `model` object | Model is a plain object you mutate; real system is the SUT. |
| jqwik stateful (Java) | `ActionBuilder`/chainable model actions | `jqwik.stateful` lifecycle. |
| proptest-state-machine (Rust) | `StateMachineTest` reference model | Sequential; the concurrent strategy is still planned per docs. |
| FsCheck (F#/.NET) | command-based state machine (3.x) | Experimental stateful testing. |
| PropEr / PropCheck (Erlang) | `statem`/`proper_statem` | One of the oldest and best stateful implementations; supports parallel/race checking. |

Write the model trivially on purpose: a dict/list-based mirror of your invariants (balance = sum of posted transactions, order state machine transitions legal, RLS row visibility rules). If the model gets complicated, you are re-implementing the system; extract only the rules that matter. For Postgres RLS specifically, drive the model against real role connections and compare visible-row sets - coordinate with `references/data-sql-databases.md` for the RLS test setup.

## PR vs nightly strategy

| Stage | Scope | Budget |
|---|---|---|
| PR | Property tests at reduced case counts; fuzz smoke (seconds per target); pairwise tables already generated | Keep total added minutes low; use Hypothesis `derandomize`/fixed seeds for CI determinism, or derandomized profiles for PR and random for nightly |
| Nightly | Full case counts; long fuzz runs (ClusterFuzzLite for repos; OSS-Fuzz for OSS); differential full replay | Any crash/failure pins a regression test with its input committed |
| On incident | Raise the failed input into the seed corpus and the failure database permanently | The generator must re-find the bug forever |

## Interpreting results and thresholds

- Property-based: a failure is a minimal counterexample plus a seed; the deliverable is the pinned regression unit test you add next to it, not a green rerun. Shrinking quality is the tool's main difference.
- Fuzzing: measure coverage of the target and "new crashes over time"; a fuzzer that finds nothing new for weeks is plateaued - retire or reseed it. Crashes are triaged: security-relevant (sanitizer, OOB) get CVE-style handling for third-party code; business logic crashes become bugs.
- Pairwise: report generated-combination count and any skipped-by-constraint pairs so the claimed matrix is auditable.
- Differential: a disagreement rate above ~0 needs investigation before cutover; log both outputs, not just the diff.

## Regulated-data priority (Henssler Financial)

- Highest-value targets: fee/billing calculations and rounding (differential vs a reference `decimal` implementation), authorization and client-data access rules (model-based state machines + RLS), document/report generation (metamorphic: content-only changes must not alter computed totals).
- Generators must synthesize client-like data, never sample it: build fake household/account fixtures from schema shapes. Any captured real traffic used as fuzz seeds is client PII under Reg S-P/GLBA - sanitize before it lands in the repo, and document the sanitization as a Safeguards control.
- Mutation-of-input tools can accidentally act on real systems: keep all generated-input execution pointed at fixtures or isolated test environments with access controls, consistent with the Safeguards Rule's access-monitoring expectations.

## Sources

- https://hypothesis.readthedocs.io/ ; https://fast-check.dev/ ; https://fscheck.github.io/FsCheck/ ; https://github.com/AnthonyLloyd/CsCheck ; https://jqwik.net/
- https://crates.io/crates/proptest (1.12.0) ; https://crates.io/crates/quickcheck (1.1.0) ; https://github.com/proptest-rs/proptest (state machine)
- https://github.com/flyingmutant/rapid ; https://github.com/leanovate/gopter ; https://github.com/giorgiosironi/eris (1.2.1) ; https://github.com/steos/php-quickcheck (stale) ; https://github.com/typelift/SwiftCheck (stale) ; https://github.com/rantly-rb/rantly ; https://github.com/Qqwy/ruby-prop_check
- https://github.com/CodeIntelligenceTesting/jazzer ; https://github.com/CodeIntelligenceTesting/jazzer.js (v4.0.0) ; https://www.code-intelligence.com/blog/jazzer-back-to-open-source ; https://github.com/google/oss-fuzz/issues/11652 (license timeline)
- https://github.com/google/atheris ; https://go.dev/doc/security/fuzzing ; https://github.com/rust-fuzz/cargo-fuzz ; https://github.com/AFLplusplus/AFLplusplus ; https://github.com/SharpFuzz/SharpFuzz ; https://google.github.io/clusterfuzzlite/
- https://schemathesis.readthedocs.io/ ; https://github.com/microsoft/restler-fuzzer
- https://github.com/microsoft/pict ; https://pypi.org/project/allpairspy/
- https://stevana.github.io/the_sad_state_of_property_based_testing_libraries.html (stateful/parallel support comparison)

Verified: 2026-10-14 via web search - proptest 1.12.0 and quickcheck 1.1.0 (crates.io), Eris 1.2.1 active with PHP/PHPUnit support matrix (Packagist), PhpQuickCheck stale (last release 2022, experimental), SwiftCheck stale (last release 0.12.0, 2019), rapid active (Apr 2026), gopter low-activity (open issues since 2017), rantly/prop_check repos, Jazzer Apache-2.0 restoration (Dec 2024) and continued activity, Jazzer.js v4.0.0 (Apr 2026) and its 2024 deprecation episode, Hypothesis 6.169.3 (PyPI) and fast-check/jqwik/FsCheck/CsCheck maintenance signals. From memory / not re-verified: [unverified] exact latest version numbers for fast-check, jqwik, FsCheck, CsCheck, Atheris, cargo-fuzz, AFL++, SharpFuzz, Schemathesis, RESTler, PICT development status, PropCheck release status.
