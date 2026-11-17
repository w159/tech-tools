# hud-surface-fallow-refactor-17.28.0: hud-surface.ts rows and agentRowResting split into helpers: fallow audit passes (0 introduced), mod and omp suite 5017 pass 0 fail

- id: hud-surface-fallow-refactor-17.28.0
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T09:43:43+00:00

## Evidence
- .atlas/evidence/2026-11-17_hud-surface-fallow-refactor.txt

## Reproduction
fallow audit --base origin/main --format json; cd plugins/atlas && env -u NO_COLOR bun test omp mod

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
