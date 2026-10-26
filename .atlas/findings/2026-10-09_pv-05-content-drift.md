# PV-05-content-drift: check_content_drift reports drift for real omp 10.4.2 cache (31 files now; CHANGELOG says 28, stale count), read-only (cache sha unchanged, 0 new files), warn severity so never triggers apply_fixes

- id: PV-05-content-drift
- status: verified
- verified_by: ParityVerifier
- verified_at: 2026-10-09T18:01:01+00:00

## Evidence
- (False, omp differs from the reference in 31 file(s): agents/verifier.md, contracts/hook-bridge.json, ...)
- atlas_doctor.py:2988 failed excludes severity=warn; apply_fixes only with --fix

## Reproduction
cwd=repo: python3 import atlas_doctor; check_content_drift(omp, ~/.omp/plugins/cache/plugins/tech-tools___atlas___10.4.2, atlas)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
