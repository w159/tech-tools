# Repair lessons

Read when a doctor row or a test failure matches a symptom below. Each entry: symptom, confirm, root cause, repair, what catches it now.

## A. Stale source checkout

- Symptom: fixes written in a marketplace source checkout do not appear in the installed plugin.
- Confirm: `git -C <checkout> fetch && git -C <checkout> rev-list --count HEAD..origin/HEAD` is large, and `python3 -c "import json;print(json.load(open('plugins/atlas/.claude-plugin/plugin.json'))['version'])"` is below the installed version.
- Root cause: the working tree was cloned long ago (16.4.2 against 17.4.0, 919 commits apart) and never rebased.
- Repair: rebase or re-branch from the remote default branch, then redo the change.
- Caught by: doctor row `source-checkout-stale` (WARN, read-only; `--fix` never acts on it).

## F. Python version drift

- Symptom: a hook or test passes on the pinned Python and fails on a newer one.
- Confirm: run the suite with the newer interpreter, for example `python3.15 -m unittest discover -s plugins/atlas/hooks`.
- Root cause: on 3.15 the stdlib json scanner reads a new `array_hook` attribute; the hand-written scanner context in `hooks/fallow_gate.py` lacked it, so the Bash prefilter never skipped.
- Repair: give the context the attribute the stdlib reads; do not copy stdlib internals without tracking them.
- Caught by: running the test suite on the newest installed Python; no doctor row.

## G. Tests that depend on the machine

- Symptom: green on one laptop, red on another or in CI.
- Confirm: `grep -rn "sed -i" plugins/atlas --include=test_*.py`, `grep -rn "\.claude/settings.json" plugins/atlas --include=test_*.py`, and run `python3 -m pytest --version` with the PATH `python3`; run mod goldens with `TZ=UTC` and `TZ=Asia/Tokyo`.
- Root cause: GNU-only `sed -i`, tests reading the real `~/.claude/settings.json`, `python3` on PATH without pytest, goldens that format local time.
- Repair: portable edits (`sed -i.bak` or Python), isolate HOME and settings in a temp dir, call the venv interpreter explicitly, pin the timezone in goldens.
- Caught by: `_test_isolation` in the doctor tests and the two-timezone golden run.

## H. Another plugin's hook blocks Bash

- Symptom: every native Bash call is denied, also inside subagents, with a hook error such as `NODE_TOO_OLD`.
- Confirm: call the `ctx_doctor` tool of the context-mode plugin, and run `node --version` (context-mode 2.1.7 needs 24.15 or newer).
- Root cause: Node 22 first on PATH (a pin in the shell profile); context-mode's PreToolUse hook fails closed. This is that plugin's requirement, not an atlas defect.
- Repair: put a Node 24.15+ first on PATH (edit the profile pin), restart the session.
- Caught by: no doctor code on purpose; follow this entry.

## I. Baseline before blame

- Symptom: a change is blamed for failures that were already there (188 "file did not load" failures for `bun:test` and `bun:sqlite` files under `mod/colony/` and `mod/omp/`, plus 6 real ones; Python failures on clean `origin/main`).
- Confirm: `git stash`, run the suite on the clean remote default branch, `git stash pop`, then compare failing test NAMES, not counts.
- Root cause: counts hide which tests are new; runner-incompatible files fail to load on every tree.
- Repair: judge a fix only by names that fail with it and pass without it.
- Caught by: the MEASURE phase rule in `SKILL.md` (clean-baseline comparison).
