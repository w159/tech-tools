# ATLAS-5.12.0-ninjaone-os-patch-installs: NinjaOne connector could not answer OS patch history; /v2/queries/os-patch-installs now wired as ninjaone_devices_os_patch_installs

- id: ATLAS-5.12.0-ninjaone-os-patch-installs
- status: verified
- verified_by: typecheck + vitest + isolated stdio handshake
- verified_at: 2026-08-18T14:35:00+00:00

## Evidence
- mcp_servers/ninjaone-mcp/src/domains/devices.ts
- mcp_node/node-ninjaone/src/resources/devices.ts
- mcp_servers/ninjaone-mcp/src/__tests__/domains/devices.test.ts
- plugins/atlas/mcp/ninjaone/server.mjs
- commit f796445

## Reproduction
cd mcp_servers/ninjaone-mcp && npm run typecheck && npx vitest run src/__tests__/domains/devices.test.ts; then copy plugins/atlas/mcp/ninjaone/server.mjs alone into an empty dir and drive it with MCP initialize + tools/list over stdio

## Proposed fix
none recorded

## Doc refs
- plugins/atlas/CHANGELOG.md
- docs/CHANGELOG.md

## History
- no earlier verdicts
