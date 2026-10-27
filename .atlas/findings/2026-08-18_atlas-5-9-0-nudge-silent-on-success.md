# ATLAS-5.9.0-nudge-silent-on-success: nudge.py no longer emits a success announcement on Stop

- id: ATLAS-5.9.0-nudge-silent-on-success
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:09:24+00:00

## Evidence
- plugins/atlas/hooks/nudge.py

## Reproduction
python3 -m pytest plugins/atlas/hooks/test_nudge.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
