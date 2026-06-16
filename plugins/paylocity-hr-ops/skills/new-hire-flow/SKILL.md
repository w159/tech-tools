---
name: new-hire-flow
description: Identify recent new hires in Paylocity (default: last 30 days) and verify their onboarding fields are populated — pay rate, position, direct deposit, local taxes. Use when user asks for "new hires", "recent hires", "onboarding gaps", "are the new people set up correctly", or pre-payroll readiness checks.
---

# New Hire Flow (Paylocity)

## Pipeline

1. `paylocity_employees_list` with `include="info,position,status,payRate"`, `activeOnly=true`. Page through all employees (or first 500).
2. **In `ctx_execute`**: filter to employees whose `hireDate` (or `info.hireDate`) is within the last N days (default 30).
3. For each new hire, fan out in parallel:
   - `paylocity_direct_deposit_list` with the employeeId
   - `paylocity_taxes_local_list` with the employeeId
   - `paylocity_deductions_list` with the employeeId
4. **In `ctx_execute`**: for each new hire, compute a checklist:
   - position set? (jobCode + jobTitle non-empty)
   - pay rate set? (payRate.rate > 0)
   - direct deposit set? (at least one DD account)
   - local taxes registered? (taxes list non-empty if jurisdiction requires it)

## Output

- **Header**: new hires count for window, plus the cutoff date used.
- **Per-employee block**: name, employeeId, hire date, the 4-item checklist with ✓ / ✗.
- **Top of report**: list of "blocked" hires (any ✗) above "clean" hires.

## Rules

- Window defaults to 30 days. Accept `days=N` from user.
- Do NOT mutate anything. Output is a triage list for the HR/payroll lead.
- If pay rate is in `futurePayRate` only, flag as "future-dated only" — not a blocker if hire date is in the future.
