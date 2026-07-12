---
name: paylocity-deduction-and-tax-overview
description: For a single employee, pull deductions, local taxes, and direct deposit setup into one consolidated payroll snapshot. Use when user asks for "show me deductions for [name]", "what's set up for employee X", "payroll setup for one person", or pre-payroll checks for an individual.
when_to_use: "When user asks to show deductions for one employee, what's set up for a person, payroll setup check, or pre-payroll individual review"
allowed-tools: Read, Glob, Grep, Bash, mcp__paylocity__*, mcp__plugin_context-mode_context-mode__*
---

# Deduction & Tax Overview (Paylocity)

Per-employee deep dive. Caller must supply `employeeId` (or a name to look up first).

## Pipeline

1. If only a name was provided, run `paylocity_employees_list` with `include="info"`, search results in `ctx_execute` to find the matching employeeId. If multiple matches, ask the user to pick.
2. Fan out in parallel:
   - `paylocity_employees_get` with `include="info,position,status,payRate"`
   - `paylocity_deductions_list`
   - `paylocity_taxes_local_list`
   - `paylocity_direct_deposit_list`
   - `paylocity_earnings_employee_list`
3. **In `ctx_execute`**: merge into a single normalized snapshot.

## Output

- **Header**: employee name, ID, hire date, position, status, current pay rate.
- **Deductions** - table: code, description, amount, frequency, pre/post tax.
- **Local taxes** - table: jurisdiction, code, filing status.
- **Direct deposit** - table: account type, last 4 of account, amount or %, routing number, deposit order. Mask account numbers to last 4.
- **Earnings (recurring)** - table: earning code, rate/amount.
- **Issues** subsection if any of these are true:
  - No direct deposit on file
  - Local taxes set but no jurisdiction listed
  - Deduction without an amount

## Rules

- ALWAYS mask account numbers - only show the last 4 digits.
- Read-only. Surface findings, never propose writes.
- If employee status is terminated, banner that at the top.

## Reference

Field shapes, masking rules, and issue-detection logic live in
[references/field-reference.md](references/field-reference.md). Read it
before building the snapshot so you know which fields each endpoint returns
and how to normalize them.
