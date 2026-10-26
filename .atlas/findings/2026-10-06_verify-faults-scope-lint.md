# verify-faults-scope-lint: (1) lint: ruff clean; pi-lens 2 ast-grep errors in atlas_faults._truncate are false positives (only called inside record's try). Real minor bug: atlas_faults.load aborts on first non-numeric ts

- id: verify-faults-scope-lint
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-06T23:04:36+00:00

## Evidence
- scripts/atlas_faults.py:29,35 (_truncate open calls, guarded by caller try at :42-59); :72 float(rec.get('ts')) inside single outer try :65-75 -> load() returned ['a'] for ts=[1,'bad',3]

## Reproduction
ruff check scripts/atlas_faults.py scripts/atlas_scope.py; xd://lens_diagnostics source=lsp; python load() probe

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
