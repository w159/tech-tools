# standards-feature: Project standards: docs/standards + standards_nudge hook + curator/auditor/review/setup

- id: standards-feature
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T15:44:06+00:00

## Evidence
- hooks/test_standards_nudge.py (12) + contract/dispatch/scaffold suites: 332 passed, 1 deselected (pre-existing HEAD failure); .atlas/evidence/2026-11-24_project-standards.txt

## Reproduction
cd plugins/atlas && ../../.venv/bin/python -m pytest -q hooks/test_standards_nudge.py hooks/test_atlas_contract.py skills/atlas-setup/scripts/test_scaffold_docs.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-24T15:41:32+00:00 rejected by atlas:verifier: Project standards feature works, but new hook breaks 2 README count contract tests
- 2026-11-24T15:43:09+00:00 verified by lead: Project standards: docs/standards + standards_nudge hook + curator/auditor/review/setup
