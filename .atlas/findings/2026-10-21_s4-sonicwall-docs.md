# S4-sonicwall-docs: S4: docs + 12.7.0 bump + dashboard CONNECTOR_AUTH; docs audit all areas current; dashboard live 18 OK, wiring 10 OK, contract 108 OK, harness PASS 41

- id: S4-sonicwall-docs
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-21T15:00:03+00:00

## Evidence
- .atlas/evidence/2026-10-21-S4-version-receipt.md
- plugins/atlas/scripts/test_atlas_dashboard_live.py::ConnectorTruth.test_table_covers_every_shipped_connector_and_real_keys

## Reproduction
python3 -m unittest discover -s plugins/atlas/scripts -p test_atlas_dashboard_live.py -> Ran 18 OK; node test-mcp-tools.mjs sonicwall -> PASS 41 tools

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
