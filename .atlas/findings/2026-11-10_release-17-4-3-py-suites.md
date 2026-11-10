# release-17.4.3-py-suites: 17.4.3 gate: hooks 2816 OK, scripts 4281 OK, ruff clean

- id: release-17.4.3-py-suites
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-10T10:20:30+00:00

## Evidence
- /tmp/release-gate/hooks.log /tmp/release-gate/scripts.log /tmp/release-gate/ruff.log

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks; python3 -m unittest discover -s plugins/atlas/scripts; ruff check --select F401,F811,F841,F821 plugins/atlas/hooks plugins/atlas/scripts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
