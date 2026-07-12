---
description: One-shot active employee roster snapshot from Paylocity - headcount totals + per-employee row with title, department, pay rate, and status.
---

# Paylocity Roster Snapshot

Run the `paylocity-roster-snapshot` skill to produce a current active roster snapshot from Paylocity. Default to the company configured by `PAYLOCITY_COMPANY_ID`; if the user passes a companyId argument, forward it. Output should be a single brief that an HR lead can paste into a status update - do not propose any writes.
