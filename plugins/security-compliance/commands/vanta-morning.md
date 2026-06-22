---
description: Daily Vanta GRC standup - failing tests, expiring evidence, overdue vulns, vendors in pending review.
---

# Vanta Morning Brief

Run the following Vanta skills in parallel and merge into a single morning brief:

1. `evidence-gap-hunter` (scope: all active frameworks; focus on EXPIRING + MISSING)
2. `vanta-vulnerability-triage` (focus: OVERDUE + DUE_THIS_WEEK)
3. `vanta-vendor-risk-rollup` (focus: pending >30d + high-risk approved)

Top of output: a 3-line "what changed since yesterday" if cached state exists, otherwise headline numbers only. Do NOT make remediation changes; this is a brief, not an action.
