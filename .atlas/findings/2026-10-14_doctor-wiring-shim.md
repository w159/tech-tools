# doctor-wiring-shim: atlas_doctor orchestration-wiring check reads dispatch_tripwire_core.py behind the 12.4.1 shim

- id: doctor-wiring-shim
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-14T11:31:05+00:00

## Evidence
- .atlas/evidence/doctor-wiring-verify.txt

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest test_atlas_doctor

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
