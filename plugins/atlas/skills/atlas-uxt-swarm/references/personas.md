# Personas: generation via datagen.py

Personas are synthesized by docs/claude_testers/harness/datagen.py, not hand-authored. The
generator produces rows in the exact 42-column seed schema run_persona.py consumes, so the
scripted harness reads generated rows with no changes. Generation is deterministic: the same
seed yields identical rows, so a run is repeatable and diffable.

## The 42-column seed schema

One row per persona, columns in this fixed order (run_persona.py and registry.py depend on it):

persona_id, full_name, department_label, rank_label, hire_date, date_of_birth, marital_status,
filing_status, spouse_income, dependents_count, dependents_ages, member_base_salary,
avg_overtime, detail_extra_duty, losap, secondary_employment, rental_income, business_income,
other_income, member_tax_rate, spouse_tax_rate, retirement_age, desired_monthly_income,
emergency_fund_months, emergency_fund_balance, survivor_option, cola_enabled, assets_checking,
assets_savings, assets_dept_plan, assets_roth_ira, assets_trad_ira, assets_brokerage,
re_primary_value, re_primary_mortgage, liab_credit_card, liab_auto, liab_student, device,
tech_savviness, scenario_focus, expected_signal.

expected_signal is a hypothesis to confirm or refute, never ground truth. dependents_ages is a
semicolon-joined list whose length should match dependents_count (a deliberate cross-field check
the fuzz role exercises).

## profile semantics (skill option -> datagen profile)

The skill exposes profile=valid|mixed (default mixed). datagen itself has three profiles:
- valid    - clean happy-path data that should pass every step.
- boundary  - every row is a known trap shape (used internally; not a skill option).
- mixed    - mostly valid, but every 4th persona (index i % 4 == 3) is mutated into a boundary
             trap. This is what the skill's profile=mixed maps to.

The five trap shapes a boundary mutation applies (chosen per row from the seed): zero_salary
(member_base_salary=0), future_hire (hire_date in the future), negative_networth (liabilities
exceed assets), past_retire (retirement_age below current age), no_plan (department_label set to
the no-pension department, Cobb Sheriff). These are the regression surface - each maps to a
previously found bug class.

## Seed repeatability

GEN_SEED (CLI --seed) makes generation deterministic: same seed + same count + same profile =
byte-identical rows. Default is random, so omit GEN_SEED for fresh data, set it to reproduce a
prior run exactly or to diff two runs on identical inputs. Account ids are assigned stably
(P01, P02, ... or an explicit --ids list) so existing run-scoped accounts are reused while the
entry DATA regenerates.

## User-count presets and the coverage cap

The skill's users option accepts an integer or one of the presets 6 / 12 / 24 (default 12),
mapped to datagen --count via the COUNT env knob. 24 is the full seed-equivalent set; 6 and 12
are lighter passes.

The coverage tier caps user count: coverage=smoke caps users at 2 regardless of the requested
count. If users and coverage conflict (e.g. users=24 coverage=smoke), the coverage cap wins for
user count and the conflict is recorded in the run log. standard and full honor the requested
count.

## Standalone use

datagen.py runs standalone for inspection or fixture generation:
  python3 datagen.py --count 12 --seed 7 --profile mixed --out generated-personas.csv
  python3 datagen.py --count 6 --profile valid --ids "P01 P02 P03 P04 P05 P06" --out gen.csv
The skill writes generated rows to RUN_DIR/generated-personas.csv before the scripted wave.
