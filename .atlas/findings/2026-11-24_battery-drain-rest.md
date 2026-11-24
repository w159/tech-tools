# battery-drain-rest: atlas at rest costs what the mod-off session costs: 0.88 vs 0.81 CPU-s per 120 s, no extra child process; no repeating mod timer at rest

- id: battery-drain-rest
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T12:59:49+00:00

## Evidence
- .atlas/evidence/2026-11-24_battery-rest-measure.txt
- plugins/atlas/mod/host/rest-idle.test.ts

## Reproduction
scratchpad idle-cpu.sh rest|off2 <plugin> on|off 120

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
