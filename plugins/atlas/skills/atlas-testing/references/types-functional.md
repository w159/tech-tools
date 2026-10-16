# Functional Test Types Deep Dive

File scope: TYPE IDs `static-lint`, `type-check`, `unit`, `integration`, `component`, `api`, `contract`, `e2e`, `smoke`, `regression`, `acceptance-bdd`, `snapshot-approval`, `characterization`, `exploratory`, `usability`. Canonical catalog: `references/taxonomy.md`. Gap scoring and recommendation: `references/selection-and-gaps.md`. Authoring and running procedure: `references/workflow.md`. Suite health (coverage, flakiness, impact analysis): `references/types-test-quality.md`. Adjacent types live in `types-input-generation.md` (property-based, fuzz, metamorphic, differential, model-based, combinatorial), `types-mutation.md`, `types-nonfunctional.md`, `types-security.md`.

Every type below follows the same template: definition, what it catches and misses, when to choose or avoid, per-language tool table, PR vs nightly run strategy, how to interpret results and thresholds, and a regulated-data priority note. "PR vs nightly" means PR-gate vs scheduled full run, not literally nightly.

## Contents

- 1. Suite shape: pyramid vs trophy vs honeycomb
- 2. Type catalogue
- 3. How these types compose
- Sources

## 1. Suite shape: pyramid vs trophy vs honeycomb

Before adding tests, agree where the weight goes. The shape decides which of the types below dominates.

| Shape | Weight distribution | Optimizes for | Fits best | Avoid when |
|---|---|---|---|---|
| Test pyramid | Many unit, few integration/api, minimal e2e | Fast deterministic feedback, lowest cost per behavior, stable failures | Backend services and libraries with real algorithms: price engines, report generators, parsers, tax and payout math | Most logic lives in interaction wiring, not in units; UI-centric web apps where units test nothing interesting |
| Test trophy | Bulge at integration/api and component level, moderate unit, few e2e | Testing the risky seams (client-rendered UI plus server actions plus forms) without full-app flakiness | Modern SPA stacks (React/Vite, Next/Vue/Svelte) where behavior emerges at integration points (Kent C. Dodds trophy shape) | Pure computation cores; monolithic backends with thin controllers (reverts to pyramid) |
| Honeycomb | Integration-heavy, deliberately small unit slice, thin e2e | Confidence that services compose; microservice boundaries and event flows are cheap to test in pairs | Service-oriented/event-driven systems where units are thin glue over a protocol (Spotify honeycomb model) | Modules with dense numeric edge cases needing exhaustive cheap unit matrices; slow, unstable infrastructure makes integration suites painful |
| Ice cream cone | e2e-heavy everything else thin | Feedback via whole system only | Nothing. Classic anti-pattern: slow, flaky, blind failure location | Always. If you inherit one, plan a push down per module, not a rewrite |

Layering defaults by stack the skill detects:

| Stack shape | Recommended shape | Reason |
|---|---|---|
| FastAPI/Django backend, financial calcs | Pyramid | Money math wants exhaustive cheap unit + property coverage; integration only at DB/queue seams |
| React/Next/Vue web client | Trophy or pyramid-honeycomb hybrid, e2e capped at ~10 percent | Component + api tests cover risk where logic lives; e2e is for critical flows only |
| Microservices / event pipelines | Honeycomb | Pairwise integration + contract tests are the cheapest real signal |
| iOS/Android app | Modified pyramid: unit (Swift Testing/JUnit), component-ish UI harnesses, few Appium/XCUITest flows | Native UI automation is slow; keep it to money-movement and auth flows |

Regulated priority: under FTC Safeguards Rule / SEC Reg S-P / GLBA, whichever shape you pick must include (1) unit/property tests over every money-math module, (2) integration or contract tests over every authz boundary and client-data API, (3) a small e2e/smoke set that proves login, data access rules, and the top client-facing transfer flows. The suite shape never removes those three obligations.

## 2. Type catalogue

### static-lint

Definition: parses source without executing to flag likely bugs, style drift, and API misuse. Distinct from type-check: linters catch patterns reachable without a type system (unused vars, shell quoting, unreachable branches).

Catches: dead code, shell injection-prone constructs (shellcheck), framework anti-patterns, formatting drift, known footguns. Misses: behavior, cross-module invariants, anything requiring runtime state.

When to choose: always, on every repo, as the cheapest gate. Avoid: none. Tune rulesets down to the ones the team will actually fix; noisy linters get ignored.

PR vs nightly: PR, fail on error class only, warn on style. Keep under 60 to 120 seconds; nightly can add the slowest linters (full cppcheck, checkstyle) and format enforcement.

Interpreting: zero-error policy on `error` severity; a warning backlog that never shrinks is debt; run the same ruleset in CI as editors use or drift creeps in.

| Language | Tools (verified 2026-10-14 unless noted) | Run |
|---|---|---|
| TS/JS (React, Vue, Svelte, Node, Bun, Next) | ESLint 10.12.0 (+typescript-eslint), Biome / oxlint [unverified: fast Rust linters] | `eslint . --max-warnings=0`; `biome check .` |
| Python | Ruff 0.17.0 (lint + format; replaces flake8/isort/black) | `ruff check .` |
| PHP | PHP_CodeSniffer [unverified], PHP-CS-Fixer [unverified] | `phpcs --standard=PSR12 src` |
| Swift | SwiftLint [unverified version] | `swiftlint --strict` |
| C#/.NET | Roslyn analyzers, .editorconfig severity mapping | `dotnet format --verify-no-changes` |
| PowerShell | PSScriptAnalyzer [unverified] | `Invoke-ScriptAnalyzer -Recurse -Severity Error -EnableExit` |
| Bash/sh | ShellCheck 0.11.0 | `shellcheck -S style scripts/*.sh` |
| Go | golangci-lint v2.14.0 (meta-runner: staticcheck, errcheck, govet) | `golangci-lint run` |
| Rust | Clippy (ships with rustup) | `cargo clippy --all-targets -- -D warnings` |
| Java/Kotlin | Checkstyle, PMD, Error Prone [unverified versions], ktlint [unverified] | `gradle checkstyleMain` |
| C/C++ | clang-tidy (ships with LLVM), cppcheck 2.22.0 | `clang-tidy -checks='-*,bugprone-*' src/*.cpp` |
| Ruby | RuboCop 1.92.0 | `rubocop --fail-level error` |

Regulated priority: enforce lints that exist for data-handling mistakes (PowerShell PSScriptAnalyzer has cmdlet design rules; shellcheck kills quoting bugs that leak paths; TS eslint no-console keeps client data out of logs).

### type-check

Definition: compile-time or inference-time verification that programs typecheck, including null safety and strictness ladders.

Catches: undefined properties, null deref paths, wrong argument shapes, unsafe casts. Misses: logic errors, protocol misuse across processes, anything runtime.

When to choose: every compiled or typed language, at maximum sustainable strictness. Avoid: none; legacy codebases adopt via per-file strictness (tsconfig strict per tsproject, mypy per-module overrides, PHPStan level ramp, Sorbet typed: ignore to typed: true).

PR vs nightly: PR at the team's locked strictness (fail on errors). Nightly: a strictness watch job that reports new warnings so they get fixed while small.

Interpreting: 0 errors gate; warnings counted as trend, not gate. In PHP rise through PHPStan levels 1 to `max`; in TS enable `strict: true` then `noUncheckedIndexedAccess`; in Python prefer pyright `typeCheckingMode: standard` or mypy `--strict` per package.

| Language | Tools (verified 2026-10-14 unless noted) | Run |
|---|---|---|
| TS/JS | tsc (compiler), pyright for Python-in-TS repos n/a; `vue-tsc`, `angular: ng build` typecheck [unverified] | `tsc --noEmit -p tsconfig.strict.json` |
| Python | mypy 2.4.0, pyright 1.1.414 (Pyright 2.x CLI exists [verify per project]) | `mypy --strict src` |
| PHP | PHPStan 2.3.1, Psalm 7 (RC line) [verified registry] | `phpstan analyse --level=max` |
| Swift | Swift compiler warnings + `swift test` build (Swift 6 concurrency checking) | `swift build -Xswiftc -warnings-as-errors` |
| C#/.NET | Roslyn `<Nullable>enable</Nullable>`, `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` [platform feature] | `dotnet build -warnaserror` |
| PowerShell | no native type system; PSScriptAnalyzer + param type checks in module functions | `Invoke-ScriptAnalyzer -Recurse` |
| Bash/sh | no type system; shellcheck covers the static surface | `shellcheck` |
| Go | compiler + `go vet` [stdlib] | `go vet ./...` |
| Rust | compiler is the type checker; `cargo check --all-targets` | `cargo check --all-features` |
| Java/Kotlin | javac, Kotlin compiler, NullAway [unverified] | `gradle compileJava` |
| C/C++ | compiler warnings `-Wall -Wextra -Werror`, `-fsanitize` for runtime cousins | `clang -Wall -Wextra -Werror -c` |
| Ruby | Steep/RBS [unverified], Sorbet [unverified; Stripe-maintained] | `steep check` |

Regulated priority: null-safety and enum exhaustiveness (Kotlin `when`, Rust match) prevent whole classes of authz bypass (missing permission enum branch compiles fine but never checks).

### unit

Definition: exercises one unit (function, class, module) with all collaborators replaced by test doubles. Fast, deterministic, no I/O.

Catches: logic branches, edge cases in money math, state machine transitions, parsing and formatting. Misses: integration seams (DB, HTTP, wiring), config errors, anything DI or protocol level.

When to choose: default first test for any new logic. Avoid: mocking through someone else's contract (fake HTTP client in unit space belongs in integration with a real stub server); giant shared mocks that encode guesses about the collaborator.

PR vs nightly: PR always if under 5 minutes total; otherwise affected modules via impact analysis (`types-test-quality.md` section 6). Nightly: full suite plus slow-path parameter sweeps.

Interpreting: median test under 100 ms, zero sleeps, zero network. Suite runtime budget: 5 min PR. If a unit test needs a DB, it is an integration test, do not fight it.

| Language | Tools (verified 2026-10-14 unless noted) | Run |
|---|---|---|
| TS/JS | Vitest 5.0.4 (default), Jest 30.5.2, node:test builtin, bun test | `vitest run`; `jest`; `node --test` |
| Python | Pytest 9.1.1 (+ fixtures, parametrize, mock) | `pytest -m "not integration"` |
| PHP | PHPUnit 13.4.2 (or Pest on top) | `phpunit --testsuite unit` |
| Swift | Swift Testing (`@Test`, `#expect`; open source, cross platform, parallel by default), XCTest for UI/perf only (Apple guidance) | `swift test`; `xcodebuild test` |
| C#/.NET | xUnit (v2 2.9.x; v3 line shipping) [verified NuGet], NUnit, MSTest | `dotnet test --filter Category!=Integration` |
| PowerShell | Pester 6.2.0 (Pester 5 end of maintenance per docs; 6 current) | `Invoke-Pester -Path ./tests/unit` |
| Bash/sh | bats-core 1.14.0 (+ bats-assert [unverified]) | `bats test/` |
| Go | stdlib testing + testify [unverified: common], `t.Parallel()` | `go test ./... -count=1` |
| Rust | builtin `#[test]` + cargo; cargo-nextest runner for partitioned runs [unverified] | `cargo test --lib`; `cargo nextest run` |
| Java/Kotlin | JUnit 6 (6.1.3 current, GA 2025-09-30), AssertJ, Mockito / MockK (Kotlin) | `gradle test` |
| C/C++ | GoogleTest, Catch2 v3, doctest [long-stable; unverified versions] | `ctest` |
| Ruby | minitest 6.0.6 (stdlib), RSpec 3.13 | `bundle exec rspec spec/unit`; `ruby -Itest` |

Notes: prefer built-in runners where the ecosystem has matured (node:test, Go stdlib, Rust builtin, Swift Testing) to cut dependency load. Doubles: prefer small hand-rolled fakes for domain interfaces, mocks only at ports the team owns.

Regulated priority: highest-value type for calculation engines (fees, gains/losses, RMD schedules, tax lots). Every rounding, boundary, and calendar rule gets an explicit unit test; property-based sweeps live in `types-input-generation.md`.

### integration

Definition: exercises several real collaborators (DB, message bus, HTTP client/server) with real infrastructure in-process. The unit of truth: does the wiring actually work.

Catches: schema mismatches, query errors, authz middleware wiring, container/port issues, serialization bugs, migrations that did not run. Misses: multi-service deployments, browser rendering, production scale.

When to choose: one tier below every e2e you would otherwise write. Avoid: pointing at shared development environments; time-based tests without clock control; testing business math here that belongs unit-level.

PR vs nightly: PR for service-scoped integration with ephemeral containers. Nightly for the full matrix (Postgres versions, provider permutations). Budget 15 min PR.

Interpreting: fail fast on container startup (5 min timeout), one shared container per suite not per test, truncate tables not rebuild.

Testcontainers pattern (verified versions, 2026-10-14): real dependencies (Postgres, Kafka, LocalStack) in Docker, started per test session, logs and readiness probed by the library.

| Language | Testcontainers lib (verified) | Typical run |
|---|---|---|
| Java/Kotlin | testcontainers-java 2.0.5 | `./gradlew integrationTest` with `@Testcontainers` |
| Python | testcontainers-python 4.15.0 | `pytest -m integration` |
| Go | testcontainers-go 0.44.0 | `go test ./integration/...` |
| .NET | Testcontainers 4.16.0 | xUnit collection fixture + `dotnet test` |
| Rust | testcontainers-rs 0.28.0 | `cargo test --test integration` |
| TS/JS | testcontainers-node [package name `testcontainers`; version [unverified]] | `vitest run integration/` |
| PHP | testcontainers-php and docker-compose based harnesses [memory; verify per repo] | `phpunit --testsuite integration` |
| Swift/iOS | no canonical lib; run Postgres against localhost in CI container, or in-memory doubles (SQLite caveat below) | `xcodebuild test` with scheme Integration |
| C/C++ | docker-compose harness controlled from CTest scripts | `ctest -L integration` |
| Ruby | docker + `sqlite3`/pg gem harnesses [ecosystem practice, no lib verified] | `bundle exec rspec spec/integration` |
| PowerShell | Pester against live Windows components (registry, services, IIS); containers rare for PS workloads | `Invoke-Pester -Tag Integration` |
| Bash/sh | bats + `docker compose up` fixture hooks | `bats test/integration/` |

Service virtualization (stub the HTTP others, so integration tests own one process at a time):

| Concern | Tool (verified 2026-10-14 unless noted) | Use when |
|---|---|---|
| HTTP stubbing, matching, stateful scenarios, proxy/recording | WireMock 3.13.2 (Java; standalone + embeddable) | Any backend or integration test that needs a fake third-party API (custodian APIs, tax providers) |
| Front-end/service-worker level interception of network in the browser | MSW 3.0.3 | Component/e2e in JS apps; also backend Node via `msw/vitest`? (interceptors) [API surface: verify in-repo] |
| Multi-protocol virtualization (HTTP, TCP, SMTP, SOAP), config-file driven | mountebank 2.9.1 (npm; last stable 2023-08, only betas since: effectively maintenance mode) | Legacy SOAP/TCP partners; prefer WireMock for plain HTTP |
| Pact-level contract stubs | Pact mock server (Rust core via FFI) in each Pact lib | See contract type; use broker + stub server, not WireMock, so pacts stay source of truth |

Regulated priority: integration tests prove the authz path end to end (token, policy, data filter). Postgres RLS is invisible to SQLite doubles: any tenant-isolation claim requires a real Postgres container test that executes `SET LOCAL app.current_user` and asserts the row filter. Mark data-faking: synthetic client names only, never production row dumps in fixtures.

### component

Definition: renders one UI component (or one web-framework unit: blade partial, Razor view component, Rails view partial) with its inputs; verifies rendered output and events, not navigation.

Catches: missing props wiring, broken conditional render, accessibility regressions caught by rendered markup, form submission contract. Misses: routing, cross-component state, backend.

When to choose: every client library (React/Vue/Svelte/Angular) and server-side view layer with meaningful logic. Avoid: pixel assertions (that is visual regression in `types-nonfunctional.md`), snapshot-only component tests that no human reads (still useful as change alarms, see snapshot-approval).

PR vs nightly: PR happy-dom/jsdom by default; nightly or targeted PR runs with real browser (Vitest browser mode, Cypress component testing) to catch renderer-specific breakage.

Interpreting: query by role/text (Testing Library philosophy), not CSS chains; timeout per render ~1 to 2 s; each test independent of mount order.

| Language | Tools (verified 2026-10-14 unless noted) | Run |
|---|---|---|
| TS/JS React | Vitest 5.0.4 + @testing-library/react + happy-dom/jsdom [unverified] | `vitest run components/` |
| TS/JS Vue/Svelte/Angular | @vue/test-utils, @testing-library/svelte, Angular TestBed [unverified versions] | per-framework runner config |
| Python | none for server-rendered; Django `test client` renders full template (that is api level); template-level logic tested as unit | `pytest` |
| PHP | Laravel `view()` tests, Symfony WebTestCase rendering, component via phpunit + Blade/Twig partial render [ecosystem practice] | `phpunit --group component` |
| Swift | SwiftUI hard to unit render; use preview-adjacent harnesses or accept XCTests over the view model; ViewInspector [unverified] | `swift test` |
| C#/.NET | bUnit 2.11.3 (Blazor); Razor views usually exercised via MVC/WebApplicationFactory instead | `dotnet test` |
| PowerShell | n/a (cmdlet-level tests are the component equivalent: Pester) | `Invoke-Pester` |
| Bash/sh | n/a | ... |
| Go | n/a (html/template tests via httptest render assertions) | `go test ./...` |
| Rust | n/a for native; wasm UI frameworks have their own testers [ecosystem-specific] | ... |
| Java/Kotlin | n/a server-side; Android: Compose testing APIs (createAndroidComposeRule) [stable platform SDK] | `gradle test` |
| C/C++ | Qt Test module for Qt widgets/Quick [platform SDK] | `ctest` |
| Ruby | Rails system-less view tests, ViewComponent specs [unverified] | `bundle exec rake test` |

Regulated priority: component tests are where form masking and disclosure of client data is verified cheaply (e.g., account number masked client-side). Assert the rendered artifact contains no unmasked identifiers.

### api

Definition: black-box HTTP (or RPC) tests against a running app instance (in-process test server or ephemeral container): request in, assert status, headers, body shape, side effects.

Catches: validation gaps, wrong status codes, pagination bugs, date/decimal handling in payloads, auth header handling, error shape drift. Misses: browser rendering, multi-service sagas (use contract), load (use `types-nonfunctional.md`).

When to choose: primary layer for service teams; one api test per endpoint rule (happy path, validation fail, authz fail, empty, boundary) beats many unit tests of controllers. Avoid: business logic assertions here that belong in unit; coupling to response `id` values; hardcoded port collisions.

PR vs nightly: PR core endpoints; nightly for full resource matrix + multi-version API header checks.

Interpreting: p50 latency budget ~50 ms per local request excluding container cold start; always assert full JSON shape on client-data responses (unknown fields are themselves a leak risk), and negative-case status codes (401 vs 403 vs 404: do not leak existence).

| Language | Tools (verified 2026-10-14 unless noted) | Run |
|---|---|---|
| TS/JS | supertest [unverified version] or plain fetch against dev server; Vitest 5 | `vitest run api/` |
| Python | pytest + httpx ASGI TestClient [stdlib-adjacent ecosystem] | `pytest tests/api` |
| PHP | Laravel `MakesHttpRequests` tests, Symfony `KernelTestCase` with `api` client [framework builtins] | `phpunit --group api` |
| Swift | n/a server-side; client-side HTTP layer mocked with URLProtocol stubs [platform practice] | `swift test` |
| C#/.NET | `WebApplicationFactory<T>` (ASP.NET Core integration testing primitives) + xUnit | `dotnet test` |
| PowerShell | `Invoke-RestMethod` + Pester for deployed endpoint probes [practice] | `Invoke-Pester -Tag Api` |
| Bash/sh | curl + jq script assertions (smoke-grade only) | `test/smoke.sh` |
| Go | httptest + chi/mux routers [stdlib + common routers] | `go test ./...` |
| Rust | axum/actix test utils + reqwest [ecosystem practice], tower-test [unverified] | `cargo test` |
| Java/Kotlin | Spring `MockMvc` / `WebTestClient` | `gradle test` |
| C/C++ | n/a (exercised via harnesses or gRPC integration tests) | ... |
| Ruby | Rails integration tests / rack-test [ecosystem builtins] | `bundle exec rake test` |

Regulated priority: api tests are the enforcement point for Reg S-P access control: every endpoint with client data gets an unauthorized-user test proving data of other households is invisible, not merely 401 on the happy path.

### contract

Definition: verifies the interface contract between two independently deployed parties, either consumer-driven (consumer's expectations captured as a pact, provider verifies it) or schema-based (OpenAPI/AsyncAPI spec becomes the source of truth; provider tested against the schema, consumer against generated stubs).

Consumer-driven (Pact): consumer writes tests against an in-memory/local mock, generating a pact file; provider replays pacts against its real server; Pact Broker (or PactFlow) mediates `can-i-deploy`; the spec is at V4 (matrix v1 through v4; no V5). Recent ecosystem moves (verified 2026-05 update blog): pact-python V3 rewrite on the Rust core (Dec 2025), Pact-Ruby v2 on Rust core, unified Rust Pact CLI, PactFlow BDCT with `Drift` CLI for spec-driven provider checks and `openapi-pact-comparator` for spec-vs-pact diffs.

Schema-based: Specmatic (2.55.3, JVM, actively released 2026-10) runs contract tests straight from OpenAPI on both sides and doubles as a stub server. Schemathesis 4.31.1 drives OpenAPI/GraphQL HTTP property-style checks (negative payloads, missing fields, malformed types) and reports server errors and spec violations. Dredd (last stable release 14.1.0, Nov 2021) reads API Blueprint: treat as unmaintained, migrate to OpenAPI-based verification.

Catches: breaking response shapes before deploy, provider ignoring deprecated consumers, enum drift, auth scheme drift (consumer-driven); spec-vs-implementation mismatches, negative-handling gaps (schema-based). Misses: business correctness (that is api/unit), performance, multi-service choreography beyond pairwise (that is integration).

When to choose: consumer-driven whenever two teams or two deployables own opposite ends of an integration; schema-based when the spec is authoritative and maintained (or on top of an OpenAPI you already generate). Avoid: pact-per-endpoint vanity with zero broker workflow; contract tests as the only authz evidence.

PR vs nightly: consumer pacts on PR of the consumer; provider verification on PR of the provider (via broker webhooks/branches); nightly full re-verification sweep; `can-i-deploy` gates release deploys, not PRs.

Interpreting: no unverified interactions; strict mode on Pact matching for non-nullability surprises; keep provider states as small named hooks, never seeded prod data.

| Language | Consumer/verify tooling (verified 2026-10-14 unless noted) | Command sketch |
|---|---|---|
| TS/JS | Pact-JS: `@pact-foundation/pact` 17.1.4 (V4 default interface) | `jest vitest tests with pactMock`, `pact-broker can-i-deploy` via unified Pact CLI |
| Python | pact-python 4.0.0 (V3 Rust-core rewrite landed Dec 2025; V3/V4 features + plugin ecosystem) | `pytest tests/contract/` |
| PHP | Pact-PHP 10.x stable / v11 beta (V4 default, Rust core) [per Pact 2026-05 update] | `phpunit tests/Contract` |
| Swift | pact-consumer-swift (v2); pact-swift (v3) [per Pact docs matrix, activity low] | xcodebuild test |
| C#/.NET | PactNet 5.0.1 (V4 spec, `WithHttpInteractions`/`WithMessageInteractions`, System.Text.Json) | `dotnet test` |
| PowerShell | n/a (verify via the .NET verifier CLI from PS script) | `pact-verifier.ps1` wrapper |
| Bash/sh | unified Pact CLI (Rust): `pact-verifier`, `pact-can-i-deploy`, `pact-stub` | `pact-can-i-deploy --broker-url ...` |
| Go | Pact-Go 2.8.0 (maintenance release, Rust core) | `go test ./contract/...` |
| Rust | Pact Reference (pact_consumer / pact_provider, Rust core itself) [verified registry family] | `cargo test` |
| Java/Kotlin | Pact-JVM 4.7 (out of beta per 2026-05 update) | `gradle pactTest` |
| C/C++ | Pact-C++ (spec v2, per docs matrix); thin, prefer consuming the Pact CLI verifier | custom runner |
| Ruby | Pact-Ruby v2 (Rust core; pre-v2 is legacy mode) | `rspec spec/contract` |
| Schema-based (any) | Specmatic 2.55.3, Schemathesis 4.31.1, unified Pact CLI + Drift (PactFlow) | `specmatic test api.spec.yaml`; `schemathesis run http://localhost:8000/openapi.json` |

Regulated priority: contract tests document what client data fields are exchanged: pact files and OpenAPI diffs belong to the GLBA/Reg S-P review surface. Never embed real account numbers in pact fixtures; use structured matchers.

### e2e

Definition: drives the real application through its UI (browser or native app) over the real stack, asserting complete user journeys.

Catches: routing, auth redirects, cookie/session handling, cross-service integration visible to users, JS runtime issues, mobile platform quirks. Misses: backend correctness details, visual fidelity (see types-nonfunctional), performance.

When to choose: after api/integration coverage; only flows that lose money or clients if broken (login, household data access, document delivery, transfer initiation). Avoid: every-flow e2e suites (ice cream cone), selectors tied to styling, sleeps.

PR vs nightly: PR: changed-flow subset (via impact mapping) and/or tagged `@smoke` core journeys, sharded across browsers. Nightly: full regression pack plus matrix (Chromium/WebKit/Firefox, mobile emulation).

Interpreting: suite budget: <10 min PR (sharded), <30 min nightly, flake budget <1 percent (Google-scale context and detection tooling: `types-test-quality.md`); traces/video on failure, screenshots on failure; retry only as band-aid, every retry-happy test gets a root-cause ticket.

Tooling table (verified versions 2026-10-14):

| Language/surface | Browser E2E | Mobile/native E2E | Notes |
|---|---|---|---|
| TS/JS | Playwright 1.64.1 (`@playwright/test`), Cypress 16.2.0 | Appium JS client | Playwright: multi-browser, traces, component testing (stories/gallery model, 1.62+; experimental-ct packages dropped 1.63+), `--shard`; Cypress: time-travel DOM, `cy.intercept`, component builder integrations |
| Python | Playwright (Python) 1.64.0, Selenium (pip) 4.x | Appium Python client | Selenium is protocol-driven, good for legacy browser matrix + Browsershots-like farms |
| Swift/iOS | n/a (web via WKWebView not usually e2e-tested) | XCUITest framework (Xcode), Appium with XCUITest driver 12.18.1 | Apple guidance: UI automation stays on XCTest; Swift Testing covers unit |
| C#/.NET | Playwright for .NET, Selenium .NET bindings | Appium .NET client | Playwright .NET tracks upstream majors |
| PowerShell | n/a (smoke via Invoke-WebRequest / Playwright CLI from PS wrapper) | n/a | ... |
| Bash/sh | n/a | n/a | CI invokes the JS/Python runners |
| Go | Selenium Go bindings or ChromeDP [unverified versions] | Appium Go clients [rare; verify per repo] | ... |
| Rust | thirtyfour 0.37.8 (WebDriver client, active), playwright-rust [community; verify maintenance] | Appium via WebDriver protocol (uncommon) | ... |
| Java/Kotlin | Playwright Java, Selenium Java 4.x | Appium Java client; Espresso (Android native) with Espresso driver 9.3.6 for Appium | Espresso recommended inside Android instrumentation tests |
| C/C++ | n/a | n/a | ... |
| Ruby | Capybara + Selenium driver [ecosystem builtins], playwright-ruby-client [community] | Appium via ruby_lib [community] | ... |
| Mobile cross-platform | n/a | Appium 3.8.0 server (major 3 line), drivers: UiAutomator2 (Android), XCUITest (iOS) | One codebase drives both platforms with platform capabilities |

Regulated priority: e2e owns proof that a household member cannot see another household's statements. Keep 1 to 2 such negative journeys always green, and run them on deploy to production-like envs with synthetic accounts only.

### smoke

Definition: minimal post-deploy subset proving the deployed artifact is alive and its critical flows work. Usually a tagged subset of the e2e or api suite plus health checks.

Catches: bad deploys, broken env config, dead third-party endpoints, expired certificates. Misses: everything else. It is a gate, not coverage.

When to choose: every deploy pipeline (staging and production). Avoid: making smoke the whole e2e suite under a different name; read-only rule on prod except clearly disposable synthetic data paths.

PR vs nightly: never on PR; after every deploy, blocking (fail = rollback).

Interpreting: <5 min, deterministic, no order dependence. Fail: page the owner, auto-rollback if configured.

| Surface | Approach (verified 2026-10-14 unless noted) | Run |
|---|---|---|
| Any | Tag subset of e2e suite: Playwright `--grep @smoke`, pytest `-m smoke`, Jest 30 `-t` name filter, Cypress env tags; Reqnroll/NUnit category; Swift Testing tags | CI deploy job step |
| Backend services | health endpoint probes + one authenticated read per service (api suite subset) | curl/Invoke-RestMethod script |
| PowerShell infra scripts | Pester smoke against created resources (tag `Smoke`) | `Invoke-Pester -Tag Smoke` |
| Mobile | 1 native launch + login journey (XCUITest/Espresso tagged subset) | `xcodebuild test -only-testing:SmokeTests` |

Regulated priority: smoke includes TLS expiry and auth endpoints first; a data-facing outage detected 2 hours late is an examiner conversation, not just an outage.

### regression

Definition: suites that protect fixed bugs and previously shipped behavior. A regression test is any test whose job is: once failing, never fails silently again.

Catches: bug recurrence, edge-case reintroductions by refactors, behavior drift. Misses: features that never had a bug filed (that is normal test coverage).

When to choose: always, as a rule rather than a suite: every bug fix lands with a failing-then-passing test reproducing the original report. Avoid: a separate "regression suite" duplicating everything; treat regression as metadata (tags) plus the fix-discipline.

PR vs nightly: bug-specific regression tests run on PR with the fix; the accumulated pack runs nightly in the full e2e/integration sweep.

Interpreting: track "bug reopened" count; if a regression test was ever disabled, it must be re-enabled with a dated comment and a linked issue.

| Language | Mechanism (verified unless noted) | Practice |
|---|---|---|
| Any | tags/markers: pytest `@pytest.mark.regression`, JUnit `@Tag("regression")`, Pester `-Tag Regression`, Swift Testing `.tags`, Playwright `@regression` in title, Go package `regression/` | CI filter: `--tag`, `-t`, `-m`, `--grep` |
| Characterization overlap | for legacy modules lock behavior with snapshot-approval or differential tests (see below), then treat them as the regression net | before refactor |

Regulated priority: client-data and money bugs get regression tests within the same PR as the fix, non-negotiable; examiners ask "how do you know it cannot happen again?".

### acceptance-bdd

Definition: Gherkin (Given/When/Then) scenarios owned with the business, executed against automated step definitions. The TYPE ID `acceptance-bdd`; runners: Cucumber family, behave, pytest-bdd, Reqnroll (SpecFlow successor).

Catches: unmet acceptance criteria, cross-team misreadings of flows (the documents are executable), missing examples in business terms. Misses: implementation bugs below the acceptance level (steps still need lower layers); writing Gherkin alone proves nothing.

When to choose: cross-team or domain-heavy products where a shared, readable flow language pays for itself (household onboarding, transfer lifecycle). Avoid: unit-test-shaped Gherkin (steps that call two functions); UI-selector soup inside steps (put that in page objects/drivers); BDD as documentation theater where nobody reads the scenarios.

PR vs nightly: PR for the scenarios the PR touches plus fast suites; nightly full packs; LivingDoc-style reporting replaced (SpecFlow+ LivingDoc was closed source and was not ported to Reqnroll; use Allure or Azure DevOps/CI native reports).

Interpreting: scenario pass = acceptance criterion met; undefined/skipped step count is a bug, not a todo; step-definition count should grow slower than scenario count (reuse).

| Language | Runner (verified 2026-10-14 unless noted) | Migration note |
|---|---|---|
| TS/JS | cucumber-js 13.3.0 (+ playwright via community harness [unverified]) | ... |
| Python | behave 1.3.3, pytest-bdd 9.0.0 (Gherkin + pytest fixtures; allure-behave/allure-pytest reporters exist) | ... |
| PHP | Behat [unverified version] | ... |
| Swift | n/a (no maintained BDD runner; keep acceptance at api level instead) | ... |
| C#/.NET | Reqnroll 3.3.4 (community fork on SpecFlow v4 codebase, .NET 8/9, scenario-level parallelization; SpecFlow support ends: EOL announced Dec 2024, GitHub deleted Jan 2025; `Reqnroll.SpecFlowCompatibility` package eases migration; LivingDoc not ported) | migrate SpecFlow to Reqnroll, do not stay on SpecFlow |
| PowerShell | n/a | ... |
| Bash/sh | n/a | ... |
| Go | godog 0.16.0 (Cucumber for Go) | ... |
| Rust | cucumber crate 0.23.0 (cucumber-rust) | ... |
| Java/Kotlin | cucumber-jvm 8.0.4 (major 8 released 2026) | ... |
| C/C++ | n/a (acceptance exercised at API level) | ... |
| Ruby | Cucumber Ruby 12.0.0 | ... |

Regulated priority: acceptance suites are audit-friendly artifacts; scenario names read as compliance controls ("Given a household member from household A, then household B statements are not accessible"). Tag scenarios with control IDs where the compliance team maintains a mapping.

### snapshot-approval

Definition: compares current output against a stored, human-reviewed snapshot or approved golden file. Snapshot (Jest/Vitest/insta/syrupy) for structured data and rendered trees; approval-based (Verify, ApprovalTests) for generated artifacts (SQL, HTML reports, emails, CSV exports).

Catches: unintended output changes, serialization drift, template regressions, generated schema drift. Misses: what the output should be (snapshot is descriptive, not normative); behavioral properties.

When to choose: complex deterministic outputs you cannot cheaply specify by hand: client report payloads, CSV statements, generated SQL, rendered document HTML, wire JSON for third-party callbacks. Avoid: snapshotting huge DOM trees nobody reviews; snapshotting live client data (redact IDs, names, account numbers via serializers/filters).

PR vs nightly: PR: runs with stored snapshots; diffs reviewed. Updates only by explicit command (`jest -u`, `vitest -u`, `pytest --snapshot-update`, `cargo insta review`; Verify and ApprovalTests use their documented accept/approve mode, check the flag name in the repo docs before scripting [unverified today]).

Interpreting: snapshot repo size grows like code: review diffs, delete stale snapshots with the feature, sort and normalize volatile fields.

| Language | Tools (verified 2026-10-14 unless noted) | Update/review mechanics |
|---|---|---|
| TS/JS | Jest 30 `toMatchSnapshot`, Vitest 5 snapshots (CLI `-u, --update [type]`) | `-u` only in review PRs; CI deletes no snapshots |
| Python | syrupy 6.1.1 (pytest plugin), pytest-snapshot 0.9.0, ApprovalTests (approvaltests 19.1.1) | `pytest --snapshot-update`; approval workflow file-by-file |
| Rust | insta 1.49.0 (inline + file snapshots, redaction filters) | `cargo insta review` |
| Swift | swift-snapshot-testing 1.19.6 (Pointfree; `assertSnapshot`) | `record: .all` in test invocation |
| C#/.NET | Verify 33.3.3 / Verify.Xunit 31.12.5 (auto-diffs, accept mode), ApprovalTests.Net [NuGet `approvaltests` 7.0.0] | accept mode env/CLI per docs |
| PHP | custom golden-file asserts in PHPUnit 13.4, snapshot plugin for Pest [unverified] | golden files in repo |
| PowerShell | Pester comparison against golden object exports (`Export-Clixml`) | review serialized files |
| Go | `cuelang`? no: golden files via `go test` + `golden` testdata pattern (io golden files, e.g. `gotest.tools` golden helpers [community]) | `-update` per lib |
| Rust alt | n/a (insta covers) | ... |
| Java/Kotlin | ApprovalTests (approvaltests-java [unverified]), plain JUnit golden file asserts | ... |
| C/C++ | ApprovalTests.cpp [unverified] | ... |
| Ruby | approvals gem [registry: 0.1.7, tiny; commonly `minitest` golden files instead] | ... |

Regulated priority: snapshot payloads sometimes embed client data by accident (statement JSON). Enforce: serializers redact; CI greps snapshot dirs for raw-looking account numbers/tax IDs before commit; snapshots count as stored client data under GLBA retention rules if not redacted.

### characterization

Definition: locks current behavior of legacy code by recording its actual outputs as tests before refactoring. Derived empirically (golden master style), not from intent. Related: differential testing (`types-input-generation.md` `differential`) compares old and new implementations head to head on the same inputs.

Catches: behavior changes introduced by refactor (intended and unintended; you then decide which are bugs). Misses: latent bugs get locked in by design (they are what the code does); combinatorial gaps if inputs are hand-picked (pair with property-based input generation).

When to choose: before touching money math or authz logic older than its tests; before framework upgrades of legacy endpoints. Avoid: leaving them forever as "the truth" instead of expressing intent; locking NPE/500 behavior as if desired (mark known-buggy explicitly).

PR vs nightly: PR on the touched module only; nightly sweeps generate the differential comparisons.

Interpreting: a changed snapshot is a decision, not a failure: triage each diff before approving; track known-buggy locks with linked tickets.

| Language | Approach (verified tools above) | Notes |
|---|---|---|
| TS/JS | Jest/Vitest snapshot suites over module entry points, run on real-shaped fixtures | prefer function-level, not DOM-level, for speed |
| Python | syrupy/pytest-snapshot + property inputs (pair with hypothesis [unverified]) | ... |
| C#/.NET | Verify or ApprovalTests.Net over legacy API responses | ... |
| Java/Kotlin | approvaltests-java golden masters | ... |
| Go/Rust/others | golden-file tests + old-vs-new binary comparison scripts | differential runs may be cheaper than exact snapshots in compiled stacks |
| Any | record from production staging via WireMock proxy-record mode (WireMock 3.13.2 proxying + save-to-recordings) | redact payloads before committing recordings |

Regulated priority: for fee and gain/loss engines, characterization before refactor is the control that shows reviewers "outputs identical on N recorded cases, diffs triaged". Keep the diff report as the audit artifact.

### exploratory

Definition: human-led investigation without prior script: tester explores the system with a charter and records findings. Not automatable; agents can draft charters and triage notes into automated candidates.

Catches: unknown unknowns: UX breaks, unexpected state combos, data-driven defects no spec encoded. Misses: nothing reliably; findings must be converted into automated regression tests to stick.

When to choose: before each release with meaningful UX or data model change; after big migrations; on new modules as a one-time deep pass. Avoid: treating it as a substitute for automation, or scheduling it so early there is nothing stable to explore.

PR vs nightly: scheduled per release train; output feeds the regression suite (bug fixes get tests, per regression type).

Interpreting (session-based test management): timeboxed 60 to 90 minute sessions against a written charter ("explore transfer-initiation under weak network with 2FA"); output = session sheet: notes, screenshots, bugs, questions. Coverage = charter list per release, not percent.

| Surface | Approach | Tooling |
|---|---|---|
| Any | Charters + SBTM session sheets (markdown templates in-repo), risk-based tours | plain files; screenshots in PR/issue; bug tracker linkage |
| Web app | guided browser session (DevTools, throttling, roles matrix) | browser devtools, test accounts per role |
| Mobile | device farm manual passes, offline/permission-denied scenarios | physical/emulated devices |

Regulated priority: charter list must include privacy probes: "find any path where user A gets user B data". Findings on data segregation are compliance findings, not just bugs.

### usability

Definition: human-led evaluation of whether real users can accomplish real goals: moderated task sessions, heuristic evaluation, accessibility spot checks. Human-only; automation cannot measure comprehension.

Catches: confusing flows, error message quality, discoverability of security controls, task-completion friction. Misses: correctness, performance.

When to choose: at milestone boundaries (new client dashboards, new transfer UX), not every release. Avoid: shipping untested UX flows to clients with regulatory duties to understand statements.

PR vs nightly: milestone-based; findings convert into defect tickets and, where automatable, a11y checks in `types-nonfunctional.md`.

Interpreting: task success rate, time-on-task, SUS score, severity-weighted issue list (Nielsen severity scale); 5 users catches most severe issues in a session design (Nielsen heuristic guidance); heuristic evaluation pass against Nielsen's 10 heuristics before each major UX release.

| Surface | Approach | Tooling |
|---|---|---|
| Web | moderated remote sessions with task scripts; heuristic review by second pair of eyes | screen share notes, SUS form |
| Mobile | in-person or recorded sessions on both platforms | same |
| Client portals (regulated) | include statement-reading comprehension tasks; document outcomes for compliance reviews | records retained |

Regulated priority: Reg S-P / FTC Safeguards expect clear client-facing disclosures; usability sessions on disclosures (fee tables, privacy notices) are cheap compliance evidence.

## 3. How these types compose

| Question | Answer |
|---|---|
| Which two types first on a new module? | unit (logic) + api or integration (wiring). Everything else is optional until measured. |
| Which type finds authz gaps? | integration/api (real policy path) + one negative e2e journey; contract tests only prove shape, not enforcement. |
| Which type should cover a calculation engine rewrite? | characterization before, unit + property-based during (`types-input-generation.md`), differential comparison on release. |
| What replaces a flaky e2e? | push the assertion one level down (api or integration). e2e keeps the journey, drops the detail. |
| Which type can the plugin automate end to end? | everything except exploratory and usability; for those the agent drafts charters/session sheets and files findings. |

Thresholds summary (all recommended, tune per repo): unit suite < 5 min PR; integration + api < 15 min PR; e2e sharded < 10 min PR, < 30 min nightly; smoke < 5 min post-deploy; lint < 2 min; e2e flake < 1 percent; contract verification < 5 min.

## Sources

- Kent C. Dodds, static vs unit vs integration vs e2e tests (trophy shape): https://kentcdodds.com/blog/unit-vs-integration-vs-e2e-tests
- Spotify honeycomb testing model: https://engineering.atspotify.com/2018/01/testing-of-microservices-and-the-test-pyramid/ (Honeycomb shape discussion) and https://martinfowler.com/articles/practical-test-pyramid.html (pyramid)
- Apple, Swift Testing overview and XCTest migration (UI/perf remain XCTest): https://developer.apple.com/xcode/swift-testing/ and https://developer.apple.com/documentation/testing/migratingfromxctest
- Pact spec V1-V4 matrix and postel rules: https://docs.pact.io/getting_started/specification ; Pact ecosystem update May 2026 (pact-python V3 rewrite Dec 2025, Pact-Ruby v2, unified Pact CLI, Drift, openapi-pact-comparator): https://docs.pact.io/blog/2026/05/22/pact-open-source-update-may-2026 ; PactNet 5 upgrade notes: https://docs.pact.io/implementation_guides/net/docs/upgrading-to-5
- Reqnroll migration guide and SpecFlow EOL (Tricentis, Dec 31 2024, GitHub deleted): https://docs.reqnroll.net/stable/guides/migrating-from-specflow.html and https://reqnroll.net/news/2025/01/specflow-end-of-life-has-been-announced/
- WireMock docs: https://wiremock.org/ ; MSW: https://mswjs.io/ ; mountebank npm registry (last stable 2023-08): https://registry.npmjs.org/mountebank
- Testcontainers docs: https://testcontainers.com/
- Playwright / Cypress / Selenium docs: https://playwright.dev/ , https://www.cypress.io/ , https://www.selenium.dev/
- Cucumber docs: https://cucumber.io/docs ; behave and pytest-bdd readmes.
- Schemathesis: https://schemathesis.readthedocs.io/ ; Specmatic: https://specmatic.io/ ; Dredd repo (last release 2021): https://github.com/apiaryio/dredd
- Jest CLI options list (no --repeat; --seed/--randomize/--changedSince verified): https://jestjs.io/docs/cli ; Jest issue 4336 (repeat request closed 2018, shell loop recommended): https://github.com/jestjs/jest/issues/4336
- Vitest CLI/config (retry, repeats, update, related, changed): https://vitest.dev/guide/cli and https://vitest.dev/config/repeats.html , https://vitest.dev/config/retry
- insta: https://insta.rs/ ; syrupy: https://syrupy-project.github.io/syrupy/ ; Verify: https://github.com/VerifyTests/Verify ; swift-snapshot-testing: https://github.com/pointfreeco/swift-snapshot-testing ; ApprovalTests: https://approvaltests.com/

Verified: on 2026-10-14 the following were checked against registries and docs: npm playwright 1.64.1, cypress 16.2.0, msw 3.0.3, @pact-foundation/pact 17.1.4, appium 3.8.0, vitest 5.0.4, jest 30.5.2, specmatic GH 2.55.3, wiremock 3.13.2, mountebank 2.9.1 (npm time 2023-08-23); pypi pact-python 4.0.0, schemathesis 4.31.1, behave 1.3.3 (2025-09), pytest-bdd 9.0.0 (2026-09), syrupy 6.1.1, approvaltests 19.1.1, playwright 1.64.0, pytest 9.1.1; GitHub releases: testcontainers-java 2.0.5 (2026-04), testcontainers-python v4.15.0, testcontainers-go v0.44.0, cucumber-jvm v8.0.4, cucumber-js v13.3.0, godog v0.16.0, pact-net 5.0.1, pact-go v2.8.0, pact-ruby v2.1.0, bats-core v1.14.0, appium-xcuitest-driver v12.18.1, appium-espresso-driver v9.3.6, swift-snapshot-testing 1.19.6, VerifyTests/Verify 33.3.3, dredd 14.1.0 (2021-11), seleniumHQ 4.51.0; crates: insta 1.49.0, testcontainers-rs 0.28.0, cucumber 0.23.0, thirtyfour 0.37.8; rubygems: cucumber 12.0.0, xcov 1.9.0, bashcov 4.0.0, simplecov 1.3.2; nuget: Reqnroll 3.3.4, PactNet 5.0.1, bUnit 2.11.3, Testcontainers 4.16.0, coverlet.collector 10.1.0, Verify.Xunit 31.12.5, verify 33.3.3, approvaltests 7.0.0, Pester 6.2.0. Pact spec status (V4 current matrix, no V5) and the 2026-05 Pact ecosystem claims from docs.pact.io. SpecFlow EOL facts from reqnroll.net and docs.reqnroll.net. Jest flag set (no --repeat; --seed/--randomize/--changedSince/--onlyChanged/--lastCommit present) from jestjs.io CLI docs; Vitest --retry/--repeats/retry-condition and update flags from vitest.dev docs. Swift Testing vs XCTest division from developer.apple.com. Everything else (Biome/oxlint, SwiftLint, php-ecosystem versions, playwright retries option, community libs marked [unverified]) is from model memory: confirm in-repo before quoting versions.