# Test authoring, running, and evidence workflow

Procedures for phases generate -> run -> evidence in SKILL.md. Read the type file and
language file named in the plan before writing code.

## Contents

- Authoring rules
- Proving a test works
- Running
- Flake triage
- Evidence report format

## Authoring rules

- **Test behavior, not implementation.** Assert observable outcomes (return values,
  rendered output, emitted events, persisted state, status codes). Do not assert private
  state, call ordering, or internal structure unless that structure IS the contract
  (e.g. an emitted wire format).
- **One reason to fail.** A test should name one defect class when it fails. Split tests
  that bundle several behaviors; a failing test should need no debugging session to
  understand.
- **Behavior-first names.** "rejects_expired_token", "prorates_first_partial_month", not
  "test_method_under_scenario". The name is the documentation of intent.
- **Oracles.** Choose the weakest oracle that answers "is this correct?"
  - Explicit expected value: simplest and best when you can compute it (use exact
    decimal for money, never floats).
  - Derived recomputation (pseudo-oracle): compute the expected result independently in
    the test (different code path), compare.
  - Metamorphic relation: when no direct oracle exists, assert a relationship
    (reordering items does not change the total; scaling inputs scales outputs
    predictably). See types-input-generation.md.
  - Golden baseline (snapshot-approval): when intent is unknown (legacy), pin current
    output and get human approval for changes.
- **AAA.** Arrange, Act, Assert, with a single act line. The act line should be readable
  without scrolling back to fixtures.
- **Fixtures and factories.** Prefer builders (`make_client(age=17)`) over literal
  blobs; literal blobs duplicate and rot. Scope fixtures to the narrowest level that
  works: per-test fresh state for isolation; suite-scoped only for expensive read-only
  resources. Reset any shared state in teardown. Deterministic data via fixed seeds,
  never wall-clock.
- **Test doubles taxonomy** (pick the cheapest that satisfies the assertion):
  | Double | Behavior | Use when |
  |---|---|---|
  | Dummy | Fills a parameter, never used | Signature requires an argument you do not exercise |
  | Stub | Returns canned answers, no expectations | Testing state-based outcomes through a dependency |
  | Spy | Records calls for later assertion | You need to verify an interaction happened (e.g. audit entry written) |
  | Mock | Pre-programmed expectations, fails on mismatch | Interaction contract matters (authz denial path, exactly-once publish) |
  | Fake | Working lightweight implementation (in-memory repo, embedded server) | Multiple interactions with meaningful state sequencing |
  Anti-pattern: mocking everything. It couples tests to implementation and produces
  suites that pass while the real system is broken. Prefer fakes and real objects at
  layer boundaries.
- **Determinism controls.** | Source | Control |
  |---|---|
  | Time | Inject a clock; freeze it; never sleep-based waits (poll with deadline instead) |
  | Randomness | Fixed seeds; injectable generator; seed printed on failure |
  | Network | Fakes, embedded servers, or recorded responses; no out-of-net calls in unit/component layers |
  | Filesystem | Fresh tmp dirs per test; seeded fixture trees; cleanup in teardown |
  | Scheduling | Take control of the scheduler/cron under test; do not rely on real timers |
- **Isolation.** No shared mutable state; unique identifiers per run (namespaced by test
  or random suffix); parallel-safe (no fixed ports, no shared tmp names); DB tests
  per-test transaction rollback or per-test schema; suites must pass in any order
  (verify by running shuffled when in doubt).

## Proving a test works

A green test proves nothing. Prove sensitivity:

1. Run the test green. Record output.
2. Copy the file aside (`cp file file.bak`), then seed a fault in the code under test: flip an operator, invert a condition, remove a
   call, off-by-one a bound, swap `==` for `!=` on a boundary. Record the exact change.
3. Run again: the test must fail, and the failure message must name the behavior under
   test (not an import error, missing fixture, or compile error; that would be red for
   the wrong reason).
4. Revert the fault: `git checkout -- <file>` (tracked) or `mv file.bak file` (untracked), then assert `git diff --stat <file>` prints nothing (or `cmp file file.bak` for untracked) before reporting. Run again: green.
5. Record failing-before / passing-after in the evidence: fault, red output line, revert,
   green output line.

If you cannot make the test fail on any seeded fault, the test is tautological or
miswired: strengthen the assertion or the oracle, or delete the test and write a real
one. For fixed bugs, failing-before means failing on pre-fix code; passing-after on the
fix. If pre-fix code is gone, a seeded fault on the fixed code is the sensitivity proof.

## Running

Get exact commands from `testscope commands`. It lists only tools it has evidence for; on `[]` with test files present, report "no detected runner" and use the stdlib runner only if the language reference names one (Python: `lang-python.md`). Run every emitted command from the `--root` directory (`cd <root>` first); testscope does not embed the path. Order:

1. **PR subset** (per change): static-lint, type-check, secrets, unit, plus targeted
   integration/component/api tests for touched surfaces. Fast enough for every push.
2. **Nightly / wide**: full integration, e2e, property-based/fuzz runs, cross-browser
   subset, accessibility scans, SCA/sast, db-migration, notebook/docs-examples.
3. **Release cadence**: load, chaos (staging), full cross-browser matrix, i18n,
   exploratory + usability (human-led), DAST.
4. **Weekly**: mutation on critical modules, coverage report, flakiness sweep.

Type-by-type cadence detail lives in the deep reference files (types-*.md, lang-*.md,
infra/data/docs files); the table above is the default when a type file does not pin
one. Report each suite's totals separately; never merge a nightly pass with a PR-subset
pass into one verdict.

## Flake triage

1. **Confirm.** Rerun the failing test 3 times, isolated (single test, no parallelism).
   Fail 1-2 of 3: flake candidate. Fail 3 of 3: real defect or deterministic-environment
   problem; debug it, do not quarantine.
2. **Quarantine.** Move confirmed flaky tests to the quarantine list (skip mechanism of
   the framework) with a ticket link and an expiry (max 30 days). Never silently delete;
   never leave expired quarantine in place. Report quarantine counts in every run
   summary.
3. **Root-cause class.** | Class | Typical signature | Fix |
   |---|---|---|
   | Time | Fails near midnight, on TZ/DST change, elapsed-time asserts | Inject clock; poll with deadline |
   | Randomness | Unseeded data, rare collisions, set-order dependence | Fixed seeds; sort before comparing |
   | Network | Timeouts, DNS, connection-reset flakes, out-of-net calls | Local fake/embedded server; recorded responses |
   | Shared state | Singleton/static residue, DB rows left over, port collisions | Per-test fresh state; unique ids/ports |
   | Ordering | Parallel interference; assumptions about insertion order | Isolate workers; sort or pin order explicitly |
   | Resources | Temp files leaking, file-handle exhaustion, disk-full | Teardown cleanup; tmp-per-test |
   | Async | Sleep-based waits, races on eventual consistency | Poll with deadline; await events, not sleeps |
   | Environment | Locale/TZ/PATH drift, container image drift | Pin env in test harness; assert prerequisites |
4. **Fix at the cause** using the determinism controls above, then verify: 10
   consecutive green isolated runs (100 for stubborn classes) before unquarantining.

## Evidence report format

Every atlas-testing run reports this fixed block, all fields even when zero or none:

```markdown
## Test evidence
- Date / target: <YYYY-MM-DD> / <path or module>
- Detect: languages=<...> frameworks=<...> test_tools=<...> ci=<...>
- Gaps (top): <type_id@area, priority> (or "none")
- Commands run:
  - `<exact command>` -> exit <code>, <suite totals: passed/failed/skipped>
- New tests: <files written>; sensitivity proof: <seeded fault>, failed as
  `<red output line>`, reverted, passed as `<green output line>`
- Mutation (if run): <tool>, killed=<n>, survived=<n>; survivors at <locations>; verdict
  per survivor (needs-test / acceptable-risk)
- Flakes: <rerun counts, quarantine state, root-cause class> (or "none")
- Not recommended: <type and reason> (from anti-recommendations, if any)
- Evidence dir: .atlas/evidence/<YYYY-MM-DD>_<slug>/
- Next test: <highest-priority type_id + area + one-line why>
```

Rules for the block:

- Every command line is copied verbatim from the terminal; exit codes are real. A missing
  status line means the run did not happen; do not backfill it.
- Suite totals are per suite. A skipped count larger than passed count is a finding, not
  a footnote.
- Evidence files (logs, outputs, run summaries) are written to the evidence directory as
  captured, named by phase (`01-detect.log`, `02-gaps.md`, `03-write.log`, ...).
- For regulated surfaces, the authz/data-exposure/audit/encryption/calculation rows from
  selection-and-gaps.md appear explicitly in the report, with their evidence paths.