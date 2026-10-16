# Mutation testing (TYPE ID: `mutation`)

## Definition

Mutation testing makes small, systematic changes (mutants) to production code, runs the test suite against each mutant, and counts a mutant as killed when at least one test fails. A surviving mutant means the code executed but no test checked the behavior the mutant changed: the gap line coverage cannot see. Coverage tells you a line ran; a killed mutant tells you a line is meaningfully asserted on.

## Catches / misses

Catches: assertions missing or too weak (`expect(result).toBeTruthy()` instead of an exact value), boundary conditions never tested (`<` vs `<=`), untested branches, dead tests that pass for the wrong reason.
Misses: untested dependencies' internals (mocked away), UI/visual defects, non-determinism, performance, and equivalent mutants (below). Mutants only run in tests you have; mutation testing cannot invent missing tests for uncovered code paths any better than coverage can.

## When to choose / avoid

Choose for: pure business logic (financial calculations, pricing, authorization checks, parsers, date/decimal math) and small-to-medium modules with fast, deterministic tests.
Avoid for: generated UI components, configuration, glue code with slow integration tests, and anything where the full run takes hours and the module changes daily. Mutation testing multiplies test-suite runtime by the mutant count; a 5-minute suite with 400 mutants is ~dozens of minutes per module.

## Per-language tool table

| Language | Tool (version, verified 2026-10-14 unless noted) | Install | Run | Notes |
|---|---|---|---|---|
| Python | mutmut 3.8.0 | `uv add --dev mutmut` | `uv run mutmut run`, `uv run mutmut browse` | Mutates code inside functions only; use mutmut 2 for module-level mutation. Requires fork support: macOS/Linux fine, Windows only under WSL. State in `mutants/` (gitignore it). Wildcards: `mutmut run "backend.services.auth*"`. Default pick. |
| Python (large/distributed) | Cosmic Ray 8.7.0 (PyPI, 2026-08) | `pip install cosmic-ray` | `cosmic-ray init` / `cosmic-ray exec` | Session-based (SQLAlchemy-backed), can distribute mutant execution across workers. Heavier than mutmut; pick only when distribution matters. |
| JavaScript / TypeScript / React | StrykerJS 10.0.0 (GA 2026-08-14) | `npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker` | `npx stryker run` | Requires Node.js >=22 (10.0.0 dropped Node 20). Runner plugin mandatory for vitest/jest; core alone has no runner. Add the TypeScript checker to drop non-compiling mutants. |
| C# / .NET | Stryker.NET (dotnet-stryker 5.0.0 current; 4.16.0 previous line) | `dotnet tool install -g dotnet-stryker` | `dotnet stryker` | Mutation Testing Elements HTML report; supports `--since` for changed-code runs. 5.0 requires the .NET 10 SDK runtime. |
| PHP | Infection 0.35.8 (Oct 2026) | `composer require --dev infection/infection` | `vendor/bin/infection` | Requires coverage (Xdebug, PCOV, or phpdbg). MSI / MSI-CN metrics; Stryker HTML report. Git-based `--git-diff-filter` for PR runs. |
| Java / Kotlin | PIT / pitest 1.30.1 (Aug 2026) | `org.pitest:pitest-maven` or pitest-gradle-plugin | `mvn pitest:mutationCoverage` / `./gradlew pitest` | Kotlin support via pitest-kotlin plugin (still weaker than Java). Strong in CI; supports `targetTests`, history for incremental runs. |
| Rust | cargo-mutants 27.1.0 (Jun 2026) | `cargo install --locked cargo-mutants` | `cargo mutants -f src/foo.rs` | Actively maintained. Works with cargo test or nextest; `--in-diff` tests only mutants in a diff (PR mode); `#[mutants::skip]` to exclude code; sharding for parallel machines. |
| Go | gremlins 0.6.0 (Dec 2025) [preferred CLI]; ooze (gtramontina/ooze, active) as library alternative | `go install` from release binaries or `go test -tags=mutation` | `gremlins unleash` | Go tooling choice verified: gremlins (go-gremlins/gremlins) is actively maintained (v0.6.0, Dec 2025, tracked broken with Go 1.25 pending v0.7.0 - check releases before adopting); ooze is active (test-as-code style, threshold option); avito-tech/go-mutesting is a framework with fewest convenience features. Gremlins suits smallish modules; full runs can take hours on large ones. |
| Ruby | mutant 0.17.0 (Apr 2026) | `gem install mutant-rspec` (or mutant-minitest) | `mutant run --use rspec --require ./lib/app 'Foo#bar'` | Actively developed. Licensing: free for open source with `--usage opensource`; commercial use requires a paid subscription - budget it before adopting. RSpec and Minitest integrations, Rails support, incremental mode, session history in `.mutant/results/`. |
| Swift | Muter (muter-mutation-testing/muter; effectively unmaintained: last release 2023, near-zero activity) | `brew install muter-mutation-testing/formulae/muter` | `muter init`, `muter run` | Treat as archived: expect toolchain breakage with Swift 6. Keep any Muter runs strictly nightly/offline, never a PR gate; `--files-to-mutate` for incremental; can't mutate inside `@resultBuilder` bodies (SwiftUI views) - exclude those files. |
| C / C++ | Mull 0.34.1 (Sep 2026, LLVM-based); dextool (joakim-brannstrom/dextool) as alternative | precompiled packages (Cloudsmith/deb) | `mull-cxx`/`mull-runner` per LLVM version | Mull is actively maintained (LLVM 20-22 support, SARIF reporter, GitHub Code Scanning guide). LLVM version coupling is the main friction. dextool is the other LLVM-based option; its release cadence is slower [INFERENCE from repo activity; verify before adopting]. |
| PowerShell / Bash | None mature | - | - | No production-grade mutation tool exists for shell scripting languages. Alternative: treat scripts as thin glue and move logic into a mutated language (Python/C#); for shell logic that must stay, rely on ShellCheck (`static-lint`) plus behavior tests (Bats for bash, Pester for PowerShell), and hand-review branches - call this out in test plan docs as a known gap. |
| Markdown / docs | None applicable | - | - | No logic to mutate. Test code blocks in docs instead, e.g. `pytest --doctest-glob="*.md"`. |

## Python (mutmut 3) configuration, verified against the mutmut 3.6.x docs (current: 3.8.0)

```toml
[tool.mutmut]
source_paths = ["backend/"]
pytest_add_cli_args_test_selection = ["tests/"]
also_copy = ["conftest.py"]
do_not_mutate_patterns = ['logger\.\w+']
type_check_command = ["mypy", "backend", "--output", "json", "--disable-error-code", "unused-ignore"]
```

Verified mutmut 3 facts:
- The keys above are real mutmut 3 keys; equivalent setup.cfg style uses `[mutmut]` with `source_paths=`, `also_copy=`, `do_not_mutate=`, `max_stack_depth=`, `mutate_only_covered_lines=`.
- `type_check_command` supports **mypy or pyrefly only** (pyright/ty cannot match type errors to mutants). mypy form must include `--output json`; pyrefly form is `['pyrefly', 'check', '--output-format=json']`.
- Pragma exclusions: `# pragma: no mutate` (line), `# pragma: no mutate block` (indentation block, also on `def`/`class` line to skip whole node), `# pragma: no mutate start` / `end` (region, works at module level).
- Process isolation: default `fork`; switch `process_isolation = "forkserver"` when the run hangs/crashes around fork-unsafe setup (gevent, grpc, torch). Both are POSIX-only.
- macOS note: `setproctitle` is fork-unsafe on macOS; mutmut auto-disables it (override with `use_setproctitle`).
- Incremental: only re-tests mutants of functions whose source changed; detects changed non-Python files via git (or a hashed dependency-file list) and warns or reruns (`on_dependency_change = "warn" | "rerun"`).
- Workflow rule from the docs: have the file committed before applying a mutant to disk (`mutmut apply`).

## StrykerJS 10 configuration, verified against the 10.0.0 release (2026-08-14)

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "mutate": ["src/**/*.{ts,tsx}", "!src/**/*.{test,spec}.{ts,tsx}", "!src/components/ui/**"],
  "ignoreStatic": true,
  "incremental": true,
  "thresholds": { "high": 80, "low": 60, "break": 60 }
}
```

Verified StrykerJS facts:
- 10.0.0 shipped 2026-08-14; the only breaking change is Node.js >=22 (engines `>=22.0.0`). New in 10: `empty-expression` mutator, mutant filtering, Babel 8, Mocha 12 support, experimental TypeScript 7 checker support, `stryker serve` (deprecating `runServer`).
- Config surface unchanged vs 9.x; thresholds defaults are high 80 / low 60 / break null. Score below `break` exits 1.
- `ignoreStatic` skips mutants only executed at file-load time.
- `--incremental` stores results in the incremental report (`reports/stryker-incremental.json` default) and reuses them on the next incremental run; `--mutate src/app.ts:5-7` limits to a line range.
- Vitest runner limits (verified from StrykerJS docs/issues): Vitest Browser Mode is unsupported; the runner always uses per-test coverage analysis; tests that call your source over HTTP instead of importing it defeat mutant-time test selection, so run those suites through the command runner instead. Jest users use `@stryker-mutator/jest-runner` + the TypeScript checker for TSX.
- Install the runner plugin: core alone fails with "Cannot find TestRunner plugin". `npx stryker init` scaffolds it.

## Mutation operators (what tools change)

Common across tools: integer/float literals +/-1; `<` <-> `<=`, `>` <-> `>=`, `==` <-> `!=`; `&&` <-> `||`; `break` <-> `continue`; `+` <-> `-`, `*` <-> `/`; boolean literal flip; remove function call / statement; empty string/collection return; condition boundary flips in loops. Tool-specific high-value ones: mutmut increments literals and swaps break/continue; StrykerJS 10 adds empty-expression (calls, throws); cargo-mutants replaces function return values with type-guided values (`Ok(true)`, `String::new()`, empty iterators, `Vec`/`Option`/`Result` variants, struct-field deletion) and skips `new`/`Default` impls; mutant (Ruby) swaps orthogonal method selectors (`select`<->`reject`, `any?`<->`none?`) and strips bang methods; PIT mutates BigDecimal/BigInteger constants; Infection has ~100 PHP-specific mutators.

## Equivalent mutants and survivor triage

An **equivalent mutant** changes text but not observable behavior (e.g. `<` to `<=` where the boundary is unreachable). It can never be killed and artificially lowers the score. Mitigations: mark/ignore the mutant, exclude the pattern (`do_not_mutate_patterns`, `#[mutants::skip]`, `// Stryker disable next-line`), or refactor so the equivalent case disappears.

Survivor triage workflow (every survivor gets one of four verdicts):

1. **Reproduce**: open the diff for the mutant; run only the tests that touch the module.
2. **Classify**: (a) missing test -> write the test that kills it; (b) weak assertion -> strengthen to an exact value; (c) equivalent/unviable mutant -> record why, then suppress via the tool's ignore mechanism; (d) dead code -> delete the code (mutation testing doubles as a dead-code detector).
3. **Record**: track survivors per module so the same class of gap is not re-discovered nightly.
4. **Gate only on triaged survivors**: new survivors after the baseline block the PR; old ones stay on a backlog.

## Rollout (incremental adoption)

1. **Pilot**: one high-risk module (auth, pricing, a calculation service). Full-repo runs can take hours; start where it pays.
2. **PR incremental runs**: changed code only. Stryker `--incremental`; mutmut wildcards `mutmut run "backend.services.auth*"`; cargo-mutants `--in-diff <patch>`; Infection `--git-diff-filter`; Stryker.NET `--since`; PIT history/incremental analysis; Muter `--files-to-mutate` from `git diff`.
3. **Nightly full runs**: incremental mode can miss mutants triggered indirectly by dependency, config, or snapshot changes (Stryker's incremental file is per-mutant; mutmut re-detects non-Python changes, but treat nightly full runs as the safety net).
4. **Trend before gate**: record the score for several weeks before setting `break`. A cold-start baseline on a legacy module is often 40-60; gating immediately breaks every build.
5. **Risk-prioritize**: under Reg S-P / FTC Safeguards, weight client-data handling, authorization checks, and financial calculations highest. A survivor in a permission check (`is_owner()` returning `false` -> `true`) outranks one in a log message. Score modules separately, not as one repo-wide average; an 80% repo score can hide a 20% score in the billing module.

## PR vs nightly strategy

| Stage | Scope | Gate |
|---|---|---|
| PR | Changed files/modules only (tool incremental modes above) | New survivors block; `break` threshold optional at first |
| Nightly | Full repo (or all opted-in modules) | Score trend recorded; regressions >2-3 points open an issue |
| Quarterly | Review exclusions, thresholds, equivalent-mutant list | Raise `break` as triage backlog drains |

## Interpreting results and thresholds

- Mutation score = killed / (killed + survived) (some tools exclude non-viable/not-covered mutants from the denominator; Infection's MSI-CN also discounts not-covered mutants - know which metric you report).
- No universal target: 60-80% is a common steady state for business logic; chasing >95% spends time on low-value/equivalent mutants. What matters is the trend and the survivors in risk-prioritized code.
- Timeouts count as killed (the mutant made the test hang) - a test suite that kills by timeout is masking a missing assertion, so check timeout counts.
- Not-covered mutants are free signal: they mark production code no test reaches at all.

## Regulated-data priority (Henssler Financial)

- Mutate first: account aggregation, fee/pricing calculations, RMD logic, authorization predicates, encryption-wrapping code paths, and any code that constructs or filters client data responses.
- Record the mutation-score baseline per critical module; this doubles as test-effectiveness evidence for the FTC Safeguards Rule control-monitoring expectations and supports the SEC Reg S-P incident-response posture (a well-mutated auth/encryption module is evidence that controls are tested, not just present).
- Never run mutation tooling against production data stores; runs execute mutated code - keep them in CI against fixtures.

## Sources

- https://mutmut.readthedocs.io/en/latest/ (configuration, process isolation, pragmas, workflow)
- https://github.com/boxed/mutmut (3.8.0; config docs verified against 3.6.x)
- https://pypi.org/project/cosmic-ray/ (v8.7.0)
- https://github.com/stryker-mutator/stryker-js/releases (v10.0.0, 2026-08-14, Node >=22, empty-expression mutator)
- https://stryker-mutator.io/docs/stryker-js/vitest-runner/ (per-test coverage; browser mode)
- https://github.com/sourcefrog/cargo-mutants + https://crates.io/crates/cargo-mutants (27.1.0)
- https://github.com/infection/infection/releases + https://packagist.org/packages/infection/infection (0.35.8)
- https://github.com/hcoles/pitest/releases + https://central.sonatype.com/artifact/org.pitest/pitest (1.30.1)
- https://github.com/go-gremlins/gremlins (v0.6.0) and https://github.com/gtramontina/ooze (Go tool comparison)
- https://github.com/mbj/mutant (v0.17.0, licensing)
- https://github.com/muter-mutation-testing/muter (Swift)
- https://github.com/mull-project/mull (0.34.1, CHANGELOG)
- https://stryker-mutator.io (Stryker.NET 5.0.0 via NuGet; family overview)

Verified: 2026-10-14 via web search/fetch - mutmut 3.8.0 (config docs verified against 3.6.x: all config keys, pragma syntax, fork/forkserver, function-only mutation, mypy/pyrefly-only, `mutants/` dir, WSL/fork, committed-before-apply rule), Cosmic Ray latest 8.7.0, StrykerJS 10.0.0 release notes (date, Node 22 breaking change, empty-expression mutator, thresholds defaults, ignoreStatic/incremental flags), Go tool maintenance (gremlins active v0.6.0; ooze active; go-mutesting framework), cargo-mutants 27.1.0, Infection 0.35.8, PIT 1.30.1, mutant 0.17.0 + commercial licensing, Mull 0.34.1 changelog, Muter last release 2023 (unmaintained), Stryker.NET 5.0.0. From memory / not re-verified: [unverified] dextool release cadence, PIT kotlin-plugin current version, Infection MSI-CN denominator detail, PowerShell/Bash "none mature" absence proof (negative claim; no tool found in research).
