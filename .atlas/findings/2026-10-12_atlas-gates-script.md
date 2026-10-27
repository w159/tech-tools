# atlas-gates-script: atlas_gates.py prints completion/tripwire/routing gate groups as JSON in 0.37s; completion_gate.evaluate shared with the Stop hook

- id: atlas-gates-script
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-12T16:24:32+00:00

## Evidence
- plugins/atlas/hooks/test_atlas_gates.py (4 OK); hooks suite 1443 OK per implementer

## Reproduction
cd plugins/atlas/hooks && python3 -m unittest test_atlas_gates; python3 plugins/atlas/scripts/atlas_gates.py --session <id> --root <repo> --json

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
