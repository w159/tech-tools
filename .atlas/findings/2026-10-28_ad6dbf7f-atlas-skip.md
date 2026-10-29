# ad6dbf7f-atlas-skip: docs_drift skips .atlas/ paths; test fails without, passes with, suite green

- id: ad6dbf7f-atlas-skip
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-28T05:09:50+00:00

## Evidence
- plugins/atlas/hooks/docs_drift.py:102; hooks/test_completion_gate.py:4092

## Reproduction
HOME=/root/atlas-home python3 -m pytest -q -p no:cacheprovider hooks/test_completion_gate.py hooks/test_atlas_gates.py hooks/test_atlas_contract.py (626 passed, 5 skipped); reverted copy: 1 failed

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
