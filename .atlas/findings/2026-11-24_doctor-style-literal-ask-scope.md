# doctor-style-literal-ask-scope: Output style: answer questions in the state line; a question gets an answer, not edits (doctor findings 27525,26520,26519,26173,26221,26176)

- id: doctor-style-literal-ask-scope
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T13:22:25+00:00

## Evidence
- .atlas/evidence/2026-11-24_doctor-style-literal-ask-scope.txt

## Reproduction
.venv/bin/python -m pytest -q plugins/atlas/hooks/test_atlas_contract.py plugins/atlas/hooks/test_fable52_guide.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
