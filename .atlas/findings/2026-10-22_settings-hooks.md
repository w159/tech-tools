# settings-hooks: worker/settings-hooks: hooks and omp bridge read saved knobs on every run (apply_store_env)

- id: settings-hooks
- status: verified
- verified_by: lead-tests
- verified_at: 2026-10-22T22:44:55+00:00

## Evidence
- worktree .atlas/wt/settings-hooks: python3 -m unittest plugins/atlas/scripts/test_atlas_env.py Ran 8 OK (lead rerun)
- python3 plugins/atlas/hooks/test_atlas_contract.py Ran 70 OK skipped=4 (lead rerun)
- implementer: hooks test_*.py Ran 1583 OK; omp bun test 311 pass, 10 fail 8 errors identical to clean tree
- subprocess test: fallow_gate.py with store ATLAS_FALLOW=off beats env ATLAS_FALLOW=on

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
