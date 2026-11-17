# atlas-doctor-shipped-and-live-2026-11-17: Shipped and live: the atlas-doctor fixes are merged to main (PR #67), published as atlas-v17.28.0, and installed on BOTH harnesses (omp 17.27.1 -> 17.28.0, Claude Code 17.28.0) via the sanctioned marketplace updater - no install cache was hand-edited

- id: atlas-doctor-shipped-and-live-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T18:29:21+00:00

## Evidence
- installed ~/.omp/plugins/cache/plugins/tech-tools___atlas___17.28.0 and ~/.claude/plugins/cache/tech-tools/atlas/17.28.0 both contain _cheap_exploration (2), BURST_SECS = 30 (1), _run_dispatch_count (3), MAX_BODY_BYTES (1), created_at=COALESCE(?,created_at) (1), and the loud missing-key typesafe_client
- installed hook suite run from the install dir: 1093 passed, 31 subtests passed in 160.45s
- installed scorer real judge call on a DB copy: calls=1 rows=6 input_tokens=2573 model=jev-1.14.0 scope_drift=0.12 - no 2048-token overflow error
- atlas_env.apply_store_env() resolves ATLAS_TYPESAFE_URL=https://api.typesafe.ai ATLAS_TYPESAFE_MODEL=jev-latest for every hook run

## Reproduction
cd ~/.omp/plugins/cache/plugins/tech-tools___atlas___17.28.0 && ATLAS_DB=/tmp/copy.db ATLAS_TYPESAFE_URL=https://api.typesafe.ai ATLAS_TYPESAFE_MODEL=jev-latest python3 scripts/turn_scoring.py --session <sid> --max-calls 3

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
