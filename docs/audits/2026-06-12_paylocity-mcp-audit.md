# paylocity-mcp deep per-endpoint audit — 2026-06-12

Vendor: Paylocity API (developer.paylocity.com). Auth: OAuth2 client_credentials
(client_id + client_secret -> bearer) against `/IdentityServer/connect/token`
with a form-urlencoded body and `scope=WebLinkAPI`. Per-request `companyId` path
segment. Production host `https://api.paylocity.com`, sandbox
`https://apisandbox.paylocity.com`. Server is read-only (GET only).

Version: package.json 0.1.2 + manifest.json 0.1.1 (drift) -> both set to **0.1.3**;
server.ts hardcoded serverInfo version 0.1.1 -> 0.1.3; node-paylocity 1.0.0 -> 1.0.1.

## Endpoint families (verified against the live API Reference sidebar)

- WebLink API (legacy, employee pay setup): `/api/v1/...` and `/api/v2/...`
- API Hub (modern): `/apihub-payroll/v1`, `/apihub-positionmanagement/v1`,
  `/apihub_time/v1`
- Employee Demographic API (modern CoreHR): `/corehr/v1` (NOT `apihub-corehr`)

## Per-tool audit

| Tool | Method+path used (before) | Verified correct path | Verdict |
|------|---------------------------|-----------------------|---------|
| paylocity_status | n/a (local) | n/a | OK — runs without creds, reports NOT CONFIGURED |
| paylocity_navigate | n/a (local) | n/a | OK |
| paylocity_employees_list / _get | GET `/coreHr/v1/companies/{cid}/employees[/{id}]` | GET `/corehr/v1/companies/{cid}/employees[/{id}]` | FIXED casing -> `corehr` (canonical doc slug; paths are case-sensitive) |
| paylocity_legacy_employees_list / _get | GET `/api/v2/companies/{cid}/employees[/{id}]` | same | OK |
| paylocity_earnings_company_list | GET `/apihub-payroll/v1/companies/{cid}/earnings` | same (Get Earning Codes) | OK |
| paylocity_earnings_employee_list | GET `/api/v1/.../employees/{id}/earnings` | GET `/api/v2/.../employees/{id}/earnings` (WebLink Get All Earnings) | FIXED v1 -> v2 |
| paylocity_deductions_list | GET `/api/v1/.../employees/{id}/deductions` | same (WebLink Get All Deductions) | OK |
| paylocity_taxes_local_list | GET `/api/v1/.../employees/{id}/localTaxes` | GET `/api/v2/.../employees/{id}/localTaxes` (WebLink Get all local taxes) | FIXED v1 -> v2 |
| paylocity_direct_deposit_list | GET `/api/v2/.../employees/{id}/directDeposit` | same (WebLink Get All Direct Deposit) | OK |
| paylocity_cost_centers_list | GET `/apihub_time/v1/companies/{cid}/costcenters` | same (Time and Labor Get Cost Centers) | OK |
| paylocity_pay_grades_list | GET `/apihub-positionmanagement/v1/companies/{cid}/paygrades` | same (Get Pay Grades) | OK |
| paylocity_job_codes_list | GET `/apihub-positionmanagement/v1/companies/{cid}/jobcodes` | GET `/apihub-payroll/v1/companies/{cid}/jobs` (Get Job Codes [Batch]) | FIXED wrong service + path |
| paylocity_pay_statements_summary | GET `/apihub-payroll/v1/.../paystatement/summary/{year}` | GET `/api/v2/.../paystatement/summary/{year}` (WebLink) | FIXED service+version; added optional query params (pagesize, pagenumber, includetotalcount, codegroup) |
| paylocity_lookup_codes_list | GET `/api/v2/companies/{cid}/codes/{codeResource}` | same (WebLink Get All Company Codes) | OK |

16 tools total — no count regression.

## Other defects fixed

- **Status base-URL display mismatch.** `_shared/base-url.ts` VENDOR_DEFAULTS.paylocity
  was `https://api.paylocity.com/api/v2`, but node-paylocity uses the bare host
  `https://api.paylocity.com` as the root and appends full per-family paths
  (`/api/v2/...`, `/corehr/v1/...`, `/apihub-*`). The status tool therefore
  reported a base URL that, if copied into `PAYLOCITY_BASE_URL`, would break every
  request (the client only strips a trailing `/api`, not `/api/v2`). Changed the
  default to `https://api.paylocity.com` so the reported and effective roots match.
  Also corrected the stale `/api/v2` default note in `.env.template`.
- **Tool descriptions** updated to name the correct API family/version and to flag
  read-only behavior (earnings/taxes/job_codes/pay_statements + navigation domain
  descriptions).

## Auth / base / sandbox / pagination (verified, no change needed)

- OAuth2 client_credentials, form-urlencoded body, `scope=WebLinkAPI`, bearer header,
  proactive ~1h token cache with 60s safety window, single-flight mint, 401 -> one
  refresh-and-retry. Correct per docs.
- `PAYLOCITY_BASE_URL` optional, defaults to `https://api.paylocity.com`;
  `PAYLOCITY_SANDBOX=true` switches host to `https://apisandbox.paylocity.com`
  (ignored when BASE_URL set). Manifest user_config marks base_url required:false
  with the documented default. Compliant with the CLAUDE.md truly-optional rule.
- Pagination: modern envelope `{data, pagination.nextToken}` normalized to
  `{items, nextToken}` (limit max 20); legacy raw arrays normalized with null
  nextToken. Correct.
- Errors surface HTTP status + response body + traceId + remediation hint; never
  swallowed. paylocity_status boots and reports state without credentials.

## Build + test evidence (staged in /tmp, node_modules never under iCloud)

- node-paylocity: `npm run build` (tsup) success; `npm test` (vitest) **20/20 passed**
  (test mocks updated `coreHr` -> `corehr`).
- paylocity-mcp: `npm run build` (tsup) success. Server has no standalone vitest
  suite (validated via node-paylocity tests + boot probe + repo harness).

## Manifest entry-point check

- `server.entry_point` = `dist/index.js`
- `server.mcp_config.args` = `["${__dirname}/dist/index.js"]`
- Both resolve to `dist/index.js`, which is present inside the packed bundle. PASS.

## Bundle size

- Before pack-script fix: **66.2MB / 6608 files** — the file:-linked vendor
  `node-paylocity` was a symlink; cpSync recreated the symlink and `mcpb pack`
  dereferenced it, archiving the vendor's full 87MB dev install (msw, vitest, tsup),
  and `npm ls --omit=dev --all` leaked those dev deps into the staged tree.
- pack-mcpb.js hardened: (1) external prod paths kept only when the segment after the
  last `node_modules/` is a dependency THIS server declares (drops the vendor's nested
  dev deps); (2) the file:-linked vendor is resolved with `realpathSync` and copied
  with `dereference:true` plus a filter that skips nested `node_modules`.
- After fix: **2.6MB / 1922 files**. Verified no vitest/msw/tsup/typescript leakage;
  `node_modules/node-paylocity/dist/index.js`, `@modelcontextprotocol/sdk`, and `zod`
  all present. `npm prune --omit=dev` is not run before pack because the pack script
  builds (needs devDeps) and stages only prod deps itself.

## Boot verification (against the packed .mcpb)

Extracted bundle, spawned manifest entry `dist/index.js` over stdio with NO Paylocity
env vars:
- `initialize` -> serverInfo `{name: paylocity-mcp, version: 0.1.3}`
- `tools/list` -> **16 tools** (all expected names)
- `tools/call paylocity_status` -> isError:false, reports "NOT CONFIGURED" gracefully;
  no crash. PASS.

## Files changed

- mcp_node/node-paylocity/src/resources/{earnings,local-taxes,job-codes,pay-statements,employees}.ts
- mcp_node/node-paylocity/tests/mocks/handlers.ts (corehr casing)
- mcp_node/node-paylocity/package.json (1.0.0 -> 1.0.1) + rebuilt dist/
- mcp_servers/paylocity-mcp/src/domains/{earnings,taxes,job_codes,pay_statements,navigation}.ts
- mcp_servers/paylocity-mcp/src/server.ts (serverInfo 0.1.1 -> 0.1.3)
- mcp_servers/paylocity-mcp/{package.json,manifest.json} (-> 0.1.3) + rebuilt dist/ + paylocity-mcp.mcpb
- mcp_servers/paylocity-mcp/scripts/pack-mcpb.js (bundle-size fix)
- mcp_servers/_shared/base-url.ts (paylocity default -> bare host)
- README.md (paylocity 0.1.1 -> 0.1.3), .env.template (base-url default note)

## Discrepancies left / manual follow-ups

- All confirmed defects fixed. No doc-unconfirmable items remained for the 16 tools.
- Live-credential validation (actual HTTP 200s against a real Paylocity company)
  was not possible in this environment; recommend a one-time creds-backed run of
  `node test-mcp-tools.mjs paylocity` to confirm the corrected paths return data.
- The pack-mcpb.js bundle-size fix lives in this server's copy only. Other servers
  with file:-linked vendor libs (e.g. node-spanning) likely have the same symlink
  bloat; consider propagating the realpath+filter fix to their pack scripts.
