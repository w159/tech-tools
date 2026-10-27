# atlas-810-status-contract-sys-modules-leak: hooks/test_status_contract.py fixed a real cross-file test-isolation bug: an unrestored sys.modules mock in setUp with no tearDown silently defeated scripts/test_atlas_curator.py's mock.patch when both ran in one pytest process

- id: atlas-810-status-contract-sys-modules-leak
- status: verified
- verified_by: VerifyAtlas810
- verified_at: 2026-09-28T13:23:10+00:00

## Evidence
- hooks/test_status_contract.py lines 67-90: tearDown captures self._orig_curator/self._orig_memory in setUp and restores sys.modules['atlas_curator']/['atlas_memory'] (or pops them if absent before), with a comment explaining the cross-file leak this fixes
- isolated pairing rerun: `python3 -m pytest hooks/test_status_contract.py scripts/test_atlas_curator.py -q` from plugins/atlas -> 44 passed, 0 failures -- this is the exact pairing that was broken pre-fix
- independently reproduced by fresh verifier dispatch (VerifyAtlas810 claim 2): CONFIRMED, same 44 passed result

## Reproduction
cd plugins/atlas && python3 -m pytest hooks/test_status_contract.py scripts/test_atlas_curator.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
