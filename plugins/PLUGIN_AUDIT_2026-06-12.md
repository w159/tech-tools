# Plugin Audit - 2026-06-12

Audit of every plugin under `plugins/` after the folder reorganization. Each plugin
was inventoried for manifest completeness, command/skill/agent counts, MCP wiring, and
README presence. The six critical plugins were additionally exercised against their live
or boot-tested MCP servers to find the real reason they "don't work."

## How this audit was produced

- Folder structure and `plugin.json` `name` fields read directly from disk.
- MCP wiring classified into three delivery models (see below).
- The live MCP servers connected this session (ConnectWise, NinjaOne, Spanning) were
  called directly to confirm real behavior and capture their actual tool lists.
- The uncredentialed servers (Auvik, Paylocity, KnowBe4) were boot-tested by extracting
  their `.mcpb`, spawning over stdio, and reading `tools/list`.
- Every critical plugin's skill/command tool references were diffed against the tool
  names its server actually exposes. Mismatches are listed verbatim.

## MCP delivery models in this repo

1. Hosted HTTP - the plugin ships a `.mcp.json` pointing at a remote endpoint
   (e.g. Auvik -> `https://mcp.wyre.ai/v1/auvik/mcp`). Only 5 plugins ship their own
   `.mcp.json`: auvik, threatlocker, immybot, pdf-viewer, product-management.
2. Local `.mcpb` bundle - the server lives in `mcp_servers/<svc>-mcp/` and is installed at
   the app level. The plugin's skills just call `mcp__<Server>__*`. This covers
   ConnectWise, NinjaOne, Spanning, Paylocity, KnowBe4, CIPP, Blumira, Vanta, ThreatLocker.
3. No server - the plugin is pure skills/commands with no MCP backend (most of the
   "role" plugins: engineering, design, finance, operations, etc.).

A plugin can be fully built and still fail at runtime if (a) its server is not connected in
the user's environment, or (b) its skills call tool names the server does not expose.

## Maturity tiers (all 45 plugins)

Counts are commands / skills / agents. "Drift" = skill/command tool references that do not
match the server's real tool names.

### Mature (populated, manifest complete, README present)

| Plugin | cmd/skl/agt | Notes |
|---|---|---|
| connectwise-psa | 10/7/3 | Server healthy + live data. 2 tool-name drifts (write tools). Output not field-filtered. |
| connectwise-automate | 2/6/1 | Server not connected this session; not exercised. |
| kaseya-autotask | 15/15/2 | Largest plugin. Not connected this session. |
| kaseya-datto-rmm | 4/7/2 | Not connected this session. |
| kaseya-it-glue | 5/7/2 | Not connected this session. |
| blumira | 6/6/2 | Server present, not connected. |
| checkpoint-avanan | 5/5/2 | |
| cipp | 4/9/2 | |
| m365 | 4/8/2 | |
| proofpoint | 6/7/2 | |
| pandadoc | 5/5/2 | |
| pax8 | 4/6/2 | |
| immybot | 6/6/3 | Ships own `.mcp.json`. |
| knowbe4 | 5/5/2 | Server healthy (30 tools) but 27 of 36 tool refs are WRONG names. See critical section. |
| ninjaone-rmm | 4/5/2 | Server healthy + live data. 1 tool-name drift. |
| auvik | 5/4/3 | Hosted HTTP server; not connected this session. |
| azure-mcp | 2/3/1 | |
| kaseya-rocketcyber | 2/5/2 | |
| microsoft-graph | 2/2/1 | |
| orchestrate | 1/1/5 | Agent-heavy coding meta-plugin. |

### Role / workflow plugins (no MCP backend, skills only - generally solid)

data, design, engineering, finance, operations, human-resources, customer-support,
product-management, productivity, enterprise-search, brand-voice, vanta-compliance-ops,
security-compliance, shared-skills, nudge, cowork-plugin-management, pdf-viewer.

These are content/skill plugins. Most are complete. Exceptions flagged below.

### Stubs (skeletons - 0 commands, 1 skill, 0 agents)

| Plugin | Issue |
|---|---|
| kaseya-spanning | CRITICAL. Hollow stub. Server is healthy with 14 working tools, but the plugin references 0 of them. |
| kaseya-bms | Skeleton only. |
| kaseya-datto-bcdr | Skeleton only. |
| kaseya-datto-saas-protection | Skeleton only. |
| kaseya-unitrends | Skeleton only. |
| kaseya-vsa | Skeleton only. |

### Structural / hygiene issues

- `cowork-plugin-management` has an internal double-nest:
  `cowork-plugin-management/skills/cowork-plugin-management/skills/...` duplicates the real
  skills. The inner copy should be removed.
- Missing README: `paylocity-hr-ops`, `security-compliance`, `shared-skills`,
  `vanta-compliance-ops`, `cowork-plugin-management`.
- Root `marketplace.json` is stale: it lists only 4 plugins (`orchestrate`, `msp-ops`,
  `security-compliance`, `hr-payroll`) and points at folders `msp-ops` and `hr-payroll`
  that do not exist. It does not register any of the ~45 real plugin folders.

## Critical 6 - root cause diagnosis (evidence-based)

Every critical server's CODE is healthy - all six boot and either return live data or list
their tools. The failures are connectivity and plugin-vs-server tool drift, not server bugs.

| Plugin | Server code | Connected this session | Tool-name drift | Verdict |
|---|---|---|---|---|
| connectwise-psa | Healthy. `cw_test_connection` returns live v2025.1 data. | Yes | 2: `cw_create_catalog_item`, `cw_update_catalog_item` (server is read-only) | Mostly works; catalog write skill is broken; output too verbose for dashboards |
| ninjaone-rmm | Healthy. `devices_list` returns live devices. | Yes | 1: `ninjaone_alerts_reset_all` (no such tool) | Works for reads; remediation skills assume action tools that do not exist |
| kaseya-spanning | Healthy. `spanning_status` + tools all present. | Yes | n/a - references 0 tools | Plugin is an empty stub; needs real skills/commands |
| auvik | Boots (HTTP proxy to wyre.ai). | No | Hosted tools not locally enumerable | Connectivity/config: server not connected in user env |
| paylocity-hr-ops | Healthy. 16 tools listed. | No | 0 - fully aligned | Connectivity only + no README + thin coverage |
| knowbe4 | Healthy. 30 tools listed. | No | 27 of 36 references are wrong names | Connectivity + pervasive naming drift; primary reason it "doesn't work" |

### KnowBe4 naming drift detail

The plugin was written against a different (verb-first) naming scheme than the server ships.
Examples of the inversion:

| Plugin uses (wrong) | Server actually exposes |
|---|---|
| `knowbe4_phishing_list_campaigns` | `knowbe4_phishing_campaigns_list` |
| `knowbe4_phishing_get_campaign` | `knowbe4_phishing_campaigns_get` |
| `knowbe4_phishing_list_security_tests` | `knowbe4_phishing_security_tests_list` |
| `knowbe4_training_list_enrollments` | `knowbe4_training_enrollments_list` |
| `knowbe4_training_get_enrollment` | `knowbe4_training_enrollments_get` |
| `knowbe4_groups_list_members` | `knowbe4_groups_members` |
| `knowbe4_training_list_users` | `knowbe4_users_list` |
| `knowbe4_training_get_store_purchase` | `knowbe4_store_purchases_get` |

A further set has no server equivalent at all and must be removed or re-scoped in the skills:
`knowbe4_phisher_*` (PhishER product - not implemented), `knowbe4_phishing_*_templates`,
`knowbe4_training_*_modules`, `knowbe4_users_list_events`,
`knowbe4_reporting_department_breakdown`, `knowbe4_reporting_ppp_trend`,
`knowbe4_reporting_account_summary`.

## Recommended fixes (in priority order)

1. KnowBe4: remap the cleanly-mappable tool names in all skills/commands; rewrite the steps
   that use truly-absent tools (PhishER, templates, modules, per-user events) to use the
   reporting/risk tools that do exist, or drop them.
2. ConnectWise PSA: the catalog-management skill calls write tools the read-only server does
   not have. Either rewrite the skill to read-only, or add the write tools to the server
   (node lib + handler + manifest + `.mcpb` rebuild) per the propagation rule. Adding write
   tools is destructive and must be verified against a sandbox, not production.
3. ConnectWise PSA server: add `fields`/`full` response filtering like NinjaOne/Vanta have.
   A single ticket currently returns ~150 lines of JSON, which is expensive and unreliable
   for the weekly dashboard.
4. NinjaOne: remove or re-scope `ninjaone_alerts_reset_all` references; the server has no
   alert-reset or device-action tools, so remediation skills must be read-only or the
   server must gain those tools.
5. kaseya-spanning: build real skills/commands against the 14 live tools (health sweep,
   restore orchestration, license utilization, audit forensics).
6. paylocity-hr-ops: add a README; coverage is otherwise correct.
7. Connectivity: Auvik, Paylocity, and KnowBe4 servers are not connected in the user's
   environment. The weekly dashboard cannot use them until they are installed/connected.
8. Hygiene: remove the `cowork-plugin-management` inner nest; rebuild `marketplace.json` to
   register the real plugin set.
