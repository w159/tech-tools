# GATE-M-OMP-TASK: completion gate (m): shell-dirty paths judged against session-wide dispatch evidence; omp task/toolCall recognised

- id: GATE-M-OMP-TASK
- status: verified
- verified_by: lead
- verified_at: 2026-10-15T19:18:20+00:00

## Evidence
- root cause: _shell_dirty_edits is session-scoped (SessionStart snapshot) but dispatch evidence was run-scoped; omp DB already records Task
- real data: source _missing_delegation(01a140a3..., real omp transcript) -> []; was list of mcp_node/... paths
- ShellEditDelegationTest 17 OK (lead run); full test_completion_gate 475 OK (worker)

## Reproduction
python3 -m unittest test_completion_gate.ShellEditDelegationTest (cwd plugins/atlas/hooks)

## Proposed fix
none recorded

## Doc refs
- plugins/atlas/CHANGELOG.md
- docs/CHANGELOG.md

## History
- 2026-10-15T18:52:34+00:00 open by lead: completion gate (m) cannot see omp task dispatches: matches only Task/Agent tool names
- 2026-10-15T19:12:50+00:00 verified by lead: completion gate (m) now recognises omp task dispatches (case-insensitive task/agent, omp toolCall transcript blocks)
