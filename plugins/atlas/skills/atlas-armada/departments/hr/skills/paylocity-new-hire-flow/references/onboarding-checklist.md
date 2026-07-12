# New Hire Flow - Onboarding Checklist Reference

The four-item onboarding checklist the audit computes per new hire.
This file pins the field locations, pass/fail logic, and edge cases so
every run classifies hires the same way.

## Checklist items

### 1. Position set

Pass when both `position.jobCode` and `position.jobTitle` are non-empty
on the `paylocity_employees_list` record (include="position").

Fail when either is empty or null.

A jobCode without a jobTitle (or vice versa) is a fail - both halves of
the position record must be populated for payroll and reporting to work.

### 2. Pay rate set

Pass when `payRate.rate` exists and is greater than 0.

Fail when `payRate.rate` is null, missing, or 0.

Special case - future-dated rate: if `payRate.rate` is null but
`futurePayRate.rate` is set, this is NOT a blocker when the hire date is
in the future. Flag it as "future-dated only" in the per-employee block
but do not move the hire to the blocked list. When the hire date is in
the past, a future-only rate IS a blocker - the employee has worked at
least one period at no recorded rate.

### 3. Direct deposit set

Pass when `paylocity_direct_deposit_list` returns at least one account
for the employeeId.

Fail when the list is empty.

Paper-check is a valid fallback but every new hire without DD is a
friction point the HR/payroll lead should see at the top of the report.

### 4. Local taxes registered

Pass when `paylocity_taxes_local_list` returns at least one row AND the
employee's work location is in a jurisdiction that levies a local tax.

Fail when the taxes list is empty and the employee works in a
jurisdiction that requires local tax registration.

Caveat: the audit cannot, on its own, know every local-tax jurisdiction.
Treat an empty taxes list as a warning, not a hard fail, unless the
user names a jurisdiction. Surface it in the per-employee block as
"[warn] no local taxes" rather than "[no]" when the jurisdiction is
unknown.

## Window

Default window: 30 days. The cutoff date is `today - N days`. An
employee is a "new hire" for this run when `hireDate >= cutoff`.

`hireDate` locations, in priority order:
1. root `hireDate`
2. `info.hireDate`

If neither is present, the employee cannot be classified as a new hire
and is excluded from the window - do not put them in the blocked list,
they simply are not in scope.

## Blocked vs clean

A hire is **blocked** when any of items 1, 2 (non-future-dated), or 3
fail. Item 4 can produce a warn but not a block on its own.

Render order:
1. Blocked hires first, sorted by hire date ascending (oldest first).
2. Clean hires second, same sort.

## Edge cases

- **Terminated within window**: an employee hired in the last 30 days
  who is now terminated still appears in the report. Mark the block
  with a "(terminated)" tag. A terminated hire with onboarding gaps is
  informational only - not a blocker, since no payroll will run.
- **Rehire**: an employee rehired in the window uses the new hireDate.
  Prior onboarding gaps from the old tenure are out of scope.
- `days=N` from the user overrides the 30-day default. `days=0` is
  invalid - fall back to 30 and tell the user.
- **Large roster**: paging through all active employees is required.
  Do not sample - new hires are a small subset and sampling can miss
  the very people the audit exists to catch.