# cipp-connector-url-only: The CIPP connector is a URL-only remote MCP server; OAuth registration, sign-in and token exchange verified live

- id: cipp-connector-url-only
- status: verified
- verified_by: main
- verified_at: 2026-10-28T18:00:05+00:00

## Evidence
- .atlas/evidence/2026-10-28-cipp-connector.md
- mcp_servers/mcp-gateway: 17 files / 223 tests passed; gen-catalog --check current

## Reproduction
cd mcp_servers/mcp-gateway && node scripts/gen-catalog.mjs --check && npx tsc --noEmit && npm test

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
