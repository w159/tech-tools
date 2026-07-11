---
name: sentry-issue-triage
description: Rank open and unresolved Sentry issues by severity, event volume, users affected, and regression or first-seen status, then produce a prioritized action list. Read-only. Use when user asks "triage Sentry", "what should I fix first", or "rank our open errors".
---

# Sentry Issue Triage

Convert a noisy stream of unresolved Sentry issues into a ranked, actionable list. This skill is read-only: it never changes issue state. It scores each issue on impact signals and tells the user which issues deserve attention first and why.

## Pipeline

1. Resolve scope with `find_organizations` to get the organization slug, then `find_projects` to get the project slug(s). If the user named an org or project, confirm it against these results instead of guessing.
2. Pull the candidate set with `search_issues` using a query that restricts to unresolved work, for example `is:unresolved`. Add `is:regression` or `firstSeen:-24h` as additional passes when the user asks about regressions or new errors.
3. For the top candidates by event volume, call `search_events` scoped to each issue to read recent event counts and the affected-user count over the chosen time window (default last 24h, widen to 14d on request).
4. When an issue field is unclear (release, tag, owning project), resolve it with `get_sentry_resource` rather than inferring.
5. Score and rank in this order: severity/level, event volume in window, users affected, regression flag, first-seen recency. A regression on a high-volume issue outranks a steady high-volume issue.

## Output

A prioritized triage brief containing:

- A ranked table: rank, issue short id, title, level, events (window), users affected, first seen, regression flag.
- A one-line "why this rank" justification per top issue.
- A recommended action per issue (investigate, assign, watch, likely noise) as a PROPOSAL only.
- The exact org slug, project slug, and time window used, so the ranking is reproducible.

## Rules and Guardrails

- Read-only. Never call `update_issue`. update_issue is VISIBLE-TO-OTHERS: it mutates Sentry state the whole team sees, so this skill only proposes status changes for a human to apply.
- Always state the org slug, project slug, and time window; an unscoped ranking is not reproducible.
- Do not invent event counts or user counts. If `search_events` returns nothing for an issue, report it as "no events in window" rather than guessing.
- Reference every finding by its Sentry issue short id so the user can reproduce your reasoning.
- If credentials or org access are missing, report the missing-access state and the step to fix it; do not fail silently.
