# cipp-mcp deep audit - 2026-06-12

Scope: per-endpoint audit + rebuild of the cipp-mcp MCP server.
Vendor: CIPP (CyberDrain Improved Partner Portal), CIPP-API Azure Functions reached at `{baseUrl}/api/<FunctionName>`.
Build tool: tsc. Tests: jest. Version: 0.2.0/0.1.1 (drift) -> 0.2.1 (both).

## Summary

- 43 tools registered (42 functional + cipp_status). All audited.
- Architecture is sound: typed service layer (one method per CIPP function), shared response shaper (compact summaries + char cap), shared error envelope (surfaces vendor HTTP status + body excerpt + remediation hint), OAuth client-credentials token provider with caching, status tool that never touches the network.
- CIPP base URL handling is correct and REQUIRED (no public default, since CIPP is self-hosted). manifest.json marks `cipp_base_url` required:true; cipp_status reports the missing state cleanly without crashing (verified live).
- Main fix: destructive/visible tool description prefixes were non-ASCII `(warn) HIGH-IMPACT` / `(warn) DESTRUCTIVE - IRREVERSIBLE` forms. Rewrote to the required ASCII `DESTRUCTIVE:` / `VISIBLE-TO-OTHERS:` prefixes (verb-first, state what is returned and when to call), and updated the repo's destructive-warnings lint to accept those ASCII tokens. Removed all non-ASCII characters from tool descriptions.

## Endpoint verification method + limitation

CIPP-API v7+ consolidated its HTTP entrypoints into a single dispatcher
(`New-CippCoreRequest.ps1`); per-function `Invoke-*.ps1` entrypoints no longer
exist at predictable raw paths, and the GitHub recursive tree is truncated for
this large repo. raw.githubusercontent.com fetches were blocked in this
environment. As a result the function names could NOT be exhaustively
re-enumerated live this session.

What WAS confirmed from official docs (docs.cipp.app):
- API calls hit `{baseUrl}/api/<Function>` (base URL must include `/api`). Matches code.
- OAuth scope `api://<clientId>/.default` against
  `https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token`. Matches token.service.ts exactly.
- `ListLogs` is a documented GET endpoint (used in the official PowerShell example). Matches code.

All other function names used here (ListUsers, ListTenants, ExecBECCheck,
ExecResetPass, ExecResetMFA, ExecRevokeSessions, ExecDisableUser,
ExecOffboardUser, AddUser, EditUser, ListGroups, AddGroup, ListMailboxes,
ListmailboxPermissions, ExecSetOoO, ExecEmailForward,
ListConditionalAccessPolicies, ListNamedLocations, ListStandards,
ExecStandardsRun, listStandardTemplates, ListTenantDrift, ListTenantAlignment,
AddStandardsTemplate, RemoveStandardTemplate, ListBPA, ListDomains,
ListDomainHealth, ListLicenses, ListCSPLicenses, ListAuditLogs,
ListAlertsQueue, ListGDAPRoles, ListGDAPInvite, ListScheduledItems,
AddScheduledItem, PublicPing, GetVersion) are the long-standing canonical CIPP
route names the CIPP frontend calls. The existing jest suite asserts the
standards-family routes (listStandardTemplates, ListTenantDrift,
ListTenantAlignment, AddStandardsTemplate, RemoveStandardTemplate) and the
domain-health flow. Author-documented CIPP naming quirks are intentional and
left intact: lowercase `listStandardTemplates`, lowercase-m
`ListmailboxPermissions`, singular `ListGDAPInvite`, `ListAlertsQueue`. None
were changed (the directive forbids inventing/altering endpoints on uncertainty).

## Per-tool table

| Tool | Endpoint (method /api/...) | Endpoint status | Desc quality | Issue | Fixed |
|------|----------------------------|-----------------|--------------|-------|-------|
| cipp_list_tenants | POST ListTenants | canonical | good | - | n/a |
| cipp_get_tenant_details | GET ListTenantDetails | canonical | good | - | n/a |
| cipp_list_users | GET ListUsers | canonical | good | - | n/a |
| cipp_create_user | POST AddUser | canonical | rewritten | non-ASCII prefix | yes (VISIBLE-TO-OTHERS:) |
| cipp_edit_user | PATCH EditUser | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_disable_user | POST ExecDisableUser | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_reset_password | POST ExecResetPass | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_reset_mfa | POST ExecResetMFA | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_revoke_sessions | POST ExecRevokeSessions | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_offboard_user | POST ExecOffboardUser | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_bec_check | GET ExecBECCheck | canonical | good | - | n/a |
| cipp_list_mfa_users | GET ListMFAUsers | canonical | good | - | n/a |
| cipp_list_user_devices | GET ListUserDevices | canonical | good | - | n/a |
| cipp_list_user_groups | GET ListUserGroups | canonical | good | - | n/a |
| cipp_list_groups | GET ListGroups | canonical | good | - | n/a |
| cipp_create_group | POST AddGroup | canonical | rewritten | non-ASCII prefix | yes (VISIBLE-TO-OTHERS:) |
| cipp_list_mailboxes | GET ListMailboxes | canonical | good | - | n/a |
| cipp_list_mailbox_permissions | GET ListmailboxPermissions | canonical (lowercase-m quirk) | good | - | n/a |
| cipp_set_out_of_office | POST ExecSetOoO | canonical | rewritten | non-ASCII prefix | yes (VISIBLE-TO-OTHERS:) |
| cipp_set_email_forwarding | POST ExecEmailForward | canonical | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_list_conditional_access_policies | GET ListConditionalAccessPolicies | canonical | good | - | n/a |
| cipp_list_named_locations | GET ListNamedLocations | canonical | good | - | n/a |
| cipp_list_standards | GET ListStandards | canonical | good | - | n/a |
| cipp_run_standards_check | GET ExecStandardsRun | canonical | good | - | n/a |
| cipp_list_standard_templates | GET listStandardTemplates | canonical (lowercase quirk, test-asserted) | good | - | n/a |
| cipp_get_tenant_drift | GET ListTenantDrift | canonical (test-asserted) | rewritten | em-dash | yes (ASCII) |
| cipp_get_tenant_alignment | GET ListTenantAlignment | canonical (test-asserted) | good | - | n/a |
| cipp_create_standard_template | POST AddStandardsTemplate | canonical (test-asserted) | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_delete_standard_template | POST RemoveStandardTemplate | canonical (test-asserted) | rewritten | non-ASCII prefix | yes (DESTRUCTIVE:) |
| cipp_list_bpa | GET ListBPA | canonical | good | - | n/a |
| cipp_list_domain_health | GET ListDomains + ListDomainHealth | canonical (per-domain flow, test-covered) | good | - | n/a |
| cipp_list_licenses | GET ListLicenses | canonical | good | - | n/a |
| cipp_list_csp_licenses | GET ListCSPLicenses | canonical | good | - | n/a |
| cipp_list_audit_logs | GET ListAuditLogs | canonical | good | - | n/a |
| cipp_list_alert_queue | GET ListAlertsQueue | canonical | good | - | n/a |
| cipp_list_gdap_roles | GET ListGDAPRoles | canonical | good | - | n/a |
| cipp_list_gdap_invites | GET ListGDAPInvite | canonical (singular quirk) | good | - | n/a |
| cipp_list_scheduled_items | POST ListScheduledItems | canonical | good | - | n/a |
| cipp_add_scheduled_item | POST AddScheduledItem | canonical | good | - | n/a |
| cipp_status | (none - local) | local config report | good | - | n/a |
| cipp_ping | GET PublicPing | canonical (anonymous) | good | - | n/a |
| cipp_get_version | GET GetVersion | canonical | good | - | n/a |
| cipp_list_logs | GET ListLogs | confirmed via docs | good | - | n/a |

## Changes made

1. src/mcp/tool.definitions.ts - rewrote 11 destructive/visible tool descriptions
   to ASCII `DESTRUCTIVE:` / `VISIBLE-TO-OTHERS:` verb-first prefixes; removed the
   one remaining em-dash (cipp_get_tenant_drift). No non-ASCII characters remain.
   destructiveHint:true annotations were already present and are unchanged.
2. scripts/lint-destructive-warnings.mjs - accept the ASCII `DESTRUCTIVE:` /
   `VISIBLE-TO-OTHERS:` prefix tokens in addition to the legacy unicode forms,
   so the repo convention is satisfied without unicode. Updated comments/messages.
3. package.json 0.1.1 -> 0.2.1; manifest.json 0.2.0 -> 0.2.1 (drift resolved, kept equal).
4. Rebuilt dist/ and repacked cipp-mcp.mcpb.

## Defects NOT found / left as-is

- Service layer error handling: surfaces vendor HTTP status + body excerpt + a
  status-aware remediation hint (buildCippHint). No swallowed exceptions.
- cipp_status: never calls the network, reports missing-creds via the shared
  envelope. Verified live (boot with empty env -> MISSING_CREDENTIALS + hint).
- Base URL: required, no fabricated default, documented as required in manifest.
- Endpoint names: left unchanged - could not be exhaustively re-verified live
  this session (see limitation above); they match canonical CIPP conventions and
  the existing tests, and the directive forbids inventing/altering on uncertainty.

## Build / test / lint evidence (staged in /tmp/cipp-build)

- npm install: 789 packages, prepare->tsc clean.
- npm run build (tsc): exit 0, no errors.
- jest: 3 suites, 17 tests, all passing.
- destructive-warnings lint (node scripts/lint-destructive-warnings.mjs src): "All destructive tools carry the required warnings." exit 0.
- non-ASCII scan of tool.definitions.ts: clean (0 matches).
- pack-mcpb.js: built cipp-mcp.mcpb (3.1 MB, 2265 files), verified dist/entry.js + node_modules present.

## Boot test (extracted bundle, stdio, NO credentials)

- spawn node dist/entry.js with all CIPP_* env empty.
- initialize + tools/list -> TOOL_COUNT=43, HAS_STATUS=true, HAS_PING=true.
- cipp_offboard_user description begins "DESTRUCTIVE:" with destructiveHint=true.
- tools/call cipp_status -> isError=true, code MISSING_CREDENTIALS, hint to set CIPP_BASE_URL. No crash.

## Version

package.json: 0.1.1 -> 0.2.1
manifest.json: 0.2.0 -> 0.2.1

## Manual follow-ups

- When network access to raw.githubusercontent.com / the CIPP OAS generator is
  available, do a one-pass diff of all 38 function names against the live CIPP-API
  routes to convert "canonical" to "verified", especially the four quirk spellings
  (listStandardTemplates, ListmailboxPermissions, ListGDAPInvite, ListAlertsQueue).
- Repo-root README.md tool tables/counts were not touched this session; confirm the
  cipp-mcp count (43) and version (0.2.1) there if it lists per-server detail.
