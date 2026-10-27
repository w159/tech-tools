# S-sentinel-root: Sentinel root resolution: orchestration sentinel walks up to the project root (5.27.1)

- id: S-sentinel-root
- status: verified
- verified_by: atlas-orchestrator
- verified_at: 2026-09-09T12:25:47+00:00

## Evidence
- Failing-first: test_sentinel_walks_up_to_project_root FAILED before fix, OK after
- suites: scripts Ran 650 tests OK (2 new sentinel tests); hooks Ran 86 tests OK
- live: board moved to repo root, statusline renders ESC[1;36mATLAS ESC[0m 1/2 | now: prove ATLAS statusline renders at the prompt | 1 left
- nested plugins/atlas/{scripts,hooks}/.atlas trees removed again after the writer was fixed

## Reproduction
python3 -m unittest test_atlas_db.UncoveredPathsTest.test_sentinel_walks_up_to_project_root

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
