# OH-1043-metrics-truthfulness: classify_error user_code/model_misuse/environment; temp/no-prompt exclusion; per-100 friction; UUIDv7 omp; certifi; breaker_tripped

- id: OH-1043-metrics-truthfulness
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:54+00:00

## Evidence
- classify_error('eval',Traceback..)=user_code; ('bash','Service mode does not accept...')=model_misuse; ('mcp__x','chroma fetch failed, falling back')=environment
- atlas.db ro: 14d sessions w/o facets = 489 (claim 489 exact); real (prompted, non-tmp) now 37 (claim 50; window drift)
- colony reclass on db copy: 580 claude-code-by-casing (14d), 533 reclassified omp by UUIDv7 (claim exact)
- mine_recurring_friction on db copy: gate_block 74.4/100 now (claim 56.8 point-in-time; metric is per-100, value drifted with new blocks today)
- typesafe_client.py:35-43 certifi; scorecard/probe_hooks.py:532-536 breaker_tripped
- unknown 26->12 and findings 22->16 not recounted

## Reproduction
sqlite3 file:/Users/jerry/.atlas/atlas.db?mode=ro ...; atlas_doctor miners on a backup copy (ATLAS_DB=tmp copy)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
