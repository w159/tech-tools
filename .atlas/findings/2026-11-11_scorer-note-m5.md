# scorer-note-m5: M5 note claim (whole drop = one pending/running rule) does not hold: 196 of 273 wrong frames

- id: scorer-note-m5
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-11T18:52:42+00:00

## Evidence
- live_capture.py:721-722 rescored on live-{150,110}-74d8931b-{1,2,3}: wrong frames 44/61/38/46/42/42, rule-only 31/46/26/30/35/28

## Reproduction
python3 -I rescoring script importing live_capture (build_truth/plan_at/agents_at/parse_frame) over the six runs

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
