---
name: sentry-api-patterns
description: Explain the Sentry MCP discovery flow, search_issues vs search_events query syntax and filters, pagination, rate limits, and resource resolution. Read-only reference. Use when user asks "how do I query Sentry", "what is the difference between search_issues and search_events", or "how does Sentry pagination work".
when_to_use: "When choosing a Sentry MCP tool, writing a search_issues or search_events query, handling pagination and rate limits, or resolving a Sentry resource to its full payload"
allowed-tools: Read, Glob, Grep, Bash, mcp__io_github_getsentry_sentry-mcp__*
---

# Sentry API Patterns

Reference skill for working against the Sentry MCP. Use it to choose
the right tool, write a correct query, and avoid common scope and
pagination mistakes. The other Sentry skills lean on these patterns.
Read-only.

## First Move

Establish scope before any query. Issues and events are always scoped
to an organization and a project, so resolve both slugs first:

1. `find_organizations` -> take the org slug.
2. `find_projects` (scoped to the org) -> take the project slug.
3. Pass the resolved slugs into `search_issues`, `search_events`,
   `analyze_issue_with_seer`, and `update_issue`. Never guess a slug.

If you are unfamiliar with a tool name, use `search_sentry_tools` to
find it and `execute_sentry_tool` to run a wrapper that the
higher-level tools do not expose.

## search_issues vs search_events

The most common error is picking the wrong one.

- `search_issues`: grouped, deduplicated issues. Use for triage,
  counts of distinct problems, regression and first-seen filters,
  resolution state.
- `search_events`: individual event rows or aggregations. Use for
  event volume over time, affected-user counts, tag and release
  breakdowns, representative events for one issue.

Rule of thumb: how many distinct problems and which are worst ->
search_issues. How many times and to how many users did one thing
happen -> search_events.

## Detailed Reference

The full filter grammar, pagination behavior, rate-limit handling,
and resource-resolution rules live in
`references/query-syntax.md`. Read it when you need the exact filter
syntax, the cursor-paging contract, or the `get_sentry_resource`
resolution procedure.

## Guardrails

- Read-only. The only mutating Sentry tool is `update_issue`, which is
  VISIBLE-TO-OTHERS: it changes team-visible state. Propose
  update_issue calls; do not auto-fire them.
- Always resolve org and project slugs through the discovery flow
  before querying.
- Report the exact query string and time window used so any result is
  reproducible.