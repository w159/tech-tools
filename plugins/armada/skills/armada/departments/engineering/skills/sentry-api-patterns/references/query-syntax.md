# Sentry MCP Query Syntax and Reference

Detailed reference for the Sentry MCP tools. The SKILL.md gives the
overview; this file holds the filter grammar, pagination, rate-limit,
and resource-resolution rules the other Sentry skills lean on. Read it
when you need the exact filter syntax or the discovery flow detail.

## Discovery Flow

Every Sentry task starts by establishing scope, because issues and
events are always scoped to an organization and a project.

1. `find_organizations` returns the organizations the credentials can
   see; take the org slug.
2. `find_projects` (scoped to the org) returns projects; take the
   project slug.
3. Pass the resolved org slug and project slug into `search_issues`,
   `search_events`, `analyze_issue_with_seer`, and `update_issue`.
   Never guess a slug.
4. When you have an unfamiliar tool name or capability, use
   `search_sentry_tools` to find the right tool, and
   `execute_sentry_tool` to run a tool the higher-level wrappers do not
   expose.

## search_issues vs search_events

These answer different questions. Picking the wrong one is the most
common error.

- `search_issues`: returns grouped issues (an issue is a deduplicated
  group of similar events). Use it for triage, counts of distinct
  problems, regression and first-seen filters, and resolution state.
  Filters include `is:unresolved`, `is:resolved`, `is:regression`,
  `firstSeen:-24h`, `assigned:me`, `level:error`, sort by `freq`,
  `new`, `user`, `date`.
- `search_events`: returns individual event rows or aggregations over
  events. Use it for event volume over time, affected-user counts, tag
  and release breakdowns, and pulling representative events for one
  issue. Filters use the same property syntax (`release:`,
  `environment:`, `transaction:`, `user.id:`) plus time windows.

Rule of thumb: how many distinct problems and which are worst ->
search_issues. How many times and to how many users did one thing
happen -> search_events.

## Filter Grammar

- Filters are `key:value` pairs joined by spaces (implicit AND), for
  example `is:unresolved level:error environment:production`.
- Negation uses `!`, for example `!environment:staging`.
- Relative time uses signed durations, for example `firstSeen:-7d`,
  `lastSeen:-1h`.
- Releases filter with `release:<version>` and first-appearance with
  `firstRelease:<version>`.
- Quote values that contain spaces.

## Pagination

- List tools return a page plus a cursor. Pass the returned cursor on
  the next call to continue; stop when no further cursor is returned.
- Do not assume the first page is the whole result set. For triage and
  health work, page until the candidate set for the chosen window is
  complete, or state explicitly that you read only the first page.
- Prefer narrowing the query (tighter time window, level filter) over
  paging through thousands of rows.

## Rate Limits

- Sentry enforces per-token rate limits. Wide scans (long windows,
  all-project sweeps, per-issue event pulls across a long list)
  consume budget fast.
- Warn the user before running a long-window or all-project scan, and
  prefer the smallest window that answers the question.
- On a rate-limit response, back off and report it; do not silently
  retry in a tight loop.

## Resolving Resources

- Use `get_sentry_resource` to resolve a specific resource (issue,
  event, release, project) to its full payload when a list response is
  truncated or a field is ambiguous.
- Resolve rather than infer: if a release version, tag, or owning
  project is unclear from a list row, fetch it.

## Guardrails

- Read-only reference. The only mutating Sentry tool is `update_issue`,
  which is VISIBLE-TO-OTHERS: it changes team-visible state. Skills
  and agents must propose update_issue calls, not auto-fire them.
- Always resolve org and project slugs through the discovery flow
  before querying.
- Report the exact query string and time window used so any result is
  reproducible.