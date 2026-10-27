# ATLAS-5.11.0-boot-noise: SessionStart injected all of MEMORY.md: 9820 bytes of mostly telemetry and per-subagent duplicates; now 3649

- id: ATLAS-5.11.0-boot-noise
- status: verified
- verified_by: deterministic contract suite
- verified_at: 2026-08-18T12:48:52+00:00

## Evidence
- plugins/atlas/scripts/atlas_memory.py filter_for_recall
- plugins/atlas/hooks/memory_capture.py

## Reproduction
python3 -m pytest plugins/atlas/scripts/test_atlas_memory.py -k RecallFilter plugins/atlas/hooks/test_atlas_contract.py -k QuietTerminal -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
