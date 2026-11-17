# pushed-branch-second-eyes-2026-11-17: Pushed HEAD 73fdaa79 is green from a pristine git archive (independent second pass, no working-tree state)

- id: pushed-branch-second-eyes-2026-11-17
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-17T18:09:21+00:00

## Evidence
- git archive HEAD | tar -x -C /tmp/vt_head ; /tmp/vt_head2 identical (diff -rq empty)
- /tmp/vt_head_evidence.txt: pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q -> '1093 passed, 31 subtests passed in 167.96s (0:02:47)'
- /tmp/vt_head_evidence.txt: pytest plugins/atlas/scripts/{test_atlas_control,test_typesafe_client,test_turn_scoring_budget,test_atlas_db_facet}.py -q -> '90 passed in 9.89s'
- /tmp/vt_head_evidence.txt: python -m unittest discover plugins/atlas/hooks -> 'Ran 3279 tests in 406.911s' / 'OK (skipped=5)' (zero failing ids, so PRE-EXISTING vs REGRESSION classification is vacuous)
- archive greps: dispatch_tripwire_core.py:478 'def _cheap_exploration', :393 'BURST_SECS = 30', typesafe_client.py:113 'MAX_BODY_BYTES = 24_000', atlas_db.py:1120 'created_at=COALESCE(?,created_at)', CLAUDE.md:134 '## Parallel agents (team rules)'
- no scope creep: git diff HEAD --stat -- plugins/atlas/hooks plugins/atlas/scripts is empty; git show --name-only 08d8304d fcec569e 73fdaa79 touches no .env / plugins cache / marketplace / installed_plugins.json; branch HEAD == origin/atlas/routing-17.28.0 (73fdaa79)

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && git archive HEAD | tar -x -C /tmp/vt_head && cd /tmp/vt_head && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m pytest plugins/atlas/scripts/test_atlas_control.py plugins/atlas/scripts/test_typesafe_client.py plugins/atlas/scripts/test_turn_scoring_budget.py plugins/atlas/scripts/test_atlas_db_facet.py -q && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m unittest discover plugins/atlas/hooks

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
