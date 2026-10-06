# Verify: dashboard stale-daemon fix (atlas 10.1.2)

Written by atlas:verifier (agent VerifyDaemonFix); copied here by the lead because the verifier role cannot Write under .atlas/evidence.

| # | Claim | Verdict |
|---|---|---|
| 1 | Reuse only if db ok and version present and >= mine; missing/older -> stop + respawn; newer kept | CONFIRMED |
| 2 | /api/health `version` == plugin.json 10.1.2 | CONFIRMED |
| 3 | The old behavior fails the new tests (new tests run against HEAD~1 script: 9 failed, 3 passed) | CONFIRMED |
| 4 | New ensure tests leave the real pidfile and log alone, spawn nothing | CONFIRMED, caveat below |
| 5 | `pytest hooks scripts`: 2230 passed, 3 skipped, 0 failed | CONFIRMED |
| 6 | Docs and versions (marketplace.json, plugin.json, both CHANGELOGs, dashboard-api.md) | CONFIRMED; docs/CHANGELOG wording overstated "live daemon replaced" (corrected by lead) |
| 7 | SessionStart runs `atlas_dashboard.py ensure` (session_boot.py:891, skipped only when ATLAS_DASHBOARD is off) | CONFIRMED (code path) |

Caveats from the verifier
- UNVERIFIED: a real 9.x/10.0.1 -> 10.1.2 upgrade on a user machine. The earlier "live daemon replaced" observation was a side effect of hooks/test_session_boot.py, not an upgrade.
- hooks/test_session_boot_db.py (2 calls) and hooks/test_atlas_contract.py (3 calls) still ran a real `ensure` against port 7421 (open finding dashboard-test-ensure-leak); a follow-up isolates them.
- `stop_daemon` falls back to `lsof -ti tcp:<port>` and SIGTERMs every PID returned, which can include connected clients (a browser SSE stream). Predates this fix; not reproduced.

Raw per-claim command output: agent://VerifyDaemonFix and local://verify-daemon-fix.md in the omp session.
