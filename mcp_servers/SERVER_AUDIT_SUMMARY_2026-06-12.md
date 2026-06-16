# MCP Server Audit + Rebuild Summary - 2026-06-12

Deep per-endpoint audit of all 10 MCP servers against vendor API docs, with build, test,
boot verification, and a fresh `.mcpb` rebuild (patch-bumped) for every server so Claude
Desktop extensions can be updated. Each server has its own detailed `AUDIT_2026-06-12.md`.

## Result table

| Server | Version (old -> new) | Tools | Bundle | Build/Test | Key fixes |
|---|---|---|---|---|---|
| connectwise-manage-mcp | 1.5.0 -> 1.5.1 | 52 | 2.6MB | tsc + vitest 10/10 | `/procurement/subCategories` -> `/subcategories`; ASCII cleanup |
| cipp-mcp | 0.1.1/0.2.0 -> 0.2.1 | 43 | 3.1MB | tsc + jest 17/17 | 11 destructive-prefix violations -> ASCII `DESTRUCTIVE:`/`VISIBLE-TO-OTHERS:`; lint fix |
| knowbe4-mcp | 1.0.3/1.1.0 -> 1.1.1 | 30 | 2.6MB | tsc + vitest 42/42 | 2 wrong paths (store_purchases, policies = 404s); region bug; **manifest entry-point that wouldn't launch**; missing _shared source |
| ninjaone-mcp | 1.5.0/1.6.0 -> 1.6.1 | 26 | 67MB -> 2.7MB | tsc + vitest | OAuth `/oauth/token` -> `/ws/oauth/token`; resources `/api/v2` -> `/v2`; bundle bloat |
| vanta-mcp | 0.2.1 -> 0.2.2 | 28 | 66MB -> 2.6MB | tsup + vitest 10/10 | broken `integrations_get_resource` path; `connectionId` -> `integrationId`; response-field shaping; pack-script bloat fix |
| auvik-mcp | 0.4.0 -> 0.4.1 | 39 | 3.2MB | tsup + vitest 27/27 + 10/10 | removed dead `node-auvik` dep; status-tool resilience; stale lib paths |
| blumira-mcp | 1.1.3/1.1.0 -> 1.1.4 | 32 | 94MB -> 2.5MB | tsup + vitest 14/14 + 14/14 | **OAuth audience bug**; dead summaries; added missing evidence capability; dropped leaked `msw` |
| threatlocker-mcp | 1.1.3/1.2.1 -> 1.2.2 | 17 | 62MB -> 2.6MB | tsup + vitest 4/4 | **5 hard runtime bugs** (handlers calling nonexistent lib methods); bundle bloat |
| paylocity-mcp | 0.1.2/0.1.1 -> 0.1.3 | 16 | 66MB -> 2.6MB | tsup + vitest 20/20 | 5 wrong paths (v1->v2, wrong service, case); base-URL display foot-gun; pack fix |
| kaseya-spanning-backup-mcp | 1.0.2/1.1.1 -> 1.1.2 | 14 | 2.7MB | tsup (no suite) | conservative (live-verified): hygiene + version; flagged doc divergences, changed no working path |

Every server: package.json and manifest.json versions now agree; every manifest
`entry_point` / `mcp_config.args` verified to point at the real built file inside the bundle;
every bundle boots over stdio and lists its tools.

## Cross-cutting issues found and fixed

- Version drift: 7 servers had package.json != manifest.json. All aligned, then patch-bumped.
- Bundle bloat: the shared `pack-mcpb.js` copied each file:-linked node library's nested
  `node_modules` (full dev install: vitest, msw, sucrase, tsup) into the bundle. Five servers
  shipped 60-94MB bundles. Fixed the pack script (realpath-dereference the vendor link, drop
  nested `node_modules`, keep only declared prod deps) and re-packed. All bundles are now 2.5-3.2MB.
- Manifest entry-point: knowbe4 shipped a manifest whose `mcp_config.args` pointed at a
  non-existent `dist/index.js`, so the packed extension would not launch in Claude Desktop.
  Fixed and added an entry-point check to every server's audit.
- Non-ASCII characters in tool descriptions / status output (em dashes, warning glyphs) removed
  from connectwise, cipp, and others per the repo writing-style rule.

## Live validation (proof the audit caught real bugs)

The connected ThreatLocker server (the user's currently-installed extension) was called live:

```
threatlocker_approvals_pending_count
-> ERROR: client.approvalRequests.pendingCount is not a function
```

This is exactly one of the 5 runtime bugs the static audit found and the rebuilt 1.2.2 bundle
fixes (`pendingCount()` -> `getPendingCount()`). The installed extension is genuinely broken on
this call today; reinstalling the rebuilt bundle resolves it. By contrast, the connected Vanta
server returned correct compact, filtered data, confirming healthy servers were left intact.

## Honest verification gaps (what still needs a credentialed run)

- `test-mcp-tools.mjs` skips all 10 servers because the repo `.env` has no credentials, so the
  harness's live tool-call step did not run here. Verification rests on per-server build + unit
  tests + boot + tools/list + the doc audits, plus the live calls against connected servers.
- NinjaOne path changes (`/v2`, `/ws/oauth/token`) are confirmed by NinjaOne docs and consistent
  with the working published extension, but were not live-called against the freshly rebuilt
  bundle (no creds in sandbox). Run `node test-mcp-tools.mjs ninjaone` with creds to confirm.
- CIPP function-name enumeration and Kaseya Spanning's `license_get` / GWS-SF endpoints could
  not be fully doc-confirmed (gated/SPA docs); flagged in their audits, no working path changed.

## To deploy

Reinstall the updated `.mcpb` bundles in Claude Desktop (Settings > Extensions). Every server is
patch-bumped, so Desktop will offer the update. ThreatLocker, KnowBe4, NinjaOne, Vanta, Blumira,
and Paylocity carry real functional fixes; the rest are clean rebuilds with version alignment and
lean bundles.
