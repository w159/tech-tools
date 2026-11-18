# crew-guard-fanout: green-check guard runs identical checks once and caps concurrent shell commands; _weight treats an over-long entry as literal text

- id: crew-guard-fanout
- status: verified
- verified_by: lead
- verified_at: 2026-11-18T10:52:32+00:00

## Evidence
- plugins/atlas/scripts/atlas_crew.py:1254
- plugins/atlas/scripts/atlas_crew.py:1372
- plugins/atlas/scripts/test_atlas_crew.py::SupervisorOverlapTests::test_guard_runs_one_command_once_for_every_worker_sharing_it

## Reproduction
python3 -m pytest -q plugins/atlas/scripts/test_atlas_crew.py plugins/atlas/scripts/test_atlas_crew_hardening.py (278 passed)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
