# perf-fixes-test: perf-fixes: 24 test files pass, no ~/.atlas/bin leak, no new ruff errors

- id: perf-fixes-test
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-20T13:31:50+00:00

## Evidence
- atlas_test.py run --changed HEAD: hooks PASS 9 files, scripts PASS 15 files; ls ~/.atlas/bin absent before and after; no unrelated deletions in atlas_env/atlas_finding/atlas_db/fallow_gate diffs; ruff adds no new errors (E731 test_fallow_gate.py:432 and E741 test_atlas_doctor_hardening.py:132 are pre-existing at HEAD, lines 429 and 132)

## Reproduction
PATH=$PWD/.atlas/.run/venv/bin:$PATH python3 plugins/atlas/scripts/atlas_test.py run --changed HEAD; ruff check <changed py files>; same ruff on git show HEAD: versions

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-20T13:31:26+00:00 rejected by atlas:verifier: perf-fixes: tests pass, no ~/.atlas/bin leak, but ruff not clean (2 pre-existing errors in changed files)
