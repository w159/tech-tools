# pushed-head-archive-tests-2026-11-17: Pushed HEAD 73fdaa79 archive: all three test commands green from a pristine checkout

- id: pushed-head-archive-tests-2026-11-17
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-17T18:06:42+00:00

## Evidence
- 1093 passed, 31 subtests passed in 169.44s (pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py)
- 90 passed in 10.14s (pytest plugins/atlas/scripts/test_atlas_control.py test_typesafe_client.py test_turn_scoring_budget.py test_atlas_db_facet.py)
- Ran 3279 tests in 408.465s / OK (skipped=5) (python -m unittest discover plugins/atlas/hooks)
- archive contains changes: dispatch_tripwire_core.py:478 _cheap_exploration, :393 BURST_SECS = 30, typesafe_client.py:113 MAX_BODY_BYTES = 24_000, atlas_db.py:1120 created_at=COALESCE(?,created_at), CLAUDE.md:134 ## Parallel agents (team rules)

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && git archive HEAD | tar -x -C /tmp/vt_head && cd /tmp/vt_head && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
