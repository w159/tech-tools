# Test Quality: Coverage, Flakiness, Impact Analysis, Smells

File scope: TYPE IDs `coverage` and `flakiness`, plus the cross-cutting practices diff coverage, test impact analysis, test smells, and suite health metrics. Cross-refs: mutation testing (assertion strength) in `types-mutation.md`; input generation for property/fuzz in `types-input-generation.md`; type catalogue in `types-functional.md`; scoring procedure in `references/selection-and-gaps.md`.

## Contents

- Type cards
- 1. Coverage kinds
- 2. Coverage tools per language
- 3. Why coverage is necessary, not sufficient
- 4. Diff (patch) coverage on PRs
- 5. Flakiness
- 6. Test impact analysis / selective runs
- 7. Test smells catalog
- 8. Suite health metrics
- Sources

## Type cards

### coverage

Definition: measurement of which lines, statements, branches, conditions, decisions, MC/DC clauses, paths, and functions executed under the test suite (section 1), with tools per language (section 2) and PR-level gating via diff coverage (section 4).

Catches: untested code paths, dead modules, gaps in money-math and authz logic; coverage trend regression. Misses: assertion strength (mutation, `types-mutation.md`), wrong expected values, boundary values, integration behavior.

When to choose: always; prefer branch + diff coverage over line totals. Avoid: as the only quality gate, or as a repo-wide target that rewards exclusion lists and touch-without-test.

PR vs nightly: PR: diff/patch coverage gate (fail-under, section 4) plus coverage report upload; nightly: full repo coverage trend, threshold watch, and coverage-based TIA mapping refresh.

Interpreting and thresholds: branch coverage is the floor; recommended gates: diff coverage 80 percent on changed code, per-file thresholds where the domain demands (money math 90+), repo-wide reported but not gated; treat 100 percent as a smell (test theater). Cross-check with mutation score on critical modules.

Regulated priority: coverage on client-data access paths and calculation engines is examiner evidence: report per-module, exclude only generated code, and keep exclusion lists reviewed and dated.

### flakiness

Definition: nondeterministic pass/fail of a test on unchanged code (section 5): root-cause classes, detection tooling, quarantine policy, and retry discipline.

Catches: real production nondeterminism (races, time, ordering, resource leaks) hiding in the suite; false CI red. Misses: deterministic bugs; nothing.

When to choose: always run detection as part of suite health; quarantine + root-cause every flaky test rather than raising retry counts. Avoid: retries without a flaky report, quarantine without an SLA, fixing flakiness only in e2e (most flake origins are lower layers).

PR vs nightly: PR: random-order local runs for changed suites, one-retry CI policy with flaky reporting; nightly: full random-order sweep plus repeated-run loops (`go test -count`, vitest `--repeat`, pytest `--repeat`) on suspect tests to confirm a fix.

Interpreting and thresholds: flake rate under 1 percent of runs (Google observed ~1.5 percent at scale); rerun-masking rate trending to zero; quarantine pool under 1 percent of the e2e suite with a 15-day fix-or-delete SLA; a test that flips within 30 days of re-enable restarts quarantine.

Regulated priority: a flaky authz or money test that is "fixed" by retry is a compliance liability: document the root cause, since intermittent access-control failures are exactly what reviewers ask about.

## 1. Coverage kinds

| Kind | Measures | Catches | Misses | Notes |
|---|---|---|---|---|
| Line | source lines executed at least once | dead code, untested modules | any partial-branch nuance | weakest gate; count differs from statement only in style rules |
| Statement | executed statements | same as line, finer in some languages | same | istanbul/c8 report statements; almost identical to line in practice |
| Branch | both outcomes of each decision (`if`, `?:`, guards) | untaken else-arms, exception paths | sub-conditions inside one expression | the minimum meaningful gate for logic code |
| Condition | each boolean sub-expression true and false independently | compound conditions with masked outcomes | whether outcomes affected the result | available in gcov (`-b -c` partial), Xdebug, some LLVM tooling |
| Decision | every decision's true/false outcome | untested exits of a decision | sub-condition effects | decidable from branch data in most stacks |
| MC/DC (modified condition/decision) | each sub-condition shown to independently affect the decision (masking variant) | compound conditions where one term always dominates | unique-cause variants (weaker set of paths than unique-cause MC/DC) | aerospace/DO-178 grade; open-source support exists: GCC gcov `-g/--conditions` with `-fcondition-coverage` (C, C++, D; Go front-end cannot; Rust experimental in GCC 14), LLVM source-based coverage, cargo-llvm-cov `--mcdc` (nightly, unstable) |
| Path | all simple/prime paths through the control flow | interaction of decisions across branches | loops bounded beyond prime paths | GCC gcov `-e/--prime-paths` with `-fpath-coverage` (report `--prime-paths-lines` tells you which lines to hit) |
| Function | each function entered | entirely dead functions | anything inside covered functions | cheapest structural signal; every tool below reports it |

Surprise for most teams: GCC gcov has shipped masking MC/DC (`-fcondition-coverage`, `gcov -g`) and prime-path coverage (`-fpath-coverage`, `gcov -e`) since GCC 13; you do not need a commercial DO-178 tool for the metrics (requirements/traceability are a different matter).

## 2. Coverage tools per language

| Language | Tool (verified 2026-10-14 unless noted) | Kinds | Run sketch |
|---|---|---|---|
| Python | coverage.py 7.16.2 (+ pytest-cov 7.1.0) | line, branch (`branch = true`) | `pytest --cov=src --cov-branch --cov-report=xml` |
| TS/JS | Vitest 5 coverage providers v8 / istanbul (@vitest/coverage-v8 5.0.4), thresholds per file (lines/functions/branches/statements); c8 12.0.0 (V8 native, no instrumentation) vs nyc 18.0.0 (istanbul instrument); Node builtin `node --test --experimental-test-coverage` [flag per Node docs] | statement, branch, function, line | `vitest run --coverage`; `c8 npm test` |
| PHP | PHPUnit 13.4.2 with php-code-coverage 14.4.1; driver: Xdebug 3 (branch + path coverage) or PCOV (line only, cheaper) | line, branch (Xdebug) | `phpunit --coverage-php` / `--coverage-xml` |
| Swift/iOS | llvm-cov via Xcode (`xcodebuild test` + coverage report), xcov gem 1.9.0 (reporter wrapper; verify activity per project) | line, region, function | fastlane scan + `xcov` or `llvm-cov export` |
| C#/.NET | coverlet.collector 10.1.0 / coverlet.msbuild 10.1.0 | line, branch, method | `dotnet test --collect:"XPlat Code Coverage"` |
| PowerShell | Pester 6.2.0 CodeCoverage | line of PowerShell commands (Pester counts commands, not lines; `throw` counts separately) | `$config.CodeCoverage.Enabled = $true; Invoke-Pester -Configuration $config` |
| Bash/sh | kcov v43 (also wraps compiled binaries with gcov/lcov), bashcov 4.0.0 | line | `kcov --include-pattern=.sh ./cov test/run.sh` |
| Go | `go test -coverprofile` (stdlib) | statement/block; branch data in profile available to `go tool cover` | `go test ./... -coverprofile=c.out` |
| Rust | cargo-llvm-cov 0.9.1 (LLVM source-based; line, region, function; `--branch` and `--mcdc` nightly/unstable), cargo-tarpaulin 0.37.5 (docker-based, line) | line, region, function (+branch nightly) | `cargo llvm-cov --workspace --lcov --output-path lcov.info` |
| Java/Kotlin | JaCoCo 0.8.15 | line, branch, function(method) | `gradle test jacocoTestReport` |
| Ruby | simplecov 1.3.2 (+ branch cobertura via formatter [community]) | line (branch via formatters) | `COVERAGE=1 bundle exec rake test` |
| C/C++ | gcov + lcov/gcovr wrappers, kcov v43 for scripts; clang + llvm-cov | line, branch, MC/DC (GCC 13+), prime path (GCC 13+) | `gcc --coverage` build, run, `gcov -g -e` |
| SQL/IaC | n/a as coverage; approximate with query logs or policy-test suites (see `data-sql-databases.md`, `infra-iac-containers-ci.md`) | n/a | ... |

Config snippets for the three gates worth enforcing (thresholds in CI, not on the honor system):

```yaml
# vitest.config.ts (vitest 5)
test: {
  coverage: {
    provider: "v8",
    thresholds: { lines: 70, functions: 70, branches: 60, statements: 70, perFile: false },
  },
},
```

```python
# pyproject.toml (coverage.py)
[tool.coverage.run]
branch = true
source = ["src"]
```

```powershell
# Pester 6
$config = New-PesterConfiguration
$config.CodeCoverage.Enabled = $true
$config.CodeCoverage.Path = './src'
$config.CodeCoverage.OutputPath = 'coverage.xml'   # JaCoCo XML by default; OutputFormat may be 'JaCoCo' or 'Cobertura'
$config.CodeCoverage.ReportRoot = $PWD.Path        # current Pester emits repo-root-relative paths (CoverageGutters folded into JaCoCo)
```

## 3. Why coverage is necessary, not sufficient

Coverage answers one question only: which lines/branches never ran under the tests. It says nothing about:

1. Assertion strength. `add(a, b)` covered by a test that asserts nothing reports 100 percent and catches nothing. Mutation testing (`types-mutation.md`) measures this directly by injecting mutants and checking whether tests kill them.
2. Missing cases. Covered branches can still be wrong (wrong expected value, wrong fixture, wrong order).
3. Interaction coverage. 100 percent line coverage per service says nothing about pairwise integration behavior (honeycomb section in `types-functional.md`).
4. Data coverage. Covering the branch is not hitting the boundary value that matters for money math; property-based and boundary input generation (`types-input-generation.md`) addresses this.

Working policy (recommended):

- Gate on branch coverage of changed code (diff coverage, section 4), not repo-wide line coverage. Repo-wide numbers encourage exclusion lists and tests that touch lines without testing them.
- Treat covered-but-wrong as the worst failure mode in a regulated shop: pairing a modest coverage gate with a mutation score on money-math modules gives a defensible position: branch floor for breadth, mutation for depth.
- Do not chase 100 percent. 70 to 85 percent branch on changed code plus targeted mutation beats a gamed 95 percent line number. Report the excluded paths explicitly.

## 4. Diff (patch) coverage on PRs

Diff coverage = percentage of lines changed in the PR that are covered by tests. It keeps new code tested while leaving legacy debt visible instead of a repo-wide gate.

diff-cover (verified 2026-10-14: pypi diff-cover 10.6.0, docs): consumes Cobertura XML, Clover XML, JaCoCo XML, or LCov. It does not consume raw gcov files or php-coveralls XML. Key flags: `--compare-branch` (default origin/main), `--fail-under=N` (nonzero exit below threshold), `--diff-range-notation=..` vs `...`, `--expand-coverage-report` (XML only; pulls multi-line statements into the analysis), `--src-roots` for JaCoCo sources. It also powers `diff-quality` for lint violations on the diff (pycodestyle, pylint, ruff.check, checkstyle, clang, more).

```bash
# python
pytest --cov=src --cov-branch --cov-report=xml
diff-cover coverage.xml --compare-branch=origin/main --fail-under=80
# node (lcov from c8/istanbul)
diff-cover lcov.info --fail-under=80
# .NET (coverlet cobertura)
diff-cover coverage.cobertura.xml --fail-under=80
# powershell (Pester JaCoCo XML; fix paths via ReportRoot, then)
diff-cover coverage.xml --fail-under=80
# rust (cargo-llvm-cov lcov)
cargo llvm-cov --workspace --lcov --output-path lcov.info && diff-cover lcov.info --fail-under=80
```

Managed platforms: Codecov and Coveralls both compute per-PR patch coverage alongside project coverage. Codecov: `coverage.status` gates with `project` and `patch` targets, and `carryforward` flags for sharded CI. Coveralls: parallel job flags and carryforward. Both consume JaCoCo XML, lcov, cobertura (Pester JaCoCo output uploads cleanly; older Pester path bugs were fixed with `Run.RepoRoot`-relative paths and `CodeCoverage.ReportRoot`, per the Pester 6 fix note).

Rollout guidance (recommended): 2 weeks report-only, then fail-under 80 on patch, then raise per team. Add a waiver file only for generated code, migrations, and test-only glue.

## 5. Flakiness

Definition: a test that shows both pass and fail on identical code. Scale reference (Google Testing Blog, 2016): roughly 1.5 percent of all test runs were flaky; about 16 percent of their tests had some flakiness; about 84 percent of pass-to-fail transitions they investigated involved a flaky test. The lesson: flake detection and quarantine are system work, not personal hygiene.

### Root-cause classes

| Class | Signature | Fix |
|---|---|---|
| Time and timezone | fails on DST edges, month ends, CI timezone UTC | inject a clock seam (jest/vitest fake timers, freezegun/timecop 0.9.11, Go clock interface, `System.TimeProvider` in .NET); never `Date.now()` in domain code without a seam |
| Randomness | fails rarely, no repro | fixed seeds (`jest --seed`, `pytest-randomly` prints the seed, per-test `rand.Seed`), seeded PRNG in fixtures |
| Ordering and shared state | passes alone, fails in suite (or reverse) | randomize order locally to find it; make fixtures independent; DB truncate not rebuild; avoid module-scope mutable state |
| Network and third party | timeouts, DNS blips | WireMock/MSW stubs (types-functional integration section); containerized dependencies via testcontainers, not dev environments |
| Async races | unawaited promise, missing join | explicit awaits; polling on state not sleep; Playwright locator auto-waits instead of `sleep` |
| UI timing and animation | e2e fails under load | wait-for-state helpers (Playwright `waitForURL`, Cypress `cy.wait` on aliased route only); disable animations in test profile |
| Resource leaks | ports, containers, file handles, temp dirs | unique ports per run; testcontainers autostops; temp cleanup in finally |
| Data dependence | specific names, unicode, huge payloads | synthetic generators; property-based cases with shrinking (types-input-generation.md) |
| Parallelism collisions | fails only with `-j N` | quarantine suites that share a DB schema; per-worker DB name or schema |

### Detection tooling (verified 2026-10-14 unless noted)

| Stack | Tool | Flags / usage |
|---|---|---|
| Python | pytest-rerunfailures 16.7 | `--reruns=2 --only-rerun=TimeoutError --reruns-delay=1`; combined with `pytest-randomly` 5.0.0 (order shuffling + `--randomly-seed`, prints seed in header) and `pytest-repeat` 0.9.4 (`--repeat=20` to repeat each test) |
| Python | pytest-testmon 2.2.0 | impact analysis (section 6), also useful to shrink repro loops |
| Jest 30 | no `--repeat` flag (feature request closed in 2018; use a shell loop: `for i in $(seq 1 20); do jest -t "name" || break; done`) | `--randomize` (test order), `--seed=N --showSeed` for repro of shuffled order [verified CLI options] |
| Vitest 5 | `--repeat` / `repeats` config (runs each test N times, any failure fails the test) and `retry` config (count, delay, condition RegExp like `/ECONNREFUSED|timeout/`, 4.1.0+ object form) | `vitest run --repeat=20 -t name` |
| Go | stdlib | `go test -count=20 ./pkg -run TestName` (catches order and state leaks), `-race` for data races, `-shuffle=on` for order randomization [stdlib flags] |
| Rust | cargo test | loop `cargo test name -- --test-threads=1`; nextest for flaky tracking [community] |
| E2E | Playwright retries option [long-stable API; unverified], trace on retry keeps evidence; treat retries as a bug signal: CI should fail the job on any retry use, reporting `flaky` status separately | `npx playwright test --retries=1` |
| Bats | loop per test file | `for i in $(seq 1 10); do bats test/foo.bats || break; done` |

Retry policy (recommended, opinionated): at most 1 automatic retry in CI for known-flaky classes; retries must emit a separate `flaky` report that the team triages; a test that retried in the last 30 days gets a root-cause ticket; retry never masks a first-run failure in the trend (track rerun rate as a first-class metric, section 8).

### Quarantine policy (recommended)

1. A test that flips results on main within a 24h window is auto-quarantined (excluded from merge-blocking, still runs in a non-blocking job) and auto-files an issue with the seed, run links, and traces.
2. Quarantine SLA: fix or delete within 15 business days. Quarantined tests still count against the team's flake budget, so hiding from them costs the team.
3. Pool cap: if more than 1 percent of the e2e suite is quarantined, freeze the quarantine list and fix before new e2e work merges.
4. Never re-enable without a green 50-loop local run plus a stated root cause.

## 6. Test impact analysis / selective runs

Run only tests whose code (or its callers) changed. All options below verified 2026-10-14 unless noted.

| Stack | Tool / flags | Mechanics and caveats |
|---|---|---|
| Python | pytest-testmon 2.2.0 (`--testmon`) | records coverage per test on first run, maps changed functions to tests; combine with pytest-randomly for order safety; testmon and coverage plugins can conflict, check plugin list |
| Jest 30 | `--onlyChanged`, `--lastCommit`, `--changedSince=<ref>`, `--findRelatedTests <files>` [verified in CLI docs] | git-based file selection, not coverage-based; good enough for most monorepos |
| Vitest 5 | `vitest related <files>` (static import graph), `--changed [since]` (git-based), since Vitest 5 `vitest list` parses statically | `related` requires static imports; dynamic imports fall through |
| Nx | `nx affected --target=test --base=origin/main` (nx 23.3.0 verified on npm) | project-graph based; project boundaries drive granularity |
| Bazel | `bazel test //...` with cached results (only affected targets rerun), plus `bazel query "rdeps(//..., <changed>)"` or bazel-diff between commits [unverified; verify in repo] | strongest answer in large repos; requires build graph hygiene |
| Rust | crate-granular: cargo reruns a crate's tests when its sources change; `cargo nextest` partitions and can filter by name/changed files [community] | cross-crate recompiles limit precision; use `cargo llvm-cov`-style change mapping only in CI |
| Go | package-level: `go test ./changed/...`; `go build ./...` guards the rest; TIA tools are thin in Go [ecosystem note] | combine with `git diff --name-only` scripting |
| PowerShell | Pester: path-based selection (`$config.Run.Path = './changed'`) | no coverage-based TIA; keep modules importable in isolation |
| Turbo/monorepos | `turbo run test --filter=...[origin/main]` [memory, verify] | ... |

Caveats: selective runs drift. Rules (recommended): full suite nightly and before release; PR selective plus a fixed smoke subset; TIA mappings regenerate whenever coverage config changes; never let "it was affected" be tribal knowledge, the tool must print which tests it selected and why.

## 7. Test smells catalog

Sources: classic xUnit Test Patterns taxonomy [book], plus field experience. Grep-able quick audit: `sleep(` in tests, `--reruns`, `await page.waitForTimeout`, `it.skip`/`describe.skip`/`xit`/`pytest.skip`/`t.Skip`, `Test`+`Ignore`, `.only(`/`focus` markers, hardcoded IPs/ports.

| Smell | Evidence | Why it hurts | Fix |
|---|---|---|---|
| Mystery guest | test reads external file/DB/env that is not created in the test | failure diagnosis requires archaeology | build all state inside the test or a named fixture |
| Conditional test logic | `if`/`for` inside a test body | test can pass without exercising anything | split into parameterized cases |
| Sleep-based waits | `time.sleep`, `waitForTimeout`, Thread.sleep | slow and order-dependent under load | wait-for-state APIs; fake timers for time |
| Never-ending tests | no timeout, stuck CI | engineer's morning gone | per-test timeout (jest `--testTimeout` [verified flag], pytest-timeout [unverified], Go `go test -timeout`) |
| Slow unit test | unit test over 1 s | suite budget broken, tests skipped in practice | move to integration or stub the slow collaborator |
| Order dependence | passes alone, fails in suite | hides real state bugs | run randomized locally (pytest-randomly, go `-shuffle`, jest `--randomize` [verified flags]) and fix the state leak |
| Shared mutable fixtures | module-level object mutated across tests | cross-test coupling | fresh fixture per test (jest `beforeEach`, pytest fixtures function-scoped, Pester `BeforeEach`, Go fresh values per test) |
| Excessive mocking | mock of the mock, `mock.calls` asserted 5 deep | tests encode implementation, not behavior | fake at the port boundary; move to integration when 3+ mocks |
| Assertion roulette | many unlabelled asserts, failure message useless | false failures misread | one behavior per test; message on every assert |
| Skipped accumulation | `.skip`, `pytest.skip`, `t.Skip` with no ticket | silent coverage decay | CI fails on skips without linked issue; trend `skipped` count (section 8) |
| Magic constants | hardcoded ports, timeouts, account numbers | breaks CI; PII in repos | env-driven config; synthetic data generators; never real client identifiers |
| Giant arrange | 50+ lines of setup | test unreadable, duplicate fixtures | builder/fixture functions; context managers |
| Retry masking | retries on, no flaky report | real bugs swallowed | separate flaky report + quarantine (section 5) |
| Test data sprawl | one YAML per test, copy-pasted edits | change ripples across dozens of files | generate from a builder; one source of truth |
| Fragile locators | CSS chains, nth-child | break on styling refactor | role/text locators (Testing Library, Playwright getByRole) |
| Duplicate coverage | 5 tests hit the same branch, none hit the next | budget spent twice, gaps stay | mutation testing (types-mutation.md) finds the dead weight; consolidate |
| Over-specific assertion | exact full JSON compared, includes volatile fields | snapshots churn, real regressions hidden in noise | normalize volatile fields (insta redactions, syrupy matchers, Verify scrubbing); assert the contract fields |
| Wrong-level test | business rule asserted only in e2e | slowest layer, weakest diagnosis | push down: unit for math, integration/api for wiring (types-functional.md) |

## 8. Suite health metrics

| Metric | Definition | Recommended target | Collection |
|---|---|---|---|
| Unit suite runtime | wall time of unit tier on PR | < 5 min | CI step timing; fail the gate over budget |
| Integration + api runtime | both tiers, PR | < 15 min | CI step timing |
| E2E runtime | sharded, PR | < 10 min (shard count adjusts) | CI step timing |
| Nightly runtime | full matrix | < 45 to 60 min | CI |
| Flake rate | flaky runs / total runs (same code, different result) | < 1 percent (Google's observed ~1.5 percent of runs [verified blog]) | CI runner flaky reports, testmon/junit rerun annotations |
| Rerun masking rate | tests that failed first attempt, passed on retry | trend to 0 | rerun plugins output (pytest-rerunfailures, Playwright flaky status, vitest retry) |
| Quarantine pool | count + age of quarantined tests | < 1 percent of e2e, age < 15 days | dashboard from issue labels |
| Skipped count | skips without linked ticket | 0 (trend) | grep in CI + runner report field |
| Diff coverage | changed-line coverage on PR | >= 80 percent | diff-cover / Codecov patch status (section 4) |
| Coverage trend | repo-wide branch coverage | non-decreasing; report only | Codecov/Coveralls project status |
| Mutation score | killed mutants / valid mutants on selected modules | trending up; only on money-math + authz modules | types-mutation.md tools |
| Avg + p95 test duration | per-test | unit p95 < 1 s; flag > 10 s | runner junit/jest timing reports |
| Flake triage SLA | time from auto-filed flake issue to root cause | < 1 business day | issue tracker |
| Suite churn per fix | tests changed per bug fix | high churn = brittle assertions | git history over test dir |

Implementation sketch: a scheduled CI job parses JUnit XML / jest output / Playwright JSON for the run-level fields, joins with git history, and emits one JSON blob to the dashboard. Start with flake rate, runtime, diff coverage, skipped count; add mutation once the suite is stable. Alert on regression of a metric week-over-week, not absolute values.

## Sources

- Google Testing Blog, "Flaky Tests at Google and How We Mitigate Them" (1.5 percent of runs flaky, ~16 percent of tests, 84 percent of transitions): https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- GCC gcov docs (MC/DC `-g/--conditions` with `-fcondition-coverage`, prime paths `-e/--prime-paths` with `-fpath-coverage`): https://gcc.sourceware.org/onlinedocs/gcc/Invoking-Gcov.html and the masking MC/DC implementation paper linked from the GCC docs collection
- diff-cover (formats Cobertura/Clover/JaCoCo/LCOV, flags, diff-quality): https://github.com/Bachmann1234/diff_cover (README) ; pypi diff-cover 10.6.0
- Pester coverage (JaCoCo default, OutputFormat options, ReportRoot fix): https://pester.dev/docs/v5/usage/code-coverage and pester/Pester issue 2149 resolution note
- cargo-llvm-cov (line/region/function, branch and mcdc unstable flags, export formats): https://github.com/taiki-e/cargo-llvm-cov
- Vitest coverage thresholds and providers: https://vitest.dev/guide/cli (coverage.* options); retry config: https://vitest.dev/config/retry ; repeats: https://vitest.dev/config/repeats.html
- Jest CLI options (--seed, --randomize, --showSeed, --changedSince, --onlyChanged, --lastCommit, --findRelatedTests, --testTimeout; no --repeat) and issue 4336: https://jestjs.io/docs/cli and https://github.com/jestjs/jest/issues/4336
- pytest-rerunfailures, pytest-randomly, pytest-repeat, pytest-testmon, coverage.py, diff-cover, pytest-cov: pypi project pages (versions verified 2026-10-14)
- coverlet (collector/msbuild), Verify, Verify.Xunit, Reqnroll, Testcontainers .NET: nuget.org flat container index (versions verified 2026-10-14)
- JaCoCo 0.8.15 (github releases), simplecov 1.3.2, xcov 1.9.0, bashcov 4.0.0, kcov v43 (github releases), timecop 0.9.11 (rubygems)
- Codecov / Coveralls docs for patch coverage, carryforward: https://docs.codecov.com/ and https://docs.coveralls.io/ [features as described; flag syntax verify per current docs before scripting]
- xUnit Test Patterns (Meszaros) for the smell taxonomy [book reference]

Verified: on 2026-10-14, checked against registries and docs: coverage.py 7.16.2, pytest-cov 7.1.0, pytest-rerunfailures 16.7, pytest-randomly 5.0.0, pytest-repeat 0.9.4, pytest-testmon 2.2.0, diff-cover 10.6.0, syrupy 6.1.1, insta 1.49.0, jest 30.5.2, vitest 5.0.4 (@vitest/coverage-v8 5.0.4), c8 12.0.0, nyc 18.0.0, coverlet.collector 10.1.0, coverlet.msbuild 10.1.0, Verify 33.3.3, Verify.Xunit 31.12.5, Reqnroll 3.3.4, Testcontainers 4.16.0, Pester 6.2.0 (plus NuGet gallery page), phpunit 13.4.2 + php-code-coverage 14.4.1 (packagist), JaCoCo v0.8.15, cargo-llvm-cov 0.9.1, cargo-tarpaulin 0.37.5, testcontainers-rs 0.28.0, simplecov 1.3.2, bashcov 4.0.0, xcov 1.9.0, timecop 0.9.11, kcov v43, nx 23.3.0, testcontainers-java 2.0.5, testcontainers-go v0.44.0, testcontainers-python v4.15.0, mypy 2.4.0, pyright 1.1.414, ruff 0.17.0, golangci-lint v2.14.0, shellcheck v0.11.0, cppcheck 2.22.0, rubocop 1.92.0, eslint 10.12.0. Jest flag surface and the no-repeat fact from jestjs.io CLI docs and jest issue 4336. Vitest retry/repeats/changed behavior from vitest.dev docs. Pester JaCoCo behavior (default format, ReportRoot, CoverageGutters folding) from pester.dev docs and Pester issue 2149. GCC MC/DC and prime-path support from the GCC gcov manual. Google flake statistics from the 2016 Google Testing Blog post. Codecov/Coveralls gate semantics summarized from their doc sites (flag syntax not re-verified today). Items marked [memory] (pytest-timeout, nextest flaky tracking, bazel-diff, turbo filter syntax, node coverage flag, Testing Library docs migration, Approvals Ruby gem size) are from model memory: verify in-repo before quoting.