# Paylocity HR Operations Plugin

Claude plugin for Paylocity HR and payroll operations, backed by the `paylocity-mcp` server.

## Overview

This plugin gives Claude working knowledge of a Paylocity tenant so it can answer roster,
onboarding, and pay questions directly from the API:

- Roster snapshot - active headcount with title, department, pay rate, and status
- New-hire flow - recent hires and which onboarding fields are still missing
- Pay-rate audit - current and future pay rates, missing/zero rates, and grade-band outliers
- Deduction and tax overview - per-employee deductions, local taxes, and direct deposit setup

## Commands

- `/paylocity-roster` - one-shot active employee roster snapshot with headcount totals.
- `/paylocity-new-hires` - new hires in the last 30 days (override with `days=N`), flagging
  missing position, pay rate, direct deposit, or local taxes.

## Skills

- `roster-snapshot` - active roster expanded with position, pay rate, and status.
- `new-hire-flow` - onboarding-readiness check for recent hires.
- `pay-rate-audit` - comp review across the roster against pay-grade bands.
- `deduction-and-tax-overview` - consolidated payroll setup for a single employee.

## Tools used

All skills call the read-only `paylocity-mcp` server. Available tools include
`paylocity_status`, `paylocity_employees_list` / `paylocity_employees_get`,
`paylocity_earnings_company_list` / `paylocity_earnings_employee_list`,
`paylocity_deductions_list`, `paylocity_taxes_local_list`, `paylocity_direct_deposit_list`,
`paylocity_cost_centers_list`, `paylocity_pay_grades_list`, `paylocity_job_codes_list`,
`paylocity_pay_statements_summary`, and `paylocity_lookup_codes_list`. Run `paylocity_status`
first to confirm credentials before other calls.

## Configuration

The `paylocity-mcp` server must be installed and connected for these skills to work. It
authenticates with Paylocity's OAuth client credentials and a company ID.

Add credentials to `~/.claude/settings.json` (user scope, encrypted on macOS):

```json
{
  "env": {
    "PAYLOCITY_CLIENT_ID": "your-client-id",
    "PAYLOCITY_CLIENT_SECRET": "your-client-secret",
    "PAYLOCITY_COMPANY_ID": "your-company-id"
  }
}
```

`PAYLOCITY_BASE_URL` is optional - leave it blank to use the Paylocity default
(`https://api.paylocity.com/api/v2`); only set it for a non-default shard. Set
`PAYLOCITY_SANDBOX=true` to target the sandbox host (`https://apisandbox.paylocity.com`);
it is ignored when `PAYLOCITY_BASE_URL` is set.

## Notes

- The server is read-only. It reports the missing-credentials state through `paylocity_status`
  rather than failing at startup, so you can always check configuration first.
- If `paylocity_status` shows the server is not connected, the skills cannot run - install and
  connect `paylocity-mcp` in your Claude environment first.
