# V-panos-claim6-artifact-freshness: CLAIM 6 PASS: both shipped artifacts are strictly newer than the newest connector source, and the bundle contains the parser fix

- id: V-panos-claim6-artifact-freshness
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:31+00:00

## Evidence
- Recomputed mtimes (epoch): newest mcp_node/node-panos/src = 1789659025 (xml.ts); newest mcp_servers/panos-mcp/src = 1789659614 (server.ts); plugins/atlas/mcp/panos/server.mjs = 1789659647; mcp_servers/panos-mcp/panos-mcp.mcpb = 1789659690. Both artifacts strictly newer than 1789659614.
- Bundle carries the fix minified: plugins/atlas/mcp/panos/server.mjs contains 'parseTagValue:!1,parseAttributeValue:!1' at the connector parser construction site. Size 394516 bytes; mcpb shasum 6e5416bb6f762bd6a9db79d265df03a0989bd7be - both match the claimed values.

## Reproduction
find mcp_node/node-panos/src mcp_servers/panos-mcp/src -type f -print0 | xargs -0 stat -f '%m %N' | sort -rn | head -1; stat -f '%m %N' plugins/atlas/mcp/panos/server.mjs mcp_servers/panos-mcp/panos-mcp.mcpb; grep -o 'parseTagValue:!1,parseAttributeValue:!1' plugins/atlas/mcp/panos/server.mjs

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
