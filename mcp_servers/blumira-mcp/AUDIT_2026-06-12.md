# blumira-mcp deep audit — 2026-06-12

Server: `mcp_servers/blumira-mcp` (tsup build, vitest). Node lib: `mcp_node/node-blumira`.
Vendor: Blumira public API. Auth: OAuth2 client_credentials -> bearer JWT, or pre-issued JWT.

## Sources used for verification

- Blumira OpenAPI spec: `https://api.blumira.com/public-api/v1/openapi.json` (fetched, paths enumerated).
- Blumira support: "Using the Blumira API" (`https://support.blumira.com/hc/en-us/articles/41813668396435`) — token flow, audience, base URL, ~30-day token life, 10 req/sec rate limit.
- Blumira API reference UI: `https://api.blumira.com/public-api/v1/ui/`.

## Auth / transport / base URL — verified

- OAuth token endpoint `https://auth.blumira.com/oauth/token`, grant `client_credentials`. CONFIRMED.
- **Audience must be the literal string `public-api`** (NOT the API base URL). Doc-confirmed. The server previously sent `audience: "https://api.blumira.com/public-api/v1"` — this was a real bug that would mint a token for the wrong audience. FIXED.
- Bearer header `Authorization: Bearer <jwt>`. CONFIRMED in `node-blumira/src/http.ts`.
- Base URL default `https://api.blumira.com/public-api/v1`. Hardcoded in lib + `_shared/base-url.ts`. `BLUMIRA_BASE_URL` optional with documented default in manifest. COMPLIANT.
- Pagination: `page`, `page_size`, `limit`, `order_by`; responses `{data, meta, links, status}`. CONFIRMED in lib types and spec.
- `blumira_status` runs without creds and returns a MISSING_CREDENTIALS envelope (isError:true) — boot-verified, does not throw.

## Per-tool audit (path/method vs OpenAPI spec)

| Tool | Method + path | Spec match | Notes |
|---|---|---|---|
| blumira_findings_list | GET /org/findings | yes | rich filter args |
| blumira_findings_get | GET /org/findings/{id} | yes | |
| blumira_findings_details | GET /org/findings/{id}/details | yes | |
| blumira_findings_evidence | GET /org/findings/{id}/evidence | yes | ADDED (was missing) |
| blumira_findings_resolve | POST /org/findings/{id}/resolve | yes | VISIBLE-TO-OTHERS; body {resolution, resolution_notes?} |
| blumira_findings_assign | POST /org/findings/{id}/assign | yes | VISIBLE-TO-OTHERS; body {owner_type, owners[]} |
| blumira_findings_comments_list | GET /org/findings/{id}/comments | yes | |
| blumira_findings_comments_add | POST /org/findings/{id}/comments | yes | VISIBLE-TO-OTHERS; body {body, sender} |
| blumira_agents_devices_list | GET /org/agents/devices | yes | |
| blumira_agents_devices_get | GET /org/agents/devices/{id} | yes | |
| blumira_agents_keys_list | GET /org/agents/keys | yes | |
| blumira_agents_keys_get | GET /org/agents/keys/{id} | yes | |
| blumira_users_list | GET /org/users | yes | |
| blumira_resolutions_list | GET /resolutions | yes | |
| blumira_msp_accounts_list | GET /msp/accounts | yes | |
| blumira_msp_accounts_get | GET /msp/accounts/{id} | yes | |
| blumira_msp_findings_all | GET /msp/accounts/findings | yes | |
| blumira_msp_findings_list | GET /msp/accounts/{id}/findings | yes | |
| blumira_msp_findings_get | GET /msp/accounts/{id}/findings/{fid} | yes | |
| blumira_msp_findings_evidence | GET /msp/accounts/{id}/findings/{fid}/evidence | yes | ADDED (was missing) |
| blumira_msp_findings_resolve | POST .../resolve | yes | |
| blumira_msp_findings_assign | POST .../assign | yes | |
| blumira_msp_findings_comments_list | GET .../comments | yes | |
| blumira_msp_findings_comments_add | POST .../comments | yes | |
| blumira_msp_devices_list | GET .../agents/devices | yes | |
| blumira_msp_devices_get | GET .../agents/devices/{id} | yes | |
| blumira_msp_keys_list | GET .../agents/keys | yes | |
| blumira_msp_keys_get | GET .../agents/keys/{id} | yes | |
| blumira_msp_users_list | GET .../users | yes | |
| blumira_navigate / blumira_status / blumira_back | n/a (navigation) | n/a | |

Total: 29 domain tools + 3 navigation tools = 32 (was 30).

## Discrepancies found and fixed

1. **OAuth audience wrong (critical).** `utils/client.ts` sent `audience: "https://api.blumira.com/public-api/v1"`; doc requires `"public-api"`. Fixed in source + `oauth.test.ts` assertion updated.
2. **Mismatched compact summaries (quality).** Every domain summary referenced fields that do not exist on the API response (`item.id` vs `finding_id`/`device_id`/`key_id`; `item.severity` (no such field); `item.os` vs `plat`/`arch`; `item.role` vs `org_roles`; `item.label`/`item.active`/`item.last_seen`). The shared shaper silently fell back to a generic primitive dump, so curated summaries were dead code. Rewrote findings/agents/users/resolutions/msp summaries to use the documented node-blumira field names (with `?? item.id` fallbacks).
3. **Missing evidence capability.** `/org/findings/{id}/evidence` and `/msp/accounts/{id}/findings/{id}/evidence` are documented (GET: evidence schema keys + paginated rows) but were absent. Added `getEvidence`/`getFindingEvidence` to node-blumira (+ `FindingEvidence`/`EvidenceKey` types), and `blumira_findings_evidence` / `blumira_msp_findings_evidence` tools (shapeRaw, page/page_size). Propagated to navigate description + READMEs.
4. **Version drift.** package.json 1.1.3, manifest 1.1.0 -> both 1.1.4. node-blumira 1.0.1 -> 1.0.2 (source changed).
5. **vitest could not resolve `@shared/*`.** oauth.test failed to load because vitest had no `@shared` alias (tsup did). Added the alias to `vitest.config.ts` so the suite passes.
6. **pack-mcpb.js bundled the file:-linked lib's nested node_modules.** `node-blumira` is symlinked into node_modules with its own 159MB devDeps; cpSync followed the symlink and dragged them in (94MB bundle). Fixed: dereference to realpath and copy with a filter that excludes any nested `node_modules`. Bundle 94MB -> 27.1MB.
7. **Docs drift.** README claimed a bogus `pax8ApiTokenV1` auth and `severity.*`/`created_at.*` filters that do not exist; base/docs URLs were stale. Corrected server README, root README (versions, auth, base URL, tool count 32), and `.env.example` (OAuth + base URL documented).

## Left as-is (with rationale)

- **Status/resolution code legend** in tool descriptions (10=Open/40=Resolved; 10=Valid/20=False Positive/30=No Action Needed/40=Risk Accepted) — could not be confirmed against the public spec text. Left unchanged; agents can call `blumira_resolutions_list` to confirm live codes. DOC-UNCONFIRMED.
- **Rate limiter default 60/min** while docs state 10 req/sec (600/min). The library default is conservative, not wrong; left to avoid over-driving the API.
- **server.ts serverInfo version "1.0.0"** — cosmetic constant in the MCP handshake; the shipped manifest/package version is 1.1.4. Left (not user-facing in tool surface). Minor follow-up candidate.
- **detection-rules endpoints** (`/org/detection-rules`, `/msp/.../detection-rules`, `/msp/basis-detection-rules`) exist in the spec but are out of scope for this findings/evidence-focused audit; not implemented. Future capability.

## Manifest entry-point check

- `server.entry_point` = `dist/index.js`; `server.mcp_config.args` = `["${__dirname}/dist/index.js"]`.
- Both reference `dist/index.js`, which IS present in the packed bundle (verified via `unzip -l` in pack script and manual extract). PASS.

## Build / test evidence

- node-blumira: `npm run build` success (tsup ESM+CJS+DTS); `npm test` 14/14 passed.
- blumira-mcp: `npm run build` success (tsup); `npm test` 14/14 passed (navigation 7, oauth 7, including corrected audience assertion).
- `npm run lint` (tsc --noEmit) emits pre-existing TS6059 rootDir warnings about `../_shared/*.ts` files being outside the server's rootDir; these are a tsconfig-layout artifact, not caused by these changes, and the script exits 0.

## Bundle size

- Before: 94 MB. After pack fix + dev-dep exclusion: **27.1 MB** (8196 files). Verified no nested `node_modules` under `node_modules/node-blumira` in the bundle.

## Boot verification

- Spawned manifest entry `dist/index.js` over stdio, sent initialize + tools/list + tools/call.
- initialize OK; tools/list returns `blumira_navigate, blumira_status` at root.
- `blumira_navigate {domain:findings}` then tools/list exposes all 8 findings tools incl. `blumira_findings_evidence`.
- `blumira_navigate {domain:msp}` exposes all 15 MSP tools incl. `blumira_msp_findings_evidence`.
- `blumira_status` with no creds returns MISSING_CREDENTIALS envelope (isError:true + remediation hint); no crash.

## Version

- blumira-mcp: 1.1.3 (pkg) / 1.1.0 (manifest)  ->  1.1.4 (both).
- node-blumira: 1.0.1 -> 1.0.2.
