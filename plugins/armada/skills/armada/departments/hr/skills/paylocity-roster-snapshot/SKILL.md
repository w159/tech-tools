---
name: paylocity-roster-snapshot
description: Pull a snapshot of the active employee roster from Paylocity, expanded with position, pay rate, and status. Use when user asks for "headcount", "current roster", "who works here", "active employees", or wants a list of employees with their titles and pay.
when_to_use: "When user asks for headcount, current roster, who works here, active employees, or a list with titles and pay"
allowed-tools: Read, Glob, Grep, Bash, mcp__paylocity__*, mcp__plugin_context-mode_context-mode__*
---

# Roster Snapshot (Paylocity)

## Pipeline

1. `paylocity_status` - confirm credentials + default companyId are in place.
2. `paylocity_employees_list` with `activeOnly=true`, `include="info,position,status,payRate"`, `limit=20`. Walk pages via `nextToken` until exhausted.
3. **In `ctx_execute`**:
   - Project each employee to `{ employeeId, firstName, lastName, jobTitle, department, payRate, location, status }`.
   - Sort by department, then last name.
   - Compute headcount totals: total active, count per department, count per location.

## Output

- **Header**: total active headcount, top 5 departments by size, snapshot timestamp.
- **Table**: one row per employee with the projected fields above.
- **Caveats**: note any employees with missing pay rate or position so HR can clean up.

## Rules

- Always include `activeOnly=true` unless the user explicitly asks for terminated employees.
- Never write any data back. This is a read-only briefing.
- If the company has >2000 employees, sample the first 500 and clearly say "first 500 only" in the header.
