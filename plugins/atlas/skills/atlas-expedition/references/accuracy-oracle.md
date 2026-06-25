# Accuracy oracle protocol

The calc-verifier is a pseudo-oracle. It recomputes every client-facing figure with its own
independent arithmetic and diffs the result against what the app showed. This file is the
contract for that recomputation. Gate G3: every client-facing number is independently
recomputed AND checked against at least one metamorphic relation; any mismatch beyond 1 cent
is a Blocker.

## The pseudo-oracle rule (non-negotiable)

NEVER read the app's calculator source to derive an expected value. Recomputing from the code
under test verifies the code against itself and proves nothing. Expected values come only from:
- the persona's submitted inputs,
- published reference facts: `/api/pension-calculator/resolve-plan` payloads,
  `/api/reference/tax-brackets`, department config,
- `docs/reference_files` ground truth, cited per figure:
  - Pension: GMEBS Kennesaw Adoption Agreement (multiplier, FAS, Rule of 75/80, hire-date
    tiers) + `Retirement-Calculator.xlsx` (survivor / J&S factors).
    `essestimateresults (8).pdf` is a worked validation fixture.
  - Pay/salary: `pay-scales/*.tsv` cent-for-cent, rule `step = years_of_service - 1` with rank
    floors per `pay-scales/README.md`.
  - Budget/debt: `Henssler_FinancialWellness_Final.xlsx`,
    `Debt Optimization v1.3 Recalc.xlsx`.

## Metamorphic relations (assert at least one per figure)

When the exact expected number is uncertain, assert a relation between a source run and a
follow-up run instead of an absolute value:

- net_worth = total_assets - total_liabilities. Definitional; exact.
- budget_surplus = income - expenses. The surplus sign flips exactly at income == expenses;
  test the boundary (surplus at income just below, at, and just above expenses).
- pension is monotonic non-decreasing in base salary: raising base salary never lowers the
  projected pension. Adding an asset never lowers net worth.
- COLA-on benefit >= COLA-off benefit for identical other inputs.
- survivor option reduces the monthly benefit vs the no-survivor benefit.
- applying member/spouse tax reduces surplus vs the untaxed gross. If supplying tax did NOT
  drop surplus, the engine did not apply tax: that is a Blocker accuracy finding, reported not
  fixed.

## Decimal and rounding rules

- Use Python `Decimal` with an explicit context. Never binary float for money.
- Final cent values: `quantize(Decimal('.01'), rounding=ROUND_HALF_EVEN)`.
- Currency tolerance is exact to the cent after quantize. The pass band is 1 cent (rounding
  noise); anything larger is a Blocker.
- Reserve a small relative tolerance ONLY for intermediate multi-year projections (e.g. pension
  growth) where rounding order legitimately differs, and say so in the row note.

## Higher-precision cross-check

Re-run each calculation at greater precision and under more than one rounding mode. Widely
differing results signal insufficient precision, a rounding-mode issue, ill-conditioned
inputs, or a numerically unstable algorithm. Flag any figure that moves more than its rounding
unit between the standard and high-precision computations.

## Compare to the displayed number

Diff against the number the UI DISPLAYS to the persona, not only the raw API value. The client
reads the screen, so the screen is the surface of record. When a screen value and the API value
disagree for the same inputs, that disagreement is itself a finding (the persona is being shown
a number the API did not return). Browser-persona screen values arrive in
`RUN_DIR/evidence/<persona_id>-ux.rows.csv` rows that carry an app_value; recompute those the
same way as API figures.

## Per-figure record

Each verified figure writes a row to `RUN_DIR/evidence/<persona_id>-verify.rows.csv` with:
input, app_value (API and/or displayed), expected_value, delta, the metamorphic relation
checked, the reference source filename, and verdict (pass / blocker / unverifiable). Missing
input or plan fact -> `unverifiable` with the missing item named; never marked passed.
