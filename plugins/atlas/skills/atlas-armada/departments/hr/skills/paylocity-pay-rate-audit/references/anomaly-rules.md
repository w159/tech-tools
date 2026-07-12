# Pay Rate Audit - Anomaly Rules Reference

The four anomaly categories the audit flags. This file pins the exact
detection logic so every run classifies anomalies the same way and the
out-of-grade check does not false-positive.

## Category 1: Missing / Zero pay rate

Flag when `payRate.rate` is null, missing, or 0 on the
`paylocity_employees_list` record (include="payRate").

This is payroll-blocking. An active employee with no rate will either
skip payroll or run at zero. These always go at the top of the report.

Do NOT flag when:
- `payRate.rate` is null but `futurePayRate.rate` is set AND the
  hireDate is in the future. That is a future-dated hire, handled in
  Category 3.
- The employee status is terminated. Terminated employees are out of
  scope for the active-roster audit entirely.

## Category 2: Out-of-grade outliers

Applies only when the employee has a `payGrade` AND that pay grade has
both `minRate` and `maxRate` defined in the `paylocity_pay_grades_list`
catalog.

- **Below grade min**: `payRate.rate < grade.minRate`
- **Above grade max**: `payRate.rate > grade.maxRate`

Exclusion rule: if the pay grade has no `minRate`, no `maxRate`, or
both missing, the grade is excluded from this check. Do not
false-positive on grades with undefined bounds - many Paylocity tenants
leave min/max blank and only use the grade as a label.

Per-grade median: compute the median of all observed `payRate.rate`
values for employees in that grade. Surface it in the outlier row so
the HR lead can see whether the outlier is one person or a systemic
mis-grade.

Pay type caveat: a grade with a salary max compared against an hourly
rate (or vice versa) will always false-positive. Before flagging,
confirm `payRate.rateType` matches the grade's rate type. If the grade
catalog does not record a rate type, exclude the comparison.

## Category 3: Future-dated change

Flag when `futurePayRate.rate` is set (non-null, non-zero).

Surface the `futureEffectiveDate` in the row. Sort this section by
effective date ascending so the soonest changes appear first.

This is informational, not blocking. Its value is letting the HR lead
see what is about to land and whether it lines up with the merit cycle.

## Category 4: Stale rate (>24 months)

Flag when the rate has not changed in more than 24 months.

Detection requires an `effectiveDate` on the pay rate record. Compute
`today - effectiveDate`; if the delta exceeds 730 days, flag.

When `effectiveDate` is not available on the record, this check cannot
run. Skip it silently - do not flag every employee as stale just
because the date is missing.

This section is advisory only. It goes at the bottom of the report.
Stale is not wrong - many tenured employees are fairly paid at a rate
set years ago. The point is to surface them for the HR lead's
judgment, not to block payroll.

## Report ordering

1. Missing/Zero (blocking) - full list
2. Out-of-grade outliers - name, rate, grade min/max, grade median
3. Future-dated changes - sorted by effective date
4. Stale rates (>24mo) - advisory, bottom

## Read-only rule

The audit never proposes rate changes inline. Every anomaly is a flag
for the HR lead. Do not include "suggested new rate" columns or
"adjust to $X" language anywhere in the output.

## Edge cases

- **Job code with no pay grade**: the employee has a jobCode but no
  payGrade. They are excluded from the out-of-grade check (no grade to
  compare against) but still subject to the missing-rate and stale
  checks.
- **Pay grade with no employees**: skip it. Do not emit an empty
  "grade has no occupants" warning.
- **Hourly vs salary mix in one grade**: if the grade's rate type is
  ambiguous, run the out-of-grade check separately for hourly and
  salary employees and note the split in the row.
- **Future rate below current**: a futurePayRate lower than the
  current payRate is a pay cut. Surface it in Category 3 with a
  "(decrease)" tag. It is not an error, but the HR lead needs to see
  it.