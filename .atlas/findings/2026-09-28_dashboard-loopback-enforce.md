# dashboard-loopback-enforce: atlas_dashboard serve refuses non-loopback host without --allow-remote

- id: dashboard-loopback-enforce
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T10:11:23+00:00

## Evidence
- plugins/atlas/scripts/test_atlas_dashboard_bind.py 4/4 OK
- serve --host 0.0.0.0 -> exit=1

## Reproduction
cd plugins/atlas/scripts && python3 test_atlas_dashboard_bind.py && python3 atlas_dashboard.py serve --host 0.0.0.0

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
