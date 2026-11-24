# battery-drain: idle atlas session 56.1 -> 0.84 CPU-s per minute (mod off 0.52): scoped fingerprint, idle backoff, frame loop stops at rest, parse caches, statusline 60 s, pruning

- id: battery-drain
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T10:11:12+00:00

## Evidence
- .atlas/evidence/2026-11-24_battery-drain.txt

## Reproduction
scratchpad idle-cpu.sh: ps -o time= over 60 s of an idle session

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-24T09:52:02+00:00 needs-evidence by atlas:verifier: battery-drain: implementer branches not yet reaped into lead tree
