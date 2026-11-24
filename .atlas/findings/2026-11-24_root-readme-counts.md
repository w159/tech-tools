# root-readme-counts: README skills row 27 fixes test_readme_table; no other root count drift

- id: root-readme-counts
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-24T18:59:08+00:00

## Evidence
- ls skills/*/SKILL.md=27; git diff README.md one row; root_pytest 191 passed

## Reproduction
.venv/bin/python -m pytest -q -p no:cacheprovider scripts plugins/armada/tests plugins/programmer/tests

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
