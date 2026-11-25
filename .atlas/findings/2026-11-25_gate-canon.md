# gate-canon: Stop gate (b)/(g) credits shaped, multi-line and batched passing test runs; failing piped bun runs earn nothing

- id: gate-canon
- status: verified
- verified_by: lead
- verified_at: 2026-11-25T17:39:53+00:00

## Evidence
- .atlas/evidence/2026-11-25-gate-canon-pytest.txt

## Reproduction
.venv/bin/python -m pytest -q -p no:cacheprovider plugins/atlas/hooks/test_completion_gate.py > /tmp/cg-final.txt 2>&1

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
