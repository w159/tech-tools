---
description: Deep-dive one Sentry issue - latest events, stack trace, breadcrumbs, tags, affected releases and users (read-only)
argument-hint: "<Sentry issue id or URL>"
---

# /sentry-investigate

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Deep-dive a single Sentry issue to isolate the failing frame and establish blast radius. Read-only.

## Usage

```
/sentry-investigate ABC-123
/sentry-investigate https://sentry.io/organizations/acme/issues/456789/
```

Issue to investigate: $1

If no issue id or URL is provided, ask which issue to investigate, or narrow with `search_issues` and confirm the single target before deep-diving.

## Pipeline

1. `find_organizations` -> org slug. `find_projects` -> project slug, unless the issue URL already carries them.
2. Confirm the target issue from $1 (short id or URL). If ambiguous, narrow with `search_issues` and confirm with the user.
3. `search_events` scoped to the issue, most-recent-first, to get representative event ids and the volume trend.
4. `get_sentry_resource` on the most recent representative event for the full payload: exception, stack trace frames, breadcrumbs, tags, request context, release.
5. Isolate the topmost in-app frame (file, function, line) and read the breadcrumb sequence that led into the failure.
6. Determine blast radius: affected releases (regression vs always-present), affected user count, environment and tag distribution.

## Output

```markdown
## Investigation: [short id] - [title]

### Failing Frame
[file]:[line] in [function] - [exception type]: [message]

### Breadcrumb Trail
[ordered events leading into the failure]

### Tags / Environment
[runtime, browser/OS, environment, notable tags]

### Affected Releases / Users
[introducing release if regression] - [n users affected]

### Root-Cause Hypothesis
[hypothesis], confirm by [next step]
```

## Rules

- Read-only. Never call `update_issue`. update_issue is VISIBLE-TO-OTHERS: it mutates team-visible Sentry state and is out of scope for this command.
- Investigate one issue at a time; confirm the target before pulling event payloads.
- Quote the actual frame, file, and line from the event payload - never reconstruct a stack trace from memory.
- Report the org slug, project slug, issue id, and the specific event id analyzed.
- To get an AI root-cause and suggested fix for this issue, use the **sentry-seer-root-cause** skill. See the **sentry-error-investigation** skill for full method.
