# wave2-d-regression: TestIsolationContract passes 3/3

- id: wave2-d-regression
- status: verified
- verified_by: Wave3Verifier
- verified_at: 2026-10-12T12:13:07+00:00

## Evidence
- pytest 3 passed

## Reproduction
python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -k TestIsolationContract -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-10-12T11:52:55+00:00 rejected by WaveVerifier: hooks/test_atlas_wt.py lacks 'import _test_isolation': test_atlas_contract TestIsolationContract fails
