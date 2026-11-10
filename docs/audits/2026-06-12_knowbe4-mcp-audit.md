# KnowBe4 MCP Server — Per-Endpoint Audit (2026-06-12)

Server: `mcp_servers/knowbe4-mcp` (self-contained, build = tsc, tests = vitest)
Vendor: KnowBe4 Reporting API v1. Reference: https://developer.knowbe4.com/rest/reporting
Version: 1.0.3 (package) / 1.1.0 (manifest) -> 1.1.1 (both, equalized).

Path verification cross-checked against the official KnowBe4 reference
implementation (mirage-security/knowbe4-mcp-server) and KnowBe4 KB
"Reporting API Overview", which agree on every path below.

## Per-tool table

Domain tools = 27. Plus 3 helpers (navigate, back, status) = 30 listed.
Lazy mode (LAZY_LOADING=true) exposes 4 meta-tools instead.

| Tool | Method + path (server) | Docs match | Desc quality | Issue | Fixed |
|------|------------------------|------------|--------------|-------|-------|
| knowbe4_account_get | GET /v1/account | OK | verb-first, fields/full | none | n/a |
| knowbe4_account_risk_score_history | GET /v1/account/risk_score_history | OK | good, pagination | none | n/a |
| knowbe4_users_list | GET /v1/users (status, group_id, page, per_page) | OK | good | none | n/a |
| knowbe4_users_get | GET /v1/users/{id} | OK | good | none | n/a |
| knowbe4_users_risk_score_history | GET /v1/users/{id}/risk_score_history | OK | good | none | n/a |
| knowbe4_groups_list | GET /v1/groups | OK | good | none | n/a |
| knowbe4_groups_get | GET /v1/groups/{id} | OK | good | none | n/a |
| knowbe4_groups_members | GET /v1/groups/{id}/members | OK | good | none | n/a |
| knowbe4_groups_risk_score_history | GET /v1/groups/{id}/risk_score_history | OK | good | none | n/a |
| knowbe4_phishing_campaigns_list | GET /v1/phishing/campaigns | OK | good | none | n/a |
| knowbe4_phishing_campaigns_get | GET /v1/phishing/campaigns/{id} | OK | good | none | n/a |
| knowbe4_phishing_security_tests_list | GET /v1/phishing/security_tests | OK | good | none | n/a |
| knowbe4_phishing_campaign_tests | GET /v1/phishing/campaigns/{id}/security_tests | OK | good | none | n/a |
| knowbe4_phishing_security_test_get | GET /v1/phishing/security_tests/{pst_id} | OK | good | none | n/a |
| knowbe4_phishing_security_test_recipients | GET /v1/phishing/security_tests/{pst_id}/recipients | OK | good | none | n/a |
| knowbe4_phishing_security_test_recipient | GET /v1/phishing/security_tests/{pst_id}/recipients/{recipient_id} | OK | good | none | n/a |
| knowbe4_training_campaigns_list | GET /v1/training/campaigns | OK | good | none | n/a |
| knowbe4_training_campaigns_get | GET /v1/training/campaigns/{id} | OK | good | none | n/a |
| knowbe4_training_enrollments_list | GET /v1/training/enrollments | OK | good | none | n/a |
| knowbe4_training_enrollments_get | GET /v1/training/enrollments/{id} | OK | good | none | n/a |
| knowbe4_store_purchases_list | GET /v1/training/store_purchases | WAS /v1/store/purchases | good | WRONG PATH | YES |
| knowbe4_store_purchases_get | GET /v1/training/store_purchases/{id} | WAS /v1/store/purchases/{id} | good | WRONG PATH | YES |
| knowbe4_policies_list | GET /v1/training/policies | WAS /v1/policies | good | WRONG PATH | YES |
| knowbe4_policies_get | GET /v1/training/policies/{id} | WAS /v1/policies/{id} | good | WRONG PATH | YES |
| knowbe4_reporting_phishing_summary | aggregates GET /v1/phishing/security_tests | OK | good | none | n/a |
| knowbe4_reporting_training_summary | aggregates GET /v1/training/campaigns | OK | good | none | n/a |
| knowbe4_reporting_risk_overview | aggregates /v1/account + risk_score_history + /v1/groups | OK | good | none | n/a |
| knowbe4_status | n/a (local) | n/a | reports creds + base URL | region desc cosmetic | improved |

Pagination: every list tool uses page/per_page (default 100, max 500 documented). OK.
Auth: Bearer token via Authorization header. OK.
Regional base URLs us/eu/ca/uk/de present and correct.
Errors: all handlers route through toolError/toolErrorFromCatch (vendor HTTP status
+ body excerpt + remediation hint via _shared/error-envelope). No swallowed exceptions.

## Discrepancies found and fixed

1. store_purchases paths wrong (`/v1/store/purchases` -> `/v1/training/store_purchases`).
   Real defect: these calls would 404 against the live API. Fixed in
   `src/domains/training.ts` (list + get) and the training test assertion.

2. policies paths wrong (`/v1/policies` -> `/v1/training/policies`).
   Real defect: would 404. Fixed in `src/domains/training.ts` and test assertion.

3. Region resolution bug in `src/utils/client.ts`. `getCredentials()` called
   `resolveBaseUrl("knowbe4", override) ?? regionUrl ?? US`. Because
   `resolveBaseUrl` ALWAYS returns the hardcoded US default when no explicit
   override is set, the `?? regionUrl` branch was dead code and `KNOWBE4_REGION`
   was silently ignored — eu/ca/uk/de accounts were all routed to the US shard.
   Fixed: branch on explicit override (override wins via resolveBaseUrl);
   otherwise use the region map (us/eu/ca/uk/de), falling back to US only for an
   unknown region code. The existing client.test.ts cases for EU/CA/UK/DE now
   pass (they would have failed against the old logic).

4. Bundle entry-point mismatch in `manifest.json`. `mcp_config.args` was
   `${__dirname}/dist/index.js`, but `entry_point` and the actual built file are
   `dist/mcp_servers/knowbe4-mcp/src/index.js` (nested due to rootDir=../..).
   There is no `dist/index.js` shim, so the packed bundle would fail to launch in
   Claude Desktop. Fixed args to match entry_point (same convention as ninjaone-mcp).

5. Missing shared source. `mcp_servers/_shared/error-envelope.ts` was absent from
   the canonical _shared dir (only the compiled dist .js/.d.ts existed), so a
   clean `tsc` build failed with TS2307. Restored the file from the identical
   connectwise/cipp copies (same 3 exports the dist already used). This is a
   repo-wide _shared asset; restoring it also unblocks any other server that
   builds against _shared from a clean tree.

6. Stale phishing test assertion (`parsed.campaigns`) predated the response-shaper
   refactor; shapeList returns a JSON array, not a `{campaigns:[...]}` envelope.
   Corrected the assertion to check the array directly. Production code unchanged.

## Discrepancies left (none material)

- knowbe4_back is a documented no-op kept for backwards compatibility. Intentional.
- The reference API supports extra optional params (campaign_type=callback,
  exclude_percentages, include_campaign_id, enrollment filters store_purchase_id/
  user_id/etc.). These were NOT added — out of scope for a defect-fix pass, and
  adding them would be a feature change. Noted as a possible future enhancement;
  not a correctness defect for the current tool surface.

## Base URL / optional-default compliance

- Vendor default hardcoded: `https://us.api.knowbe4.com` (region map) /
  `https://us.api.knowbe4.com/v1` (_shared VENDOR_DEFAULTS).
- `KNOWBE4_BASE_URL` optional; manifest user_config.base_url required:false with
  the documented-default description. `KNOWBE4_REGION` optional, default us.
- `.env.template` lines present and blank (resolve to default). OK.

## Build / test / boot evidence (staged in /tmp, node_modules never under iCloud)

- `npm run typecheck` (tsc --noEmit): PASS (0 errors).
- `npm run build` (tsc): PASS (clean rebuild).
- `npm test` (vitest): 4 files, 42 tests, ALL PASS — includes EU/CA/UK/DE region
  resolution and the corrected training/store/policy paths.
- `node scripts/pack-mcpb.js`: produced knowbe4-mcp.mcpb v1.1.1 (2.6 MB, 1896 files);
  pack verifier confirmed entry + node_modules present.
- Boot verify (no KNOWBE4_* env): server starts on stdio, tools/list returns 30
  tools. `knowbe4_status` without creds returns a MISSING_CREDENTIALS envelope
  (no crash) — confirms tools are registered unconditionally and creds are
  reported missing at call time.

## Version

old: package 1.0.3 / manifest 1.1.0 (drift) -> new: 1.1.1 in BOTH (equal).

## Artifacts shipped back to repo

- src fixes: src/domains/training.ts, src/utils/client.ts,
  src/__tests__/domains/training.test.ts, src/__tests__/domains/phishing.test.ts
- mcp_servers/_shared/error-envelope.ts (restored)
- manifest.json, package.json (version + args), CHANGELOG.md
- rebuilt dist/, new knowbe4-mcp.mcpb

## Manual follow-ups

- Live-key smoke test against a real KnowBe4 tenant (esp. the corrected
  store_purchases and policies paths, and a non-US region) is recommended; the
  audit verified paths against docs + the official reference impl, not a live call.
- Optional future enhancement: expose the additional documented query params
  (campaign_type, enrollment filters, exclude_percentages, include_* flags).
