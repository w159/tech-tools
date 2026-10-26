# S-panos-mcpb-stale-artifact: panos-mcp.mcpb was packed before the final src edit, shipping pre-objects.ts code to any installer

- id: S-panos-mcpb-stale-artifact
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T15:11:21+00:00

## Evidence
- mtime comparison: panos-mcp.mcpb 2026-09-17T14:28:09.507Z vs newest src mcp_servers/panos-mcp/src/domains/objects.ts 2026-09-17T14:28:41.487Z - artifact 32s older than source
- plugins/atlas/mcp/panos/server.mjs 2026-09-17T14:28:45.318Z (386032 bytes) was fresh; only the .mcpb lagged, so the boot probe passed while the installable bundle was stale
- Fix: npm run pack:mcpb, exit 0, 29.5MB / 3022 files, shasum 8532ecee8a876c27927c94e1ad7dd6423f62cae1, mcpb now 2026-09-17T15:11:21.409Z > newest src
- AGENTS.md section 2 checklist line 'npm run build && npm run pack:mcpb re-ran successfully; .mcpb artifact is fresh' was recorded [x] in docs/architecture/panos-connector-design.md:269 but was false at read time

## Reproduction
node -e "compare fs.statSync('mcp_servers/panos-mcp/panos-mcp.mcpb').mtimeMs against the max mtime under mcp_servers/panos-mcp/src"

## Proposed fix
Freshness assertion (artifact mtime > max src mtime) belongs in the pack script or the boot probe, so a stale .mcpb fails loudly instead of being asserted fresh in a checklist

## Doc refs
- AGENTS.md:39
- docs/architecture/panos-connector-design.md:262-276

## History
- no earlier verdicts
