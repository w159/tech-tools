# Finding: six carried gaps, and what they had in common (2026-08-06, atlas 5.6.0)

## Root cause (reusable rule)

Every gap closed here had been *written down* and then survived, some for weeks.
Writing a gap into ROADMAP or a CHANGELOG caveat feels like handling it. It is
not: prose does not fail. Three of these six were only found again because
someone asked "what is still open", and one of them (`skill_factory.py`) had
already been reported as removed.

The durable rule: a known gap either gets fixed or gets a failing/asserting
test. `test_atlas_contract.py` had exactly one of these encoded as a passing
test that documented the hole, and that is the one that could not rot silently.
Prefer that shape for anything deferred.

## The gaps

1. **A stale test that failed for a stale reason.** `test_connectors_wiring.py`
   globbed `*.mcpb` after the 2026-07-31 move to vendored ESM bundles. Discovery
   returned `{}`, so three bundle tests passed vacuously and one failed. The
   failure was reported in three separate sessions as "1 pre-existing failure,
   confirmed unrelated" -- true each time, and nobody read it. Vacuous-pass is
   the more dangerous half: a test whose fixture finds nothing asserts nothing.
   Every filesystem-driven test now needs a discovery-is-non-empty guard.
2. **`facets.gate_block_count` was permanently NULL.** Schema, miner and doctor
   all existed; no code ever wrote a row. Wiring the writer exposed a second,
   worse defect: `chronicle_facet._sync_friction_events` deleted *all* of a
   session's `friction_events` before re-mirroring `signals`, erasing rows
   written by other hooks (`gate_block`, and `memory_capture`'s `memory_drop`,
   which had been getting erased every Stop since it shipped). Delete-then-
   reinsert must always be scoped to the rows the writer owns.
3. **The gate could not tell "wrote nothing" from "recorded nothing".** The
   run-write signal returned `[]` in both cases, and `[]` skipped conditions
   (a), (b), (f) and (g). A session whose telemetry never landed got a gate
   enforcing only "the docs files exist". The fix distinguishes them: zero
   events AND zero tool_calls means no data, so read the git tree instead.
4. **Ten more secret shapes were trackable.** The 2026-08-05 fix corrected rule
   *ordering* and said so honestly, leaving *coverage* unverified. Probing found
   `*.pgdump`, `*.dmp`, `*.rdb`, `*.bacpac`, `*.sqlite`, `*.sqlite3`, `*.db`,
   `*.jceks`, `*.keytab`, `*.p7b` all trackable under `docs/`, `.atlas/`,
   `plugins/`. Ordering and coverage are two separate audits; passing one says
   nothing about the other.
5. **`skill_factory.py` outlived its hook.** 5.5.0 removed `auto_skill.py` and
   19 generated skills and recorded the rule as absolute. The script that wrote
   the SKILL.md files stayed in `scripts/`, and `atlas-setup` still verified its
   presence as a deployment step. Unwiring a caller is not removing a capability.
6. **A gap entry that was already fixed.** ROADMAP claimed no test asserted the
   memory-drop path; `test_unstorable_lesson_is_recorded_not_dropped` had been
   asserting it. Stale gap entries cost the same attention as real ones.

## Fix

- `plugins/atlas/hooks/completion_gate.py`: `_record_gate_block()`,
  `_run_has_telemetry()`, git fallback in `_run_written_paths()`.
- `plugins/atlas/hooks/chronicle_facet.py`: `_gate_block_count()`, scoped
  friction delete.
- `plugins/atlas/scripts/test_connectors_wiring.py`: ESM-bundle discovery plus a
  non-empty guard.
- `plugins/atlas/scripts/atlas_doctor.py`: `--enrich-facet`.
- Deleted `plugins/atlas/scripts/skill_factory.py` and its test.
- `.gitignore`: ten shapes added to the terminal block.

## Evidence

`.atlas/evidence/2026-08-06-atlas-5.6.0-gap-closure.md`. Suite:
`cd plugins/atlas && python3 -m pytest hooks scripts -q` -> 1028 passed,
3 skipped (installed-parity, pending reinstall), 56 subtests passed.

## Do not regress

- `GitignoreSecretContract` probes 24 secret paths and 3 real docs every run.
- `test_no_script_writes_a_skill_either` asserts the factory stays deleted.
- `test_gate_trusts_a_run_row_that_reports_no_writes` and
  `test_no_telemetry_falls_back_to_git_condition_f` pin both halves of the
  telemetry distinction; changing one without the other breaks a test.
