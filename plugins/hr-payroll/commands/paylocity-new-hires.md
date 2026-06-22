---
description: Recent new-hire onboarding readiness check from Paylocity. Pulls hires from the last 30 days (override with `days=N`) and flags missing position, pay rate, direct deposit, or local taxes.
---

# New Hire Onboarding Check

Run the `paylocity-new-hire-flow` skill to identify recent new hires and confirm their onboarding fields are populated. Default window is 30 days; honor `days=N` from the user. Output should clearly separate "blocked" hires (anything missing) from "clean" hires, with a per-employee 4-item checklist. Never mutate Paylocity data - this is a triage list for the HR/payroll lead.
