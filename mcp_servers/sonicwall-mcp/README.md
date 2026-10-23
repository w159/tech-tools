# SonicWall MCP Server

An MCP server for SonicWall firewalls running SonicOS 7, over the SonicOS REST API.
Every change is staged in the firewall's pending config. Nothing takes effect until the
separate `sonicwall_config_commit` tool is called.

Status: not yet validated against hardware. The endpoint inventory comes from the vendor
Swagger dump for SonicOS 7.3.2-7010.

## What it does

- Reads system, license, interface, VPN and log data.
- Lists, creates, updates and deletes address/service/zone objects and access, security,
  NAT and route policies (all staged, never auto-committed).
- Offers a guarded generic request tool for any endpoint listed in the bundled inventory
  (`sonicos-endpoints.json`).
- Logs in by itself (HTTP Basic over HTTPS), keeps the session in memory, and releases the
  single SonicOS admin slot when the process exits.

## Configuration

Set these environment variables. Values left blank or still showing an unresolved
`${user_config.x}` placeholder count as unset.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SONICWALL_HOST` | Yes | none | Firewall hostname or IP, no scheme and no path. There is no vendor default. |
| `SONICWALL_USERNAME` | Yes | none | Admin account for the API. Use a dedicated least-privilege admin so audit entries are attributable. |
| `SONICWALL_PASSWORD` | Yes | none | Password for that account. Sent only in the Basic Authorization header. |
| `SONICWALL_PORT` | No | `443` | HTTPS port. An invalid value falls back to 443. |
| `SONICWALL_VERIFY_TLS` | No | `true` | Set to `false` to accept a self-signed certificate. Uses a per-request agent, never the process-wide TLS setting. |
| `SONICWALL_SESSION_OVERRIDE` | No | `false` | Set to `true` to preempt a human admin who holds the single API session. That admin is logged out and their pending config is discarded. |

If host, username or password is missing, only `sonicwall_status` and `sonicwall_navigate`
are listed. Set all three and restart the session to get the full tool set.

## Running

The server speaks MCP over stdio.

```bash
export SONICWALL_HOST="fw.example.test"
export SONICWALL_USERNAME="api-admin"
export SONICWALL_PASSWORD="..."
node dist/index.js
```

Inside the armada plugin this connector ships as a prebuilt bundle at
`plugins/armada/mcp/sonicwall/server.mjs`.

## Tools

Tools are grouped into domains. Use `sonicwall_navigate` to list domains, list a domain's
tools, or search the endpoint inventory.

| Domain | Tools |
|--------|-------|
| navigation | `sonicwall_navigate`, `sonicwall_status` |
| session | `sonicwall_logout` |
| system | `sonicwall_version`, `sonicwall_system_status`, `sonicwall_security_services_status`, `sonicwall_interfaces_status`, `sonicwall_license_status`, `sonicwall_api_settings`, `sonicwall_logged_in_users` |
| config | `sonicwall_config_pending`, `sonicwall_config_commit`, `sonicwall_config_discard`, `sonicwall_config_mode`, `sonicwall_non_config_mode` |
| objects | `sonicwall_objects_list`, `_get`, `_create`, `_update`, `_delete` (address objects and groups, service objects and groups, zones, schedules; keyed by name) |
| policies | `sonicwall_policies_list`, `_get`, `_create`, `_update`, `_delete` (access, security, NAT and route policies; keyed by uuid) |
| interfaces | `sonicwall_interfaces_list`, `sonicwall_interfaces_get`, `sonicwall_interfaces_statistics` |
| vpn | `sonicwall_vpn_policies_list`, `sonicwall_vpn_site_to_site_list`, `sonicwall_vpn_site_to_site_get`, `sonicwall_vpn_tunnel_status`, `sonicwall_ssl_vpn_sessions` |
| logs | `sonicwall_log_view`, `sonicwall_audit_log_view`, `sonicwall_audit_log_settings`, `sonicwall_syslog_servers`, `sonicwall_export_log_csv`, `sonicwall_export_audit_csv` |
| generic | `sonicwall_request` |

## Safety notes

- Read tools carry `readOnlyHint: true`. Every tool that can change the appliance carries
  `readOnlyHint: false` and `destructiveHint: true`, and its description starts with
  `DESTRUCTIVE:`.
- Writes are staged. `sonicwall_config_commit` is the only step that makes them live, and it
  changes traffic handling for everyone behind the firewall. Review
  `sonicwall_config_pending` first. `sonicwall_config_discard` throws the staged changes away.
- `sonicwall_request` accepts only paths that appear in the endpoint inventory. Any method
  other than GET needs `confirm: true`. Some paths are refused even with `confirm`:
  restart, import, password and TOTP changes, clear-log, restore-defaults, auth,
  factory-default, delete-all endpoints and full config export.
- SonicOS allows a single API session. Ending the session (including `sonicwall_logout`)
  discards uncommitted pending config, so commit first if it should survive.
- `sonicwall_status` shows only the length of the password, never the value, and warns when
  TLS verification is off or session override is on.
- A tool that declares no effect class is treated as mutating and logged to stderr, never
  as read-only.

## Tests

Unit tests use vitest and live in `src/__tests__/`. They cover configuration parsing and the
missing-credential state, request building (URL, headers, auth) with `fetch` mocked, the
`sonicwall_request` guards, and tool annotations. They never contact a firewall.

`vitest.config.ts` points `node-sonicwall` at the library source, so no library build is
needed. Do not run `npm install` inside the repo (see `CONTRIBUTING.md`); stage a copy first:

```bash
mkdir -p /tmp/sw-stage/mcp_servers /tmp/sw-stage/mcp_node
cp -r mcp_servers/sonicwall-mcp mcp_servers/_shared /tmp/sw-stage/mcp_servers/
cp -r mcp_node/node-sonicwall /tmp/sw-stage/mcp_node/
cd /tmp/sw-stage/mcp_servers/sonicwall-mcp
npm install
npx vitest run
```

`npm test` runs the unit tests and then the boot probe (`tests/boot-probe.mjs`), which
launches the bundled server from `plugins/armada/mcp/sonicwall/` and so needs the repo
layout. From the repo root, `node test-mcp-tools.mjs sonicwall` runs the shared tool-surface
checks.

## License

Apache-2.0
