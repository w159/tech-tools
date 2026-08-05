# stop_hook_active was silencing atlas's own capture hooks, not just its retry loops

Date: 2026-08-05

## Problem

`atlas_hook_guard.should_run()` unconditionally returned `False` whenever
`payload.get("stop_hook_active")` was true. That guard exists to stop
message-repeating hooks (nudge, auto_skill, completion_gate) from looping
forever on Claude Code's forced-continuation retry. But `ingest_session.py`,
`memory_capture.py`, and `chronicle_facet.py` are capture hooks: they only
write observability data, and replaying that write on a retry is idempotent,
not a loop risk. The guard treated both hook shapes identically.

Whenever `completion_gate.py` blocked, Claude Code re-fired Stop with
`stop_hook_active=true`. The old guard silenced every atlas Stop hook on
that retry, including the three capture hooks. So every session where the
gate blocked one or more times had its telemetry capture switched off for
that Stop, and the gate's own false positives (see the docs-drift/verifier-
coverage whole-tree over-blocking fixed the same date, CHANGELOG 2026-08-05)
were the direct cause of a learning stall: `improvements` sat 24 days stale,
`asset_verdicts` 27 days stale.

## Fix

`atlas_hook_guard.should_run()` gained a `kind` parameter, `"capture"` or
`"emit"` (default `"emit"` so any caller not yet updated keeps prior
behavior). `atlas_hook_guard.py:140-159` documents the distinction;
`atlas_hook_guard.py:162` gates `stop_hook_active` on `kind != "capture"`.
Callers updated: `plugins/atlas/hooks/ingest_session.py:29`,
`plugins/atlas/hooks/memory_capture.py:329`,
`plugins/atlas/hooks/chronicle_facet.py:155` (new hook, wired in from the
start) all pass `kind="capture"`. The circuit breaker and per-hook throttle
window in `should_run()` still apply to both kinds -- only the
`stop_hook_active` short-circuit is kind-specific.

## Evidence

- `plugins/atlas/scripts/test_atlas_hook_guard.py` covers both `kind` values.
- Full suite from `plugins/atlas`: `python3 -m pytest scripts hooks -q` -> 1042
  passed, 1 pre-existing unrelated failure
  (`test_connectors_wiring::test_every_mcp_service_has_a_bundle`, confirmed
  pre-existing by reproducing on a clean stashed tree).

## Do not regress

Any new Stop hook that only writes telemetry (not a message/block decision)
must call `should_run(..., kind="capture")`. A hook that re-emits a message
or a block decision on every Stop must use the default `kind="emit"`.
