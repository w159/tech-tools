# atlas-wave-measured-improvement-10.1.2: Ground-up atlas hardening wave: hooks, omp bridge, subagents, mux/IRC, connectors, doctor, herd, scorecard

- id: atlas-wave-measured-improvement-10.1.2
- status: verified
- verified_by: atlas:lead
- verified_at: 2026-10-07T05:16:02+00:00

## Evidence
- scorecard 217 metrics, baseline (frozen pre-fix tree) vs live: improved 53, regressed 6 (doctor +17ms from new checks, session_boot +100ms fixed after by cached ensure_colony probe p50 235->76ms, irc p50 165->305ms from per-pane flock+input check), 4 skipped (colony HTTP route moved by another session). Highlights: failopen crashes 5->0, timeouts 1->0, untraced 6->0; bash_advisor 3M-char 97.8s->0.16s; bridge hang budget bash 30s->20s, task batch 75s->20s; bridge bash pre p50 110->47ms; 33/33 device names classified; omp typecheck errors 13->0; irc human dup 20->0, stream loss 16-18->0, late note delivered 0->1, parallel spawn 1/8->8/8; connector configured false-positive 9->0, false-negative 4->0; credwatch false positives 4->0; dispatch decoy denied 0->5; nonsense worker reports accepted 6->1. Suites: hooks 1147 pass/3 skip, scripts 1370-1380 pass, omp 347 pass, tsc 0 errors, node test-mcp-tools.mjs 12 connectors PASS in placeholder and no-creds modes. Recorded by lead from implementer evidence plus lead-run scorecard; not independent verifier.

## Reproduction
python3 plugins/atlas/scripts/atlas_scorecard.py run --root plugins/atlas --out after.json; python3 plugins/atlas/scripts/atlas_scorecard.py diff baseline.json after.json

## Proposed fix
none recorded

## Doc refs
- plugins/atlas/CHANGELOG.md
- docs/architecture/atlas-workboard.md
- docs/architecture/atlas-harness-parity.md

## History
- no earlier verdicts
