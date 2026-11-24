# atlas-taste-check: taste_check.py flags off-system UI; --gate blocks only when armed, gives up at max rounds

- id: atlas-taste-check
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-24T16:59:53+00:00

## Evidence
- plugins/atlas/skills/atlas-taste/scripts/taste_check.py:239-263; own fixture under TMPDIR taste-v.*: exit1 w/2 FAIL, exit0 fixed, exit2 no standard, gate silent unarmed, block JSON, systemMessage give-up

## Reproduction
python3 taste_check.py --root <fixture> [--gate|--arm --rounds 2]

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
