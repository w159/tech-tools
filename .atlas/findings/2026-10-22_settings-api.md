# settings-api: worker/settings-api: seven-group typed catalog, applies now, paths read-only

- id: settings-api
- status: verified
- verified_by: lead-tests
- verified_at: 2026-10-22T22:36:55+00:00

## Evidence
- cd .atlas/wt/settings-api/plugins/atlas/scripts && python3 -m unittest test_atlas_control: Ran 51 tests OK
- behavior_state(): titles in contract order, counts [10,19,14,7,9,3,4], advanced 0, paths 3, hidden 7, applies {now}, 0 Undocumented

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
