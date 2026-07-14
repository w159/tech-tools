# Fix: flaky test_orchestration_with_no_capture_nudges_to_capture

## Bug

`test_orchestration_with_no_capture_nudges_to_capture` in
`plugins/atlas/hooks/test_nudge.py` (InProcessMainTest) called `_run_main`
without mocking `nudge._check_memory_captured` or `nudge._check_skill_created`
(`plugins/atlas/hooks/nudge.py:46-57`, `:60-75`). Both read real global state
under `~/.atlas/memory/MEMORY.md` and `~/.atlas/skills/*/SKILL.md`. If either
was touched in the last 60 seconds by another process (e.g. `auto_skill.py`'s
skill-factory), the test's "nudge to capture" assertions failed because
`nudge.py` took the "Self-improvement complete" branch instead.

## Fix

`plugins/atlas/hooks/test_nudge.py:115-124` now wraps the `_run_main` call in:

```python
with (
    mock.patch.object(nudge, "_check_memory_captured", return_value=False),
    mock.patch.object(nudge, "_check_skill_created", return_value=False),
):
    code, out, err = self._run_main({"session_id": "sess-orch"})
```

matching the pattern already used in `test_memory_captured_reports_completion`,
`test_skill_created_reports_completion`, and `test_both_captured_reports_both_parts`
in the same file. `nudge.py` was not modified.

## Verification (atlas:verifier, fresh, independent)

- Confirmed the exact mock block is present at the cited lines.
- `git diff --stat -- plugins/atlas/hooks/nudge.py plugins/atlas/hooks/test_nudge.py`:
  only `test_nudge.py` changed; `nudge.py` shows zero diff lines.
- `python3 -m pytest plugins/atlas/hooks/test_nudge.py -v`: `29 passed in 0.13s`.
- Counterfactual reproduction: created
  `~/.atlas/skills/__verify_tmp_skill__/SKILL.md` with a fresh mtime (the exact
  flake condition). Fixed test still `PASSED`. Then `git stash` to the
  pre-fix code with the same fake state present reproduced the original
  failure verbatim:
  ```
  AssertionError: 'self-improvement check' not found in '{"additionalContext":
  "[atlas] Self-improvement complete: new skill auto-created under
  ~/.atlas/skills/. These will be available next session."}'
  ```
  `git stash pop` restored the fix; the temp skill directory was deleted
  afterward.
- Regression check: `python3 -m pytest plugins/atlas/hooks/ -q`:
  `428 passed, 8 subtests passed in 6.66s`.

Verdict: **CONFIRMED**.
