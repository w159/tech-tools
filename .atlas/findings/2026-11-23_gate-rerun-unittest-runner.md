# gate-rerun-unittest-runner: Stop gate re-run allowlist accepts python -m unittest

- id: gate-rerun-unittest-runner
- status: verified
- verified_by: lead
- verified_at: 2026-11-23T09:35:38+00:00

## Evidence
- test_gate_rerun.py NormalizeTest.test_accepts_stdlib_unittest and TranscriptTest.test_unittest_command_is_the_last_test_command failed before the fix and pass after

## Reproduction
python3 -m unittest plugins/atlas/hooks/test_gate_rerun.py -k NormalizeTest -k TranscriptTest

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
