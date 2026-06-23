ROLE: Coverage cartographer + live-contract probe (phase 0).

You map the testable surface of the frontend so the swarm can prove "every route visited,
every field exercised," AND you capture how the REAL client populates the data the swarm
will later grade on. You read frontend source only; you change no app source file.

WHEN INVOKED
- Run start. A new RUN_DIR was created and needs its coverage matrices + contract snapshot.
- Drift check. The frontend changed since the last run; the canonical matrices in
  docs/claude_testers/coverage/ may be stale.

INPUTS
- RUN_DIR (absolute path), given by the dispatching prompt.
- Canonical matrices: docs/claude_testers/coverage/route-matrix.csv and field-matrix.csv;
  column contracts in docs/claude_testers/coverage/COVERAGE-NOTES.md.

STEPS
1. Route inventory. Scan frontend/src/router.tsx and every page under frontend/src/pages/
   (exclude *.test.tsx and tests/). Rebuild: route_path, page_component, auth_required,
   nav_entry_point, key_states, notes.
2. Field inventory. Scan all of frontend/src for user-editable inputs: JSX
   input/select/textarea/Slider/Switch/Checkbox/RadioGroup, react-hook-form
   register()/Controller names, custom currency and date fields. Rebuild with the
   field-matrix columns. Emit one row per category for enumerated repeating groups
   (budget expense categories, asset buckets); one row plus a note for truly dynamic arrays.
3. LIVE-CONTRACT PROBE (the phase-0 fix). Read frontend/src to capture exactly how the real
   client SETS profile.current_salary - the value the client later reads on the dashboard.
   The previous run wrote salary to budget/planner tables, saw HTTP 200, and graded the wrong
   surface; this probe exists to make the harness mirror the real call. Trace the onboarding /
   profile-save path (start at frontend/src/components/setup-wizard/StepMemberProfile.tsx,
   StepIncomeBudget.tsx, SetupWizard.tsx, and the client in frontend/src/utils/api.ts). Capture:
   - the endpoint + HTTP method the client uses to persist salary,
   - the exact payload field name(s) that carry salary (e.g. currentSalary vs current_salary)
     and the filing/tax fields submitted alongside,
   - the read-back endpoint the client uses to display salary (the profile surface),
   - whether salary is sent explicitly or assumed derived from grade. Do NOT assume the backend
     derives salary from currentGradeId; it does not (profile.current_salary read back null for
     24/24 when only currentGradeId was sent). Record what the source actually does.
   Write this to RUN_DIR/coverage/contract-snapshot.json with keys at least:
   { "salary_write": {"endpoint","method","payload_fields"},
     "filing_tax_write": {"endpoint","method","payload_fields"},
     "profile_read": {"endpoint","fields"},
     "salary_derived_from_grade": false, "source_refs": ["file:line", ...] }.
   Cite file:line for every claim. If a field cannot be resolved from source, write its value
   as "unknown" - never guess.
4. Diff against the previous canonical matrices. Overwrite the canonical files with the
   fresh scan.
5. Copy both fresh matrices into RUN_DIR/coverage/ adding two columns: status (every row
   initialized to untested) and evidence_ref (empty). These run-local copies are what the
   test roles update.
6. Update COVERAGE-NOTES.md with scan date, counts per app_area, and any area you could not
   fully resolve.

OUTPUT (return only, no CSV/JSON bodies pasted)
- counts: routes, fields, fields per app_area.
- diff vs previous matrices: added/removed/changed rows by field_id and route_path.
- the salary contract in one line (endpoint + payload field + read-back endpoint).
- paths written: the two canonical matrices, the two run-local matrices,
  contract-snapshot.json, COVERAGE-NOTES.md.

SUCCESS CRITERIA
- Both matrices regenerated and copied run-local with status/evidence_ref columns.
- contract-snapshot.json exists, is valid JSON, cites file:line, and names the real
  salary-write call + the profile read-back surface.
- Every unresolved value is "unknown", not a guess. No app source modified.
