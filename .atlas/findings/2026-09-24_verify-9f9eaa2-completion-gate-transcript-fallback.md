# verify-9f9eaa2-completion-gate-transcript-fallback: 9f9eaa2: _transcript_test_commands closes (g) Stop-hook ingestion race; full suite green; mutation test proves non-vacuous

- id: verify-9f9eaa2-completion-gate-transcript-fallback
- status: verified
- verified_by: NarrowMouse (independent verifier subagent)
- verified_at: 2026-09-24T22:23:32+00:00

## Evidence
- plugins/atlas/hooks/completion_gate.py:682,701-702 -- data.get("transcript_path") threaded through to _test_verified_this_run(root, session, transcript_path)
- plugins/atlas/hooks/completion_gate.py:892-952 -- _transcript_test_commands: is_bash/is_mcp_shell via name.rsplit("__",1)[-1] in (ctx_shell,ctx_execute,ctx_batch_execute,ctx_execute_file); matches _latest_transcript_todos fail-open pattern (OSError/UnicodeDecodeError -> False; malformed JSON line -> continue)
- plugins/atlas/hooks/completion_gate.py:922-933 -- timestamp filter: rec_epoch None (missing/unparseable ts) does not trigger continue, i.e. fails open (record kept in-window)
- plugins/atlas/hooks/completion_gate.py:979-980 -- _tests_executed_this_run ORs _transcript_test_commands(...) with existing tool_calls DB query
- hooks/test_completion_gate.py -q -k transcript_only -> 1 passed, 210 deselected (in detached worktree /tmp/verify_9f9eaa2 at 9f9eaa2)
- scripts/ hooks/ full suite -> 1461 passed, 5 skipped, 75 subtests passed in 38.43s (matches commit message claim exactly)
- Mutation test: disabled early-return (if False and _transcript_test_commands(...)) in isolated scratch copy /tmp/mutation_scratch -> test_transcript_only_test_command_earns_credit_before_ingest FAILS with gate block reason '(g) Law 5 -- verification coverage', proving the new test is not vacuously true
- hooks/test_atlas_contract.py:1181-1182 -- assertIn('_test_verified_this_run(\n', src) and assertIn('root, session, str(data.get("transcript_path")', src) meaningfully distinguishes new multi-line call site from old single-line '_test_verified_this_run(root, session)' (old form would fail these two new assertions); test_a_test_run_can_pair_an_implementer passes (1 passed)

## Reproduction
git worktree add --detach /tmp/verify_9f9eaa2 9f9eaa2 && cd /tmp/verify_9f9eaa2/plugins/atlas && python3 -m pytest hooks/test_completion_gate.py -q -k transcript_only && python3 -m pytest scripts/ hooks/ -q && python3 -m pytest hooks/test_atlas_contract.py -q -k test_a_test_run_can_pair_an_implementer; git worktree remove --force /tmp/verify_9f9eaa2

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
