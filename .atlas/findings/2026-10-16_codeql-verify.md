# CODEQL-VERIFY: CodeQL fixes 95687ebe..9b3a6652 preserve behaviour; no regressions introduced (pre-existing failures: herdr 14, falcon 7, omp agent-guard 1)

- id: CODEQL-VERIFY
- status: verified
- verified_by: codeql-verifier
- verified_at: 2026-10-16T15:03:47+00:00

## Evidence
- atlas py 258+515 OK; node-spanning 43, paylocity 20, shared 71, cipp 31 pass; herdr 14 fails identical at baseline 95687ebe; falcon/omp fails not touched by diff

## Reproduction
see report commands

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
