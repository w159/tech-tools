# Shell / Bash testing reference

How POSIX sh and Bash scripts map to the atlas-testing taxonomy. TYPE IDs are the canonical ids from `references/taxonomy.md`; gap output references rows here.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | ShellCheck v0.11.0; shfmt v3.14.1 (mvdan/sh) | `brew install shellcheck shfmt` | `shellcheck -x script.sh`, `shfmt -d .` | ShellCheck is the mandatory gate (Bash 5.3 + POSIX.1-2024 aware); shfmt enforces formatting via `shfmt -d` in CI (or `--write` locally). Set the intended dialect per file: `# shellcheck shell=bash` or `sh`. |
| type-check | Not applicable (see list) | | | |
| unit | bats-core v1.14.0 + bats-assert 2.2.4 + bats-support 0.3.0 + bats-file 0.4.0 | `brew install bats-core`, libs via git submodules/`npm`/BATS_LIB_PATH | `bats tests/` | `@test` blocks, `run` helper capturing `$status`/`$output`/`$lines`, `assert_output`, `assert_success`, file helpers, tags (`# bats test_tags=`), `BATS_TEST_TIMEOUT`, `BATS_TEST_RETRIES`, `--jobs` parallel, `--abort` fail-fast, junit formatter for CI. |
| integration | bats with real fixtures or containers (docker/podman); shellspec 0.28.1 as the alternative framework | brew / apt | `bats tests/integration/` | Spin disposable containers in `setup_file`, run the script against real services, assert outputs. shellspec covers the same ground with richer matchers and POSIX-shell support (dash, busybox, zsh, ksh). |
| api | bats calling `curl` against a stub server or a running service; jq assertions on JSON responses | bats + jq | `bats tests/api/` | Assert status, headers, and JSON body shape with `run` + `jq -e`; for provider-side contracts, see `references/types-functional.md`. |
| contract | Not applicable (see list) | | | |
| e2e | bats invoking the full CLI/entrypoint with a prepared environment | bats | `bats tests/e2e/` | Highest-fidelity row: run the actual script as a user would, assert stdout/stderr/exit code/artifacts. Nightly. |
| smoke | bats smoke suite (tagged or separate dir) | bats | `bats tests/smoke/` | Shebang valid, `--help` works, binary deps present; runs on every CI build in seconds. |
| regression | bats full suite re-run; failing-case-first workflow | bats | `bats tests/` | Every reported bug becomes a `@test` reproducer before the fix. |
| snapshot-approval | Golden-file pattern: write command output to a file, `diff golden.txt <(run...)`; or bats `assert_output` with file fixtures | bats | `bats tests/` | No dedicated snapshot tool; keep goldens in `tests/golden/` and update deliberately. Also compare ANSI-stripped output (strip via `sed`/`ANSI_CODES` filter) to avoid terminal-color noise. |
| characterization | Golden-file diff over wrapped legacy scripts | bats | `bats tests/` | Pin current behavior of untested scripts before refactoring; see `references/types-test-quality.md`. |
| coverage | kcov 43 (latest stable release; v44 in pre-release testing) | `brew install kcov` / apt | `kcov --bash-dont-erase-script-dir coverage tests/test.sh` | Instruments bash via DEBUG trap/`BASH_XTRACEFD`; produces Cobertura/HTML, merges across runs (`--merge`), excludes lines with `KCOV_EXCL_LINE`. Runs the whole script, so pair with bats via kcov wrapping the bats invocation. |
| benchmark | hyperfine 1.20.0 | `brew install hyperfine` | `hyperfine 'script.sh arg' 'alt.sh arg'` | Statistical timing for script micro-benchmarks and migration A/B comparisons; export JSON/markdown for CI dashboards. |
| data-quality | bats + jq over CSV/JSON outputs of scripts | bats | `bats tests/data/` | Assert column counts, null-free required fields, referential checks on script outputs; see `references/types-test-quality.md` for the data-quality checklist. |
| db-migration | bats smoke tests against a disposable Postgres container (`psql` apply, schema assert) | bats + docker | `bats tests/migration/` | Only where shell drives migrations; the heavyweight version lives in `references/data-sql-databases.md`. |
| sast | ShellCheck (security rules: SC2086 quoting, SC2115 rm, SC2024 sudo redirection, etc.) | brew | `shellcheck -x -S style` | ShellCheck doubles as the shell SAST; treat error-severity findings as release blockers. |
| secrets | gitleaks / trufflehog (repo-wide) | brew | `gitleaks detect --no-banner` | Catches tokens in scripts, env fixtures, and CI files. |
| ci-pipeline | bats + ShellCheck + shfmt + actionlint (workflow lint) in CI; junit output via `bats --report-formatter junit` | brew/npm | `bats --report-formatter junit tests/ > junit.xml` | Publish junit.xml to the CI test reporter; run shellcheck/shfmt/actionlint as fast separate jobs. |
| i18n | Stability practice: run tests under `LC_ALL=C.UTF-8` (or a fixed locale) and add one locale-sensitive test where behavior varies | bats | env var in test setup | Pin locale in `setup` so sort/format behavior is deterministic; add explicit locale tests only where the script sorts/compares user text. |
| flakiness | Process discipline: PATH stubs, no network sleeps, `BATS_TEST_RETRIES` only as bandage | bats | `bats tests/` | Root causes: real network calls, `sleep`-based waiting, shared `/tmp`. Stub external commands and wait on observable conditions instead. |

### Not applicable

| TYPE ID | Reason |
|---|---|
| type-check | No static type system; ShellCheck provides the closest static analysis. |
| component | No component model; script/function granularity is covered by unit. |
| contract | No Pact-style consumer contract tooling in the shell ecosystem. |
| acceptance-bdd | No maintained Gherkin runner for shell. |
| property-based | No mainstream tooling; no QuickCheck equivalent for shell. |
| fuzz | No mainstream tooling; no QuickCheck equivalent for shell. |
| metamorphic | No mainstream tooling; no QuickCheck equivalent for shell. |
| combinatorial | No mainstream tooling; no QuickCheck equivalent for shell. |
| differential | No mainstream tooling; no QuickCheck equivalent for shell. |
| model-based | No mainstream tooling; no QuickCheck equivalent for shell. |
| mutation | No maintained shell mutation tester. |
| load | Load testing belongs to the system under test, not management scripts. |
| chaos | No mainstream harness; do controlled failure drills (kill processes, full disks) manually. |
| accessibility | Not applicable to scripts; terminal-output goldens are covered by snapshot-approval. |
| visual-regression | Not applicable to scripts; terminal-output goldens are covered by snapshot-approval. |
| cross-browser | Not applicable to scripts; terminal-output goldens are covered by snapshot-approval. |
| sca | No dependency manifest for typical scripts; pin tool versions in CI images and treat vendored binaries via repo scanning. |
| dast | Dynamic app testing runs against services, not scripts. |
| iac-policy | Covered by `references/infra-iac-containers-ci.md` (Checkov, Trivy, tfsec). |
| container-scan | Covered by `references/infra-iac-containers-ci.md` (Checkov, Trivy, tfsec). |
| authz | Permission behavior of scripts is asserted inside unit/e2e tests; no dedicated tool. |
| docs-examples | Repo-level tooling, language-agnostic. |
| notebook | Repo-level tooling, language-agnostic. |
| link-check | Repo-level tooling, language-agnostic. |
| exploratory | Human-led activities; not tool-runnable. |
| usability | Human-led activities; not tool-runnable. |

## Recommended default stack

1. bats-core 1.14 with bats-assert/bats-support/bats-file for unit, integration, and e2e layers (directories `tests/unit`, `tests/integration`, `tests/e2e`).
2. ShellCheck 0.11 + shfmt 3.14 as PR gates (separate fast CI jobs; `shfmt -d` for format diffs).
3. kcov 43 for coverage on the highest-risk scripts; hyperfine for benchmarking script rewrites.
4. Stub external commands on PATH for deterministic unit tests (`git`, `ssh`, `systemctl`, network tools); use containers only in the integration/e2e stage.
5. gitleaks for secrets; junit report from bats for CI dashboards.

## Config snippets

bats unit test with a PATH stub:

```bash
# tests/unit/deploy.bats
setup() {
    load 'test_helper/bats-support/load'
    load 'test_helper/bats-assert/load'
    TESTS_BIN="$BATS_TEST_DIRNAME/fixtures/bin"
    PATH="$TESTS_BIN:$PATH"   # fixtures/bin/ssh is a fake exit-0 ssh
}

@test "deploy uses ssh with the computed target" {
    run deploy_app web-1.example
    assert_success
    assert_output --partial "ssh web-1.example"
}
```

CI invocation:

```bash
shellcheck -x $(find . -name '*.sh' -type f)
shfmt -d .
bats --jobs 4 --report-formatter junit tests/ > junit.xml
kcov --include-path=bin,lib coverage ./bin/myscript --selftest
```

POSIX vs bash portability check:

```bash
# lint both dialects where the script claims sh
shfmt -ln posix -d posix-scripts/
dash -n posix-scripts/*.sh      # or busybox sh -n in CI
shellcheck --shell=sh posix-scripts/*.sh
```

## Gotchas

- POSIX vs Bash: decide the dialect per file (shebang + `# shellcheck shell=`); a script claiming `sh` must pass `dash -n` and POSIX shellcheck. Keep Bash-only features (`[[ ]]`, arrays, `local` in functions) out of POSIX files.
- kcov only instruments the script it runs; wrap the bats runner (`kcov ... bats tests/`) or run per-script coverage and merge with `kcov --merge`. kcov's latest stable is 43 (2024); v44 is still pre-release, so expect no rapid fixes.
- Stub hygiene: never stub commands the script itself needs (e.g. stubbing `mktemp`); stub at the boundary (`ssh`, `curl`, `aws`, `systemctl`) and restore PATH in `teardown`.
- bats `run` and errexit: since bats 1.14, `run` honors `set -e` inside your functions; older suites relying on the previous suppression may expose latent failures.
- Timing flakiness: replace `sleep 5` with condition-based waits (`until [ -f marker ]` with `BATS_TEST_TIMEOUT` as a cap); network-dependent unit tests belong in integration.
- Coverage percentages for shell are advisory: kcov counts lines, and idiomatic one-liners inflate/deflate scores; use coverage to find dead code, not as a hard gate.
- Regulated-context rule (client PII): stub data must be synthetic; never check in fixtures exported from production systems (GLBA/SEC Reg S-P). gitleaks is the tripwire.

## Sources

- https://github.com/bats-core/bats-core/releases (v1.14.0, v1.13.0 notes)
- https://github.com/bats-core/bats-assert/tags
- https://github.com/koalaman/shellcheck/releases
- https://github.com/mvdan/sh/releases (shfmt)
- https://github.com/shellspec/shellspec/releases
- https://github.com/kward/shunit2/releases
- https://github.com/SimonKagstrom/kcov/releases and ChangeLog
- https://github.com/sharkdp/hyperfine/releases
- https://bats-core.readthedocs.io/en/latest/

Verified (2026-10-14): bats-core v1.14.0/v1.13.0 features incl. `--errexit`, junit formatter, `--abort`, tags, retries (GitHub releases + changelog); bats-assert 2.2.4 tags; ShellCheck v0.11.0 (release assets dated 2026-01-05); shfmt v3.14.1 (mvdan/sh releases); shellspec 0.28.1 (2026); shunit2 2.1.8 (2025, slow cadence); kcov 43 stable / v44 pre-release (GitHub + Homebrew + Debian tracker); hyperfine 1.20.0. From memory, mark [unverified]: actionlint current version; exact bats-file latest tag beyond 0.4.0.
