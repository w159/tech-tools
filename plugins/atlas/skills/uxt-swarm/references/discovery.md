# Phase 0: Discovery

Discovery runs FIRST, before any data entry, and has two jobs: regenerate the coverage
matrices from live frontend source, and probe the REAL client contract so the swarm later
grades the surface the client actually reads. It is dispatched as a general-purpose subagent
with references/roles/cartographer.md as the prompt prefix.

Why phase 0 exists: the previous run wrote salary to budget/planner tables, read those back,
saw HTTP 200, and declared COMPLETE - while profile.current_salary (the value the CLIENT reads
on the dashboard) was null for all 24 personas and the app showed "needs work." Discovery
captures the real salary-write call so the harness mirrors it instead of guessing.

## What discovery does

1. Coverage cartography. Scan frontend/src/router.tsx + frontend/src/pages/ for routes and all
   of frontend/src for user-editable fields. Rebuild the canonical route-matrix.csv and
   field-matrix.csv in docs/claude_testers/coverage/, diff against the previous run, and copy
   both into RUN_DIR/coverage/ with two extra columns: status (init untested) and evidence_ref.

2. Live-contract probe. Read frontend/src to capture how the real client SETS and READS
   profile.current_salary. Start at the setup wizard (StepMemberProfile.tsx, StepIncomeBudget.tsx,
   SetupWizard.tsx) and the API client (frontend/src/utils/api.ts). Capture the salary-write
   endpoint+method+payload field names, the filing/tax write, the profile read-back endpoint,
   and whether salary is sent explicitly (it must be - the backend does NOT derive it from
   currentGradeId). Cite file:line for every claim; write "unknown" rather than guess.

## Outputs (all under RUN_DIR/coverage/)

- route-matrix.csv  - run-local copy, status + evidence_ref columns added.
- field-matrix.csv  - run-local copy, status + evidence_ref columns added.
- contract-snapshot.json - the live client contract the scripted harness MUST mirror:
  { "salary_write": {"endpoint","method","payload_fields"},
    "filing_tax_write": {"endpoint","method","payload_fields"},
    "profile_read": {"endpoint","fields"},
    "salary_derived_from_grade": false,
    "source_refs": ["file:line", ...] }

The canonical matrices in docs/claude_testers/coverage/ are also overwritten with the fresh
scan, and COVERAGE-NOTES.md gets the scan date + per-app_area counts.

## Downstream dependency

contract-snapshot.json is the source of truth for the scripted-persona role and the harness:
the salary write and the read-back assertion both use the call it names. If the probe could not
resolve the real call (values are "unknown"), that is a blocker for data entry - the harness
cannot mirror a call it does not know. Resolve it before running phase 2.

## Caching

Under coverage=smoke the matrices may be reused from a recent run if the frontend has not
changed since (a docs-only or harness-only diff). The live-contract probe still runs unless a
current contract-snapshot.json already exists for an unchanged frontend. When in doubt, re-probe.
