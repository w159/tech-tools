# git-guard-approval-grant: Approved protected commit/push grants the branch for 30 min; no repeat prompts

- id: git-guard-approval-grant
- status: verified
- verified_by: lead
- verified_at: 2026-11-20T19:22:54+00:00

## Evidence
- plugins/atlas/hooks/test_git_guard.py

## Reproduction
.venv/bin/python -m pytest -q -p no:cacheprovider plugins/atlas/hooks/test_git_guard.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
