# atlas-doctor-session-2026-11-17: atlas-doctor run: 3154 facets enriched, 8 open findings fixed (mux cheap-model exemption, block-loop progress reset, created_at upsert fix, judge budget+hosted endpoint), 1,610 facets re-judged by the model

- id: atlas-doctor-session-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T16:32:30+00:00

## Evidence
- repo /Users/jerry/MEGA/Projects/Agentic/tech-tools working tree: dispatch_tripwire_core.py, completion_gate_core.py, atlas_db.py, turn_scoring.py, typesafe_client.py, atlas_control.py, CLAUDE.md, docs/CHANGELOG.md, docs/lessons/2026-11-17_a-loop-counter-needs-a-progress-signal.md

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && python3 -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
