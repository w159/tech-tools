# wave12-phase-sync: wave 12 HUD/route-tab same glyph+colour claim refuted in live frames f0050/60/61/63 (TODO rows)

- id: wave12-phase-sync
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-11T20:35:51+00:00

## Evidence
- live-150-5d6a53ef-1/frames f0050 rows24-26 HUD running vs panel rows12-14 queued; f0063 HUD returned vs panel queued; phase-sync.test.ts 9 pass uses synthetic busySnap only

## Reproduction
COLORTERM=truecolor bun test mod/phase-sync.test.ts (9 pass) + ANSI-strip of frames f0050,f0060,f0061,f0063

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
