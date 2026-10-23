# Paylocity MCP Server

An MCP server for the Paylocity REST API (HR and payroll). The whole tool surface is
read-only: it lists and reads records and never writes to Paylocity.

## What it does

- Reads employees from the modern CoreHR API and the legacy WebLink API.
- Reads company earning codes, job codes, cost centers and pay grades.
- Reads per-employee earnings, deductions, local taxes, direct deposit accounts and yearly
  pay statement summaries.
- Looks up code tables (pay group, EEO, positions, departments and others).
- Gets an OAuth token itself (client credentials) and refreshes it when it expires or a 401
  comes back.

## Configuration

Set these environment variables. Values left blank or still showing an unresolved
`${user_config.x}` placeholder count as unset.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PAYLOCITY_CLIENT_ID` | Yes | none | OAuth client ID from the Paylocity API credentials. |
| `PAYLOCITY_CLIENT_SECRET` | Yes | none | OAuth client secret. |
| `PAYLOCITY_COMPANY_ID` | Recommended | none | Default company ID used in request paths. If unset, every call must pass `companyId`. |
| `PAYLOCITY_BASE_URL` | No | `https://api.paylocity.com` | Overrides the API host. A trailing slash or `/api` segment is stripped. |
| `PAYLOCITY_SANDBOX` | No | `false` | `true`, `1` or `yes` uses `https://apisandbox.paylocity.com`. Ignored when `PAYLOCITY_BASE_URL` is set. |

If the client ID or secret is missing, only `paylocity_status` and `paylocity_navigate` are
listed. Set both and restart the session to get the full tool set.

## Running

The server speaks MCP over stdio.

```bash
export PAYLOCITY_CLIENT_ID="..."
export PAYLOCITY_CLIENT_SECRET="..."
export PAYLOCITY_COMPANY_ID="..."
node dist/index.js
```

Inside the armada plugin this connector ships as a prebuilt bundle at
`plugins/armada/mcp/paylocity/server.mjs`.

## Tools

Use `paylocity_navigate` with a `domain` to list a domain's tools.

| Domain | Tools |
|--------|-------|
| navigation | `paylocity_navigate`, `paylocity_status` |
| employees | `paylocity_employees_list`, `paylocity_employees_get` (modern CoreHR, with `include` expansion) |
| legacy_employees | `paylocity_legacy_employees_list`, `paylocity_legacy_employees_get` |
| earnings | `paylocity_earnings_company_list`, `paylocity_earnings_employee_list` |
| deductions | `paylocity_deductions_list` |
| taxes | `paylocity_taxes_local_list` |
| direct_deposit | `paylocity_direct_deposit_list` |
| cost_centers | `paylocity_cost_centers_list` |
| pay_grades | `paylocity_pay_grades_list` |
| job_codes | `paylocity_job_codes_list` |
| pay_statements | `paylocity_pay_statements_summary` |
| lookup_codes | `paylocity_lookup_codes_list` |

List tools return a compact summary by default. Pass `full: true` or `fields` for more.
Modern list endpoints page with `limit` (max 20) and `nextToken`.

## Safety notes

- Every tool is annotated `readOnlyHint: true` and `destructiveHint: false`. There are no
  create, update or delete tools. The unit tests fail if a write-style tool name is added
  without the matching annotations.
- Payroll data is sensitive. Tool results can contain employee names, pay rates, tax and bank
  details. Treat transcripts accordingly and use the narrow `fields` option when a summary is
  enough.
- `paylocity_status` shows the base URL and the default company ID, and an abbreviated client
  ID. It never prints the client secret or a token.
- An unrecognized tool name is annotated as mutating and logged to stderr, never as read-only.

## Tests

Unit tests use vitest and live in `src/__tests__/`. They cover configuration parsing and the
missing-credential state, request building (token request, host selection, company path,
Bearer header) with `fetch` mocked, and tool annotations. They never contact Paylocity.

`vitest.config.ts` points `node-paylocity` at the library source, so no library build is
needed. Do not run `npm install` inside the repo (see `CONTRIBUTING.md`); stage a copy first:

```bash
mkdir -p /tmp/pl-stage/mcp_servers /tmp/pl-stage/mcp_node
cp -r mcp_servers/paylocity-mcp mcp_servers/_shared /tmp/pl-stage/mcp_servers/
cp -r mcp_node/node-paylocity /tmp/pl-stage/mcp_node/
cd /tmp/pl-stage/mcp_servers/paylocity-mcp
npm install --legacy-peer-deps
npm test
```

`--legacy-peer-deps` is needed because npm 10 fails on the linked `node-paylocity` package
together with the vitest dev dependency otherwise.

From the repo root, `node test-mcp-tools.mjs paylocity` runs the shared tool-surface checks
against the bundled server.

## License

Apache-2.0
