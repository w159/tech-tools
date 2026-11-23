# gate-docs-drift-committed: Docs-drift cross-check counts a CHANGELOG committed since the run start, from the next whole second

- id: gate-docs-drift-committed
- status: verified
- verified_by: lead
- verified_at: 2026-11-23T09:35:38+00:00

## Evidence
- test_completion_gate.py DocsMovedInGitRealRepoTest, 786 tests OK, and test_atlas_contract.py 132 tests OK after the boundary fix

## Reproduction
python3 -m unittest plugins/atlas/hooks/test_completion_gate.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
