# programmer-tpp-command-hook: programmer TPP nudge is a deterministic command hook that cannot block prompts

- id: programmer-tpp-command-hook
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:11:23+00:00

## Evidence
- plugins/programmer/hooks/test_tpp_nudge.py 7/7 OK
- meta-question prompt -> exit=0, no output

## Reproduction
python3 -m unittest discover -s plugins/programmer/hooks -p test_*.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
