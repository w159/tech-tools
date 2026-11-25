# gate-w-waiters: Stop gate (w): one Monitor per team; per-pid waiter markers so an ending wait cannot unwatch a live one

- id: gate-w-waiters
- status: verified
- verified_by: lead
- verified_at: 2026-11-25T16:47:36+00:00

## Evidence
- .atlas/evidence/2026-11-25-sidepanel-rework.txt; test_completion_gate.py; test_atlas_mux_more.py overlap test

## Reproduction
python3 plugins/atlas/hooks/test_completion_gate.py && python3 plugins/atlas/scripts/test_atlas_mux_more.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
