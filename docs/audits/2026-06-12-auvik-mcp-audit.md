# auvik-mcp deep audit -- 2026-06-12

Version: 0.4.0 -> 0.4.1 (package.json + manifest.json + server.ts Server() string).
Build: tsup. Tests: vitest. Transport: stdio (bundle) + http (gateway). 39 tools (no count change).

## Architecture note

The server does NOT use the `node-auvik` library at runtime. It ships a
self-contained HTTP client in `src/client-factory.ts` (Basic auth, JSON:API
bracket params, manual 308/301/307 region-redirect re-send with auth re-attach,
429 backoff, empty-body 404 handling). `node-auvik` was a declared production
dependency but is never imported -> dead weight in the bundle. Removed it from
`package.json` dependencies. Independently corrected `node-auvik`'s stale paths
for hygiene (propagation rule) and patch-bumped it 1.0.0 -> 1.0.1.

## Per-endpoint audit (server client-factory + tools)

All paths verified against Auvik support docs and the Celerium PowerShell
wrapper (mirrors the live OpenAPI spec). Result: every shipped server path is
CORRECT.

| Tool | Method + path | Verified | Notes |
|------|---------------|----------|-------|
| auvik_status | GET /v1/authentication/verify | OK | Boots + reports without creds; region optional, default us1. |
| auvik_navigate | follow links.next (allowlisted auvikapi host) | OK | Refuses non-Auvik URLs. |
| auvik_tenants_list | GET /tenants | OK | |
| auvik_tenants_detail | GET /tenants/detail?tenantDomainPrefix= | OK | prefix, not numeric id. |
| auvik_tenants_get_detail | GET /tenants/detail/{id} | OK | requires id + domainPrefix. |
| auvik_devices_list | GET /inventory/device/info | OK | |
| auvik_devices_get | GET /inventory/device/info/{id} | OK | |
| auvik_devices_get_details | GET /inventory/device/detail/{id} | OK | singular "detail" confirmed. |
| auvik_devices_list_details | GET /inventory/device/detail | OK | |
| auvik_devices_get_extended | GET /inventory/device/detail/extended/{id} | OK | |
| auvik_devices_list_extended | GET /inventory/device/detail/extended | OK | filter[deviceType] required. |
| auvik_devices_list_warranty | GET /inventory/device/warranty | OK | |
| auvik_devices_get_warranty | GET /inventory/device/warranty/{id} | OK | empty-body 404 handled. |
| auvik_devices_list_lifecycle | GET /inventory/device/lifecycle | OK | |
| auvik_devices_get_lifecycle | GET /inventory/device/lifecycle/{id} | OK | |
| auvik_networks_list | GET /inventory/network/info | OK | |
| auvik_networks_get | GET /inventory/network/info/{id} | OK | |
| auvik_networks_list_detail | GET /inventory/network/detail | OK | singular. |
| auvik_networks_get_detail | GET /inventory/network/detail/{id} | OK | |
| auvik_interfaces_list / get | GET /inventory/interface/info[/{id}] | OK | |
| auvik_configurations_list / get | GET /inventory/configuration[/{id}] | OK | |
| auvik_components_list / get | GET /inventory/component/info[/{id}] | OK | |
| auvik_entities_list_notes / get_note | GET /inventory/entity/note[/{id}] | OK | |
| auvik_entities_list_audits / get_audit | GET /inventory/entity/audit[/{id}] | OK | |
| auvik_alerts_list | GET /alert/history/info | OK | |
| auvik_alerts_get | GET /alert/history/info/{id} | OK | |
| auvik_statistics_device | GET /stat/device/{statId} | OK | statId path seg; filter[fromTime/thruTime/interval]. |
| auvik_statistics_device_availability | GET /stat/deviceAvailability/{statId} | OK | |
| auvik_statistics_interface | GET /stat/interface/{statId} | OK | |
| auvik_statistics_service | GET /stat/service/{statId} | OK | |
| auvik_statistics_component | GET /stat/component/{componentType}/{statId} | OK | two path segs. |
| auvik_statistics_oid | GET /stat/oid/{statId} | OK | deviceMonitor. |
| auvik_billing_client_usage | GET /billing/usage/client | OK | filter[fromDate/thruDate], calendar dates. |
| auvik_billing_device_usage | GET /billing/usage/device/{id} | OK | |

Auth: HTTP Basic (`username:apiKey` base64) -- correct. Region: 8 regions
(us1-4, eu1-2, au1, ca1), hardcoded URL pattern, AUVIK_REGION optional, default
us1, 308 redirect auto-followed. Pagination: page[first]/page[after] JSON:API.
Description quality: verb/path-first, typed args with filter[] mapping and
enums extracted from the spec, error envelope surfaces HTTP status + body +
remediation hints; no swallowed exceptions.

## Defects fixed

1. **node-auvik unused but bundled** -> removed from server package.json deps;
   regenerated package-lock.json (0 node-auvik refs). Bundle shrank.
2. **server.ts hardcoded version "0.3.0"** -> "0.4.1" (matches manifest/pkg).
3. **auvik_status missing-creds path returned the generic missingCredsError
   shape** (no ok/region:null) -> now returns
   `{ok:true, hasCredentials:false, region:null, baseUrl, verified:false, note}`.
   Satisfies the "status must run without creds and report state" rule + the
   status.test.ts contract.
4. **auvik_status auth-failure path did not set isError** -> now returns
   `isError:true` with the diagnostic JSON payload (matches status.test.ts).
5. **node-auvik stale/incorrect paths** (library only; not shipped by server):
   - `/inventory/device/details` -> `/inventory/device/detail`
   - `/inventory/device/info/extended-details` -> `/inventory/device/detail/extended`
   - `/inventory/network/details` -> `/inventory/network/detail`
   - `/alert/history` -> `/alert/history/info` (list + get)
   - dismiss `/alert/history/{id}/dismiss` -> `/alert/dismiss/{id}`
   - statistics: rebuilt to use `/stat/{type}/{statId}` path segment +
     filter[fromTime/thruTime/interval] (was `/stat/device` with bare params);
     renamed getSnmpPollerStatistics -> getOidStatistics (`/stat/oid/{statId}`).
   Updated node-auvik alerts.test.ts dismiss assertion. Patch-bumped 1.0.0->1.0.1.
6. **README** region list `anz1` -> correct codes (us2/us3/us4/eu1/eu2/au1/ca1);
   version table auvik-mcp 0.4.0->0.4.1, node-auvik 1.0.0->1.0.1.

## Left as-is (correct already)

Server client paths, Basic auth, region resolution, 308 handling, pagination
params, error envelope, manifest user_config (auvik_region required:false,
default us1, documented), .env.template (AUVIK_REGION blank=us1).

## Manifest entry-point check

manifest server.entry_point = `dist/index.js`; mcp_config.args =
`["${__dirname}/dist/index.js"]`. Extracted bundle contains `dist/index.js` at
that path. MATCH.

## Build / test / boot evidence

- node-auvik: typecheck clean, tsup build OK, vitest 27/27 pass.
- auvik-mcp: typecheck clean, tsup build OK, vitest 10/10 pass
  (status.test.ts now green after the two status fixes).
- Pack: `node scripts/pack-mcpb.js` -> auvik-mcp.mcpb. Pack script's nested
  node_modules filter already present (no file:-linked vendor bundled; node-auvik
  no longer a dep anyway).
- Bundle: **3.2 MB** (package size 3.2MB, unpacked 9.7MB, 2376 files).
- Boot verify: extracted bundle, spawned `dist/index.js` over stdio with
  AUVIK_USERNAME/AUVIK_API_KEY unset:
  - initialize -> serverInfo {name:auvik-mcp, version:0.4.1}
  - tools/list -> 39 tools (no regression)
  - tools/call auvik_status -> ok:true, hasCredentials:false, region:null,
    baseUrl "https://auvikapi.us1.my.auvik.com/v1 (vendor default; set
    AUVIK_REGION to override)", verified:false. No crash.

## Manual follow-ups

- None required to ship. (node-auvik fixes are library hygiene; the server does
  not depend on node-auvik anymore. If node-auvik is republished to npm, the
  1.0.1 dist is ready.)
