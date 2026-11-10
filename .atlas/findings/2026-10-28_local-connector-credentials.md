# local-connector-credentials: Local connector credentials repaired from Key Vault and re-verified: auvik, spanning, paylocity, threatlocker and falcon now authenticate from ~/.config/atlas/atlas.env (HTTP 200 / state OK); knowbe4 and vanta remain rejected upstream (401); blumira, sonicwall and gateway-side CIPP remain unprovisioned; department yaml records updated

- id: local-connector-credentials
- status: verified
- verified_by: main
- verified_at: 2026-10-28T20:15:11+00:00

## Evidence
- .atlas/evidence/2026-10-28-local-connector-credentials.md
- node /tmp/gw-auth/probe.mjs plugins/armada/mcp/<vendor>/server.mjs <vendor>_status with env from ~/.config/atlas/atlas.env -> auvik/spanning/paylocity/threatlocker OK (HTTP 200), falcon state OK authenticated true tool_count 145; knowbe4 FAILED HTTP 401 Invalid Token; vanta FAILED HTTP 401 token mint failed
- ~/.config/atlas/atlas.env mode 600, 25 keys, FALCON_* added from vault falcon-client-id/secret/base-url; leak grep over .atlas/departments returns nothing

## Reproduction
set -a && . ~/.config/atlas/atlas.env && set +a && MCP_TRANSPORT=stdio node /tmp/gw-auth/probe.mjs plugins/armada/mcp/auvik/server.mjs auvik_status

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
