# command-center-integrations-10.2.0: Atlas Command Center rebuild, channel model, herdr host, tooling integrations, durable evidence

- id: command-center-integrations-10.2.0
- status: verified
- verified_by: atlas:lead
- verified_at: 2026-10-07T09:22:18+00:00

## Evidence
- Durable evidence in .atlas/.run/evidence/: sweep (60/60 cells + 10/10 deep checks, 15 routes x 2 viewports x 2 themes, 0 console/page errors), scorecard (HEAD baseline 161 metrics vs live 217: improved 40, new 58, regressed 8 of which session_boot latency fixed after: p50 265->65ms cold in harness, scorecard 54ms vs 62 baseline; mux test and probe artifacts fixed), suites (hooks 1156 OK, scripts 1449 pass + 3 attributed fails: 2 test_atlas_remote env/wC-owned, 1 mux fixed after; omp 353 pass, tsc 0, mcp 12 connectors PASS). Gate bug found and fixed: ~ and $HOME not expanded when classifying edit paths (omp resolveTarget + dispatch_tripwire). Earlier frozen pre-fix baseline and /tmp artifacts were lost to a reboot, so earlier 53/6 numbers are conversation-only. Integrations: herdr-projects, captains-deck, tode detected installed; herdr-file-viewer and cmux-browser-mcp not installed (install commands surfaced); cmuxlayer registered in ~/.omp/agent/mcp.json with 120s timeout (needs /mcp reload). Recorded by lead from implementer evidence, not independent verifier.

## Reproduction
python3 plugins/atlas/scripts/atlas_scorecard.py run --root plugins/atlas --out after.json; bun .atlas/.run/evidence/sweep/run.mjs

## Proposed fix
none recorded

## Doc refs
- docs/architecture/atlas-workboard.md
- docs/architecture/atlas-channels.md
- docs/architecture/atlas-colony.md
- plugins/atlas/CHANGELOG.md

## History
- no earlier verdicts
