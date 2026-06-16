# kaseya-spanning-backup-mcp — Per-endpoint audit (2026-06-12)

Deep per-endpoint audit of the Kaseya Spanning Backup MCP server against the
public Spanning Backup for Office 365 OpenAPI spec
(http://o365-docs.spanningbackup.com/swagger/json, fetched this session).

Vendor: Spanning Cloud Backup. Auth: HTTP Basic (admin email = username,
API token = password). Build: tsup. Node lib: mcp_node/node-spanning
(file:../../mcp_node/node-spanning, zero runtime deps).

Posture: this server is LIVE and was verified this session (spanning_status and
spanning_users_list returned real data), so core paths/auth are known-good. Per
the conservative mandate, no known-working path was altered. Doc-divergences are
FLAGGED below rather than rewritten, because a wholesale rewrite to the OpenAPI
model would be high-risk and could break the verified spanning_users_list call.

## Version

| Artifact | Old | New |
|---|---|---|
| package.json | 1.0.2 | 1.1.2 |
| manifest.json | 1.1.1 | 1.1.2 |
| server.ts `new Server({version})` | 1.1.0 | 1.1.2 |
| README.md server table row | 1.1.0 | 1.1.2 |

node-spanning lib left at 1.0.2 (no source change; dist rebuilt identically).

## Per-tool audit (14 tools)

| Tool | Method/Path (code) | Description quality | Verdict |
|---|---|---|---|
| spanning_status | none (local) | verb-first, what+when | PASS. Never throws; returns MISSING_CREDENTIALS envelope without creds (boot-verified). |
| spanning_navigate | none (local) | discovery aid | PASS |
| spanning_users_list | GET /users (-> /external/users) | cursor-paginated, typed args | PASS path (verified live). FLAG: response model. See note 1. |
| spanning_users_list_all | GET /users (auto-page) | good | PASS path. Same model FLAG as above. |
| spanning_users_get | GET /users/{id} | required userId, typed | PASS path shape. FLAG: param is userPrincipalName per spec, not opaque id. See note 1. |
| spanning_services_list | GET /users/{id}/services | required userId | FLAG: no /services path exists in M365 OpenAPI. See note 2. |
| spanning_backups_list | GET /users/{id}/services/{svc}/backups | required userId+service | FLAG: no such path in M365 OpenAPI. See note 2. |
| spanning_backups_list_all | same (auto-page) | good | FLAG: same as above. |
| spanning_restores_queue | POST /users/{id}/services/{svc}/restores | DESTRUCTIVE: prefix present, typed args | PASS prefix/hygiene. FLAG: no restore path in M365 OpenAPI. See note 2. |
| spanning_restores_get | GET /restores/{id} | required restoreId | FLAG: no such path. See note 2. |
| spanning_restores_wait_for | poll /restores/{id} | interval/timeout typed | FLAG: depends on note 2. |
| spanning_audit_list | GET /audit | from/to ISO, cursor | FLAG: no /audit path in M365 OpenAPI. See note 2. |
| spanning_audit_list_all | GET /audit (auto-page) | good | FLAG: same. |
| spanning_license_get | GET /license (-> /external/license) | clear | FLAG: wrong path. Real endpoint is GET /external/tenant. See note 3. |

## Quality-bar checks

- DESTRUCTIVE prefix on spanning_restores_queue: PRESENT (already compliant). It
  is the only write tool exposed; assign/unassign from the spec are NOT exposed.
- Arg descriptions: every tool has typed arg descriptions with format/default. PASS.
- Errors: node-spanning http.ts maps 400/401/403/404/409/429/5xx to typed errors
  carrying HTTP status + response body; the 401 message names both creds and the
  platform; the MCP layer wraps catches in toolErrorFromCatch with a remediation
  hint. No swallowed exceptions. PASS.
- spanning_status without creds: returns isError MISSING_CREDENTIALS, no throw at
  init. Boot-verified. PASS.
- Basic auth: Buffer.from(`${adminEmail}:${apiToken}`).toString('base64'). Matches
  spec ("E-Mail in username field, API Key in password field"). PASS.
- Platform -> base-URL map (m365/gws/salesforce): present in config.ts, client.ts,
  server.ts, manifest user_config, .env.template — consistent across layers. PASS
  for consistency; see note 4 for the regional-URL caveat.
- Base URL optional: SPANNING_API_URL is `required:false`, resolves to platform
  default when blank, no warning. PASS.

## Discrepancies vs the OpenAPI spec (FLAGGED, not changed)

Note 1 — Users endpoint model differs from code's generic model.
  Spec: GET /external/users returns `{ nextLink, users[] }`; paging uses
  `size` + `msIdOffset` + `sortPropOffset` (not `limit`/`cursor`), and a user is
  keyed by `userPrincipalName` (GET /external/users/{userPrincipalName}), not an
  opaque `userId`. The code sends `limit`/`cursor` and reads `next`. The handler
  defensively falls back across `users`/`items` and `next`, which is why
  spanning_users_list still returned real data live. LEFT AS-IS (known-working);
  a future hardening pass should align to `nextLink`/`size`/`msIdOffset` paging
  and surface userPrincipalName.

Note 2 — services / backups (per-user) / restores / audit have NO counterpart
  in the M365 OpenAPI spec. The documented M365 surface is only:
  /external/users, /external/users/{upn}, /external/tenant,
  /external/tenant/backups/summary, /external/users/assign,
  /external/users/unassign. The code's `/users/{id}/services`,
  `/users/{id}/services/{svc}/backups`, `/users/{id}/services/{svc}/restores`,
  `/restores/{id}`, and `/audit` paths are not in the published M365 doc. These
  may exist on the GWS or Salesforce platforms (not covered by the o365 swagger),
  or be private/legacy. Treated as UNVERIFIED — not deleted, because removing
  tools would be a regression and the GWS/SF surfaces were not auditable here.
  RECOMMENDATION: obtain the GWS and Salesforce API docs to confirm or correct
  these five tool families; expose assign/unassign (write tools, DESTRUCTIVE/
  VISIBLE-TO-OTHERS) and a tenant-summary/backup-summary tool which ARE in the
  M365 doc but are currently NOT exposed.

Note 3 — spanning_license_get path is wrong for M365.
  Code calls GET /license (resolves to /external/license), which does not exist.
  The real seat/license data is GET /external/tenant (fields: licenses,
  assigned, users, sharedMailboxes, status, etc.). This tool will 404 on M365.
  LEFT AS-IS per the "no path changes without confirming live" rule — but this is
  the single clearest defect and the recommended first real fix: point
  license.get() at `/tenant` and reshape to the tenant fields. (Not changed now
  because it was not live-verified and the conservative mandate forbids
  speculative path edits; flagged for an explicit follow-up.)

Note 4 — Base URL is region-specific in the spec, not single.
  The M365 OpenAPI lists per-region hosts: o365-api-us / -eu / -ca / -ap / -uk /
  -af .spanningbackup.com. The code hardcodes a single non-regional
  `https://o365-api.spanningbackup.com/external` default. This default was
  live-verified working this session, so it resolves correctly for this tenant
  (likely an alias to the tenant's home region), and SPANNING_API_URL lets an
  operator override to a regional host. LEFT AS-IS (working) but flagged: a
  future pass could add an optional SPANNING_REGION env to select the regional
  host explicitly.

## Build evidence

- Staged to /tmp/span-build (node-spanning + server + _shared), npm install OK.
- node-spanning: `tsc --noEmit` clean; `tsup` build success.
- server: `tsup` build success; entry dist/index.js produced (matches manifest
  entry_point). No server test script exists (npm test skipped — none configured).

## Manifest entry-point check

- manifest.server.entry_point = "dist/index.js" — present in packed bundle.
- manifest.server.mcp_config.args = ["${__dirname}/dist/index.js"] — matches.
- Confirmed by extracting the .mcpb and listing dist/index.js. PASS.

## Bundle size

- kaseya-spanning-backup-mcp.mcpb = 2.7 MB (package), 8.2 MB unpacked,
  1923 files. The file-linked node-spanning carried a 189 MB nested
  node_modules (dev-only; node-spanning has zero runtime deps) — removed before
  pack, so it did NOT bloat the bundle. pack-mcpb.js already filters externally
  file-linked nested node_modules as a second guard.

## Boot result

- Spawned packed bundle over stdio with empty creds.
- initialize OK; tools/list returned 14 tools (no regression).
- spanning_status returned isError MISSING_CREDENTIALS envelope (no crash).
  PASS.

## Summary of changes applied

- Version bump to 1.1.2 across package.json, manifest.json, server.ts, README.
- Rebuilt server dist (committed) and repacked .mcpb (copied back to repo).
- Cleaned stale hashed dist artifacts (prior build generations) from repo dist.
- No path or behavior changes (conservative mandate); all doc-divergences flagged
  above for an explicit, doc-backed follow-up pass.

## Recommended manual follow-ups (require GWS/SF docs or live verification)

1. Fix spanning_license_get to GET /external/tenant and reshape (note 3).
2. Align users paging to nextLink/size/msIdOffset and key by userPrincipalName
   (note 1).
3. Confirm or correct services/backups/restores/audit against GWS + Salesforce
   API docs (note 2); consider exposing assign/unassign + tenant backup summary
   (documented M365 endpoints not currently surfaced).
4. Optionally add explicit regional base-URL selection (note 4).
