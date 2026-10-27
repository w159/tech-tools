# Review the gateway audit log

Read-only. Nothing here changes cloud state.

## Audit event shape

One JSON line per event on stdout, schema `mcp-gw.audit/1`: `schema`, `ts`, `request_id`, `event` (`auth_failed`, `token_issued`, `tools_listed`, `tool_call`), `actor.sub`, `actor.email`, `actor.idp`, `actor.tenant`, `client_id`, `roles`, `connector`, `tool`, `effect` (`read`, `write`, `destructive`), `decision` (`allow`, `deny`), `reason`, `outcome` (`ok`, `tool_error`, `backend_error`, `timeout`), `duration_ms`, `args_hmac`.

Tool arguments, tool results and tokens are never logged. `args_hmac` is a keyed hash showing two calls had identical arguments without revealing them.

## Inputs

Ask only for what is missing, one question at a time: the window (default 7d), the Log Analytics workspace customer id (`logAnalyticsCustomerId` deployment output) and the Container App name.

## Queries

Paths relative to `${CLAUDE_PLUGIN_ROOT}/enterprise/queries/azure`:

| Insight | File |
|---|---|
| Destructive calls by person | `destructive-calls-by-person.kql` |
| Denials by person | `denials-by-person.kql` |
| Unused grants | `unused-grants.kql` |
| Error rate by connector | `error-rate-by-connector.kql` |
| First-seen client ids | `first-seen-client-ids.kql` |

Container Apps console logs are in table `ContainerAppConsoleLogs_CL`; the log line is column `Log_s` (Microsoft Learn, "Monitor logs in Azure Container Apps"). If the environment uses Azure Monitor resource-specific tables, the table is `ContainerAppConsoleLogs` and the column is `Log`; adjust the query first.

1. Copy the query to a temp file outside the repo. Replace `lookback` (for example `30d`) and `appName`. For unused-grants, replace the `granted` datatable rows with the (role, connector) pairs from the `grants` in `policy.yaml`, one row per connector (expand `"*"` to the connector ids in the catalog).
2. Run: `az monitor log-analytics query --workspace <workspace customer id> --analytics-query "$(cat /tmp/q.kql)" --out table`. The first query after a deploy can fail until the table exists; wait a few minutes and retry once.
3. Delete the temp file when done; results contain actor emails.

Google Cloud filters exist under `enterprise/queries/gcp` but Google Cloud is not yet supported.

## Summary format

Lead with the window and the event count. Then one short section per insight:

- Destructive calls by person: person, count, connectors and tools. Flag anyone outside the roles meant to hold `destructive`.
- Denials by person: person, count, deciding `reason` values. Repeated `no_grant` for one person usually means a missing group assignment; repeated `deny_tools:` hits mean a carve-out is working or a user is probing.
- Unused grants: (role, connector) pairs with no allowed call in the window. Candidates to remove through `policy.md`. A short window gives false positives; state the window.
- Error rate by connector: calls, error rate, split by `tool_error`, `backend_error`, `timeout`, and p95 `duration_ms` where available. Name any connector above 5 percent.
- First-seen client ids: ids first seen in the window, first seen time, number of people. Confirm each is an expected Claude client.

Report counts from the output. If a query returns nothing, say so and check the app name, the window, and that the gateway logs to stdout, before concluding there was no activity. Suggest policy changes but never make them; route those to `policy.md`.
