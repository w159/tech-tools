# junk-writes-home-downloads: Junk writers fixed: no stray .atlas/junk files, guards deny misuse

- id: junk-writes-home-downloads
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-14T23:52:22+00:00

## Evidence
- agent://JunkFixVerify; a-f pass: no .atlas under ~/Downloads, no atlas-* dirs, no junk root entries, 7421 not listening, 269+65 py tests OK, bun 449 pass/0 fail, reap_tick created no stray .atlas, register_project None/None/1, guard deny/deny/deny/allow. NOT checked: installed cache 12.4.3; live sessions keep old code until reinstall

## Reproduction
find ~/Downloads -maxdepth 6 -name .atlas; lsof -iTCP:7421; unittest suites; bun test; reap_tick in temp ATLAS_HOME; bun /tmp/g.ts via registerAgentGuard

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-10-14T23:48:05+00:00 needs-evidence by atlas:verifier: atlas wrote .atlas/.run into ~ and ~/Downloads; omp workers misused write with tool names/prose as paths
