# V-panos-claim1-tool-count-and-gate: CLAIM 1 PASS: shipped bundle exposes exactly 60 unique tools with real credentials, and the disclosure gate still yields 2 / 3 / 60

- id: V-panos-claim1-tool-count-and-gate
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:08+00:00

## Evidence
- node .atlas/.run/panos-live.mjs schemas -> 'tools exposed: 60'; independent tools/list via spawn of node --import plugins/atlas/mcp/_env/load.mjs plugins/atlas/mcp/panos/server.mjs -> count 60, unique 60 (no duplicate names)
- mcp_servers/panos-mcp/tests/boot-probe.mjs drives the same SHIPPED bundle (SERVER = plugins/atlas/mcp/panos/server.mjs, line 11): [no credentials] 2 tools; [host + username/password bootstrap] 3 tools (panos_keygen, panos_navigate, panos_status); [host + api key] 60; [unresolved MCP placeholders] 2; [CFG_ only] 60; [CFG_ unresolved] 2 -> PROBE PASS

## Reproduction
node .atlas/.run/panos-live.mjs schemas | head -1 && (cd mcp_servers/panos-mcp && npm run test:boot)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
