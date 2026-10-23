# Kaseya Spanning Backup MCP Server

An MCP server for Kaseya Spanning Backup, the SaaS backup product for Microsoft 365, Google
Workspace and Salesforce. It lists backed-up users and their services, daily backup runs, the
audit log and license usage, and can queue a restore.

## What it does

- Lists backed-up users, one user's detail, and the services protected for a user.
- Lists daily backup runs, per user or tenant-wide.
- Queues a restore job, reads its status, and can wait for it to finish.
- Reads the audit log and the license and seat usage.

## Configuration

Set these environment variables. Values left blank or still showing an unresolved
`${user_config.x}` placeholder count as unset.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SPANNING_ADMIN_EMAIL` | Yes | none | Spanning admin account email that owns the API token. |
| `SPANNING_API_TOKEN` | Yes | none | Spanning API token. |
| `SPANNING_PLATFORM` | No | `m365` | `m365`, `gws` or `salesforce`. Any other value falls back to `m365`. |
| `SPANNING_API_URL` | No | per platform | Overrides the base URL. See the table below. |
| `LOG_LEVEL` | No | `info` | Log verbosity. Logs go to stderr. |

Default base URL per platform:

| Platform | Base URL |
|----------|----------|
| `m365` | `https://o365-api.spanningbackup.com/external` |
| `gws` | `https://api.spanningbackup.com/external` |
| `salesforce` | `https://salesforce-api.spanningbackup.com` |

If the admin email or token is missing, only `spanning_status` and `spanning_navigate` are
listed. Set both and restart the session to get the full tool set.

## Running

The server speaks MCP over stdio.

```bash
export SPANNING_ADMIN_EMAIL="admin@example.test"
export SPANNING_API_TOKEN="..."
export SPANNING_PLATFORM="m365"
node dist/index.js
```

Inside the armada plugin this connector ships as a prebuilt bundle at
`plugins/armada/mcp/spanning/server.mjs`.

## Tools

Call the users tools first to get a user ID. Use `spanning_navigate` with a `domain` to list
a domain's tools.

| Domain | Tools |
|--------|-------|
| navigation | `spanning_navigate`, `spanning_status` |
| users | `spanning_users_list`, `spanning_users_list_all`, `spanning_users_get` |
| services | `spanning_services_list` |
| backups | `spanning_backups_list`, `spanning_backups_list_all` |
| restores | `spanning_restores_queue`, `spanning_restores_get`, `spanning_restores_wait_for` |
| audit | `spanning_audit_list`, `spanning_audit_list_all` |
| license | `spanning_license_get` |

The `_list_all` tools walk every page. The plain `_list` tools return one page.

## Safety notes

- `spanning_restores_queue` is the only tool that changes anything. Its description starts
  with `DESTRUCTIVE:` and it is annotated `readOnlyHint: false`, `destructiveHint: true`. A
  restore can overwrite existing data in the target mailbox, drive or calendar. Confirm the
  user, the service and the restore point before calling it.
- Every other tool is annotated read-only.
- Restores are asynchronous. `spanning_restores_queue` returns a restore ID right away. Poll
  with `spanning_restores_get`, or use `spanning_restores_wait_for` (default 30 second
  interval and 10 minute timeout, sized for the vendor's 100 requests per minute limit). Large
  restores can run for hours, so set `timeoutMs` to match.
- `spanning_status` reports whether credentials are set and the base URL in use. It does not
  print the token.
- A tool that declares no effect class is annotated as mutating and logged to stderr, never
  as read-only.

## Tests

This package has no unit tests of its own yet. The shared harness covers it from the repo
root: `node test-mcp-tools.mjs spanning` starts the bundled server with placeholder
credentials and checks that it boots, that the tool count has not dropped below the recorded
floor, that destructive tools carry `readOnlyHint: false`, and that every tool has a
description and an object input schema. It does not contact Spanning.

Do not run `npm install` inside the repo (see `CONTRIBUTING.md`). To build in a staging copy:

```bash
mkdir -p /tmp/spanning-stage/mcp_servers /tmp/spanning-stage/mcp_node
cp -r mcp_servers/kaseya-spanning-backup-mcp mcp_servers/_shared /tmp/spanning-stage/mcp_servers/
cp -r mcp_node/node-spanning /tmp/spanning-stage/mcp_node/
cd /tmp/spanning-stage/mcp_servers/kaseya-spanning-backup-mcp
npm install
npm run build
```

An earlier review of this connector is kept at
`docs/audits/2026-06-12-kaseya-spanning-backup-mcp-audit.md`.

## License

Apache-2.0
