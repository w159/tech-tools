# Rust testing

Language-specific tooling for testing Rust crates and workspaces. For type definitions and procedures see `workflow.md`. Versions verified 2026-10-14 unless marked `[unverified]`.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | clippy (ships with rustup) + rustfmt | `rustup component add clippy` | `cargo clippy --all-targets -- -D warnings` | Pedantic/nursery lints opt-in via attributes; warn-by-default set in CI. |
| type-check | cargo check + rustc lints | none | `cargo check --workspace --all-targets` | Type system is compile-time; `#[deny(...)]` lints in code. |
| unit | cargo test (`#[test]`, `#[cfg(test)]` modules) + nextest 0.9.148 | `cargo install --locked cargo-nextest` | `cargo nextest run` | nextest runs one process per test (isolation, retries, JUnit output); keep cargo test for doc tests. |
| integration | cargo test (tests/ dir) + nextest | none | `cargo nextest run --test '*'` | tests/*.rs binaries; use temp dirs or testcontainers-rs for services `[unverified minor]`. |
| component | cargo test with fakes behind traits (no fixed tool) | none | `cargo nextest run` | Design seams per `codebase-design`; axum/actix handlers via `tower::ServiceExt::oneshot`. |
| api | cargo test with the real router/service (axum test-client style helpers) `[unverified tools]` | none | `cargo nextest run` | Mount full router, call via in-memory service; Testcontainers for the backing store. |
| contract | no stable Rust-native Pact client; use Pact CLI wrappers or polyglot consumers | n/a | pact-cli containers in CI | Rust core of Pact is upstream, but Rust client crates lag `[unverified]`; run contract tests from JS/Go/Python consumers against Rust providers. |
| e2e | language-agnostic (Playwright, k6) | n/a | n/a | Drive from any language against the running binary. |
| smoke | filtered test set (`cargo test -- --skip slow` / nextest filters) | none | `cargo nextest run -E 'not test(slow)'` | nextest filter expressions (nexte.st/book/filter-expressions). |
| regression | full suite + cargo-semver-checks `[unverified minor]` | `cargo install cargo-semver-checks` | `cargo semver-checks` | Catches public API breakage against the last released crate version. |
| acceptance-bdd | cucumber crate `[unverified minor]` | `cargo add --dev cucumber` | `cargo test --test features` | Gherkin features, step functions with macros. |
| snapshot-approval | insta 1.49.0 | `cargo add --dev insta` | `cargo insta test` + `cargo insta review` | Inline `assert_snapshot!` / file snapshots; review CLI for approve/reject; CI must run with `INSTA_UPDATE=no`. |
| characterization | insta snapshots + full suite | none | `cargo insta test` | Pin legacy behavior with snapshots before refactor. |
| property-based | proptest 1.12.0, quickcheck 1.1.0 | `cargo add --dev proptest` | `cargo test` (pick up strategies in test fns) | proptest: shrinking + `proptest!` macro; quickcheck: simpler API, slower shrink. Failures persist in `proptest-regressions/`, commit them. |
| fuzz | cargo-fuzz (libFuzzer backend) or afl.rs `[unverified minors]` | `cargo install cargo-fuzz` | `cargo fuzz run <target> -O -- -max_total_time=120` | Targets under fuzz/; corpus and artifacts in fuzz/artifacts; run nightly in CI with a time budget. |
| metamorphic | implement as proptest properties (transform, compare) | none | n/a | e.g. compressed(decompressed(x)) == x. |
| combinatorial | proptest strategies over tuples | none | n/a | Exhaustive small domains: use `proptest::collection` and `Arbitrary`. |
| differential | tests comparing two impls (feature flag or old crate) | none | n/a | Common for codec/serialization parity. |
| model-based | loom 0.7+ `[unverified minor]` for concurrency model checking; proptest stateful for command models | `cargo add --dev loom --target 'cfg(loom)'` | `RUSTFLAGS="--cfg loom" cargo test` | loom explores thread interleavings exhaustively (slow: CI nightly subset). |
| mutation | cargo-mutants v27.1.0 | `cargo install cargo-mutants` | `cargo mutants --test-tool nextest` | Set timeouts relative to baseline; `--sharding` across CI workers; `#[mutants::skip]` for false positives. |
| coverage | cargo-llvm-cov 0.9.1 (LLVM instrument-coverage) | `cargo install cargo-llvm-cov` | `cargo llvm-cov --lcov --output-path lcov.info` | Branch coverage `--branch` needs nightly; doctests `--doctests` also nightly-only. tarpaulin exists but is superseded by native coverage; avoid in new projects. |
| flakiness | nextest retries + per-test isolation, criterion-style seeds in proptest | none | `cargo nextest run --retries 2` | nextest flags flaky tests in output; reruns on failure; JUnit output records retry counts. |
| benchmark | criterion 0.8.2 (gnuplot optional), divan 0.1.x `[unverified minor]` | `cargo add --dev criterion --features html_reports` | `cargo bench` | `[[bench]] name = "x" harness = false` in Cargo.toml; baselines via `--save-baseline`. Criterion 0.6+ always uses `std::hint::black_box`. |
| load | language-agnostic (k6, vegeta) | n/a | n/a | see `types-nonfunctional.md`. |
| chaos | no canonical tool; testcontainers + fault-injecting proxies | n/a | n/a | see `types-nonfunctional.md`. |
| accessibility | language-agnostic | n/a | n/a | see `types-nonfunctional.md`. |
| visual-regression | language-agnostic (Playwright) | n/a | n/a | see `types-nonfunctional.md`. |
| cross-browser | language-agnostic | n/a | n/a | Wasm frontends still verified via browser tools. |
| i18n | no canonical tool; fluent-rs projects unit-test message selectors `[unverified tools]` | none | `cargo test` | Assert bundles resolve all locales, fall back correctly. |
| sast | clippy + rustc deny-list; optional semgrep `[unverified]` | rustup | `cargo clippy -- -W clippy::unwrap_used` | Deny `unwrap_used`, `expect_used`, `panic` in library code paths handling input. |
| sca | cargo-audit (RustSec advisories) + cargo-deny 0.20.2 | `cargo install cargo-audit cargo-deny` | `cargo audit`, `cargo deny check` | deny.toml controls licenses/bans/sources; advisory DB is machine-readable, great in CI. |
| secrets | gitleaks (language-agnostic) | binary | `gitleaks detect --redact` | see `types-security.md`. |
| dast | language-agnostic | n/a | n/a | see `types-security.md`. |
| iac-policy | cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| container-scan | cross-ref `infra-iac-containers-ci.md` (trivy for built images) | n/a | n/a | |
| authz | unit-test policy modules with proptest over role combinations | none | `cargo test` | No dedicated tool; generate (role, resource, action) triples. |
| data-quality | sqlx::test macros for DB-backed tests `[unverified]` | sqlx dev-dep | `cargo test` | Cross-ref `data-sql-databases.md`. |
| db-migration | sqlx migrate / refinery tests against testcontainers Postgres | none | `cargo test` | Assert migrations apply forward cleanly; cross-ref `data-sql-databases.md`. |
| docs-examples | doc tests (fenced `rust` blocks in `///` doc comments) | none | `cargo test --doc` | Failing doc test fails build; `# use mycrate as _;` hides imports. |
| notebook | n/a (Rust kernels rare) | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| link-check | language-agnostic; rustdoc broken-intra-doc-links via `cargo doc` warnings | none | `cargo doc --no-deps` | `-D rustdoc::broken_intra_doc_links` in CI. |
| ci-pipeline | GitHub Actions with rustup, cargo-chef/swatinem cache actions `[unverified]` | workflow YAML | clippy, fmt, nextest, llvm-cov, audit, deny | Cache target/ via SwatinemRust action or sccache; doc tests separate step. |
| exploratory | human-led | n/a | n/a | see `types-functional.md`. |
| usability | human-led | n/a | n/a | see `types-functional.md`. |

## Recommended default stack

cargo test for correctness of everything simple, nextest as the runner in CI (isolation plus retries kills most flakes), clippy + fmt + `cargo check` as static gates, insta for snapshots, proptest for parsers/serializers, cargo-fuzz nightly for decoders, cargo-mutants on a sharded nightly, cargo-llvm-cov for coverage reporting, cargo-audit + cargo-deny for the supply chain, criterion where performance matters.

Why: this is the community-consensus stack; every piece is actively maintained (all confirmed above), the pieces compose (nextest is a test tool for cargo-mutants and cargo-llvm-cov), and the nightly-only features are isolated to optional flags instead of workflows.

## Config snippets

Cargo.toml (dev-deps and bench harness):

```toml
[dev-dependencies]
insta = "1"
proptest = "1"
criterion = { version = "0.8", features = ["html_reports"] }

[[bench]]
name = "core_ops"
harness = false
```

nextest.toml (workspace root):

```toml
[profile.ci]
fail-fast = false
retries = { counter = "global", initial-count = 0, max-fail = 3 }
slow-timeout = { period = "60s", terminate-after = 2 }

[profile.ci.junit]
path = "junit.xml"
```

deny.toml (minimal):

```toml
[advisories]
version = 2
deny = ["unmaintained"]

[licenses]
version = 2
allow = ["MIT", "Apache-2.0", "BSD-3-Clause", "Unicode-3.0"]
```

CI command sequence:

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --profile ci
cargo llvm-cov --lcov --output-path lcov.info
cargo audit && cargo deny check
```

Nightly jobs:

```bash
cargo fuzz run fuzz_parse -O -- -max_total_time=1800
cargo mutants --test-tool nextest --sharding slice --jobs 8
cargo semver-checks
```

## Gotchas

- nextest does not run doc tests; keep a `cargo test --doc` step or accept nightly `cargo llvm-cov --doctests` only under nightly.
- insta in CI: run with `INSTA_UPDATE=no` (default in CI contexts) and fail on new snapshots; use `cargo insta review` locally. Do not commit `.snap.new` files.
- proptest failures persist to `proptest-regressions/`; commit that directory or CI reruns will not replay the shrunk case.
- cargo-fuzz requires nightly (libFuzzer); plan a dedicated job, and never run fuzzers with unrestricted time in PR CI. Fuzz targets compiled with sanitizers (AddressSanitizer) catch memory issues; enable via `-Cpasses=sancov-module` guidance or cargo-fuzz flags.
- loom is exhaustive over interleavings: runtime explodes with task count. Only a small, marked test subset should be cfg(loom).
- cargo-mutants copies the tree per run (reflinks on APFS/Btrfs/XFS make this cheap); avoid `--jobs` above 8; skip `#[tokio::test]`-style test fns automatically (treated like `#[test]`).
- coverage branches and doctests need nightly; stable line/region coverage is fine for PR gating.
- criterion compares against baselines stored in target/criterion; save a baseline on main in CI (`--save-baseline main`) and run with `--baseline main` on branches.
- MSV targets: criterion 0.8 needs Rust 1.86+; nextest MSRV 1.91 for building it. Check these against your toolchain policy before pinning.
- doc tests run with the doctest compiler sandbox; anything requiring files or network belongs in tests/ instead.
- Integration tests share one binary per tests/*.rs file: slow global setup repeats; use shared workspace helpers crate.

## Sources

- https://nexte.st and https://crates.io/crates/cargo-nextest (0.9.148, 2026-10-08)
- https://mutants.rs/changelog.html and https://github.com/sourcefrog/cargo-mutants/releases (v27.1.0)
- https://github.com/taiki-e/cargo-llvm-cov (0.9.1)
- https://github.com/criterion-rs/criterion.rs/releases (0.8.2, 2026-02-04)
- https://crates.io/crates/insta (1.49.0)
- https://doc.rust-lang.org/cargo/ (doc tests, bench harness)
- https://github.com/proptest-rs/proptest, https://github.com/BurntSushi/quickcheck
- https://github.com/rust-fuzz/cargo-fuzz, https://github.com/rust-fuzz/afl.rs
- https://github.com/rustsec/rustsec (cargo-audit), https://github.com/EmbarkStudios/cargo-deny
- https://github.com/google/loom (concurrency model checking)
- https://github.com/cucumber-rs/cucumber
- https://ciaran.land/posts/rust-test-coverage/ (tarpaulin superseded by native coverage)

Verified: confirmed 2026-10-14 via web: cargo-nextest 0.9.148, cargo-mutants v27.1.0 (2026-06-02) with nextest/sharding options, cargo-llvm-cov 0.9.1 with fail-under/branch/doctest flags, criterion 0.8.2 (MSRV 1.86), insta 1.49.0, proptest 1.12.0, quickcheck 1.1.0, cargo-deny 0.20.2, tarpaulin superseded by native instrument-coverage, criterion maintenance handover. From memory, flagged unverified: cargo-fuzz/cargo-audit/loom/cucumber/cargo-semver-checks minor versions, divan current status.