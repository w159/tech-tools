# Deduction & Tax Overview - Field Reference

Field shapes returned by each Paylocity endpoint in the snapshot pipeline,
plus the normalization and masking rules the SKILL.md assumes. Read this
before building the snapshot so the merge is consistent.

## paylocity_employees_get (include="info,position,status,payRate")

Header fields used in the snapshot:

| Field | Location | Notes |
|-------|----------|-------|
| employeeId | root | primary key |
| firstName, lastName | root or info | join for display name |
| hireDate | root or info.hireDate | ISO date |
| jobTitle | position.jobTitle | may be empty on unonboarded hires |
| jobCode | position.jobCode | links to job code catalog |
| status | status.employmentStatus | active, terminated, onLeave |
| payRate.rate | payRate.rate | current rate |
| payRate.rateType | payRate.rateType | "H" hourly, "S" salary |
| payType | payRate.payType | per-pay-period amount |

If `status.employmentStatus` is `terminated`, the snapshot must show a
terminated banner at the top of the block.

## paylocity_deductions_list

One row per deduction code on the employee.

| Field | Notes |
|-------|-------|
| code | deduction code (e.g., "401K", "MED") |
| description | human label |
| amount | dollar amount per period |
| calculationType | "F" fixed, "P" percent |
| frequency | per pay period |
| preTax | boolean - pre-tax vs post-tax |

Issue: a deduction row with a null or zero `amount` is flagged in the
Issues subsection.

## paylocity_taxes_local_list

| Field | Notes |
|-------|-------|
| jurisdiction | city, county, or school district name |
| code | local tax code |
| filingStatus | filing status applied |

Issue: a row with a code set but `jurisdiction` empty is flagged - the
employee is enrolled in a local tax but the jurisdiction is not recorded,
which breaks remittance.

## paylocity_direct_deposit_list

| Field | Notes |
|-------|-------|
| accountType | "C" checking, "S" savings |
| accountNumberLast4 | derived - NEVER print the full account number |
| amount | dollar amount, or null if percent |
| percent | percent of net, or null if fixed amount |
| routingNumber | ABA routing |
| depositOrder | priority order (1 = first funded) |

Masking rule: `accountNumber` from the API may arrive full or truncated.
The snapshot output must only ever show the last 4 digits. If the API
returns a full account number, truncate to last 4 before rendering. Never
log or print the full account number anywhere - including intermediate
ctx_execute output.

Issue: an empty direct deposit list is flagged - the employee has no
DD on file and will receive a paper check unless resolved before payroll.

## paylocity_earnings_employee_list

Recurring earnings codes beyond base pay (shift differential, bonus,
commission).

| Field | Notes |
|-------|-------|
| earningCode | code (e.g., "BONUS", "SHIFT") |
| rate | per-hour or per-period amount |
| amount | flat amount if fixed |

Only recurring earnings belong in the snapshot. One-off earnings entries
historical dates are out of scope.

## Normalization (ctx_execute)

The merge in step 3 produces one object per employee:

```
{
  header:    { employeeId, name, hireDate, jobTitle, status, payRate, payType },
  deductions: [ { code, description, amount, frequency, preTax } ],
  localTaxes: [ { jurisdiction, code, filingStatus } ],
  directDeposit: [ { accountType, accountLast4, amount, percent, routingNumber, order } ],
  earnings:  [ { earningCode, rate, amount } ],
  issues:    [ "no direct deposit", "local tax missing jurisdiction", ... ]
}
```

Build the `issues` array by applying the per-section rules above. The
SKILL.md Output section renders this object - it does not re-derive
the issues.

## Edge cases

- **Terminated employee**: still return the snapshot, but banner it.
  A terminated employee with no DD is not a blocker.
- **Multiple DD accounts**: list all, sorted by `depositOrder`.
- **Percent-based deduction with no percent field**: treat as a data
  error and flag in Issues.
- **Name lookup collision**: if `paylocity_employees_list` returns
  multiple matches for the supplied name, do not pick one - ask the
  user to disambiguate with the employeeId.