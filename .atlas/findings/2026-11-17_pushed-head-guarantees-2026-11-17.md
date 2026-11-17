# pushed-head-guarantees-2026-11-17: Four behavioural guarantees reproduced directly against the pushed HEAD archive

- id: pushed-head-guarantees-2026-11-17
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-17T18:06:45+00:00

## Evidence
- MUX: _scope_gate direct -> atlas:explorer model=haiku denied=[] (not denied); atlas:implementer model=haiku denied=[('mux','DENY - another in-process atlas:* dispatch of this session is still running...')]; atlas:explorer model=opus denied=[('mux', same deny)]
- STEPS: _runner_steps_problem -> 0 numbered steps: 'DENY - the STEPS: block of this atlas:runner dispatch has no numbered lines. Write each step as a numbered line (1. ..., 2. ...), at most 7.'; 8 steps: 'DENY - this atlas:runner dispatch has 8 numbered STEPS but the cap is 7.'
- BLOCK LOOP: _block_loop_state counts [(1,False),(2,False),(3,False),(4,True)] with no new dispatch (cap trips at 4, FINAL notice 'identical block 3 of 3'); with progress=100..103 counts [(1,False),(1,False),(1,False),(1,False)] (no trip)
- UPSERT: temp DB created_at 1794938756.885785 unchanged after second upsert with different payload (correction_count 1->7); explicit created_at=1234.5 stored as 1234.5
- JUDGE BOUND: hostile exchange body 402499 bytes -> fit_state -> 24000 bytes; hostile facet body 352858 -> 24000; end-to-end score_session sent 9 POSTs, max body 22499 bytes, facet POST 11873 bytes, all <= 24000

## Reproduction
/Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python /tmp/vt_g2.py (and /tmp/vt_guarantees.py) with cwd /tmp/vt_head

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
