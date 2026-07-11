---
name: sentry-release-health
description: Report Sentry release health (adoption, crash-free sessions and users, new vs resolved issues, regressions) for a release and flag bad releases. Read-only. Use when user asks "how healthy is this release", "is the latest deploy crashing", or "check release health".
---

# Sentry Release Health

Assess whether a release is healthy or should be rolled back. Pulls adoption, crash-free sessions and users, the new-vs-resolved issue balance, and regressions tied to the release, then renders a clear healthy/degraded/bad verdict. Read-only.

## Pipeline

1. Resolve scope: `find_organizations` then `find_projects` to fix the org and project slug.
2. Identify the release. If the user named a version, use it; otherwise pull recent releases with `get_sentry_resource` (releases resource) and confirm the target release with the user.
3. Pull release-level health metrics with `search_events` and `get_sentry_resource` scoped to the release: session count, crash-free session rate, crash-free user rate, and adoption (share of sessions on this release vs the prior baseline).
4. Pull the issue balance with `search_issues` filtered to the release: new issues introduced by the release (`firstRelease:<version>`), regressions (`is:regression`), and issues resolved in the release.
5. Compare against the prior release baseline so adoption and crash-free rates are read as a delta, not an absolute, and flag any metric that moved the wrong way.

## Output

A release health brief containing:

- Release identity: version, project, deploy/first-seen time, baseline release compared against.
- Adoption: percentage of sessions on this release and the trend.
- Stability: crash-free session rate and crash-free user rate, with the delta vs baseline.
- Issue balance: new issues introduced, regressions, and issues resolved.
- Verdict: healthy / degraded / bad-release, with the specific metric(s) that drove the call.
- A recommended action (continue rollout, hold, investigate top regression, consider rollback) framed as a PROPOSAL.

## Rules and Guardrails

- Read-only. Never call `update_issue`. update_issue is VISIBLE-TO-OTHERS and mutates team-visible state; rollback or resolve decisions are proposed here, applied by a human.
- A crash-free rate is meaningless without a baseline. Always report the delta against the prior release.
- Do not fabricate adoption or crash-free numbers. If session data is missing (release health not enabled, no sessions yet), say so and report only the issue-level signals.
- Always state the org slug, project slug, release version, and the time window used.
- If access or the release is missing, report the missing-state and the step to resolve it rather than failing silently.
