# Go testing

Language-specific tooling for testing Go modules. For type definitions and procedures see `workflow.md`; scoring lives in `selection-and-gaps.md`. Versions verified 2026-10-14 unless marked `[unverified]`.

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | golangci-lint v2.14.0 (2026-09; 2.x series) + staticcheck (merged into golangci-lint as `staticcheck` linter) | binary release, `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest` | `golangci-lint run ./...` | v2 config format is incompatible with v1; `staticcheck`, `gosimple`, `stylecheck` are one linter now. govet ships with it. |
| type-check | go build + go vet (built in) | none | `go build ./... && go vet ./...` | No separate static type tool; vet catches printf, copylocks, shadow. |
| unit | testing pkg + testify v1.12.1 (assert/require), table-driven + `t.Run`, `t.Parallel()` | `go get github.com/stretchr/testify` | `go test ./... -count=1` | Prefer `require` over `assert` for precondition failures. Mocks: go.uber.org/mock v0.6.0 (`mockgen`) or mockery v3.8.1 (`golang/mock` is archived). testifylint via golangci-lint flags misuse. |
| integration | testcontainers-go v0.44.0 | `go get github.com/testcontainers/testcontainers-go` | `go test ./...` (tagged) | Auto-terminates containers per test; Docker required; modules provided for Postgres, Kafka, Redis, LocalStack. |
| component | go test + httptest against subrouters / in-memory dependencies | none | `go test ./...` | Treat as unit-with-fakes; no fixed tool. |
| api | httptest (stdlib) + testify assert | none | `go test ./...` | Test handlers with `httptest.NewRecorder`, real routers (chi/gin) mounted per test. |
| contract | pact-go v2.8.0 | `go get github.com/pact-foundation/pact-go/v2` + `pact-go install` (cgo required) | go test files using `consumer.NewV2Pact` / `HTTPVerifier` | Spec 2/3/4; needs Pact Broker or Pactflow for CI workflows. musl Linux has known segfaults. |
| e2e | language-agnostic (Playwright, k6, curl-based suites) | n/a | n/a | No first-class Go e2e framework; drive browser tools from any language. |
| smoke | build tags + `testing.Short()` | none | `go test -short ./...` vs full run | Gate deploys on `go test -short -race ./...`. |
| regression | go test suite, `-count=1` to disable cache | none | `go test ./... -count=1` | Go caches passing tests; always `-count=1` in CI. |
| acceptance-bdd | godog (Cucumber for Go) `[unverified minor]` | `go get github.com/cucumber/godog` | `godog run` or go test hook | Gherkin feature files, step defs in Go. |
| snapshot-approval | golden files (no canonical tool); goldie `[unverified minor]` | `go get github.com/sebdah/goldie` | part of go test | Compare `*.golden` files; `-update` flag to refresh. |
| characterization | golden files + `go test -count=1` | none | n/a | Pin legacy behavior with golden outputs before refactoring. |
| property-based | rapid v1.3.0 (`pgregory.net/rapid`) | `go get pgregory.net/rapid` | runs inside `go test` | `rapid.Check(t, ...)`; automatic minimization; `MakeFuzz` turns a property into a native fuzz target. |
| fuzz | native Go fuzzing (stdlib `testing.F`, go 1.18+) | none | `go test -fuzz=FuzzX -fuzztime=60s ./pkg` | Coverage-guided; corpus in `testdata/fuzz/`. Seed corpus checked on every normal `go test`. |
| metamorphic | implement with rapid or native fuzz | none | n/a | Express as property (same output after invariant transforms). |
| combinatorial | table-driven subtests | none | n/a | For real cartesian coverage prefer rapid generators. |
| differential | side-by-side tests (new impl vs old impl) | none | n/a | Keep old implementation as reference until parity proven. |
| model-based | rapid state machines (`rapid.StateMachine`) | `go get pgregory.net/rapid` | runs inside go test | Model parallel/mutating systems as command sequences. |
| mutation | gremlins v0.6.0 (go-gremlins/gremlins, active; tracked broken with Go 1.25 pending v0.7.0, check releases); ooze (gtramontina/ooze) as library alternative | gremlins from release binaries; ooze via go dep | `gremlins unleash` | `--git-diff-lines` for PR scope, full trees nightly. mutago (jonbaldie/go-mutesting, v2.10.x) is the newer alternative. gremlins.dev moved to GitHub; the old domain is gone. |
| coverage | go cover, `-coverpkg=./...`; integration-mode coverage via `GOCOVERDIR` | none | `go test -coverprofile=c.out -coverpkg=./... ./...` | Merge profiles with `go tool covdata textfmt` from `GOCOVERDIR`; see coverage guide in `types-test-quality.md`. |
| flakiness | `go test -race -shuffle=on -count=10` | none | same | Race detector is the main flake hunter; `-shuffle=on` reorders tests. t.Parallel everywhere possible. |
| benchmark | go bench + benchstat | included / `go install golang.org/x/perf/cmd/benchstat@latest` | `go test -bench=. -benchmem ./...`, then `benchstat old.txt new.txt` | Commit baselines to CI artifacts; compare before/after. |
| load | language-agnostic: vegeta, k6, Grafana k6 `[unverified minor]` | binary install | vegeta attack / k6 run | Keep out of unit suite; nightly or pre-release only. |
| chaos | no canonical Go tool; toxiproxy for fault injection | binary / testcontainers module | run alongside integration tests | Inject via toxiproxy between service and dependencies. |
| accessibility | language-agnostic | n/a | n/a | Browser stack; see `types-nonfunctional.md`. |
| visual-regression | language-agnostic (Playwright screenshot) | n/a | n/a | see `types-nonfunctional.md`. |
| cross-browser | language-agnostic | n/a | n/a | see `types-nonfunctional.md`. |
| i18n | no canonical tool; test `golang.org/x/text` message catalogs in unit tests | include x/text tests | `go test ./...` | Assert translations exist for all locales, plural rules. |
| sast | gosec (via golangci-lint) | included in golangci-lint | `golangci-lint run --enable gosec` | Flags unsafe/weak crypto/padding oracle patterns. |
| sca | govulncheck (golang.org/x/vuln) | `go install golang.org/x/vuln/cmd/govulncheck@latest` | `govulncheck ./...` | Reports only reachable vulnerabilities (symbol analysis). Run weekly + in CI. |
| secrets | gitleaks (language-agnostic) | binary | `gitleaks detect --redact` | see `types-security.md`. |
| dast | language-agnostic | n/a | n/a | see `types-security.md`. |
| iac-policy | n/a for Go source; cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| container-scan | cross-ref `infra-iac-containers-ci.md` (trivy for built images) | n/a | n/a | |
| authz | unit-test wrappers/middleware with table-driven cases | none | `go test ./...` | No dedicated tool; enumerate roles in table columns. |
| data-quality | cross-ref `data-sql-databases.md` | n/a | n/a | |
| db-migration | golang-migrate + testcontainers-go with init SQL | `go get github.com/golang-migrate/migrate/v4` | go test with Postgres container | Assert migrations up and down cleanly. |
| docs-examples | Go example functions (`func ExampleFoo()` with `// Output:`) | none | `go test ./...` | Runnable docs; mismatches fail the build. |
| notebook | n/a (Go kernels rare; if notebooks exist use language-agnostic checks) | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| link-check | language-agnostic | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| ci-pipeline | GitHub Actions `actions/setup-go` with caching | workflow YAML | `go test -race ./...`, `golangci-lint`, `govulncheck` | Typical job: lint, vet, unit+race, build, integration, mutation nightly. |
| exploratory | human-led | n/a | n/a | see `types-functional.md`. |
| usability | human-led | n/a | n/a | see `types-functional.md`. |

## Recommended default stack

Standard library `testing` plus testify for assertions and table-driven subtests. golangci-lint (v2) as the single static gate. testcontainers-go for anything requiring real dependencies. Rapid for properties, native fuzzing for parsers and decoders, govulncheck for dependencies. Mutation and load gates run nightly, everything else per PR.

Why: stdlib tests need zero dependencies and run anywhere Go runs; testcontainers avoids bespoke docker-compose glue; rapid is stable, dependency-free and integrates with the native fuzzer; govulncheck's reachability analysis removes noise that raw CVE feeds produce.

## Config snippets

.golangci.yaml (v2, note the version key; `golangci-lint migrate` converts v1):

```yaml
version: "2"
linters:
  default: standard
  enable:
    - gosec
    - testifylint
    - tparallel
    - prealloc
  settings:
    govet:
      enable-all: true
formatters:
  enable:
    - gofumpt
issues:
  max-issues-per-linter: 0
  max-same-issues: 0
```

Coverage, unit + integration:

```bash
go test -race -shuffle=on -count=1 -coverprofile=c.out -coverpkg=./... ./...
go tool cover -func=c.out
# integration coverage: build with -cover, run with GOCOVERDIR
go build -cover ./cmd/app && mkdir cov && GOCOVERDIR=cov ./app &  # exercise via httptest
go tool covdata textfmt -i cov -o integration.out
```

Fuzzing and benches:

```bash
go test -fuzz=FuzzParse -fuzztime=90s -run '^$' ./internal/parse
go test -run=^$ -bench=BenchmarkQuery -benchmem ./internal/query | tee new.txt
benchstat baseline.txt new.txt
```

Mutation gate (nightly):

```bash
gremlins unleash --git-diff-lines --min-covered-msi 75 ./...
```

## Gotchas

- golangci-lint v2 is not backwards compatible with v1 configs; pin one binary version via CI action and run `golangci-lint migrate` once, deliberately.
- Go's test cache hides flakes: CI must pass `-count=1` (mutation and coverage runs set it internally, ordinary invocations do not).
- `-race` requires cgo-free builds of Go but works on all platforms; it does not catch data races in code paths never executed, keep integration tests running with race on.
- t.Parallel must be called both in the parent and in subtests to parallelize; testifylint/tparallel enforce this. testify `suite` does not support parallel tests.
- Pact-go requires cgo and a Rust-built FFI library installed via `pact-go install`; on Alpine/musl images plan for the documented segfaults.
- testcontainers needs Docker in CI (testcontainers-cloud or GHA service containers); reaper/ryuk requires privileged or default socket access, disable via TESTCONTAINERS_RYUK_DISABLED for restricted runners.
- Coverage: `go test -cover` counts only the package under test unless `-coverpkg=./...`; integration coverage needs the `-cover` build flag and `GOCOVERDIR`, profiles are merged with `go tool covdata`.
- Benchmarks with default harness are noise-sensitive: pin CPU, use `benchstat` with >= 10 runs (`-count=10`) or move to a dedicated runner.
- Mutation testing multiplies test runtime by number of mutants; keep it to changed lines in PRs (`--git-diff-lines`) and full trees nightly.
- Native fuzzing keeps writing to the seed corpus dir under `testdata/fuzz`; commit interesting cases, and remember normal `go test` replays the corpus (fast) without coverage guidance.
- Windows CI: race detector supported; testcontainers works but Docker Desktop must be installed and running on the runner.

## Sources

- https://golangci-lint.run/docs/product/migration-guide/ (v2 config)
- https://github.com/golangci/golangci-lint/releases/tag/v2.0.0
- https://pkg.go.dev/github.com/stretchr/testify (v1.12.1, 2026-08-19)
- https://github.com/uber-go/mock (go.uber.org/mock v0.6.0; golang/mock archived)
- https://github.com/vektra/mockery/releases (v3.8.1)
- https://github.com/testcontainers/testcontainers-go/releases (v0.44.0)
- https://github.com/pact-foundation/pact-go (v2.8.0)
- https://github.com/flyingmutant/rapid/releases (v1.3.0; import pgregory.net/rapid)
- https://go.dev/doc/tutorial/fuzz (native fuzzing)
- https://github.com/go-gremlins/gremlins (gremlins v0.6.0) and https://github.com/gtramontina/ooze; https://github.com/jonbaldie/go-mutesting (mutago alternative)
- https://pkg.go.dev/testing (coverage, bench, shuffle flags)
- https://golang.org/x/vuln (govulncheck)
- https://github.com/cucumber/godog

Verified: confirmed 2026-10-14 via web: testify v1.12.1, golangci-lint v2.14.0 (GitHub releases) and v2 config format, go.uber.org/mock v0.6.0 + golang/mock ARCHIVED, mockery v3 GA + v3.8.1, testcontainers-go v0.44.0, pact-go v2.8.0 + cgo/musl caveats, rapid v1.3.0, native fuzzing flags, gremlins v0.6.0 active / ooze active / mutago v2.10.x active. From memory, flagged unverified: godog minors, goldie, benchstat install path correctness.