# sec3-completion-gate: Plan s3 completion gate: crew attribution crosses sessions

- id: sec3-completion-gate
- status: rejected
- verified_by: atlas:verifier (verdict of 2026-11-10T08:58Z, ledger row re-entered by orchestrator after the release worktree was removed)
- verified_at: 2026-11-10T10:38:52+00:00

## Evidence
- hooks/completion_gate_core.py _team_records crew branch; scripts/atlas_crew.py:1010 no lead_session

## Reproduction
pytest -q test_completion_gate.py (631 pass); mutation of _team_gate fails 2 tests

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
