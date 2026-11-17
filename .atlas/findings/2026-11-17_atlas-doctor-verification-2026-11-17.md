# atlas-doctor-verification-2026-11-17: Adversarial verification of the atlas-doctor changes: created_at upsert fix VERIFIED (pre-fix bug reproduced against HEAD), mux exemption and block-loop progress reset VERIFIED with no NEW test failures (hooks 3277 vs 3272, same 11 pre-existing failures; scripts 349 OK); 3 defects found and handed back for repair

- id: atlas-doctor-verification-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T16:33:13+00:00

## Evidence
- plugins/atlas/scripts/atlas_db.py upsert_facet created_at; plugins/atlas/hooks/dispatch_tripwire_core.py _cheap_exploration + BURST_SECS 30; plugins/atlas/hooks/completion_gate_core.py _block_loop_state progress reset; plugins/atlas/scripts/turn_scoring.py judge budget

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools && python3 -m pytest plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/test_completion_gate.py -q && cd plugins/atlas/scripts && python3 -m unittest test_atlas_db_facet test_turn_scoring_budget

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
