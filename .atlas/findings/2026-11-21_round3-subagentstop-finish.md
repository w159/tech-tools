# round3-subagentstop-finish: Blocked SubagentStop now stamps member finished (replay of real payload); denied dispatch leaves no rows already holds

- id: round3-subagentstop-finish
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-21T01:41:51+00:00

## Evidence
- plugins/atlas/hooks/worker_report_gate_core.py:451 (finish_member before block); test_worker_report_gate.py test_blocked_stop_still_stamps_member_finished; pytest 499 passed; bun test 4703 pass 0 fail

## Reproduction
replay SubagentStop payload (agent a0c33e5cd0c020e95, handback msg) on HEAD vs worktree hook with ATLAS_REPORT_GATE_DIR temp: HEAD member exit_code absent, worktree stamped

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
