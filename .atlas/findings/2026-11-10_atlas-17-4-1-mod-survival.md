# ATLAS-17.4.1-mod-survival: atlas 17.4.1: mod re-boots after /clear, failures visible, one header parser, todo read errors, bounded /atlas-core, gate (r) early done, fallow_gate on Python 3.15, doctor checks and worktree guard; suites green; live terminal render after /clear not yet observed

- id: ATLAS-17.4.1-mod-survival
- status: verified
- verified_by: lead-test-run
- verified_at: 2026-11-10T05:59:54+00:00

## Evidence
- claude plugin test plugins/atlas: 901 pass, 188 fail (all 'the file did not load'), 0 non-load failures; baseline origin/main 876 pass, 194 fail
- python -m unittest discover -s plugins/atlas/hooks: Ran 2749 tests OK (skipped=5); baseline FAILED (failures=8, errors=11)
- python -m unittest discover -s plugins/atlas/scripts (venv with pytest first on PATH): Ran 4239 tests OK (skipped=1); baseline FAILED (failures=17, errors=22)
- claude plugin validate plugins/atlas: Validation passed

## Reproduction
claude plugin test plugins/atlas && python3 -m unittest discover -s plugins/atlas/hooks -p 'test_*.py'

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
