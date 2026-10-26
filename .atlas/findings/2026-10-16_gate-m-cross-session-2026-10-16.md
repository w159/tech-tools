# GATE-M-CROSS-SESSION-2026-10-16: gate (m) ignores other sessions writes in shared worktree

- id: GATE-M-CROSS-SESSION-2026-10-16
- status: verified
- verified_by: gate-verifier
- verified_at: 2026-10-16T19:41:51+00:00

## Evidence
- HEAD code + new tests: test_other_sessions_write_is_not_blamed_on_this_session FAILS (gate blocks), test_own_shell_edit_still_blocks_when_other_session_wrote_elsewhere passes; working tree: both pass; full hooks/test_completion_gate.py 477 passed, 13 subtests; CHANGELOG lines plugins/atlas/CHANGELOG.md:7-8, docs/CHANGELOG.md:16-17 correct

## Reproduction
git archive HEAD plugins/atlas into /tmp/gv, copy current test file, python3.14 -m pytest -q hooks/test_completion_gate.py -k <two tests>; then same in working tree; full file run

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-10-16T19:40:00+00:00 verified by atlas:verifier: gate (m) ignores other sessions writes in shared worktree
