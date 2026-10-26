# dashboard-stale-daemon: ensure_daemon replaces daemon with missing/older version; keeps newer

- id: dashboard-stale-daemon
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-06T20:34:13+00:00

## Evidence
- local://verify-daemon-fix.md (intended .atlas/evidence/verify-daemon-fix.md; verifier Write denied)
- plugins/atlas/scripts/atlas_dashboard.py:1334-1353,2049
- HEAD~1 script vs new tests: 9 failed, 3 passed (stop_daemon called 0 times; KeyError version; no _version_tuple)
- pytest hooks scripts: 2230 passed, 3 skipped; pidfile sha 84192942..1f89 and live pid 82964 unchanged
- real-machine 9.x/10.0.1->10.1.2 upgrade UNVERIFIED

## Reproduction
cd plugins/atlas && python3 -m pytest -q hooks scripts

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-10-06T20:19:19+00:00 verified by atlas:verifier: ensure_daemon replaces daemon with missing/older version; keeps newer
