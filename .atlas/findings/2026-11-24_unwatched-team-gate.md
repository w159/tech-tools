# unwatched-team-gate: Stop gate (w) blocks a stop while this session tmux team runs with no live atlas_mux wait

- id: unwatched-team-gate
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T19:56:59+00:00

## Evidence
- test_completion_gate.py UnwatchedTeamStopTest (fails with the w block removed); gate.sh push GATE_RC=0; .atlas/evidence/2026-11-24_unwatched-team-gate.txt

## Reproduction
cd plugins/atlas && ../../.venv/bin/python -m pytest -q -p no:cacheprovider hooks/test_completion_gate.py -k Unwatched

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
