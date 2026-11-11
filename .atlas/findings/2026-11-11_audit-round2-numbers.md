# audit-round2-numbers: Round2 audit: M5/M6 values right; lag max factors, 13-of-18 count, omitted M3 wrong

- id: audit-round2-numbers
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-11T17:51:32+00:00

## Evidence
- docs/audits/2026-11-11_atlas-round2.md:21,49-50; after metrics.json lag.max_s 150: 1.84/2.8/4.51, 110: 5.54/4.66/4.2

## Reproduction
python3 -c recompute over six after metrics.json vs baseline/live-150,110 metrics.json

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
