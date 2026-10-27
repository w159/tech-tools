# S4 version bump 12.6.0 -> 12.7.0
changed_files: .claude-plugin/marketplace.json (atlas entry line 50); plugins/atlas/.claude-plugin/plugin.json (line 3)
evidence_strategy: no-test-exception (replacement verification: parity tests below)
9a15dd51 (12.6.0 release) touched version files: marketplace.json (atlas entry only; top-level 4.6.2 untouched), plugin.json. plugins/atlas/omp/package.json changed there by +1 line, not a version bump.
Bumped now: same two files, nothing else. No other file carries 12.6.0 outside docs/CHANGELOG/.atlas.
Tests: hooks test_atlas_contract: Ran 108, OK (skipped=3).
scripts suite: Ran 2135, FAILED (failures=1): test_atlas_dashboard_live.ConnectorTruth.test_table_covers_every_shipped_connector_and_real_keys; 'sonicwall' missing from dashboard CONNECTOR_AUTH. NEW (sonicwall connector gap), not version-related, not cache parity.

## S4-U2 dashboard connector table
changed_files: plugins/atlas/scripts/atlas_dashboard.py (CONNECTOR_AUTH += "sonicwall": [[HOST, USERNAME, PASSWORD]]); plugins/atlas/CHANGELOG.md (removed the "Version bump ... separate implementer step" bullet).
Only enumeration of panos in scripts/dashboard-ui was CONNECTOR_AUTH (atlas_dashboard.py:464).
Before: test_atlas_dashboard_live Ran 18, FAILED (failures=1).
After: test_atlas_dash*.py Ran 348, OK. test_connectors_wiring.py Ran 10, OK.
