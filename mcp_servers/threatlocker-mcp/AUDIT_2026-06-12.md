# threatlocker-mcp deep audit - 2026-06-12

Server: mcp_servers/threatlocker-mcp (build = tsup, tests = vitest)
Node lib: mcp_node/node-threatlocker (file:../../mcp_node/node-threatlocker, committed dist)
Vendor: ThreatLocker Portal API. Auth = raw API key in `Authorization` header (no Bearer),
optional `managedOrganizationId` header for child-org scope.
Base default (hardcoded, optional override): `https://portalapi.g.threatlocker.com/portalapi`.

Version: package.json 1.1.3 / manifest.json 1.2.1 (drift) -> both set to 1.2.2.

## Per-tool audit (17 tools)

| Tool | Lib method -> endpoint (verified vs lib tests/mocks) | Method/sig match before fix | Result |
|------|------|------|------|
| threatlocker_navigate | (inline, discovery aid) | n/a | OK |
| threatlocker_status | (inline, never throws; reports missing creds + default base URL) | n/a | OK; runs without creds (boot-verified) |
| threatlocker_computers_list | computers.list -> POST /Computer/ComputerGetByAllParameters | OK | OK |
| threatlocker_computers_get | computers.get -> GET /Computer/ComputerGetForEditById?computerId | OK | OK |
| threatlocker_computers_get_checkins | computers.getCheckins -> POST /ComputerCheckin/ComputerCheckinGetByParameters | BUG: called `getCheckins(computerId, {..})`; lib takes a single params object | FIXED -> `getCheckins({ computerId, pageNumber, pageSize })` |
| threatlocker_computer_groups_list | computerGroups.list -> GET /ComputerGroup/ComputerGroupGetGroupAndComputer | OK | OK |
| threatlocker_computer_groups_dropdown | computerGroups.getDropdown -> GET /ComputerGroup/ComputerGroupGetDropdownByOrganizationId | BUG: called `.dropdown()` (does not exist on lib) | FIXED -> `.getDropdown()` |
| threatlocker_approvals_list | approvalRequests.list -> POST /ApprovalRequest/ApprovalRequestGetByParameters | OK | OK |
| threatlocker_approvals_get | approvalRequests.get -> GET /ApprovalRequest/ApprovalRequestGetById?approvalRequestId | OK | OK |
| threatlocker_approvals_pending_count | approvalRequests.getPendingCount -> GET /ApprovalRequest/ApprovalRequestGetCount | BUG: called `.pendingCount()` (does not exist on lib) | FIXED -> `.getPendingCount()` |
| threatlocker_approvals_get_permit_application | approvalRequests.getPermitApplication -> GET /ApprovalRequest/ApprovalRequestGetPermitApplicationById?approvalRequestId | OK | OK |
| threatlocker_audit_search | auditLog.search -> POST /ActionLog/ActionLogGetByParametersV2 | OK | OK |
| threatlocker_audit_get | auditLog.get -> GET /ActionLog/ActionLogGetByIdV2?actionLogId | OK | OK |
| threatlocker_audit_file_history | auditLog.getFileHistory -> GET /ActionLog/ActionLogGetAllForFileHistoryV2?fullPath | BUG: called `.fileHistory()` (does not exist on lib) | FIXED -> `.getFileHistory()` |
| threatlocker_organizations_list_children | organizations.listChildren -> POST /Organization/OrganizationGetChildOrganizationsByParameters | OK | OK |
| threatlocker_organizations_get_auth_key | organizations.getAuthKey -> GET /Organization/OrganizationGetAuthKeyById | OK | OK |
| threatlocker_organizations_for_move_computers | organizations.listForMoveComputers -> GET /Organization/OrganizationGetForMoveComputers | BUG: called `.forMoveComputers()` (does not exist on lib) | FIXED -> `.listForMoveComputers()` |

### Severity of the 5 fixed bugs

All five were hard runtime failures, present in the shipped dist: four called a method name
that does not exist on the node lib (TypeError: not a function), and one passed the wrong
argument shape to `getCheckins`. These tools would have thrown on every invocation. The node
lib (and its own unit tests + msw mocks) are the source of truth and confirm the correct method
names and the single-params signature; the fixes were applied on the server side only.

## Auth / scoping / base URL (verified)

- API key: sent as raw `Authorization` header value, no Bearer prefix (http.ts). Matches manifest user_config doc. OK.
- Org scope: `managedOrganizationId` header set only when THREATLOCKER_ORGANIZATION_ID present. Optional. OK.
- Base URL: hardcoded default `https://portalapi.g.threatlocker.com/portalapi`; env override optional;
  manifest `threatlocker_base_url` is `required: false` with documented-default description. Conforms to repo directive. OK.
- Pagination: POST search endpoints use buildSearchBody (pageNumber/pageSize/orderBy/searchText/childOrganizations); unwrapPaginatedResponse defensively reads items/data/results + totalItems. OK.

## Description quality bar

- All 17 tools are verb-first, state what they return and when to call. OK.
- All tools are READ-ONLY (list/get/search/count). No write/approve/deny tool exists, so no
  DESTRUCTIVE:/VISIBLE-TO-OTHERS: prefix is required. (See discrepancy note below re: manifest long_description.)
- Args typed with format/default/effect; required args use the schema `required` array. OK.
- Errors: domain handlers wrap calls in try/catch and return `toolErrorFromCatch` (HTTP status +
  response body excerpt + remediation hint) as `isError: true`. No swallowed exceptions. OK.
- threatlocker_status runs without creds and never throws (boot-verified). OK.

## Build / test evidence (staged in /tmp, node_modules present)

- typecheck (`tsc --noEmit`): the only errors are TS6059 rootDir complaints about `../_shared/*.ts`
  being outside `src` rootDir -- a staging-only artifact of the strict tsconfig in isolation, not a
  type error in the code. The tsup build (which uses the @shared esbuild alias) succeeds.
- `npm run build` (tsup): SUCCESS. Fresh dist contains the 5 corrected method names and the
  single-object getCheckins call; zero stale/bad names.
- `npm test` (vitest, server): 4/4 PASS after fixing one stale assertion. The status-tool test
  asserted the literal substring 'credentials status'; the canonical (improved) description says
  'configuration status: credential presence ...'. Updated the assertion to 'configuration status'
  rather than degrade the description. No code/description regression.
- node-threatlocker test suite: FAILS in /tmp only because `msw/node` could not be resolved in the
  fresh /tmp install (msw devDep postinstall). This is the documented stale-node_modules class to
  ignore; the node lib source was NOT modified, so its committed dist remains valid.

## Manifest entry-point check

- manifest.server.entry_point = `dist/index.js`
- manifest.server.mcp_config.args = `["${__dirname}/dist/index.js"]`
- Both resolve to the file present in the packed bundle (verified: `dist/index.js` extracted, 432 bytes). MATCH.

## Bundle size

- Before this audit: 36.5MB (stale dist with duplicate chunks).
- First repack (no filter fix): 61.9MB / 4037 files -- regression caused by the file:-linked node
  lib's nested `node_modules` (full dev toolchain: tsup, vitest, typescript, rollup, esbuild, chai,
  sucrase) leaking into the bundle via `npm ls --omit=dev` walking the vendor's nested deps.
- FIX in scripts/pack-mcpb.js: (1) cpSync filter excludes a vendor package's own nested
  `node_modules`/`node_modules.nosync.noindex`/`.DS_Store`; (2) prod-paths filter now drops any
  external path containing a `/node_modules/` segment (vendor dev/build toolchain) while keeping the
  vendor package ROOT and ROOT's own node_modules.
- After fix: 34.4MB / 2996 files. SDK and node-threatlocker/dist both present; no vitest/typescript/
  rollup/esbuild/chai/sucrase/tsup in bundle.
- Note: `npm prune --omit=dev` before pack is incompatible with this pack script (the script
  rebuilds via tsup, a devDep prune would remove). Dev-dep exclusion is instead enforced by the
  pack script's `npm ls --omit=dev` + the new path filters, which achieve the same result.

## Boot verification (extract + spawn manifest entry over stdio, no creds)

- serverInfo: threatlocker-mcp (initialize OK)
- tools/list: 17 tools returned (full list as expected)
- threatlocker_status: isError=false; reports "NOT CONFIGURED - set THREATLOCKER_API_KEY" plus the
  documented default base URL. Boots and runs cleanly with empty creds.

## Version

- package.json: 1.1.3 -> 1.2.2
- manifest.json: 1.2.1 -> 1.2.2 (drift resolved; pack script also syncs manifest.version from package.json)
- node-threatlocker: unchanged at 1.0.3 (no source change -> no patch bump)

## Discrepancies fixed

1. 5 server-side node-lib method/signature mismatches (getCheckins sig, getDropdown, getPendingCount,
   getFileHistory, listForMoveComputers) -- every affected tool would throw at runtime. Fixed.
2. Version drift package.json vs manifest.json -- aligned to 1.2.2.
3. Stale dist with duplicate domain chunks -- replaced with a clean fresh build.
4. pack-mcpb.js shipping the file:-linked vendor's dev toolchain (~27MB) -- filtered out.
5. Stale vitest assertion ('credentials status') -- updated to match canonical description.

## Discrepancies left (doc-unconfirmable or out of scope)

1. manifest.json `long_description` claims the server can "act on / approve/deny software approval
   requests". No write/approve tool exists in the surface; the tools are read-only. This is a
   documentation overclaim, not a code defect. Left as-is to avoid scope creep on a behavior change;
   recommend either softening the long_description or adding an explicit (DESTRUCTIVE-prefixed)
   approve/deny tool in a future change.
2. server.ts hardcodes `version: '0.1.0'` in the MCP serverInfo block (cosmetic; unrelated to the
   manifest/package 1.2.2). Left as-is; not part of the tool surface.
3. node-threatlocker type defs declare numeric IDs (id: number) for computer/approval/action-log,
   while ThreatLocker Portal IDs are GUIDs and the server passes string IDs. Works at runtime
   (IDs are stringified into the query string), so no behavior bug; the lib's `number` typing is
   imprecise but harmless. ThreatLocker API docs are gated (kb.help), so the exact ID type could
   not be doc-confirmed; left unchanged to avoid an unverified type churn across the lib.
