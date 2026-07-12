---
description: One-shot Sentry triage brief - rank unresolved issues by impact and propose actions (read-only, proposes status changes only)
argument-hint: "[org/project or time window, optional]"
---

# /sentry-triage

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Produce a prioritized triage brief of unresolved Sentry issues. Read-only: this command ranks and recommends, it never changes issue state.

## Usage

```
/sentry-triage
/sentry-triage acme/web
/sentry-triage last 7d
```

Scope hint (optional): $1

If no scope is given, resolve the default org and project through discovery and confirm before running a wide scan.

## Pipeline

1. `find_organizations` -> org slug. `find_projects` -> project slug. Confirm against any scope hint the user passed.
2. `search_issues` with `is:unresolved` for the candidate set; add `is:regression` and `firstSeen:-24h` passes when the queue is large.
3. `search_events` scoped to the top candidates to confirm event volume (default window 24h) and affected-user counts.
4. `get_sentry_resource` to resolve any ambiguous release, tag, or owning project.
5. Rank by severity, event volume, users affected, regression flag, first-seen recency.

## Output

```markdown
## Sentry Triage: [org/project] (window: [window])

### Ranked Queue
| # | Issue | Title | Level | Events | Users | First Seen | Regression |
|---|-------|-------|-------|--------|-------|------------|------------|
| 1 | [short id] | [title] | error | [n] | [n] | [date] | yes/no |

### Why These Ranks
- #1 [short id]: [one-line justification]

### Proposed Actions (PROPOSAL ONLY - not applied)
- [ ] [short id]: [investigate / assign / watch / likely noise]
```

## Rules

- Read-only. Never call `update_issue`. update_issue is VISIBLE-TO-OTHERS: it mutates team-visible Sentry state, so this command only proposes status changes for a human to apply.
- Always report the org slug, project slug, and time window so the ranking is reproducible.
- Do not fabricate event or user counts; if `search_events` returns nothing for an issue, report "no events in window".
- See the **sentry-issue-triage** skill for the full scoring method and the **sentry-api-patterns** skill for query syntax.
