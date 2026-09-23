# Pulse config artifact

Schema for `.atlas/memory/product-pulse-config.md` - the only place atlas-pulse persists user decisions across runs. `.atlas/memory/` is the docs-SSOT home for persistent cross-session state; this file is living config (revised in place, never dated). It is created ONLY by Phase 1 when the user confirms event names or source choices that code could not supply, and re-read by Phase 0 on every later run. If the file claims a source the repo no longer wires, Phase 1 re-runs.

The interview captures *which tool* and *what shape of query* - never credentials. API keys, DSNs, and tokens stay in the user's environment. Never write a secret value into this file.

## File shape

```markdown
---
product_name: <string, used in report titles>
lookback_default: <1h | 24h | 7d | 30d, default 24h>
primary_event: <event name, or "not-defined">
value_event: <event name, "same-as-primary", or "not-defined">
completion_events: <comma-separated 0-3, or empty>
quality_scoring: <true | false, default false>
quality_dimension: <string; only when quality_scoring true>
quality_scoring_note: <one sentence distinguishing a 5 from a 3; only when opted in>
analytics_source: <provider id | none>
tracing_source: <provider id | none>
payments_source: <provider id | none>
db_access: <none | read-only: <connection shape, cheap-scan columns, tables to avoid>>
---
# Pulse config - <product name>

<Prose notes: what each event means in the user's own words, which source is
canonical when two tools could answer the same signal, anything flagged
needs-review.>
```

## Key semantics

- `primary_event` unset/`not-defined` -> the Usage section leads with the best discovery-derived engagement signal and labels it `proxy - not user-confirmed`. Never invented.
- `value_event: same-as-primary` -> the report renders one usage line, not two.
- `pending_metrics` / `excluded_metrics` (comma-separated, optional): metrics the user deferred for instrumentation render as `no data` each run until wired; intentionally excluded metrics are omitted entirely. Every un-instrumented metric the user names must land in exactly one of the two - never silently skipped.
- `db_access` exists only after a **verified read-only** connection shape is named. A prod credential or any connection with write access is refused every time it is offered: the options are a read-only replica/user, or no DB. Refusal is not a one-time interview answer - re-offered credentials are re-refused.
- Anything the user answered loosely gets flagged `needs-review` in the prose notes after one pushback round, and moves on.

## Maintenance

- Phase 0 re-reads this file every run; Phase 1 re-runs whenever it is stale or absent.
- Edit it in place when the user re-runs the interview or confirms new events. Keep frontmatter keys stable - the schema above is the whole contract.
- The file is user-readable project state: write event names in the terms the team actually uses, not generic templates.