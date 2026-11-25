# host-chip-probe: mod gate: host probe checks the reply header chip with the real contract pattern (offline run only)

- id: host-chip-probe
- status: verified
- verified_by: lead
- verified_at: 2026-11-25T10:21:06+00:00

## Evidence
- .atlas/evidence/2026-11-25_team-card-worker-budget.txt

## Reproduction
python3 plugins/atlas/scripts/atlas_mod_gate.py && cd plugins/atlas/scripts && python3 -m unittest test_atlas_mod_gate

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
