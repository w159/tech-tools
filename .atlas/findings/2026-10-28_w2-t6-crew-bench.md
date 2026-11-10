# w2-t6-crew-bench: Crew benchmark harness and pkgkit fixture in repo (287 tests, reference passes, stubs fail); baseline single 501k tok/53.3 s, crew 253k tok/57.0 s

- id: w2-t6-crew-bench
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-28T10:08:51+00:00

## Evidence
- .atlas/evidence/2026-10-28_before-after/track-t6-check.txt; plugins/atlas/bench/results/RESULTS.md

## Reproduction
python3 plugins/atlas/scripts/atlas_bench.py fixture-check && python3 -m unittest plugins/atlas/scripts/test_atlas_bench.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
