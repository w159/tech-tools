# completion-gate-followups: completion_gate silent while subagents run, hint includes --title, unittest counted as a test run

- id: completion-gate-followups
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:21:42+00:00

## Evidence
- test_completion_gate.py 258 OK
- atlas hooks 815 run, 1 fail = install-cache parity; scripts 709 OK; programmer 7 OK

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks -p test_*.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
