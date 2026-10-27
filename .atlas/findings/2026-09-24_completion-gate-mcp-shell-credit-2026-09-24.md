# completion-gate-mcp-shell-credit-2026-09-24: completion_gate.py _tests_executed_this_run: MCP shell (lean-ctx ctx_shell / context-mode ctx_execute+batch+file) now earns (g) test-run credit alongside Bash (commit d63e763)

- id: completion-gate-mcp-shell-credit-2026-09-24
- status: verified
- verified_by: IntermediatePorcupine (independent verifier subagent, fresh context, no shared state with the implementer)
- verified_at: 2026-09-24T22:11:09+00:00

## Evidence
- classify() trace confirmed via live snippet: mcp__lean-ctx__ctx_shell -> target='lean-ctx.ctx_shell'; mcp__plugin_context-mode_context-mode__ctx_execute -> target='context-mode.ctx_execute' (session_ingest.py:46-63,43) -- exact match to SQL literals at completion_gate.py:909-913
- tool_name='Bash' clause preserved verbatim (completion_gate.py:910); zero 'kind=bash' matches anywhere in file; pre-existing Bash-path test test_one_implementer_plus_a_test_verified_finding_passes still passes
- targeted run: pytest hooks/test_completion_gate.py -q -k 'lean_ctx_shell or ctx_execute_test_command' -> 2 passed, 211 deselected (reproduced 3x deterministic)
- full suite: pytest hooks/test_completion_gate.py scripts/ hooks/ -q -> 1460 passed, 3 skipped (pre-existing/expected), 6 failed -- all 6 are test_no_telemetry_falls_back_to_git_condition_f, root-caused to an unrelated third-party process concurrently mutating hooks/docs_drift.py during the session (confirmed via git-stash-to-HEAD control run passing, a mid-run ImportError from docs_drift.py being edited on disk, and peer Main's confirmation it wasn't them); zero overlap with _tests_executed_this_run or condition (g)
- mutation test: reverted target IN(...) back to tool_name='Bash' only in a /tmp scratch copy (repo untouched) -> both new tests then FAIL with gate blocking on '(g) Law 5 -- verification coverage'; proves tests are not vacuously true; scratch copy discarded after
- no stray repo changes from this verification: zero Write/Edit calls made; content-diff confirms completion_gate.py SQL and test_completion_gate.py's 3 new symbols unchanged from what was reviewed

## Reproduction
cd plugins/atlas && python3 -m pytest hooks/test_completion_gate.py -q -k 'lean_ctx_shell or ctx_execute_test_command'

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
