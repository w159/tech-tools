# supervision-lens-postfix: Supervision lens: sweep 64/64 + deep 26/26 + bun 19/19 pass, but memberBoard double-counts blocked todos (5 items -> sum 7)

- id: supervision-lens-postfix
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-10-07T15:42:41+00:00

## Evidence
- plugins/atlas/scripts/dashboard_ui/js/chan-names.js:72 vs atlas_todo.py:1159 _item_counts / atlas_dash_work.py:321 _op_status; fixture /tmp/sv2/api.json: server counts {pending:2,in_progress:2,completed:1}, memberBoard {active:2,open:2,blocked:2,done:1}, todos_state {open:1,in_progress:1,done:1,blocked:2}; notes /Users/jerry/atlas-progress/SupervisionVerify2.md; .atlas/.run/evidence/sweep/index.json when=2026-10-07T15:42:18Z

## Reproduction
fixture via atlas_dash_work._op_add/_op_status + atlas_dash_irc.h_channel_get (herdr patched out) -> /tmp/sv2/api.json; bun -e memberBoard(api.channel_meta, api.board); bun .atlas/.run/evidence/sweep/run.mjs; bun test plugins/atlas/scripts/dashboard_ui/js/*.test.js

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
