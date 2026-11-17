# atlas-worker-judge-key-2026-11-17: Mux workers now inherit the judge key: atlas_mux.WORKER_ENV forwards TYPESAFE_API_KEY by env inheritance (never via FORWARDED_ENV, which travels in the pane argv), so worker turn-scoring stopped failing 401 after the judge endpoint moved off the local loopback

- id: atlas-worker-judge-key-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T19:32:59+00:00

## Evidence
- plugins/atlas/scripts/atlas_mux.py:137-139 adds TYPESAFE_API_KEY to WORKER_ENV with a comment stating it is env-inherited only, never in FORWARDED_ENV (that tuple is serialized into the pane command line and would leak the key to tmux argv/ps)
- plugins/atlas/scripts/test_atlas_mux_env.py: two new tests - worker_env inherits the key only when the parent has it, and the key never enters pane_command
- red-before: against HEAD atlas_mux.py the new test fails with KeyError TYPESAFE_API_KEY; green-after: mux+contract suites 404 passed, 3 skipped, 187 subtests
- end-to-end: a child spawned with worker_env(parent) sees the key and the hosted judge rejects it as authentication_error (past the missing-key check), while a child without the key still gets the missing-key 401
- no secret value in the repo: git diff | grep -c apikey_ -> 0; the test uses the literal fake-key

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas/scripts && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m pytest -q test_atlas_mux_env.py -k judge_key

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
