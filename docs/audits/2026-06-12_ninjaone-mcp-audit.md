# ninjaone-mcp deep per-endpoint audit (2026-06-12)

Server: `mcp_servers/ninjaone-mcp` (build = tsc, tests = vitest)
Node lib: `mcp_node/node-ninjaone` (file:../../ dependency, prebuilt dist, build = tsup)
Vendor: NinjaOne (NinjaRMM) Public API v2. OAuth2 client_credentials + user authorization_code/PKCE.

Version: server package.json 1.5.0 -> 1.6.1; manifest.json 1.6.0 -> 1.6.1 (drift resolved, now equal).
node-ninjaone patch-bumped 1.2.0 -> 1.2.1 (source changed, see fixes below).

## Per-tool audit

26 tools exposed (5 infra/auth + 21 domain). All verb-first descriptions; destructive/visible-to-others
prefixes present where appropriate; args typed with format/default; errors surface HTTP status + hint.

| Tool | Method + path (node-ninjaone) | Verdict |
|------|-------------------------------|---------|
| ninjaone_status | n/a (local) | OK - boots + reports missing-creds without crash |
| ninjaone_navigate | n/a (local discovery) | OK |
| ninjaone_sign_in | POST /ws/oauth/authorize + /ws/oauth/token | OK (already correct in user-flow.ts) |
| ninjaone_sign_out | n/a (local token store) | OK |
| ninjaone_auth_status | n/a (local) | OK |
| ninjaone_devices_list | GET /v2/devices | FIXED path (/api/v2 -> /v2) |
| ninjaone_devices_get | GET /v2/device/{id} | FIXED path |
| ninjaone_devices_reboot | POST /v2/device/{id}/reboot | FIXED path; DESTRUCTIVE prefix OK |
| ninjaone_devices_services | GET /v2/device/{id}/windows-services | FIXED path |
| ninjaone_devices_alerts | GET /v2/device/{id}/alerts | FIXED path |
| ninjaone_devices_activities | GET /v2/device/{id}/activities | FIXED path |
| ninjaone_organizations_list | GET /v2/organizations | FIXED path |
| ninjaone_organizations_get | GET /v2/organization/{id} | FIXED path |
| ninjaone_organizations_create | POST /v2/organizations | FIXED path |
| ninjaone_organizations_locations | GET /v2/organization/{id}/locations | FIXED path |
| ninjaone_organizations_devices | GET /v2/organization/{id}/devices | FIXED path |
| ninjaone_alerts_list | GET /v2/alerts | FIXED path |
| ninjaone_alerts_reset | POST /v2/alert/{uid}/reset | FIXED path; VISIBLE-TO-OTHERS OK |
| ninjaone_alerts_reset_all | POST /v2/device|organization/{id}/alerts/reset | FIXED path; DESTRUCTIVE OK |
| ninjaone_alerts_summary | GET /v2/alerts (client-side aggregate) | FIXED path |
| ninjaone_tickets_list | POST /v2/ticketing/trigger/board/{id}/run | FIXED path; board-query model correct |
| ninjaone_tickets_get | GET /v2/ticketing/ticket/{id} | FIXED path |
| ninjaone_tickets_create | POST /v2/ticketing/ticket | FIXED path |
| ninjaone_tickets_update | PUT /v2/ticketing/ticket/{id} | FIXED path |
| ninjaone_tickets_add_comment | POST /v2/ticketing/ticket/{id}/comment | FIXED path; VISIBLE-TO-OTHERS OK |
| ninjaone_tickets_comments | GET /v2/ticketing/ticket/{id}/log-entry | FIXED path; /log-entry comment model correct |

(Webhooks resource in node-ninjaone is not exposed as an MCP tool but was path-fixed for consistency.)

## Discrepancies fixed (node-ninjaone source)

1. OAuth token endpoint - CRITICAL. `auth.ts` posted to `${baseUrl}/oauth/token`. NinjaOne's
   documented token endpoint is `/ws/oauth/token` (confirmed by NinjaOne's official PowerShell
   authorization-flow doc using `https://oc.ninjarmm.com/ws/oauth/token`, and by the repo's own
   `user-flow.ts` which already used `/ws/oauth/token`). The bare path 404s, so the default
   client_credentials auth mode could never mint a token. Fixed to `/ws/oauth/token`.

2. Resource base path - CRITICAL. Every resource (devices, organizations, alerts, tickets, webhooks)
   prefixed paths with `/api/v2/...`. NinjaOne's official apidocs curl examples show resources at
   `/v2/...` (e.g. `https://app.ninjaone.com/v2/organization/{id}/devices`). Replaced all
   `/api/v2/` -> `/v2/` across the five resource files (and a doc comment in types/tickets.ts).

3. Test fixtures aligned: `tests/mocks/handlers.ts` (token + all resource paths) and
   `tests/integration/devices.test.ts` override paths updated to the corrected URLs so the
   library suite represents reality.

OAuth2 client_credentials grant body (grant_type/client_id/client_secret/scope), default scopes
(`monitoring management`), regional base URL map (us/eu/oc/ca/us2/fed), and the optional
NINJAONE_BASE_URL (defaults to https://app.ninjarmm.com, manifest required:false) were all verified
correct - no change needed. Read-only-vs-action surface is accurate (reboot/reset/create/update are
correctly prefixed; no tool claims an unsupported action).

## Discrepancies left (intentional / out of scope)

1. Device/alert list cursor param. NinjaOne `/v2/devices` uses `after`-based pagination (integer
   last-device-id), not the `cursor` query param the handlers/types pass. The cursor is simply
   ignored by the API today (first page still returns), so this is a latent pagination gap, not a
   hard failure. Left as a follow-up because fixing it cleanly touches the typed BaseListParams
   surface and several handlers; deferred to avoid a half-applied typed change. Org/ticket listing
   are unaffected (tickets paginate via request-body cursor; orgs via after as well).

2. Pre-existing stale server unit tests (NOT regressions from this audit - all use a fully mocked
   client and never exercise HTTP paths):
   - `client.test.ts` (4): expected getCredentials() object omits the `authMode` field that the
     implementation now returns (field added in a prior change; test not updated).
   - domain list tests (6) in devices/organizations/alerts/tickets: assert `data.tickets` /
     `data.locations` / `data.cursor` keys, but the handlers emit the shared response-shaper
     envelope. Test/impl drift predating this audit.
   These 10 failures reproduce independently of the path/token fixes and are left for a separate
   test-refresh task.

## Build / test / boot evidence

- node-ninjaone: `npx tsup` build success; dist verified to contain `/ws/oauth/token` and `/v2/devices`
  (no `/api/v2/`, no bare `/oauth/token`). Library vitest: 9 files, 82/82 passing.
- Server: `npm run typecheck` clean; `npm run build` (tsc) success. Server vitest: 95 passing,
  10 pre-existing failures (see above), 0 new failures.
- Manifest entry-point check: `server.entry_point` and `server.mcp_config.args` both point to
  `dist/mcp_servers/ninjaone-mcp/src/index.js`. tsc (rootDir ../..) emits exactly that nested path;
  confirmed present in the built dist AND inside the packed bundle (`unzip -l` match). Correct -
  not broken (unlike the knowbe4 sibling).
- Pack: `node scripts/pack-mcpb.js` -> ninjaone-mcp.mcpb; packer self-verified entry + node_modules.
- Boot: extracted bundle, spawned the manifest entry over stdio, initialize OK, tools/list returned
  26 tools including ninjaone_status. With creds removed, ninjaone_status returns a clean
  MISSING_CREDENTIALS envelope (isError:true) instead of crashing.

## Artifacts shipped back to repo

- mcp_node/node-ninjaone/src/{auth.ts, resources/*.ts, types/tickets.ts} (source fixes)
- mcp_node/node-ninjaone/dist/* (rebuilt)
- mcp_node/node-ninjaone/package.json (1.2.1)
- mcp_node/node-ninjaone/tests/{mocks/handlers.ts, integration/devices.test.ts} (aligned)
- mcp_servers/ninjaone-mcp/dist/* (rebuilt)
- mcp_servers/ninjaone-mcp/{manifest.json (1.6.1), package.json (1.6.1), ninjaone-mcp.mcpb}

Note: the regenerated .mcpb is ~67MB (bundles full node_modules) vs the prior ~2.8MB, which had
been packed against a pruned/production-only node_modules. Functionally correct and self-verified;
a production-prune before packing would shrink it if bundle size matters.
