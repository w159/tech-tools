# tripwire-sanctioned-write-deny: Tripwire no longer denies docs/ and .atlas/ writes at the inline-op limit

- id: tripwire-sanctioned-write-deny
- status: verified
- verified_by: lead
- verified_at: 2026-11-23T09:35:38+00:00

## Evidence
- test_dispatch_tripwire.py test_docs_and_atlas_writes_pass_the_threshold failed before the fix, whole file 385 tests OK after

## Reproduction
python3 -m unittest plugins/atlas/hooks/test_dispatch_tripwire.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
