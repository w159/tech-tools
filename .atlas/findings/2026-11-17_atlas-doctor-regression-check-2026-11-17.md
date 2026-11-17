# atlas-doctor-regression-check-2026-11-17: Regression check settled: HEAD archive tree vs working tree, same runner and interpreter, identical failing-test ids - 0 regressions; the 4 failures (2x test_codex_parity AskBehaviour, 1x test_telemetry_wiring, 1x test_atlas_analytics session.codex!=session.omp) are ambient PI_*/OMP_*/CLAUDE_* env artifacts that fail at HEAD too and pass under a clean env

- id: atlas-doctor-regression-check-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T17:42:00+00:00

## Evidence
- plugins/atlas/hooks/test_dispatch_tripwire.py, plugins/atlas/hooks/test_completion_gate.py, plugins/atlas/scripts/test_atlas_control.py, plugins/atlas/scripts/test_typesafe_client.py, plugins/atlas/scripts/test_turn_scoring_budget.py, plugins/atlas/scripts/test_atlas_db_facet.py; commit 08d8304d

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && .venv/bin/python -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
