---
name: paylocity-new-hire-flow
description: "Identify recent new hires in Paylocity (default: last 30 days) and verify their onboarding fields are populated - pay rate, position, direct deposit, local taxes. Use when user asks for \"new hires\", \"recent hires\", \"onboarding gaps\", \"are the new people set up correctly\", or pre-payroll readiness checks."
when_to_use: "When user asks about new hires, recent hires, onboarding gaps, are new people set up correctly, or pre-payroll readiness checks"
allowed-tools: Read, Glob, Grep, Bash, mcp__paylocity__*, mcp__plugin_context-mode_context-mode__*
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
- **Per-employee block**: name, employeeId, hire date, the 4-item checklist with [x] / [no].
- **Top of report**: list of "blocked" hires (any [no]) above "clean" hires.

## Rules

- Window defaults to 30 days. Accept `days=N` from user.
- Do NOT mutate anything. Output is a triage list for the HR/payroll lead.
- If pay rate is in `futurePayRate` only, flag as "future-dated only" - not a blocker if hire date is in the future.

## Reference

The checklist field locations, pass/fail logic, and edge cases (future-dated
rates, terminated-but-active, missing hireDate) are documented in
[references/onboarding-checklist.md](references/onboarding-checklist.md).
Read it before running the audit so the checklist is computed consistently.
