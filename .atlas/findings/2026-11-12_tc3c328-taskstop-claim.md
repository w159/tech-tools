# tc3c328-taskstop-claim: TaskStop-killed agent reads failed on every agent surface at e4a8186a (todo row T2 reads done only when lead completes it)

- id: tc3c328-taskstop-claim
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-12T02:09:26+00:00

## Evidence
- mod/discipline.ts:255-265, mod/register.ts:313-336, mod/register-agents.test.ts:384-396; stoprun-150-e4a8186a-1..3 frames: no agent row/card shows ghost done after stop

## Reproduction
bun test mod/register-agents.test.ts mod/discipline.test.ts (44 pass); frame scan of stoprun-150-e4a8186a-{1,2,3}/frames/*.ans and tab-*.ans

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
