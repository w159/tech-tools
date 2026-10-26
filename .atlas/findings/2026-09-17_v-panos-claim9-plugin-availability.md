# V-panos-claim9-plugin-availability: CLAIM 9 FAIL: the panos connector is entirely UNTRACKED by git, so a fresh atlas install gets a .mcp.json server entry pointing at a bundle that does not exist

- id: V-panos-claim9-plugin-availability
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-09-17T15:49:57+00:00

## Evidence
- Wiring itself is correct: plugins/atlas/.mcp.json has a panos entry running node --import /mcp/_env/load.mjs /mcp/panos/server.mjs with ATLAS_ENV_FILE and all seven CFG_PANOS_* vars, and plugins/atlas/.claude-plugin/plugin.json declares exactly the seven keys panos_host, panos_api_key, panos_username, panos_password, panos_target, panos_verify_tls, panos_rest_version. The bundle those point at is the one I verified (60 tools, parser fix present).
- BUT git status shows '?? plugins/atlas/mcp/panos/', '?? mcp_servers/panos-mcp/', '?? mcp_node/node-panos/', '?? docs/architecture/panos-connector-design.md'. git ls-files returns 0 files for all three connector paths. None is gitignored (git check-ignore -q fails on each), so they are simply never added.
- Every sibling connector IS tracked: git ls-files 'plugins/atlas/mcp/*/server.mjs' returns 10 bundles (auvik, blumira, cipp, connectwise, knowbe4, ninjaone, paylocity, spanning, threatlocker, vanta) and falcon ships its Python tree tracked. panos is the only connector missing. git ls-files mcp_servers lists 11 server dirs, all except panos-mcp. Only .mcpb archives are universally untracked, so the mcpb being untracked is the project norm.
- Consequence: the two files that ARE tracked were modified (' M plugins/atlas/.mcp.json', ' M plugins/atlas/.claude-plugin/plugin.json'). Committing only those advertises a panos server and seven config keys while shipping no server.mjs - the panos MCP server fails to spawn on every fresh install.

## Reproduction
git status --porcelain | grep -i panos; git ls-files plugins/atlas/mcp/panos mcp_servers/panos-mcp mcp_node/node-panos | wc -l; git ls-files 'plugins/atlas/mcp/*/server.mjs' | wc -l

## Proposed fix
git add plugins/atlas/mcp/panos/server.mjs mcp_servers/panos-mcp/src mcp_servers/panos-mcp/tests mcp_servers/panos-mcp/{package.json,package-lock.json,manifest.json,tsconfig.json,tsup*.ts,vitest.config.ts,.env.example,.gitignore,scripts} mcp_node/node-panos/{src,tests,package.json,package-lock.json,tsconfig.json,tsup.config.ts,vitest.config.ts} docs/architecture/panos-connector-design.md - matching exactly what the ten sibling connectors track. Verify with git ls-files 'plugins/atlas/mcp/*/server.mjs' returning 11.

## Doc refs
- none

## History
- no earlier verdicts
