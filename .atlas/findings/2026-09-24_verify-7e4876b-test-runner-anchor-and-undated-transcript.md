# verify-7e4876b-test-runner-anchor-and-undated-transcript: 7e4876b: _TEST_RUNNER_RE anchored to command-start (no bare-mention credit); undated transcript records rejected when started known; assertRegex call-site fix confirmed

- id: verify-7e4876b-test-runner-anchor-and-undated-transcript
- status: verified
- verified_by: SpontaneousFish (independent verifier subagent)
- verified_at: 2026-09-24T22:42:40+00:00

## Evidence
- plugins/atlas/hooks/completion_gate.py:884-891 (regex), :938-939 (continue on undated), :701-703 (call site matched by assertRegex); plugins/atlas/hooks/test_atlas_contract.py:1178-1184; plugins/atlas/hooks/test_completion_gate.py:1493-1536 (new regression test); full suite 1468 passed, 3 skipped, 75 subtests in /tmp/verify_7e4876b (detached worktree, removed after use); mutation test in discarded scratch copy /tmp/mutate_scratch reverting regex anchoring made test_transcript_mention_of_pytest_does_not_earn_credit FAIL (AssertionError: 'verification coverage' not found in '')

## Reproduction
git worktree add --detach /tmp/verify_7e4876b 7e4876b; python3 -c regex-table-test (8 cases: pytest/code/python3-m/sudo all True, grep/ls/echo mentions all False); cd /tmp/verify_7e4876b/plugins/atlas && python3 -m pytest hooks/test_completion_gate.py hooks/test_atlas_contract.py -q (295 passed, 3 skipped, 62 subtests) && python3 -m pytest scripts/ hooks/ -q (1468 passed, 3 skipped, 75 subtests); cp -R worktree to /tmp/mutate_scratch, reverted _TEST_RUNNER_RE to bare \b(...) form via python3 replace, reran -k test_transcript_mention_of_pytest_does_not_earn_credit -> FAILED; rm -rf /tmp/mutate_scratch; git worktree remove --force /tmp/verify_7e4876b; git worktree list shows only main worktree, no stray entries

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
