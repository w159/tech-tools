# S2-gate-mechanisms: Gate conditions (i) todo-drain and (j) worktree close-out, plus the (f) git cross-check

- id: S2-gate-mechanisms
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-08-19T14:26:43+00:00

## Evidence
- hooks+scripts pytest: 1195 passed, 3 skipped; mutation-checked

## Reproduction
python3 -m pytest -q plugins/atlas/hooks plugins/atlas/scripts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
