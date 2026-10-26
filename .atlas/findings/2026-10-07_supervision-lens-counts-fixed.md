# supervision-lens-counts-fixed: memberBoard counts each item once; blocked no longer double counted

- id: supervision-lens-counts-fixed
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-07T15:50:03+00:00

## Evidence
- /tmp/sv3.log; fixture rows s1{active1,open1,blocked1} s2{blocked1,done1} SUM5 blocked2; bun test 19 pass; sweep 64/64 26/26

## Reproduction
fixture via open_lead_channel+_op_add/_op_status+h_channel_get -> bun memberBoard; bun test dashboard_ui/js/*.test.js; bun .atlas/.run/evidence/sweep/run.mjs

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
