---
name: sentry-error-investigation
description: Deep-dive one Sentry issue across latest events, stack trace, breadcrumbs, tags, affected releases and users to isolate the failing frame. Read-only. Use when user asks "investigate this Sentry issue", "what is causing this error", or "show me the stack trace for issue X".
---

# Sentry Error Investigation

Take a single Sentry issue and reconstruct what is actually failing: the latest events, the stack trace down to the failing frame, the breadcrumb trail that led there, the tags and environment, and which releases and users are affected. Read-only.

## Pipeline

1. Resolve scope: `find_organizations` then `find_projects` to fix the org and project slug if not already known from the issue reference.
2. Identify the target issue. If the user passed a short id or URL, use it directly; otherwise narrow with `search_issues` and confirm the single issue with the user before deep-diving.
3. Pull the latest events for the issue with `search_events` scoped to that issue id, ordered most-recent-first, to get representative event ids and the event count trend.
4. For the most recent representative event, call `get_sentry_resource` to fetch the full event payload: exception type and value, the stack trace frames, breadcrumbs, request context, tags, and the release that produced it.
5. Isolate the failing frame: identify the topmost in-app (non-library) frame, its file, function, and line, and the local values if present. Cross-read breadcrumbs immediately preceding the exception to establish the trigger sequence.
6. Determine blast radius: which releases the error appears in (regression vs always-present), affected user count, and environment/tag distribution, using `search_events` aggregations where available.

## Output

A single-issue investigation brief containing:

- Issue identity: short id, title, level, first seen, last seen, event count in window.
- The failing frame: file, function, line, and the exception type and message.
- Breadcrumb trail: the ordered events leading into the failure.
- Tags and environment summary: runtime, browser/OS, environment, custom tags of note.
- Affected releases and users: which release introduced it (if a regression) and how many users hit it.
- A hypothesis of root cause stated as a hypothesis, plus the next step to confirm it.

## Rules and Guardrails

- Read-only. Never call `update_issue`. update_issue is VISIBLE-TO-OTHERS and mutates team-visible state; this skill investigates only.
- Investigate one issue at a time. If the issue is ambiguous, stop and confirm the target before fetching event payloads.
- Quote the actual frame, file, and line from the event payload. Do not reconstruct a stack trace from memory or infer line numbers.
- Distinguish in-app frames from library frames; the failing frame is the topmost in-app frame unless the evidence says otherwise.
- Always report the org slug, project slug, issue id, and the specific event id you analyzed.
- If event payloads are unavailable (sampling, retention, missing access), say so and report what is verifiable rather than filling gaps.
