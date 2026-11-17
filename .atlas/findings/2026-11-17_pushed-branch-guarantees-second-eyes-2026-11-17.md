# pushed-branch-guarantees-second-eyes-2026-11-17: MUX cheap-exploration exemption, runner STEPS cap, block-loop progress reset, facet created_at COALESCE and the 24k judge body bound all hold when re-derived by hand on the archive

- id: pushed-branch-guarantees-second-eyes-2026-11-17
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-17T18:09:21+00:00

## Evidence
- /tmp/vt_head_evidence.txt (script /tmp/vtg_verify.py): MUX - explorer+haiku second dispatch -> decision='allow' (NOT denied); implementer+sonnet second dispatch -> decision='deny' 'DENY - another in-process atlas:* dispatch of this session is still running'; explorer+opus -> decision='deny' (model_override rule: 'The agent definition pins model: haiku')
- _cheap_exploration: explorer/haiku=True, explorer/sonnet=True, explorer/opus=False, explorer/''=False, implementer/sonnet=False, implementer/haiku=False; _burst_note 2nd (exempt=False) -> (True, 'DENY - another in-process ...'), 3rd (exempt=True) -> (False, '')
- STEPS - runner 0 numbered steps -> 'DENY - the STEPS: block of this atlas:runner dispatch has no numbered lines ... at most 7.'; 8 steps -> 'DENY - this atlas:runner dispatch has 8 numbered STEPS but the cap is 7.'; 7 steps -> allow
- BLOCK LOOP - limit=3; four identical blocks with unchanged dispatch count -> (1,False) (2,False) (3,False) (4,True) exhausted; changed dispatch count 5->6->7 -> (1,False) (1,False) (1,False) never exhausted
- UPSERT - insert created_at=1000 -> (1000.0,'g1','o1'); upsert without created_at -> (1000.0,'g2','o2') created_at UNCHANGED; upsert with explicit created_at=2000 -> (2000.0,'g3','o2')
- JUDGE BOUND - exchange body 100215 bytes -> trimmed 24000 bytes (<= MAX_BODY_BYTES 24000); facet body 90191 bytes -> trimmed 24000 bytes

## Reproduction
/Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python /tmp/vtg_verify.py  (run from the /tmp/vt_head archive; temp ATLAS_DB + ATLAS_HOOKSTATE_DIR, never the real ~/.atlas)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
