# ninjaone-mcp-1.8.0-wrong-endpoints: Five NinjaOne endpoints were transcribed wrong, and the 404 hint blamed credentials

- id: ninjaone-mcp-1.8.0-wrong-endpoints
- status: verified
- verified_by: test-suite
- verified_at: 2026-08-19T15:55:00+00:00

## Evidence
- live red: ninjaone_scripts_list -> HTTP 404 with hint Verify NINJAONE_CLIENT_ID... on installed 1.7.0
- spec NinjaRMM-API-v2.json has /v2/automation/scripts, no /v2/scripts
- node-ninjaone: npm test 111 passed (was 94), typecheck clean
- ninjaone-mcp: npm test 162 passed / 11 pre-existing failures (baseline 142/11 on 6df018c)
- _shared: 66 passed / 0 failed
- rebuilt bundle standalone: MCP handshake as ninjaone-mcp 1.8.0, 45 tools

## Reproduction
cd mcp_node/node-ninjaone && npm test; cd ../../mcp_servers/ninjaone-mcp && npm test

## Proposed fix
none recorded

## Doc refs
- docs/vendors/ninjaone/api-reference.md
- docs/CHANGELOG.md
- plugins/atlas/CHANGELOG.md

## History
- no earlier verdicts
