# gate-rerun-quoted-separator: Stop gate no longer re-runs text from inside a quoted argument as the test command

- id: gate-rerun-quoted-separator
- status: verified
- verified_by: lead
- verified_at: 2026-11-23T08:10:14+00:00

## Evidence
- plugins/atlas/hooks/test_gate_rerun.py TranscriptTest.test_separator_inside_a_quoted_argument_does_not_start_a_segment, failed before the fix and passes after

## Reproduction
python3 -m unittest plugins/atlas/hooks/test_gate_rerun.py -k TranscriptTest

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
