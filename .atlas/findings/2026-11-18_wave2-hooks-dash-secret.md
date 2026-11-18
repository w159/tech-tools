# wave2-hooks-dash-secret: dash: ensure launch URL (token) is injected into SessionStart additionalContext

- id: wave2-hooks-dash-secret
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-18T05:45:17+00:00

## Evidence
- plugins/atlas/hooks/session_boot_core.py:95-99,1672-1674,1697; plugins/atlas/scripts/atlas_dashboard.py:1741,1429

## Reproduction
read session_boot_core.py ensure_dashboard; grep launch=/token in test_session_boot_core.py (no match)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
