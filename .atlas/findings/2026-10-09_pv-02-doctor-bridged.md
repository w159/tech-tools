# PV-02-doctor-bridged: atlas_doctor.py --hook bridged (contracts/hook-bridge.json bridged list), runs once on first main before_agent_start; omp has no Skill tool mapping

- id: PV-02-doctor-bridged
- status: verified
- verified_by: ParityVerifier
- verified_at: 2026-10-09T18:01:01+00:00

## Evidence
- contracts/hook-bridge.json:20; omp/hook-bridge.test.ts:553-569 drives real loadBridgedHooks through before_agent_start twice -> 1 run; no Skill in omp/hook-bridge.ts

## Reproduction
cd plugins/atlas/omp && bun test hook-bridge.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
