# crew-command-spec-guard: crew_command emits a crew command only when the spec has section headings for the planned files

- id: crew-command-spec-guard
- status: verified
- verified_by: lead
- verified_at: 2026-11-18T12:02:48+00:00

## Evidence
- plugins/atlas/hooks/prompt_optimizer_core.py:865
- plugins/atlas/hooks/test_prompt_optimizer.py::test_crew_command_none_for_non_spec_doc_and_many_files

## Reproduction
python3 -m pytest -q plugins/atlas/hooks (3431 passed)

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-18T11:56:03+00:00 needs-evidence by atlas:verifier: crew_command per-file spec guard: no implementation present to verify
