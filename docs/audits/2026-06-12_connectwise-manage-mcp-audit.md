# ConnectWise Manage MCP - per-endpoint audit (2026-06-12)

Server: `mcp_servers/connectwise-manage-mcp`
Vendor: ConnectWise Manage REST API (`/v4_6_release/apis/3.0`)
Version: 1.5.0 -> 1.5.1 (patch). package.json and manifest.json kept equal.

Endpoint paths verified against the ConnectWise Manage OpenAPI-generated client
(pyconnectwise, HealthITAU - 1:1 with the CW OpenAPI schemas) plus the spinen
procurement PHP client. The official developer portal is gated, so these
machine-generated references were used as the authoritative path source.

## Summary

- 52 tools registered (with creds). Without creds the server boots and exposes
  `cw_status` + `cw_test_connection` only - the required missing-creds behavior.
- One real path defect found and fixed: catalog subcategories used the wrong
  segment casing.
- Writing-style defects fixed: unicode em dashes in user-visible strings
  (health status output, no-creds diagnostic output, manifest description).
- Base URL is correctly optional with the documented NA default and regional
  shard support. Status tool works with missing creds. Response shaping and
  error envelopes are wired on every list/get tool.

## Per-tool verdicts

| Tool | Path / method vs docs | Description quality | Issue | Fixed |
|------|----------------------|---------------------|-------|-------|
| cw_status | n/a (local config read) | OK (verb, always-works) | none | n/a |
| cw_test_connection | GET /system/info | OK | none | n/a |
| cw_search_tickets | GET /service/tickets | OK | none | - |
| cw_get_ticket | GET /service/tickets/{id} | OK | none | - |
| cw_create_ticket | POST /service/tickets | OK (WRITE_CREATE) | none | - |
| cw_update_ticket | PATCH /service/tickets/{id} | OK (JSON Patch, WRITE_UPDATE) | none | - |
| cw_get_ticket_notes | GET /service/tickets/{id}/allNotes, fallback /notes | OK | both child paths confirmed valid | - |
| cw_add_ticket_note | POST /service/tickets/{id}/notes | OK | none | - |
| cw_search_companies | GET /company/companies | OK | none | - |
| cw_get_company | GET /company/companies/{id} | OK | none | - |
| cw_create_company | POST /company/companies | OK | none | - |
| cw_update_company | PATCH /company/companies/{id} | OK | none | - |
| cw_search_contacts | GET /company/contacts | OK | none | - |
| cw_get_contact | GET /company/contacts/{id} | OK | none | - |
| cw_create_contact | POST /company/contacts | OK (communicationItems) | none | - |
| cw_search_projects | GET /project/projects | OK | none | - |
| cw_get_project | GET /project/projects/{id} | OK | none | - |
| cw_search_project_tickets | GET /project/tickets | OK (project/id condition) | none | - |
| cw_get_project_ticket | GET /project/tickets/{id} | OK | none | - |
| cw_get_project_ticket_notes | GET /project/tickets/{id}/allNotes, fallback /notes | OK | fallback handles boards without allNotes | - |
| cw_add_project_ticket_note | POST /project/tickets/{id}/notes | OK | none | - |
| cw_create_project | POST /project/projects | thin but OK | none | - |
| cw_search_time_entries | GET /time/entries | OK | none | - |
| cw_get_time_entry | GET /time/entries/{id} | OK | none | - |
| cw_create_time_entry | POST /time/entries | OK | none | - |
| cw_search_members | GET /system/members | OK | none | - |
| cw_get_member | GET /system/members/{id} | OK | none | - |
| cw_search_configurations | GET /company/configurations | OK | none | - |
| cw_get_configuration | GET /company/configurations/{id} | OK | none | - |
| cw_list_boards | GET /service/boards | OK | none | - |
| cw_list_priorities | GET /service/priorities | OK | none | - |
| cw_list_statuses | GET /service/boards/{boardId}/statuses | OK | none | - |
| cw_search_activities | GET /sales/activities | OK | none | - |
| cw_get_activity | GET /sales/activities/{id} | OK | none | - |
| cw_create_activity | POST /sales/activities | OK | none | - |
| cw_search_catalog_items | GET /procurement/catalog | OK | none | - |
| cw_get_catalog_item | GET /procurement/catalog/{id} | OK | none | - |
| cw_create_catalog_item | POST /procurement/catalog | OK (extraFields passthrough) | none | - |
| cw_update_catalog_item | PATCH /procurement/catalog/{id} | OK | none | - |
| cw_list_catalog_categories | GET /procurement/categories | OK | none | - |
| cw_list_catalog_subcategories | GET /procurement/subcategories | OK | WRONG CASING: was /procurement/subCategories | YES |
| cw_list_manufacturers | GET /procurement/manufacturers | OK | none | - |
| cw_search_agreements | GET /finance/agreements | OK | none | - |
| cw_get_agreement | GET /finance/agreements/{id} | OK | none | - |
| cw_get_agreement_additions | GET /finance/agreements/{id}/additions | OK | none | - |
| cw_search_invoices | GET /finance/invoices | OK | none | - |
| cw_get_invoice | GET /finance/invoices/{id} | OK | none | - |
| cw_search_opportunities | GET /sales/opportunities | OK | none | - |
| cw_get_opportunity | GET /sales/opportunities/{id} | OK | none | - |
| cw_search_opportunity_forecasts | GET /sales/opportunities/{id}/forecast | OK | path confirmed singular "forecast" | - |
| cw_search_opportunity_notes | GET /sales/opportunities/{id}/notes | OK | none | - |
| cw_search_sales_stages | GET /sales/stages | OK | path confirmed | - |

Every list/search tool calls `shapeList`; every get tool calls `shapeItem`;
status/create/update calls use `shapeRaw`. All accept opt-in `fields[]` and
`full`. All catch blocks route through `toolErrorFromCatch`, which surfaces the
vendor HTTP status (via CwHttpError.status) plus a body excerpt and a
remediation hint. No exceptions are swallowed.

## Conditions / pagination model

- Query params used: `conditions` (CW condition syntax), `page`, `pageSize`,
  `orderBy`. These match the CW Manage query model. Child-list tools
  (notes, additions, forecasts) correctly omit `conditions`/`orderBy` where the
  parent-scoped collection does not need them.
- `childconditions` / `customFieldConditions` are not exposed as dedicated args;
  this is acceptable - they are advanced filters and not required for the
  current tool surface. Not treated as a defect.

## Base URL handling

- Default hardcoded in `getConfig()`: `https://api-na.myconnectwise.net`.
- `CW_MANAGE_BASE_URL` (and legacy `CW_MANAGE_URL`) are optional; empty,
  whitespace, or unresolved `${...}` placeholder values fall back to the default
  with no error. Regional shards (eu/au) and on-prem URLs are supported by
  passing the value through. manifest `user_config.cw_manage_base_url` is
  `"required": false` with the documented default. Compliant.

## Fixes applied (repo src + dist rebuilt)

1. `src/tools/catalog.ts` - `cw_list_catalog_subcategories` path
   `/procurement/subCategories` -> `/procurement/subcategories` (canonical
   lowercase segment per the CW OpenAPI client). This is the only behavioral
   path fix.
2. `src/tools/health.ts` - replaced unicode em dashes with hyphens in the
   `cw_status` credential-status strings.
3. `src/index.ts` - replaced em dashes with hyphens in the no-creds
   `cw_status` diagnostic output and one OAuth log line; bumped the internal
   `McpServer` version label from a stale `1.1.5` to `1.5.1`.
4. `manifest.json` - replaced em dashes in `description` with hyphens; version
   1.5.0 -> 1.5.1.
5. `package.json` - version 1.5.0 -> 1.5.1.

## Doc discrepancies fixed vs left

- Fixed: catalog subcategories path casing (`subCategories` -> `subcategories`).
- Left as-is (verified correct against the CW OpenAPI client, no change needed):
  opportunity forecast path `/sales/opportunities/{id}/forecast`, sales stages
  `/sales/stages`, ticket `allNotes` with `/notes` fallback, agreement
  `/additions`, board `/statuses`.
- Not changed (out of scope, pre-existing, in a file not otherwise touched):
  one em dash in `src/auth/middleware.ts` log message ("Role check failed -").
  Internal log line only, not a tool description; flagged for a future pass.

## Build / test / boot evidence

- npm install (staged in /tmp): added 587 packages, exit 0.
- typecheck (`tsc --noEmit`): exit 0, no errors.
- build (`tsc`): exit 0.
- test (`vitest run`): Test Files 1 passed (1); Tests 10 passed (10). No project
  test failures. (No stale node_modules/zod glob in this run.)
- pack (`node scripts/pack-mcpb.js`): produced connectwise-manage-mcp.mcpb,
  version 1.5.1, 2.6MB, dist/index.js + node_modules verified present.
- boot test (extracted bundle, `node dist/index.js` over stdio):
  - No creds: initialize + tools/list succeed; serverInfo version 1.5.1; tools =
    [cw_status, cw_test_connection]. Expected and acceptable.
  - Dummy creds: 52 cw_* tools registered, including
    cw_list_catalog_subcategories. No tool-count regression.

## Artifacts copied back to repo

- connectwise-manage-mcp.mcpb (v1.5.1)
- dist/ (rebuilt, includes all source fixes)
- manifest.json (v1.5.1)
- package.json (v1.5.1)
- Source fixes applied directly in repo src/ via edits.
