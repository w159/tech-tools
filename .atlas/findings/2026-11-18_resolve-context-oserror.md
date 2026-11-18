# resolve-context-oserror: resolve_context returns an over-long single-line context entry as literal text

- id: resolve-context-oserror
- status: verified
- verified_by: lead
- verified_at: 2026-11-18T10:41:23+00:00

## Evidence
- plugins/atlas/scripts/atlas_crew.py:347
- plugins/atlas/scripts/test_atlas_crew.py::PlanTests::test_context_long_single_line_is_literal_text

## Reproduction
python3 -m pytest -q plugins/atlas/scripts/test_atlas_crew.py plugins/atlas/scripts/test_atlas_crew_hardening.py (274 passed)

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-18T10:38:59+00:00 needs-evidence by atlas:verifier: resolve_context long-line fix not applied: verifier role cannot edit
