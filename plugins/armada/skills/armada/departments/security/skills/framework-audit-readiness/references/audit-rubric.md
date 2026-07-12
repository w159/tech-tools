# Framework Audit Readiness Rubric

Evaluation criteria for Vanta framework audit readiness. Use this rubric to
score readiness and prioritize remediation before an audit.

## Readiness Score Calculation

```
readiness_score = (passing_tests / total_tests) * 100
```

Compute per control, then average across all controls weighted by control
criticality.

## Control Criticality Tiers

| Tier | Weight | Examples |
|------|--------|----------|
| Critical | 3x | Access control, encryption, incident response |
| High | 2x | Change management, vendor risk, logging |
| Standard | 1x | Policy attestation, training, awareness |

Weighted score = sum(passing * weight) / sum(total * weight) * 100.

## Readiness Bands

| Band | Score | Meaning | Action |
|------|-------|---------|--------|
| READY | 95-100 | Audit-ready | Proceed with audit scheduling |
| NEARLY-READY | 85-94 | Minor gaps | Fix quick wins, then schedule |
| GAPS-PRESENT | 70-84 | Significant gaps | 30-60 day remediation plan needed |
| NOT-READY | <70 | Major gaps | Do not schedule; full remediation required |

## Control Classification Tags

Tag every control in the output with one of these:

| Tag | Criteria | Priority |
|-----|----------|----------|
| BLOCKER | 0% pass rate | Immediate escalation |
| AT-RISK | <50% pass rate | High priority remediation |
| QUICK-WIN | Exactly 1 failing test | Fix first for fast wins |
| HEALTHY | >=95% pass rate | No action needed |
| INSUFFICIENT-DATA | 0 tests total | Verify control is in scope |

## Test Status Interpretation

| Vanta Status | Meaning | Counts toward pass rate? |
|--------------|---------|--------------------------|
| PASSING | Test passed | Yes (passing) |
| NEEDS_ATTENTION | Test failed or not evaluated | No |
| NOT_IN_SCOPE | Test not applicable to this framework | Excluded from denominator |
| ERROR | Test could not run | Excluded, but flag for manual review |

## Output Standards

1. Header must include framework name, total controls, total tests, pass
   rate, and a Vanta UI deep-link slug.
2. Top 10 at-risk controls listed with: control name, pass rate, failing
   tests inline, suggested owner.
3. Quick wins section: every control with exactly one failing test.
4. Blocker section: every control with zero passing tests.
5. If >500 NEEDS_ATTENTION tests exist, sample the first 200 and note that
   more exist.
6. Never auto-remediate. This is a triage report, not an action plan.