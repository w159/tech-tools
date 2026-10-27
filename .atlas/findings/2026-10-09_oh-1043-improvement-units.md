# OH-1043-improvement-units: Baselines carry units; mismatched units re-baselined, never compared; selffix {v,unit}

- id: OH-1043-improvement-units
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:54+00:00

## Evidence
- scripts/atlas_doctor.py:2449 METRIC_UNITS, :2469-2529 supersede_unit_mismatch/_supersede_stale_units (pending->superseded, real verdicts kept)
- atlas_selffix.py:72-119 {v,unit} + rebaseline_units
- atlas.db ro: improvements 87-90 're-baselined, supersedes #49/#50/#85/#86 unit=per100_sessions', remeasured_at NULL, no verdict; values 74.436/28.571/3.007/6.015 match current recurring_friction miner output
- 49/50/85/86 keep their prior verdicts (not pending, by design)

## Reproduction
sqlite3 'file:/Users/jerry/.atlas/atlas.db?mode=ro' 'SELECT ... FROM improvements ORDER BY id DESC LIMIT 8'

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
