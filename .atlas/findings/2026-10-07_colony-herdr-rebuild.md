# colony-herdr-rebuild: Colony single page, channel simplification, dispatch quoting fix, error classification: verified round

- id: colony-herdr-rebuild
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-07T12:54:08+00:00

## Evidence
- agent://FinalVerify-2; scripts 1482, hooks 1177, omp 356, dashboard_ui 15, colony unit 33; dispatch PONG; 5 pages 0 console errors; open: 13 vendored contract tests env-failing unproven vs pristine, nothing committed

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest discover -p test_*.py; cd ../hooks && python3 -m unittest discover -p test_*.py; cd ../omp && bun test; cd ../scripts/dashboard_ui && bun test

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-10-07T06:00:03+00:00 needs-evidence by atlas:verifier: Atlas colony rebuilt on herdr + vendored herdr-web-ui: Python side green, UI/live verification open
- 2026-10-07T10:23:40+00:00 verified by atlas:verifier: Atlas colony on herdr + vendored herdr-web-ui: final state verified (suites, live 7317, tailnet, browser, security probe
- 2026-10-07T10:26:58+00:00 needs-evidence by atlas:verifier: Atlas colony: herdr-web-ui rail removed and live 7317/tailnet verified; open: Colony lens only links to the Herdr consol
- 2026-10-07T12:20:34+00:00 needs-evidence by atlas:verifier: Atlas colony/IRC repair round: dispatch --thinking fix, Colony = single herdr page, channel wiring, hooks row rule verif
- 2026-10-07T12:26:55+00:00 needs-evidence by VerifyColonyRound: Repo-side dispatch fix, Colony single page, channel wiring, hooks-row rule reproduce; 2 doc drifts + installed cache 10.
- 2026-10-07T12:52:32+00:00 verified by atlas:verifier: Round verified: scripts 1482 OK, hooks 1177 OK, omp 356/0, dashboard_ui 15/0, herdr unit 33/0, PONG, classifier, 5 pages
