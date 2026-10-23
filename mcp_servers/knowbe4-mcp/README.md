# KnowBe4 MCP Server

An MCP server for KnowBe4 security awareness training, phishing simulation and user risk
data. The whole tool surface is read-only.

## What it does

- Lists and reads users, groups and group members, with risk score history.
- Reads the account record and account risk score history.
- Reads phishing campaigns, phishing security tests and their recipients.
- Reads training campaigns, enrollments, store purchases and policies.
- Builds three summary reports: phishing, training and risk overview.

## Configuration

Set these environment variables. Values left blank or still showing an unresolved
`${user_config.x}` placeholder count as unset.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `KNOWBE4_API_KEY` | Yes | none | KnowBe4 Reporting API token (Bearer). |
| `KNOWBE4_REGION` | No | `us` | `us`, `eu`, `ca`, `uk` or `de`. Picks the regional API host. |
| `KNOWBE4_BASE_URL` | No | from region | Explicit base URL. Wins over `KNOWBE4_REGION` when set. |
| `LAZY_LOADING` | No | off | `true` starts with a small set of meta-tools and loads domain tools on demand. |
| `MCP_TRANSPORT` | No | `stdio` | Transport selection. `stdio` is what the plugin uses. |
| `LOG_LEVEL` | No | `info` | Log verbosity. Logs go to stderr. |

Regional hosts:

| Region | Base URL |
|--------|----------|
| `us` | `https://us.api.knowbe4.com` |
| `eu` | `https://eu.api.knowbe4.com` |
| `ca` | `https://ca.api.knowbe4.com` |
| `uk` | `https://uk.api.knowbe4.com` |
| `de` | `https://de.api.knowbe4.com` |

If `KNOWBE4_API_KEY` is missing, only `knowbe4_status` and `knowbe4_navigate` are listed. Set
the key and restart the session to get the full tool set.

## Running

The server speaks MCP over stdio.

```bash
export KNOWBE4_API_KEY="..."
export KNOWBE4_REGION="us"
node dist/mcp_servers/knowbe4-mcp/src/index.js
```

Inside the armada plugin this connector ships as a prebuilt bundle at
`plugins/armada/mcp/knowbe4/server.mjs`.

## Tools

Find user, group and campaign IDs with the matching list tool before calling a get tool. Use
`knowbe4_navigate` with a `domain` to list a domain's tools.

| Domain | Tools |
|--------|-------|
| navigation | `knowbe4_navigate`, `knowbe4_status` |
| account | `knowbe4_account_get`, `knowbe4_account_risk_score_history` |
| users | `knowbe4_users_list`, `knowbe4_users_get`, `knowbe4_users_risk_score_history` |
| groups | `knowbe4_groups_list`, `knowbe4_groups_get`, `knowbe4_groups_members`, `knowbe4_groups_risk_score_history` |
| phishing | `knowbe4_phishing_campaigns_list`, `knowbe4_phishing_campaigns_get`, `knowbe4_phishing_campaign_tests`, `knowbe4_phishing_security_tests_list`, `knowbe4_phishing_security_test_get`, `knowbe4_phishing_security_test_recipients`, `knowbe4_phishing_security_test_recipient` |
| training | `knowbe4_training_campaigns_list`, `knowbe4_training_campaigns_get`, `knowbe4_training_enrollments_list`, `knowbe4_training_enrollments_get`, `knowbe4_store_purchases_list`, `knowbe4_store_purchases_get`, `knowbe4_policies_list`, `knowbe4_policies_get` |
| reporting | `knowbe4_reporting_phishing_summary`, `knowbe4_reporting_training_summary`, `knowbe4_reporting_risk_overview` |

List tools return a compact summary by default. Pass `full: true` or `fields` for more.

## Safety notes

- Every tool is annotated `readOnlyHint: true`. There are no create, update or delete tools.
  The unit tests check that read annotations and `DESTRUCTIVE:` / `VISIBLE-TO-OTHERS:`
  description markers agree.
- Results include user names, email addresses and risk scores for people in the account.
  Treat transcripts accordingly and prefer the `fields` option when a summary is enough.
- `knowbe4_status` reports whether a key is set and which base URL is active. It does not
  print the key.
- A tool that declares no effect class is annotated as mutating and logged to stderr, never
  as read-only.

## Tests

Unit tests use vitest and live in `src/__tests__/`. They cover navigation, the HTTP client,
the phishing and training domains, and tool annotations.

Do not run `npm install` inside the repo (see `CONTRIBUTING.md`); stage a copy first:

```bash
mkdir -p /tmp/kb4-stage/mcp_servers
cp -r mcp_servers/knowbe4-mcp mcp_servers/_shared /tmp/kb4-stage/mcp_servers/
cd /tmp/kb4-stage/mcp_servers/knowbe4-mcp
npm install
npm test
```

From the repo root, `node test-mcp-tools.mjs knowbe4` runs the shared tool-surface checks
against the bundled server.

See `CHANGELOG.md` for the history of fixes.

## License

Apache-2.0
