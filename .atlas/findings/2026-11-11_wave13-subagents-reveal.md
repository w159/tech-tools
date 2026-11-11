# wave13-subagents-reveal: Wave 13 claim (new SUBAGENTS row on first poll, full state) holds for timing and state word only; row is incomplete mid-reveal

- id: wave13-subagents-reveal
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-11T21:52:10+00:00

## Evidence
- live-150-8271cfc8-1 frames f0035,f0036,f0037 (rows 22.14-23.15); live-110-8271cfc8-1 f0037,f0038,f0039; mod/routing.ts:81-97; mod/routing.test.ts:472-515

## Reproduction
bun test mod/routing.test.ts (29 pass); ANSI-stripped frames from frames/index.json windows 20.4-23.8 (150) and 21.4-25.0 (110)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
