# Testing taxonomy

Canonical vocabulary for atlas-testing. Every test type has one stable TYPE ID; use these
ids in arguments, scripts, gap tables, and evidence. Synonyms resolve to a TYPE ID (see
the last table): do not mint new names for known concepts.

## Canonical catalog

Cost: time and infra to author + run at a useful scale. Automation: auto (agent can run
and judge it) or human-led (a person must do it). Deep reference: the file that owns this
type (read before authoring).

### Foundational static

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `static-lint` | Analyzes source without executing it: linters, semantic rules, style and smell detection. | Dead code, obvious defects, suspicious patterns, style debt. | Runtime behavior, cross-module logic, actual security posture. | Low: seconds, no infra. | None. | Auto | types-functional.md |
| `type-check` | Compiler or language-server type checking, including strict modes and null-flow analysis. | Contract mismatches, null-handling holes, dead branches. | Logic errors within a valid type flow, wrong values. | Low: seconds to minutes. | None. | Auto | types-functional.md |

### Unit-scale behavior

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `unit` | Executes the smallest isolated units with controlled inputs, asserting observable behavior. | Logic defects cheaply; regressions at change sites. | Cross-module wiring, integration seams, performance. | Low: seconds. | Testable seams (importable units, injectable deps). | Auto | types-functional.md |
| `snapshot-approval` | Pins current output as a golden/approval baseline; deviations fail; changes require human review. | Unintended output drift, silent formatting/UI-state changes. | Whether the pinned output was ever correct; baseline rot. | Low. | Normalizable output (no volatile bytes: timestamps, ids). | Auto; a human approves baseline changes | types-functional.md |
| `characterization` | Tests inferred from observed current behavior of legacy code, used while refactoring. | Behavior change during refactor; documents what code really does. | Latent bugs, since current behavior is the oracle. | Low to medium. | Runnable legacy unit with captured inputs. | Auto | types-functional.md |

### Composition and boundaries

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `integration` | Runs several real collaborators together (module plus DB, module plus broker, client plus stub server). | Wiring errors, schema/contract drift, config mistakes. | Full user journeys; rendering. | Medium: minutes, service setup. | Local infra (containers) and doubles for kept edges. | Auto | types-functional.md |
| `component` | One service or UI component exercised end-to-end internally but isolated from true externals (a service test). | Intra-service behavior including persistence interactions. | Cross-service contracts; real client integrations. | Medium. | Runnable component with controlled inputs. | Auto | types-functional.md |
| `api` | HTTP/IPC surface exercised client-like: status codes, payload shapes, error bodies, idempotency. | Serialization bugs, wrong status codes, error-shape drift, visible authn holes. | Browser rendering; logic far below the handler. | Low to medium. | Running service (or test server) + request fixtures. | Auto | types-functional.md |
| `contract` | Consumer expectation pinned as a schema/pact case the provider verifies. | Breaking changes between services or versions. | Business behavior inside the provider. | Low to medium; broker infra for teams. | Documented interface (OpenAPI, Pact, JSON schema). | Auto | types-functional.md |

### System and user

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `e2e` | Drives the assembled system through user-visible flows across services. | Defects that only appear assembled, broken journeys, env/config drift. | Fine-grained localization; it is slow. | High: minutes to hours, browser/device infra. | Deployable system, stable selectors, seeded data. | Auto | types-functional.md |
| `smoke` | Small post-deploy subset proving the system is up and core actions work. | Deployment breakage, dead core paths. | Depth; edge cases. | Low. | Deployed or locally booted system. | Auto | types-functional.md |
| `regression` | Targeted tests pinned to each past defect or triage entry. | Specific known bugs returning. | Uncataloged defects. | Low cumulative. | Defect backlog hygiene to feed it. | Auto | types-functional.md |
| `acceptance-bdd` | Given/When/Then scenarios agreed with the domain owner and executed against the system. | Requirement misunderstandings; spec drift. | Fine-grained implementation defects. | Medium: scenario upkeep. | Living feature files plus a runner. | Auto | types-functional.md |
| `exploratory` | Human-led, charter-based investigation of the system for surprises. | Unknown unknowns; UX-hostile flows; missing validations. | Nothing directly: it is human-led and reproducibility comes from converting findings into regression tests. | High: senior attention in hours. | A runnable system and a charter. | Human-led | types-functional.md |

### Data and persistence

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `data-quality` | Assertions over datasets: freshness, ranges, uniqueness, referential integrity, nullability. | Corrupt or upstream-drifted data reaching reports and models. | Schema-level breaks (that is db-migration). | Low to medium. | A data source fixture and expectations. | Auto | data-sql-databases.md |
| `db-migration` | Applies and rolls back migrations on a scratch database seeded to the previous version. | Broken up/down paths, data loss, model/schema drift. | Production-scale locking behavior; plan that separately. | Medium. | Scratch DB plus migration tooling. | Auto | data-sql-databases.md |

### Input generation and oracles

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `property-based` | Generates many inputs from properties and asserts an invariant per case; shrinks on failure. | Edge inputs manual cases miss; invariant violations; over-narrow implementations. | Correctness of the property itself; deep paths without good generators. | Medium: generator authoring. | Stated invariants; generator library. | Auto | types-input-generation.md |
| `fuzz` | Bombards the target with random, mutated, or malformed inputs; the oracle is "no crash/hang/unexpected error". | Parser robustness; DoS via malformed input; memory safety in native code. | Semantically wrong output that does not crash. | Medium: corpora and run time. | Entry points accepting untrusted input. | Auto | types-input-generation.md |
| `metamorphic` | Asserts expected relationships between outputs across input transformations when a direct oracle is unknown. | Wrong semantics in numeric, reporting, and derivative systems. | Relationships too weak; shared bias that both outputs carry. | Medium. | At least one metamorphic relation. | Auto | types-input-generation.md |
| `combinatorial` | Pairwise or t-way coverage over interacting parameter dimensions. | Interaction defects in config and feature matrices. | Defects needing higher-order interaction than the chosen t. | Low to medium. | Parameter dimensions. | Auto | types-input-generation.md |
| `differential` | Runs two implementations (or versions) on the same inputs and diffs outputs. | Divergent behavior in rewrites, ports, version upgrades. | Bugs both implementations share. | Medium: needs a reference implementation. | Two runnable implementations of the same interface. | Auto | types-input-generation.md |
| `model-based` | State machines or models generate input sequences and expected transitions. | Protocol and state errors; forbidden or unreachable transitions. | Correctness of the model itself. | High: model authoring. | A formal or semi-formal model. | Auto | types-input-generation.md |

### Non-functional

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `benchmark` | Measured throughput, latency, or memory of hot paths against a threshold or trend. | Performance drift per change. | Production-like contention (that is load). | Medium: stable machine, baselines. | A representative hot path. | Auto | types-nonfunctional.md |
| `load` | Drives realistic concurrency in variants: load, stress, soak (endurance), spike. | Capacity limits, degradation curves, leaks, pool exhaustion. | Micro-level hot-path drift (that is benchmark). | High: environment and data. | A production-like target you own. | Auto | types-nonfunctional.md |
| `chaos` | Injects failures (latency, kills, partitions) in a controlled environment, asserting recovery. | Missing retries, cascading failures, bad degradation paths. | Correctness under fault-free load. | High: staging-like environment. | Isolation so blast radius is controlled. | Auto | types-nonfunctional.md |
| `accessibility` | Automated a11y scans (semantic tree, contrast, labels) plus manual screen-reader passes. | Missing labels, contrast failures, focus-order errors; real AT usability via manual passes. | Subjective comprehension. | Low per scan; medium for manual passes. | Rendered UI. | Auto + human-assisted | types-nonfunctional.md |
| `visual-regression` | Screenshots of rendered UI diffed against baselines per viewport and theme. | Unintended visual change. | Differences the diff tolerates or mis-fires on (font loading, animations). | Medium: infra plus baseline upkeep. | Stable rendering environment. | Auto; a human reviews diffs | types-nonfunctional.md |
| `cross-browser` | Matrix runs over browser/OS/device combinations on critical flows. | Engine-specific defects; CSS/JS drift per platform. | Corners of the matrix it did not cover. | High: browser grids. | Browser farm or local matrix. | Auto | types-nonfunctional.md |
| `i18n` | Locale, format, RTL, and encoding coverage; pseudo-localization to force string expansion. | Hard-coded strings, locale/format bugs, truncation under expansion. | Translation quality itself. | Medium. | At least one non-default locale or pseudo-locale. | Auto, plus human review | types-nonfunctional.md |
| `usability` | Human-led task-based sessions measuring task success, time, and satisfaction. | Flows that work but defeat users; comprehension gaps. | Code-level defects. | High: recruiting plus time. | Real users or proxies and tasks. | Human-led | types-nonfunctional.md |

### Meta (tests about tests)

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `mutation` | Seeds many small source faults and checks that tests fail: measures assertion strength. | Tests that execute code but assert nothing meaningful. | Untested code regions (coverage's job). | High: compute. | A test suite worth strengthening. | Auto | types-mutation.md |
| `coverage` | Reports which code executed under a suite; a map, not a quality metric. | Untested regions. | Assertion strength; whether covered behavior is correct. | Low. | Instrumented test run. | Auto | types-test-quality.md |
| `flakiness` | Detects and triages nondeterministically failing tests; feeds determinism fixes. | Tests that lie intermittently. | Rarely-triggered flakes until rerun budget accumulates. | Medium: rerun budget. | Repeatable run harness. | Auto | types-test-quality.md |
| `ci-pipeline` | Lints and validates workflow files; proves the pipeline that runs all tests is itself sound. | Broken or invalid pipeline changes before they block the team. | Runtime runner quirks under specific org versions. | Low. | CI config files. | Auto | infra-iac-containers-ci.md |

### Security and privacy

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `sast` | Static application security testing on source: taint flows, dangerous APIs, insecure patterns. | Injection sinks, unsafe deserialization, crypto misuse patterns. | Runtime and deployment issues; triages false positives. | Medium. | Configured analyzer and rules. | Auto | types-security.md |
| `sca` | Software composition analysis: dependency inventory plus known-CVE and license checks. | Vulnerable dependencies, removed/deprecated packages, license problems. | Vulnerabilities in your own code. | Low. | Lockfiles or manifests. | Auto | types-security.md |
| `secrets` | Scans diffs, history, and repos for embedded credentials and keys. | Leaked tokens before they leak. | Secrets injected at runtime via env; never commit those patterns either. | Low. | None. | Auto | types-security.md |
| `dast` | Dynamic scanning of the running application from the outside. | Exposed endpoints, missing security headers, reflected XSS at runtime. | Logic visible only in deep authenticated flows. | Medium to high. | A running target you own, plus test credentials. | Auto | types-security.md |
| `iac-policy` | Policy-as-code checks and config tests on Terraform/Bicep/etc. (encryption-at-rest, exposure, authz modes). | Unencrypted storage, over-broad grants, public exposure. | Defects in application code. | Low to medium. | IaC files and policy rules. | Auto | types-security.md |
| `container-scan` | Scans images and registries for CVEs and container configuration weaknesses. | Vulnerable base images, root-user containers, embedded secrets. | Host-level issues. | Low per build. | Built images. | Auto | types-security.md |
| `authz` | Tests that permission boundaries hold per role and tenant: client-data surfaces deny out-of-scope roles. | Over-broad data exposure, broken tenant isolation, privilege escalation. | Permission paths the role matrix omits. | Medium. | A defined role matrix and test accounts. | Auto | types-security.md |

### Docs and artifacts

| TYPE ID | Definition | Catches | Misses | Cost | Prerequisites | Automation | Deep reference |
|---|---|---|---|---|---|---|---|
| `docs-examples` | Compiles and executes code blocks in documentation. | Published snippets that no longer run. | Prose accuracy; unstated caveats. | Low. | Extractable code blocks. | Auto | docs-notebooks-web-assets.md |
| `notebook` | Executes notebooks top to bottom in a clean kernel, verifying saved outputs. | State dependency across cells, stale outputs, broken cells. | Statistical validity of the analyses. | Medium. | Notebook runtime. | Auto | docs-notebooks-web-assets.md |
| `link-check` | Crawls docs and sites for dead links and anchors. | Rot in references. | Auth-walled destinations (configure a skip list). | Low. | Known root URLs. | Auto | docs-notebooks-web-assets.md |

## Layers view

Read the catalog bottom-up when hardening a stack and top-down when triaging: a failing
lower layer makes upper-layer results untrustworthy (flake triage before load results).

| Layer | Type ids | Question it answers | Typical cadence |
|---|---|---|---|
| 0. Static | static-lint, type-check (plus secrets, sca, sast as static security) | Does the code even hold its contracts structurally? | Every commit/PR |
| 1. Unit | unit (+ docs-examples, notebook as executable documentation) | Is each small behavior right in isolation? | Every PR |
| 2. Integration | integration, component, api, contract, data-quality, db-migration | Do the pieces actually fit? | PR for touched areas; nightly wide |
| 3. System | e2e, smoke, regression, acceptance-bdd, snapshot-approval, characterization | Does the assembled system serve the user? | Nightly + release (smoke: per deploy) |
| 4. Non-functional | benchmark, load, chaos, accessibility, visual-regression, cross-browser, i18n, usability, exploratory | Is it fast, resilient, usable, accessible, consistent? | Release cadence; nightly for the automatable |
| 5. Meta | mutation, coverage, flakiness, ci-pipeline | Are the tests themselves honest and the pipeline sound? | Weekly/nightly; coverage per PR |

Input-generation strategies (property-based, fuzz, metamorphic, combinatorial, differential,
model-based) are not a sixth layer: they are strategies layered onto layers 1 to 3 wherever
inputs or oracles are hard. Security types span layers: sast/secrets/sca at 0, dast and
authz at 3, iac-policy and container-scan against artifacts (see types-security.md).

## Synonyms

Terms you may hear mapped to TYPE IDs. If a user or doc uses the left column, use the
canonical id in tables and evidence.

| Term(s) | TYPE ID | Note |
|---|---|---|
| Smoke, sanity check, BVT (build verification test), confidence check, trip test | smoke | Two names for the same class; sanity sometimes means a post-change narrow smoke. |
| Golden master, approval test, snapshot test, baseline test, laser strikes | snapshot-approval | Characterization is adjacent: an approval-style test whose oracle is inferred current behavior. |
| Characterization, inference test, pin-down test, lock-in test | characterization | Usually implemented AS golden-master tests, but its purpose is refactoring safety. |
| Soak, endurance, duration test; stress, spike, volume test | load | Variants of one type: load/stress/soak/spike. |
| Property test, proptest, QuickCheck, Hypothesis test | property-based | Named after the flagship tools. |
| Fuzz, monkey test, negative-input testing | fuzz | Negative testing is broader; fuzz is the automated malformed-input part. |
| End-to-end, journey test, user journey, system test | e2e | System tests usually mean the same layer. |
| CDC, consumer-driven contract, Pact test, schema pin | contract | |
| UAT, user acceptance testing, BDD, Gherkin scenarios, spec flow | acceptance-bdd | Human-run sign-off UAT maps here in spirit; the automated executable part is this type. |
| Mutation testing, mutant analysis | mutation | |
| Code coverage, test coverage, line/branch coverage report | coverage | |
| Flaky test detection, unstable tests, nondeterminism triage, reruns | flakiness | Test impact analysis lives with flakiness in types-test-quality.md. |
| Pairwise, all-pairs, t-way, OAT (orthogonal array) | combinatorial | |
| A/B oracle, cross-implementation comparison, shadow diff | differential | |
| Metamorphic relation, MR | metamorphic | |
| Model-based testing, state model tests | model-based | |
| Perf regression, microbenchmark | benchmark | |
| Chaos engineering, fault injection, resilience testing | chaos | |
| A11y scan, WCAG scan, screen-reader check | accessibility | |
| Visual regression, screenshot diff, pixel diff, VRT | visual-regression | |
| Browser matrix, device matrix | cross-browser | |
| i18n / l10n testing, localization test, pseudo-loc | i18n | |
| Usability test, UX session, task-based walk | usability | Human-led; do not substitute an accessibility scan. |
| Pen test, penetration test, bug bounty findings | dast | Automated part fits dast; human pentesting exceeds it. |
| Vulnerability scan, dependency audit, CVE check, license scan | sca | |
| Code security scan, taint analysis, codeql-style scan | sast | |
| Secret scan, credential sweep | secrets | |
| Policy-as-code, Terraform/Bicep compliance check | iac-policy | |
| Image scan, registry scan | container-scan | |
| Permission tests, tenant isolation tests, RLS tests, role matrix tests | authz | RLS-specific detail: data-sql-databases.md. |
| RLS tests, schema round-trip, migration test, rollback test | db-migration | |
| Data checks, freshness/stardog checks, dataset expectations, Great Expectations-style | data-quality | |
| Doctest, runnable docs snippets | docs-examples | |
| Notebook test, nbmake/pytest, nbval, papermill run | notebook | |
| Link check, dead-link detection, rot scan | link-check | |
| Workflow lint, actionlint, pipeline validation | ci-pipeline | |