# omp-widget-reap-verify: omp widget + reap-on-report fixes verified

- id: omp-widget-reap-verify
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-14T08:24:50+00:00

## Evidence
- .atlas/evidence/omp-widget-reap-verify.txt: red on HEAD (gates native_bash_ignored_in_omp; reap done_report_closes_lead_made_board_item + member_finish_cli_with_done_report; omp D2,D3,D4,D6,textOf), green on tree; suites only allowed failures; sentinel fails on HEAD too

## Reproduction
git worktree add HEAD + cp tests; unittest/bun test; full suites

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
