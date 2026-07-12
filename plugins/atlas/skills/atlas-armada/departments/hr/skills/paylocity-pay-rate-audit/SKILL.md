---
name: paylocity-pay-rate-audit
description: Audit pay rates across the active roster - pulls current and future pay rates, flags missing/zero rates, future-dated rate changes, and outliers vs. pay grade. Use when user asks for "pay rate audit", "comp review", "salary check", "are pay rates correct", or before a merit-cycle / payroll run.
when_to_use: "When user asks for a pay rate audit, comp review, salary check, are pay rates correct, or before a merit cycle or payroll run"
allowed-tools: Read, Glob, Grep, Bash, mcp__paylocity__*, mcp__plugin_context-mode_context-mode__*
---

# Pay Rate Audit (Paylocity)

## Pipeline

1. `paylocity_employees_list` with `include="info,position,status,payRate,futurePayRate"`, `activeOnly=true`. Page through all employees.
2. `paylocity_pay_grades_list` - capture the pay grade catalog.
3. `paylocity_job_codes_list` - capture the job code catalog.
4. **In `ctx_execute`**:
   - Project each employee to `{ employeeId, name, jobCode, payGrade, payRate, payType, futurePayRate, futureEffectiveDate }`.
   - For each pay grade, compute min/max/median observed pay rate.
   - Flag anomalies:
     - **Missing**: payRate is null or 0.
     - **Below grade min** or **above grade max** (when employee has a pay grade and the grade has min/max defined).
     - **Future-dated change**: futurePayRate is set, surface the effective date.
     - **Stale**: rate has not changed in > 24 months (if effectiveDate is available).

## Output

- **Header**: total audited, anomalies count by category.
- **Section: Missing/Zero pay rates** - full list, payroll-blocking.
- **Section: Out-of-grade outliers** - name, current rate, grade min/max.
- **Section: Future-dated changes coming up** - sorted by effective date.
- **Section: Stale rates (>24mo)** - bottom of report, advisory only.

## Rules

- Read-only. Never propose rate changes inline - flag for HR.
- If pay grade has no min/max defined, exclude from out-of-grade check (do not false-positive).

## Reference

Anomaly category definitions, pay-grade min/max math, stale-rate detection,
and the out-of-grade exclusion rules live in
[references/anomaly-rules.md](references/anomaly-rules.md). Read it before
running the audit so anomalies are classified the same way every time.
