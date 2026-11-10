# cipp-connector-client-id: CIPP connector now carries oauth.clientId: cipp_client_id user config (default a0b18b3a-2064-457f-ab94-1fdb5c11ca80, the same client id CIPP PublicMcpRegister returns); armada contract suite green (21 tests) with a new guard that every user_config placeholder in .mcp.json resolves; gateway suite 223/223; catalog.json unchanged

- id: cipp-connector-client-id
- status: verified
- verified_by: main
- verified_at: 2026-10-28T18:14:58+00:00

## Evidence
- .atlas/evidence/2026-10-28-cipp-connector.md section 6
- commit 19de3953: plugins/armada/.mcp.json cipp entry = type http + url from user_config.cipp_mcp_url + oauth.clientId from user_config.cipp_client_id; plugin.json userConfig 53 -> 54
- python3 plugins/armada/tests/test_armada_contract.py -> Ran 21 tests, OK (the count assertion was stale at 57 after the earlier URL-only change; now 54)
- cd mcp_servers/mcp-gateway && node scripts/gen-catalog.mjs --check -> catalog/catalog.json is current; npx tsc --noEmit clean; npm test -> 17 files / 223 tests

## Reproduction
cd plugins/armada && python3 tests/test_armada_contract.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
