# c14-band-busy-on-submit: prompt.submit busy mark does not remove live idle band: 13-14 idle frames after submit in both runs

- id: c14-band-busy-on-submit
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-11T23:22:55+00:00

## Evidence
- mod/discipline.ts:250-254; live-150-61858003-1 frames f0003..f0015 line 37 idle while host line 36 shows running UserPromptSubmit hooks 0/3 7s; first non-idle f0016; live-110 f0003..f0014 line 32

## Reproduction
bun test mod/discipline.test.ts (15 pass) + frame scan of live-150 and live-110 61858003-1 after t_prompt=5.96

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
