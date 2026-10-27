# measurable-skips: Formatter skips recorded as friction; tool_error_rate min sample

- id: measurable-skips
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-09T15:32:45+00:00

## Evidence
- hooks/test_format_after_edit.py, scripts/test_atlas_doctor.py, scripts/test_atlas_selffix.py; 2785 passed, 3 skipped, 422 subtests passed in 183.68s (0:03:03)

## Reproduction
env -u CI python3 -m pytest hooks scripts -q (plugins/atlas)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
