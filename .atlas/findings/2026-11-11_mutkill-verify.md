# mutkill-verify: mutation-killing tests kill claimed survivors; 3 equivalences hold

- id: mutkill-verify
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-11T09:38:21+00:00

## Evidence
- mod/hud.mut.test.ts, omp/mission-panel.mut.test.ts, mod/panel-layout.mut.test.ts; tsc exit 0; 2254 pass 0 fail

## Reproduction
hand-mutate hud.ts:94, mission-panel.ts:178, panel-layout.ts:589; bun test <file>; git checkout; COLORTERM=truecolor bun test mod omp

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
