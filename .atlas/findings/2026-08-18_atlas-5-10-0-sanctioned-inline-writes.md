# ATLAS-5.10.0-sanctioned-inline-writes: deny tier no longer counts the docs/.atlas writes the completion gate itself orders; threshold 8 -> 6

- id: ATLAS-5.10.0-sanctioned-inline-writes
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:34:54+00:00

## Evidence
- plugins/atlas/scripts/atlas_db.py unsanctioned_inline_ops_since_last_dispatch

## Reproduction
python3 -m pytest plugins/atlas/scripts/test_atlas_db.py -k UnsanctionedInlineOps -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
