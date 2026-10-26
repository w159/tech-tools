# OH-1043-durable-settings: Durable settings store ~/.atlas/settings.json (atomic 0600), source layering, omp bridge export, restart persistence

- id: OH-1043-durable-settings
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:53+00:00

## Evidence
- scripts/atlas_control.py:63-67 os.open 0o600 + os.replace; :97-99 store_path ATLAS_HOME or ~/.atlas
- scripts/atlas_control.py:487-501 process>store>claude layering
- omp/hook-bridge.ts:415-425 reads store env
- test_atlas_control.py:430 test_knob_persists_across_restart passes
- live /api/behavior store_path=/Users/jerry/.atlas/settings.json; knobs carry value/source/layers/reaches/default/ref/changed; 48 advanced vars; sources default/process/claude. Note: store file not yet created on disk (no POST made yet) - consistent, not exercised live

## Reproduction
curl /api/behavior (token from index.html meta atlas-token); python3 -m pytest (19 files incl. scripts/test_atlas_dashboard.py, test_atlas_control.py, test_settings_center.py, hooks/test_*.py) -q -> 1088 passed, 187 subtests passed; omp: ATLAS_DASHBOARD_PORT=17969 bun test -> 358 pass 0 fail

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
