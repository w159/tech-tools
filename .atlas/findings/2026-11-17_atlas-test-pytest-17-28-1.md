# atlas-test-pytest-17.28.1: atlas_test.py run starts each file under pytest from the first interpreter that has it

- id: atlas-test-pytest-17.28.1
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T11:51:34+00:00

## Evidence
- 16 passed; full run under pytest: hooks PASS 74 files, scripts 166/167, wall 172.9s (.atlas/evidence/2026-11-17_perf-fixes-full-parallel-run.txt)

## Reproduction
.venv/bin/python -m pytest -q -p no:cacheprovider plugins/atlas/scripts/test_atlas_test.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
