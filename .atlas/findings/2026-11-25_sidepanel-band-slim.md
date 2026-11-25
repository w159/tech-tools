# sidepanel-band-slim: Band drops TODO/subagent rows (max 3 rows); finished-worker timers freeze (data/live.ts endedAt)

- id: sidepanel-band-slim
- status: verified
- verified_by: lead
- verified_at: 2026-11-25T16:47:36+00:00

## Evidence
- .atlas/evidence/2026-11-25-sidepanel-rework.txt; mod/view/band/band-slim.test.ts; mod/view/panel/status-lifecycle.test.ts

## Reproduction
cd plugins/atlas && bun test mod omp && bunx --package typescript@5 tsc --noEmit -p tsconfig.json; cd ../.. && python3 plugins/atlas/scripts/atlas_mod_gate.py --live --require-live

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
