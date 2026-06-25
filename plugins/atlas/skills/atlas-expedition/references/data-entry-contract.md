# data-entry-contract.md

Canonical ordered API contract for the scripted-persona role and `run_persona.py`.
Both MUST obey this contract exactly. Any deviation is a harness defect, not a
test finding.

IMPORTANT: The exact endpoints, HTTP methods, and payload field names below come from
`RUN_DIR/coverage/contract-snapshot.json` (written by phase 0 discovery). Read that
file first and substitute its discovered values wherever this document shows generic
placeholders like `<primary_write_endpoint>` or `<primary_field>`.

---

## Background: why the contract matters

A prior run produced null primary-field readbacks for all personas. Root cause:
the harness was relying on the backend to derive a value from another field alone.
The backend does not do that. The primary field is only set when it is supplied
explicitly in the request body, matching the real frontend client's behavior. Phase 0
discovery captures the real call so this cannot happen again.

---

## Step order

### 1. Enroll / create account

Use the enrollment or signup endpoint from contract-snapshot.json (or the app's auth
flow if no separate enrollment step exists). Supply identity fields from the persona
seed. Standard response: 200 or 201. A 409 (account already exists) is tolerated;
continue. A 4xx/5xx on this call is a BLOCKER for that persona; record it and stop
that persona's run.

### 2. Primary record write

Use `contract-snapshot.json`.`primary_write` (endpoint, method, payload_fields). Send
every field in payload_fields with the persona's seed values. Do NOT omit any field
and do NOT assume the backend derives one field from another.

Pass condition: immediately call the read-back endpoint
(`contract-snapshot.json`.`primary_read`) and assert that every primary_write field
is non-null and matches the submitted value (within a 1-cent tolerance for money
fields). A mismatch or null is reported as a BLOCKER finding `primary-field-not-stored`
and the persona is marked data-entry-failed. Do NOT continue silently with a null value.

### 3. Secondary writes

Execute each entry in `contract-snapshot.json`.`secondary_writes` in order (filing/tax,
household, net worth, and any other onboarding steps the app defines). A 4xx/5xx on
any secondary write is recorded as a finding (not skipped). Continue to remaining steps
regardless, unless the secondary write is an explicit prerequisite for a later step
(note that dependency if so).

### 4. Computed-value assertion

If the app applies rates or multipliers (e.g. tax rates reduce a surplus, a benefit
multiplier scales a payout), assert that the computed output reflects the input. Compute
the expected direction from the persona's submitted inputs and verify the app's result
moves the correct way. If the computed value does not reflect the input, record a BLOCKER
finding `rate-not-applied` with the submitted rates, the expected direction, and the
returned value.

### 5. Remaining onboarding steps

Execute any remaining steps defined by the app's onboarding flow (resolve plan, calculate
estimate, budget snapshot, goals, preferences, etc.) in the order discovery identified.
For each: record the full request/response. A non-2xx is recorded as a finding (not a
run failure unless it blocks a required downstream step).

---

## Pass / fail definition (gate G1)

A persona is "setup complete" (G1 pass) if and only if ALL of the following are
true after all steps complete:

1. Every field in `primary_write.payload_fields` reads back non-null and matching from
   the `primary_read` endpoint.
2. Every required secondary write completed without a blocking error.
3. At least one computed or derived value was captured and passed the computed-value
   assertion.

HTTP 200 on a write call alone is NOT sufficient. The client-surface readback
(step 2 pass condition) is the only authoritative measure.

---

## Known bug classes -- surface as evidence, do not fix

| Bug class | Symptom | Finding label |
|---|---|---|
| field-not-derived | Backend does not derive a field from a related field | primary-field-not-stored |
| rate-not-applied | Rates accepted at 200 but computed output unchanged | rate-not-applied |
| secondary-500 | A secondary-write POST returns 500 | secondary-500 |
| XSS-echo-unescaped | Script payloads echoed unescaped in API responses | XSS-echo |

Add app-specific known bugs discovered during the run to the run's `notes/` dir, not
to this file.

---

## Reference

- Discovered contract: `RUN_DIR/coverage/contract-snapshot.json` (source of truth for
  this run's endpoints, methods, and payload field names).
- Harness implementation: `docs/claude_testers/harness/run_persona.py`.
- Phase 0 probe: `references/discovery.md`.
