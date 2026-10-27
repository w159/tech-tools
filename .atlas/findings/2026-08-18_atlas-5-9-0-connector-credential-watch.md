# ATLAS-5.9.0-connector-credential-watch: MCP auth failures now trigger one restart instruction instead of an endpoint sweep

- id: ATLAS-5.9.0-connector-credential-watch
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:09:24+00:00

## Evidence
- plugins/atlas/hooks/connector_credential_watch.py
- plugins/atlas/hooks/hooks.json

## Reproduction
python3 -m pytest plugins/atlas/hooks/test_connector_credential_watch.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
