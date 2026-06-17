# data-entry-contract.md

Canonical ordered API contract for the scripted-persona role and `run_persona.py`.
Both MUST obey this contract exactly. Any deviation is a harness defect, not a
test finding.

---

## Background: why the contract was corrected

Run-20260615 produced 24/24 null `profile.current_salary` readbacks. Root cause:
the harness was relying on the backend to derive salary from `currentGradeId`
alone. The backend does not do that. `profile.current_salary` is only set when
`currentSalary` is supplied explicitly in the PUT body, matching the real
frontend client's behavior.

---

## Step order

### 1. Enroll (POST /api/enroll)

Body: `{ enrollmentCode, firstName, lastName, dateOfBirth, ... }` (persona seed
values). Standard response: 200 or 201 with `{ profile }`. A 409 means the
account already exists -- tolerated, continue.

### 2. Profile update -- grade + salary (PUT /api/profile)

The real client sends `currentGradeId` and `currentSalary` together via
`api.updateProfile(data: ProfileUpdatePayload)`:

```
PUT /api/profile
Content-Type: application/json

{ "currentGradeId": <int>, "currentSalary": <number> }
```

`ProfileUpdatePayload` (frontend/src/utils/api.ts line 817) confirms both fields.
`updateProfile` calls `this.request("/profile", { method: "PUT", body: ... })`.

Pass condition: immediately GET /api/profile and assert `profile.current_salary`
is non-null and equals the submitted value (within 0.01). A mismatch or null is
reported as a BLOCKER finding `salary-not-stored` and the persona is marked
data-entry-failed. Do NOT continue silently with a null salary.

### 3. Filing and tax (PUT /api/profile -- second call)

Body: `{ filingStatus, memberTaxRate, spouseTaxRate }` (values from persona seed).
Tax rates are also written here. A 4xx/5xx on this call is reported as a finding
(not skipped). Continue to the next step regardless.

### 4. Tax applied assertion

After the budget/financial-planner call that uses tax rates, assert that
`surplus` (net of taxes) is strictly less than the gross income figure for that
persona. If surplus >= gross, record finding BUG-001 (tax-stored-not-applied,
Blocker) with the persona's submitted rates, the gross value, and the returned
surplus.

### 5. Households (POST /api/households)

Attempt the call with spouse/dependent data from the seed. If the server returns
500, do NOT skip silently. Record finding `households-500` (Nielsen 4 Blocker,
known bug) with the full request body and response, then continue the run. The
persona is marked as households-failed but continues to pension and budget steps.

### 6. Net worth (POST /api/wellness/net-worth)

Standard 200/201 expected. A non-2xx is recorded as a finding.

### 7. Pension plan resolve (POST /api/pension-calculator/resolve-plan)

Use `deptCode` and `hireDate` from the seed. Expected: 200 with a plan ID. If
422 (no plan for that department / hire date combination), record finding
`pension-no-plan-422` with the request body and continue -- this is expected for
some department codes and is NOT a run failure. Do NOT hide 422s.

### 8. Pension estimate (POST /api/pension-calculator/estimate)

Requires the resolved `planId` from step 7. If step 7 produced no plan, skip
this step and record that it was skipped due to no resolved plan. If the server
returns 422 on the survivor option, record the finding with the survivor election
percentage that caused it, then retry with `survivorElectionPct: 0` (single
life) so the run continues.

### 9. Budget / financial planner

POST to the financial-planner endpoint with income, expenses, and tax rates from
the seed. Captures `surplus_deficit` as a key figure. Tax applied assertion
(step 4) fires here.

---

## Pass / fail definition (gate G1)

A persona is "setup complete" (G1 pass) if and only if ALL of the following are
true after all steps complete:

1. `profile.current_salary` is non-null and matches the submitted value.
2. `profile.filing_status` is non-null.
3. At least one of: net worth record created, pension estimate captured, or
   budget surplus captured.

HTTP 200 on a write call alone is NOT sufficient. The client-surface readback
(step 2 pass condition) is the only authoritative measure.

---

## Known app bugs -- surface as evidence, do not fix

| Bug ID | Symptom | Finding label |
|---|---|---|
| salary-not-derived | Backend does not derive `current_salary` from grade alone | salary-not-stored (if currentSalary omitted) |
| tax-stored-not-applied | Tax rates accepted at 200 but surplus unchanged vs gross | BUG-001 |
| households-500 | POST /api/households returns 500 | households-500 |
| XSS-echo-unescaped | Script payloads echoed unescaped in API responses | XSS-echo |
| wellness/meeting-500 | GET /api/wellness/meeting returns 500 | wellness-meeting-500 |

---

## Reference

- Frontend client: `frontend/src/utils/api.ts`, `updateProfile` method (line 144),
  `ProfileUpdatePayload` interface (line 817).
- Harness implementation: `docs/claude_testers/harness/run_persona.py`, step 5b
  (put_profile_salary).
- BUILD-SPEC section 5 (the corrected data-entry contract).
