# completion-gate-run-scoped-ab: completion_gate (a)/(b) only credit evidence and verified findings produced during the current run

- id: completion-gate-run-scoped-ab
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:17:05+00:00

## Evidence
- test_completion_gate.py 221 OK
- test_atlas_contract.py 86/87, sole failure is install-cache parity

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks -p test_completion_gate.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
