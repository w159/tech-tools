# atlas-test-runner-17.28.1: atlas_test.py runs hooks and scripts suites in parallel under pytest and selects tests by changed path

- id: atlas-test-runner-17.28.1
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T11:50:32+00:00

## Evidence
- full run: hooks PASS 74 files, scripts 166/167 (test_connectors_wiring.py fails on the blumira server.mjs deletion that predates this run), wall 172.9s at jobs 8 against about 17 minutes serial

## Reproduction
python3 plugins/atlas/scripts/atlas_test.py run plugins/atlas/scripts/atlas_crew.py plugins/atlas/scripts/atlas_test.py plugins/atlas/hooks/completion_gate_core.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
