# prompt-optimizer-harness-events: prompt_optimizer ignores subagent hand-backs and task notifications

- id: prompt-optimizer-harness-events
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:14:59+00:00

## Evidence
- test_prompt_optimizer.py 105 OK
- hand-back stdin -> no output

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks -p test_prompt_*.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
