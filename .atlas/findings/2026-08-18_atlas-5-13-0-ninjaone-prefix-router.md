# ATLAS-5.13.0-ninjaone-prefix-router: tools/call routed by hardcoded name prefix, so any tool whose name did not encode its domain was listed but uncallable

- id: ATLAS-5.13.0-ninjaone-prefix-router
- status: verified
- verified_by: isolated bundle handshake + flattened-navigation routability test
- verified_at: 2026-08-18T15:07:09+00:00

## Evidence
- mcp_servers/ninjaone-mcp/src/index.ts:74-93
- mcp_servers/ninjaone-mcp/src/__tests__/flattened-navigation.test.ts

## Reproduction
spawn plugins/atlas/mcp/ninjaone/server.mjs, tools/list then tools/call each listed tool; assert no response contains 'Unknown tool' (35/35 reach a handler)

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md
- plugins/atlas/CHANGELOG.md

## History
- no earlier verdicts
