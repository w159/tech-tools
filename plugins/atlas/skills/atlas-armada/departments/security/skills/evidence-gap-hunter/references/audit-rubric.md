# Evidence Gap Audit Rubric

Evaluation criteria for Vanta evidence document health. Use this rubric to
classify evidence gaps by severity and prioritize remediation before an audit.

## Evidence Status Classification

| Status | Vanta Field | Severity | Action |
|--------|-------------|----------|--------|
| MISSING | `MISSING` | Critical | No evidence exists. Create or upload immediately. |
| EXPIRING | `EXPIRING` | High | Evidence expires within 30 days. Schedule refresh now. |
| NEEDS_REVIEW | `NEEDS_REVIEW` | Medium | Evidence exists but reviewer flagged it. Investigate the flag. |
| STALE | `CURRENT` but >365d old | Medium | Evidence is current but ancient. Re-attest to prove ongoing compliance. |
| CURRENT | `CURRENT` and <365d old | None | Healthy. No action needed. |

## Gap Prioritization Matrix

Score each gap on two axes, then sort by composite score descending.

### Impact Axis (what control the evidence supports)

| Impact | Score | Description |
|--------|-------|-------------|
| Critical control | 3 | Access management, encryption, incident response |
| High control | 2 | Change management, vendor management, logging |
| Standard control | 1 | Policy attestation, training completion |

### Urgency Axis (time pressure)

| Urgency | Score | Description |
|---------|-------|-------------|
| Overdue | 3 | Deadline already passed |
| Due <= 7d | 2 | Expires within a week |
| Due <= 30d | 1 | Expires within a month |
| Future | 0 | More than 30 days out |

Composite = Impact + Urgency. Sort descending. Ties broken by control name
alphabetically for deterministic output.

## Evidence Quality Checks

For each document classified CURRENT, run these quality checks:

1. **Owner assigned** - Has a responsible party, not blank.
2. **Date current** - Last updated within the policy refresh cycle (usually 12 months).
3. **Framework tagged** - Linked to at least one active framework.
4. **Control linked** - Maps to a specific control, not orphaned.
5. **Format valid** - PDF or documented format, not a link to a portal page.

Any CURRENT document that fails 2+ checks should be flagged as STALE in the
output, even if Vanta reports it as CURRENT.

## Output Standards

- Every MISSING document must include its parent control name so the user
  understands why it matters.
- Every EXPIRING document must include days-until-expiry.
- Every STALE document must include days-since-last-update.
- Never imply a document is healthy just because status=CURRENT. Always run
  the quality checks above.