---
name: harbor-audit
description: 'Runs the saved audit queries against the gateway logs for a time window and summarizes five insights: destructive tool calls by person, denials by person, unused grants, error rate by connector, and first-seen client ids. Read-only. Use for access reviews, incident questions, and trimming grants.'
when_to_use: reviewing who used the gateway, investigating denials or errors, or finding grants nobody uses
allowed-tools: Read, Glob, Grep, Bash
argument-hint: '[window, for example 7d]'
---

# harbor-audit

Read-only. Nothing here changes cloud state.

## Audit event shape

One JSON line per event on stdout, schema `mcp-gw.audit/1`: `schema`, `ts`,
`request_id`, `event` (`auth_failed`, `token_issued`, `tools_listed`,
`tool_call`), `actor.sub`, `actor.email`, `actor.idp`, `actor.tenant`,
`client_id`, `roles`, `connector`, `tool`, `effect` (`read`, `write`,
`destructive`), `decision` (`allow`, `deny`), `reason`, `outcome` (`ok`,
`tool_error`, `backend_error`, `timeout`), `duration_ms`, `args_hmac`.

Tool arguments, tool results and tokens are never logged. `args_hmac` is a
keyed hash that shows two calls had identical arguments without revealing them.

## Inputs

Ask only for what is missing: cloud (azure or gcp), window (default 7d), the
log location (Azure: Log Analytics workspace id and Container App name; Google
Cloud: project and Cloud Run service name).

## Queries

| Insight | Azure (KQL) | Google Cloud (Cloud Logging) |
|---|---|---|
| Destructive calls by person | `queries/azure/destructive-calls-by-person.kql` | `queries/gcp/destructive-calls-by-person.txt` |
| Denials by person | `queries/azure/denials-by-person.kql` | `queries/gcp/denials-by-person.txt` |
| Unused grants | `queries/azure/unused-grants.kql` | `queries/gcp/unused-grants.txt` |
| Error rate by connector | `queries/azure/error-rate-by-connector.kql` | `queries/gcp/error-rate-by-connector.txt` |
| First-seen client ids | `queries/azure/first-seen-client-ids.kql` | `queries/gcp/first-seen-client-ids.txt` |

Paths are relative to `${CLAUDE_PLUGIN_ROOT}`.

### Azure

Container Apps console logs are in table `ContainerAppConsoleLogs_CL`; the log
line is column `Log_s` (Microsoft Learn, "Monitor logs in Azure Container
Apps"). If the environment was switched to Azure Monitor resource-specific
tables, the table is `ContainerAppConsoleLogs` and the column is `Log`; adjust
the query before running.

1. Copy the query to a temp file. Replace `lookback` (for example `30d`) and
   `appName`. For unused-grants, replace the `granted` datatable rows with the
   (role, connector) pairs from `policy.yaml` grants, one row per connector
   (expand `"*"` to the connector ids in the catalog).
2. Run: `az monitor log-analytics query --workspace <workspace customer id> --analytics-query "$(cat /tmp/q.kql)" --out table`.
   The workspace customer id is the `logAnalyticsCustomerId` deployment output.
   The first query after a deploy can fail until the table exists; wait a few
   minutes and retry once.

### Google Cloud

Cloud Run turns each JSON stdout line into `jsonPayload` on resource type
`cloud_run_revision` (Cloud Run logging docs). The `.txt` files hold the
filter; Cloud Logging filters do not aggregate, so group the output.

```bash
gcloud logging read "$(grep -v '^--' queries/gcp/<insight>.txt | sed 's/SERVICE_NAME/<service>/')" \
  --project <project> --freshness <window> --format json > /tmp/events.json
```

Then group `/tmp/events.json` with `jq` or `python3` as the hint at the bottom
of each file says. Delete `/tmp/events.json` when done; it contains actor
emails.

## Summary format

Lead with the window and the event count. Then one short section per insight:

- Destructive calls by person: person, count, connectors and tools. Flag
  anyone outside the roles meant to hold `destructive`.
- Denials by person: person, count, deciding `reason` values. Repeated
  `no_grant` for one person usually means a missing role assignment; repeated
  `deny_tools:` hits mean a carve-out is doing its job or a user is probing.
- Unused grants: (role, connector) pairs with no allowed call in the window.
  Candidates to remove through harbor-policy. A short window gives false
  positives; say the window used.
- Error rate by connector: calls, error rate, split by `tool_error`,
  `backend_error`, `timeout`, and p95 `duration_ms` where available. Name any
  connector above 5 percent.
- First-seen client ids: ids first seen inside the window, with first seen
  time and number of people. Each new id is an OAuth client that was not seen
  before; confirm it is an expected Claude client.

Report counts from the output. If a query returns nothing, say so and check the
service name, the window, and that the gateway logs to stdout, before
concluding there was no activity. Suggest policy changes but never make them;
route those to harbor-policy.
