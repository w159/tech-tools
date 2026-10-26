# ATLAS-5.9.0-verifier-write-path: atlas:verifier had no write path to findings.json; CLI + mandatory step + dispatch bracket added

- id: ATLAS-5.9.0-verifier-write-path
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:09:24+00:00

## Evidence
- plugins/atlas/scripts/atlas_finding.py
- plugins/atlas/agents/verifier.md:72
- plugins/atlas/hooks/dispatch_tripwire.py:227

## Reproduction
python3 -m pytest plugins/atlas/scripts/test_atlas_finding.py plugins/atlas/hooks/test_dispatch_tripwire.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
