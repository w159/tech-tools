---
description: "Build or fix a Grafana panel or dashboard backed by a SQL datasource; use when you need a clean, dialect-correct query plus the panel and variable configuration to render a metric."
argument-hint: "[datasource] [SQL dialect] [panel goal] [metric definition]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/operating-contract.md"
```

If the contract did not load above, read `skills/orchestrate/references/operating-contract.md` and apply it before proceeding.

Build or fix this Grafana panel: $ARGUMENTS

Read the arguments as four inputs:
- Datasource: the Grafana datasource name and the database behind it.
- SQL dialect: the target dialect, such as PostgreSQL, MySQL, SQL Server, or Oracle.
- Panel goal: what the panel should show and which panel type (time series, table, stat, etc.).
- Metric definition: how the number is computed - the rows counted, the filters, the time grain.

If the panel goal or the metric definition is missing or ambiguous, ask once for it, then proceed.

Deliver three things:
1. The SQL query - clean and optimized for the stated dialect. Use Grafana variables to parameterize filters rather than hardcoding values, and support the dashboard time picker instead of hardcoded dates. Output columns must match the target panel type: a time column for time series, clearly named value columns for tables and stats. Handle empty result sets gracefully so the panel shows a "no data" state, not a database error.
2. Panel and variable configuration - the specific Grafana UI settings: panel type, datasource, the variable definitions, axis and field mappings.
3. Verification plan - how to confirm the query returns the correct rows, with a sample of the expected result set.

Constraints:
- Do not guess table or column names from memory. If unsure of the schema, state which tables and columns you are assuming, or ask for clarification.
- Remove all debugging artifacts from the final query - no artificial delays (such as WAITFOR DELAY or its dialect equivalent) and no scratch comments.

VERIFY:
- Run the query against the real datasource and show the actual result set, or state the exact query to run and the expected rows if you cannot run it here.
- Confirm the output columns match the panel type and that an empty-result case renders as "no data," not an error.
- Confirm each Grafana variable resolves and the time picker drives the query.

REPORT:
- The final SQL query.
- The panel and variable configuration.
- The sample result set you observed (or the command and expected output if unrun).
- The empty-result behavior you confirmed.
