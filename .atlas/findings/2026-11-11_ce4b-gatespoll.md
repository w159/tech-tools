# ce4b-gatespoll: band gatesPoll runs gates on the poll that sees stop-verdict change (urgent bypass of 5s gap)

- id: ce4b-gatespoll
- status: verified
- verified_by: verifier-ce4b
- verified_at: 2026-11-11T19:41:29+00:00

## Evidence
- plugins/atlas/mod/register.ts:559-563,675-678; register-fresh.test.ts:128 (5 pass 0 fail)

## Reproduction
cd plugins/atlas && COLORTERM=truecolor bun test mod/register-fresh.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
