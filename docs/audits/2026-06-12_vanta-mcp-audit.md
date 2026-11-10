# vanta-mcp deep per-endpoint audit — 2026-06-12

Version: 0.2.1 -> 0.2.2 (package.json, manifest.json, src/server.ts serverInfo).
Build: tsup. Node lib: node-vanta (file:../../mcp_node/node-vanta, zero prod deps).
Auth: OAuth2 client_credentials, POST https://api.vanta.com/oauth/token, JSON body,
scope vanta-api.all:read, token cached + refreshed 60s before expiry, one forced
refresh on 401. Base URL default https://api.vanta.com/v1, VANTA_BASE_URL optional.
Pagination: cursor (pageSize 1-100, pageCursor); envelope {results:{data,pageInfo}}
normalized to {items,endCursor,hasNextPage}. All verified against developer.vanta.com.

## Per-tool table (28 tools)

| Tool | Method + path | Verified vs docs | Result |
|------|---------------|------------------|--------|
| vanta_navigate | (local) | n/a | OK |
| vanta_status | (local) | runs without creds, reports missing | OK |
| vanta_frameworks_list | GET /frameworks | pageSize/pageCursor | OK |
| vanta_frameworks_get | GET /frameworks/{id} | id path | OK |
| vanta_frameworks_list_controls | GET /frameworks/{id}/controls | id path + paging | OK |
| vanta_controls_list | GET /controls | frameworkMatchesAny[], paging (confirmed via reference page) | OK |
| vanta_controls_get | GET /controls/{id} | id path | OK |
| vanta_tests_list | GET /tests | statusFilter, frameworkFilter, paging | OK |
| vanta_tests_get | GET /tests/{id} | id path | OK |
| vanta_documents_list | GET /documents | frameworkMatchesAny[], statusMatchesAny[] | OK |
| vanta_documents_get | GET /documents/{id} | id path | OK |
| vanta_integrations_list | GET /integrations | paging | OK (field shaping fixed) |
| vanta_integrations_get | GET /integrations/{integrationId} | path id renamed connectionId->integrationId | FIXED |
| vanta_integrations_list_resource_kinds | GET /integrations/{integrationId}/resource-kinds | path id renamed; field shaping fixed | FIXED |
| vanta_integrations_list_resources | GET /integrations/{integrationId}/resource-kinds/{resourceKind}/resources | path id renamed; added optional connectionId + isInScope query filters | FIXED |
| vanta_integrations_get_resource | GET /integrations/{integrationId}/resource-kinds/{resourceKind}/resources/{resourceId} | WRONG PATH was /integrations/resources/{resourceId} (nonexistent); now requires 3 path params | FIXED |
| vanta_people_list | GET /people | emailAndNameFilter, groupIdsMatchesAny[] | OK |
| vanta_people_get | GET /people/{id} | id path | OK |
| vanta_vendors_list | GET /vendors | paging | OK |
| vanta_vendors_get | GET /vendors/{id} | id path | OK |
| vanta_risk_scenarios_list | GET /risk-scenarios | paging | OK |
| vanta_risk_scenarios_get | GET /risk-scenarios/{id} | id path | OK |
| vanta_vulnerabilities_list | GET /vulnerabilities | q, isFixAvailable, paging | OK |
| vanta_vulnerabilities_get | GET /vulnerabilities/{id} | id path | OK |
| vanta_policies_list | GET /policies | paging | OK |
| vanta_policies_get | GET /policies/{id} | id path | OK |
| vanta_monitored_computers_list | GET /monitored-computers | complianceStatusFilterMatchesAny[] | OK |
| vanta_monitored_computers_get | GET /monitored-computers/{id} | id path | OK |

## Discrepancies found and fixed

1. integrations get_resource WRONG ENDPOINT. node-vanta getResource() called
   GET /integrations/resources/{resourceId}, which does not exist in the Vanta
   API. Correct endpoint (developer.vanta.com/reference/getresource):
   GET /integrations/{integrationId}/resource-kinds/{resourceKind}/resources/{resourceId}.
   Fixed node-vanta getResource(integrationId, resourceKind, resourceId) and the
   MCP tool now requires all three path params.

2. integrations path identifier mislabeled. Docs call the integration path
   segment integrationId (the integration slug, e.g. "aws"); connectionId is an
   OPTIONAL query filter for a specific account connection. The lib + MCP tools
   labeled the path segment connectionId on get / list_resource_kinds /
   list_resources. Renamed to integrationId across node-vanta + server. Added
   connectionId (optional) and isInScope (optional) as documented QUERY filters
   on list_resources only.

3. integrations response field shaping wrong. integrationSummary read
   connectionId/name/status/lastSyncedAt/provider; docs return integrationId,
   displayName, resourceKinds. resourceKindSummary read kind/displayName/count;
   docs return resourceKind, isScopable, numResources, numInScope, integrationId.
   Updated both summaries and the Integration / IntegrationResourceKind types.

4. serverInfo version stale. src/server.ts reported 0.2.0 while package/manifest
   were 0.2.1. Set to 0.2.2 alongside the version bump.

5. pack-mcpb.js bundle bloat (66.2MB -> 2.6MB). npm ls --omit=dev only omits
   THIS package's devDeps; the file:-linked node-vanta lib's devDeps (tsup,
   vitest, msw, typescript, ~87MB) still appeared in --parseable output and the
   external-path filter (node_modules count === 1) wrongly admitted them. Then
   cpSync copied the node-vanta symlink target wholesale including its
   node_modules. Fixed the filter to keep only file:-link package roots (no
   nested /node_modules/ segment) and added a cpSync filter + dereference:true
   so a package's own nested node_modules are never copied. Bundle is now lean.

## Items reviewed and left as-is (correct)

- OAuth2 client_credentials, token URL, JSON body, scope, refresh logic.
- Base URL default + optional VANTA_BASE_URL (manifest required:false, .env note).
- Cursor pagination param names pageSize/pageCursor and envelope normalization.
- Error envelopes surface HTTP status + body excerpt + remediation hint; no
  swallowed exceptions; vanta_status runs without creds.
- All non-integration list/get pairs match documented paths.
- categoryFilter is a valid (documented) extra filter on /tests but is an
  enhancement, not a defect; not added this pass.

## Manifest entry-point check

manifest.server.entry_point = "dist/index.js".
manifest.server.mcp_config.args = ["${__dirname}/dist/index.js"].
Extracted bundle contains dist/index.js (10312 bytes). Both point to the real
built entry inside the packed bundle. PASS.

## Build / test / boot evidence

- node-vanta: npm install (138 pkgs) + tsup build OK; vitest 10/10 passing
  (client, auth, frameworks, errors).
- vanta-mcp: tsup build OK (index.js + per-domain chunks). Server has no own
  vitest suite (test suite lives in node-vanta).
- pack: node scripts/pack-mcpb.js -> vanta-mcp.mcpb, 2.6MB, 1921 files
  (was 66.2MB / 6607 files before the pack-script fix).
- boot: extracted bundle, spawned dist/index.js over stdio with no creds.
  initialize OK (serverInfo name=vanta-mcp version=0.2.2). tools/list returned
  28 tools. vanta_status present and callable without creds, reporting
  "NOT CONFIGURED". No startup crash.

## Artifacts updated in repo

- mcp_servers/vanta-mcp/vanta-mcp.mcpb (2.6MB)
- mcp_servers/vanta-mcp/dist/ (rebuilt, stale chunks removed)
- mcp_servers/vanta-mcp/src/domains/integrations.ts
- mcp_servers/vanta-mcp/src/server.ts (version)
- mcp_servers/vanta-mcp/package.json + manifest.json (0.2.2)
- mcp_servers/vanta-mcp/scripts/pack-mcpb.js (bundle-leak fix)
- mcp_node/node-vanta/src/resources/integrations.ts + src/types/index.ts
- mcp_node/node-vanta/dist/ (rebuilt)

## Manual follow-ups

- The pack-mcpb.js bundle-leak fix is per-server. Other servers that bundle a
  file:-linked node lib with devDeps likely ship the same 60MB+ bloat; propagate
  this filter + cpSync fix to their pack scripts.
- Optional enhancement: expose categoryFilter / controlFilter / ownerFilter on
  vanta_tests_list (all documented) for richer test triage.
- No docs/vendors/vanta.md exists; no README table or plugin command referenced
  the renamed connectionId arg, so no downstream propagation was required.
