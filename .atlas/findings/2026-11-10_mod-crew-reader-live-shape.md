# mod-crew-reader-live-shape: Mod crew reader: dead pid without exit file shows a worker as running

- id: mod-crew-reader-live-shape
- status: rejected
- verified_by: atlas:verifier (verifier-7480)
- verified_at: 2026-11-10T11:17:24+00:00

## Evidence
- plugins/atlas/mod/data/crew.ts vs .atlas/.run/crew/port28 (gw-docs pid 36392 dead, no exit file)

## Reproduction
read crew.ts readCrew against .atlas/.run/crew/port28

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
