# verify-3bbce5a-test-runner-regex: commit 3bbce5a: _TEST_RUNNER_RE JSON-escaped-newline fix and vacuous-test repair, independently reproduced

- id: verify-3bbce5a-test-runner-regex
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-24T22:52:11+00:00

## Evidence
- plugins/atlas/hooks/completion_gate.py:885 (regex now includes |\\n alternative); plugins/atlas/hooks/test_completion_gate.py:1538-1577 (test_ctx_execute_multiline_code_earns_credit, zero self._exec_mcp_test_command( calls in method body confirmed via sed+grep); full suite at 3bbce5a: 1469 passed, 5 skipped, 75 subtests (plugins/atlas, python3 -m pytest scripts/ hooks/ -q); mutation 1 (regex \\n alternative stripped): test_ctx_execute_multiline_code_earns_credit FAILS with AssertionError on gate block reason; mutation 2 (regex stripped AND self._exec_mcp_test_command re-added after _log_dispatches): test WRONGLY passes (1 passed), reproducing the described pre-fix vacuous-test bug; parent commit 7e4876b:plugins/atlas/hooks/test_completion_gate.py has zero occurrences of test_ctx_execute_multiline_code_earns_credit, confirming the test is new in 3bbce5a

## Reproduction
git worktree add --detach /tmp/verify_3bbce5a 3bbce5a; cd /tmp/verify_3bbce5a/plugins/atlas; python3 -m pytest hooks/test_completion_gate.py -q -k 'multiline or cd_and_python3 or undated_transcript' (3 passed); python3 -m pytest scripts/ hooks/ -q (1469 passed, 5 skipped, 75 subtests); throwaway python: completion_gate._TEST_RUNNER_RE.search(json.dumps({'code':'cd plugins/atlas\npytest -q'})) -> match span (26,34) '\\npytest'; full positive/negative case table (pytest -q, {command:pytest -q}, {code:pytest -q}, cd&&python3 -m pytest, grep -n pytest ., ls pytest.ini, echo pytest, npm test, sudo pytest -q) all matched expected True/False; git worktree remove --force /tmp/verify_3bbce5a

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
