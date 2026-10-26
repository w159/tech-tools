# OH-1043-dispatch-tripwire: Spec deny skeleton, exploration deny 126 B, tmux name lift, verifier.md via atlas_finding.py, omp alias expansion accepted

- id: OH-1043-dispatch-tripwire
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:53+00:00

## Evidence
- hooks/dispatch_tripwire.py:280 REPORT fields STATUS, STEPS, FILES_CHANGED, EVIDENCE, DELIVERABLE, NEXT
- _exploration_deny('cat src/a.py','lean-ctx') = 126 bytes (measured)
- hooks/dispatch_tripwire.py:513 TMUX set + TMUX_PANE empty lifts name
- agents/verifier.md:7 disallows Write; 2 refs to atlas_finding.py
- omp/index.test.ts:580-594 alias expansion test passes
- tests test_dispatch_tripwire.py:542,3166,3191 pass. 960x/14d frequency not independently recounted

## Reproduction
python3 -c 'import dispatch_tripwire as dt; len(dt._exploration_deny(...))' ; bun test

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
