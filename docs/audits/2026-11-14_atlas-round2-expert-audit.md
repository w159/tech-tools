# Atlas round 2 expert audit (2026-11-14)

Base: main 3e9767fc (atlas 17.20.0, armada 2.3.1, programmer 1.0.4).
Ask: "Continue making improvements". This round first closes what 17.20.0 left
open, then runs new critic passes over atlas, armada and programmer.

## 1. The 1/4 wall-time goal at 8 modules: measured floor

Goal: Atlas warm wall time at most 25% of a single plain Claude prompt, same
model (claude-sonnet-5-5, effort medium), CLI start and exit excluded (warm).

17.20.0 matrix on fixture-8b (8 modules, 434 tests, n=3 per arm, all runs green):

| Arm | Mode | Runs (s) | Mean (s) |
|---|---|---|---|
| plain | warm | 46.3, 46.6, 52.8 | 48.6 |
| atlas | warm | 23.5, 22.6, 22.8 | 23.0 |
| plain | cold | 53.6, 50.9, 54.4 | 53.0 |
| atlas | cold | 29.4, 27.3, 25.9 | 27.5 |

Atlas warm is 47.3% of plain warm. The 25% target is 12.2 s.

Breakdown of one representative warm run (fixture-8b-atlas-warm-n2, 22.6 s):

| Part | Seconds | Note |
|---|---|---|
| Crew (parallel workers) | 14.3 | set by the slowest worker |
| Slowest worker model time | 10.7 | money module, one model call, 1739 output tokens |
| Lead model time | 5.7 | two calls: plan the crew, read the verdict |
| Other (tmux, irc, check gate, seal) | about 2.5 | |

Every run's slowest worker is money or ini (12.0 to 15.8 s worker wall). Each
worker already does the minimum: one model reply that writes the file and
calls `irc check`, then the supervisor stops it after a verified DONE.

Floor with the same model: slowest worker model time (10.7 s) plus the lead's two
required model calls (5.7 s) is 16.4 s, which is 33.7% of plain warm before any
tmux, check or seal time. The 25% goal at 8 modules is not reachable without
changing the model, the deliverable, or the operating contract:

- Skipping the lead's verdict call (PostToolUse `continue:false`) saves about 3 s,
  still lands near 40%, and removes the lead's own read of the result, which the
  decision-model tenet requires. Rejected.
- Splitting a module across two workers changes the deliverable (one owner per
  file). Rejected.
- A pre-started worker pool saves about 1.5 s of CLI start per wave; it does not
  move the model-time floor. Not worth the complexity at this size.

At 16 modules the same fixed costs are spread over twice the work, and 17.20.0
measured 24-26%, so the goal holds where the crew has enough parallel work.

## 2. Spinner

Problem: the band and side panel turned a braille spinner while the TODO and SUBAGENTS block, the board and the dispatch cards turned circle marks, so two glyph sets ran on screen at once. The side panel's phase spinner could also drift out of step with the band after the tenth beat.

Cause: the band and panel used a braille glyph set while the other surfaces used circle marks.

Fix: one frame loop and one glyph set. The band, the TODO and SUBAGENTS block, the side panel, the board and the dispatch cards all turn the four circle marks on the same beat. ASCII mode still turns `|/-\`.

Evidence: a new test failed before ("◐" vs "◐⠋"). The bun suite is 4133 pass, 35 skip, 0 fail; it was 4123.

## 3. Armada bundles

Problem: the shipped MCP bundles were not rebuilt from source in any check, so nothing showed whether `plugins/armada/mcp/<svc>/server.mjs` matched `mcp_servers`.

Cause: 17.20.0 shipped the bundles without a reproducible rebuild in CI (its changelog listed this as not changed).

Fix: rebuilt 11 of 12 bundles (all but auvik) from current sources; tool counts are unchanged (429 across 12 servers). Added `scripts/rebuild_armada_bundles.mjs` (pinned tsup 8.5.1, esbuild 0.28.2, Node 22; byte-reproducible), `plugins/armada/mcp/bundles.lock.json` with source and bundle hashes, the `armada-bundles` CI workflow that fails when shipped bundles differ from source, and `test_armada_bundles.py` as a local guard. The bundles grew because zod went from 4.0.0 to 4.6.7 in the rebuild.

## 4. Telemetry

Problem: sends were skipped or wrong in several cases, and the dashboard counted some things twice.

Cause and fix:

- Counting hooks did not start the hourly background send; they now do, so usage leaves the machine without waiting for a later session start.
- `ATLAS_ANALYTICS=on` did not count as the first-run notice shown, so explicit opt-ins never sent. It does now, and `send --auto` refuses before the notice.
- Crew and colony worker sessions (`ATLAS_WORKER_NAME`, `ATLAS_CREW_WORKER`) counted as sessions and active days. They no longer do.
- The hourly send stamp could erase a just-written send result. It now takes `analytics/.lock` without blocking and skips the stamp on contention. 2 tests failed before; 263 pass after.
- The anonymity check refused sends when a username or hostname equalled a public payload value (`linux`, `true`, `3.13`). It no longer does.
- `status` prints a `send:` line saying whether sending is ready, waiting for the notice or blocked.
- Dashboard: hook totals no longer double-count reason sub-keys, hooks that only fault are failures and not use, and a skill typed as a slash command is not "unused". It adds `pct`, `per_100_sessions`, `rates` and "Fix or build next" signals with evidence. This is a server change and needs a production deploy, which has not happened yet.

## 5. Crew

Problem: a hung or forking check held the supervisor far past its budget, and several failure paths ended in a crash, an unrelated pid being signalled, or a wait that never returned.

Fix and evidence:

- A check past its timeout is killed with every process it started. A 3 s budget took 49.1 s before. The timeout output keeps what the check printed.
- Checks run in their own process group; kill, Ctrl-C or a closing pane stops them.
- A check that prints non-UTF-8 bytes yields a red verdict.
- Kill only signals processes whose command line names the run; a reused pid is left alone. `_is_ours` matches the run id as a whole argv path component or a `--name <run_id>-` token.
- `wait` and `run --wait` report a supervisor that died without a summary (exit 1, `supervisor.log` tail).
- Plans with absolute or `../` owned paths, and run ids tmux cannot name, are refused with exit 2.
- Stop during a warm lead recycle starts no new lead and leaves none behind.

The crew changes were verified 6/6, including a kill of real workers.

## 6. Docs

Problem: skill commands, the reference doc and the READMEs described things the code did not do.

Fix: atlas-setup's scaffold command runs from the skill directory (from a project it failed with "can't open file scripts/scaffold_docs.py"). atlas-audit self mode backfill commands use the plugin path. atlas-doctor loads for "atlas doctor", "atlas health check" and "atlas band or HUD missing". `docs/reference/atlas-reference.md` has the hook table, gate conditions (a) to (s), counts, manual skills, slash-command form and five dead links corrected, and the `ATLAS_PINNED_PROJECTS` row for a knob no code reads is gone. The READMEs' quick start boot line and dry-run output match what the code prints. New contract tests keep skill commands, documented env knobs, doc links and reference counts matched to the code: 5 failed before, 118 pass after.

## 7. Status cache

Problem: `~/.atlas` collected `status-gates-*.json` and `status-segment-*.json` files and never removed them. Evidence: 24 cache files after one day.

Fix: `refresh_gates` now prunes both patterns older than 7 days. The current file, fresh files and unrelated files are kept, and errors are ignored. The `PruneStaleCaches` test failed before; 84 pass after.

## 8. Resolve paths

Problem: `atlas_resolve.check_paths` used `abspath`, so a symlink inside the project could point outside it and still pass.

Fix: it uses `realpath` and refuses `--paths` entries that escape the project root through a symlink. New files and in-root symlinks are still accepted. 2 tests failed before; 273 pass after. `test_atlas_resolve_paths.py` also now imports the test isolation helper, which the contract test caught.

## 9. Programmer

Problem: four checks produced mostly false findings, and one was slow enough to hit the edit hook's timeout.

Fix and evidence:

| Check | Change | Before | After |
|---|---|---|---|
| LIT001 | octal check no longer re-splits the file per literal | 8000-line file in 44 s | 1 s |
| CFG001 | loopback and test-only hosts, documentation links and env/config fallback defaults are not hardcoded endpoints | 25 findings, 84% false on the atlas corpus | 6 findings |
| SEC001 | string constants, loops over literal tuples, constant if/else values and joins of constant tuples are not SQL built from strings | 70 findings | 42 findings |
| DEM001 | str/dict value methods and `unittest.mock` attributes are not message-chain links | 15 findings, all false | 0 |
| WIN001 | flags only marker comments (leading or tagged TODO/FIXME/HACK/XXX, not prose); `print()` in `#!` scripts is program output | 14 findings, all false | 0 |

WIN001: 2 tests failed before; 126 pass after.

## 10. Armada agents and Falcon

Problem: department agents did not say where their skill library is, and Falcon had a credential leak.

Fix: department agents now name the path of their skill library and say to read it, since department skills are not registered with the Skill tool. Falcon inert-mode guidance now points to the armada plugin config instead of the atlas plugin. Falcon MCP redacts credentials and sensitive query parameters in the configured base URL shown by `falcon_status`, debug logs and auth hints; the leak was reproduced before the fix and 1505 tests pass after.

## 11. Connector hang

Problem: a connector tool call against an unreachable or hung vendor stalled or failed with an unhelpful message.

Observed: blumira and threatlocker retried silently, errors showed as "HTTP 0" or a bare "fetch failed", and POST could be retried.

Fix: a shared resilient-fetch helper in `mcp_servers/_shared`, copied byte-identical into the `node-*` libs (a test checks the copies). Calls return `NETWORK_ERROR` ("cannot reach <host>: connection refused" or "timed out after Nms") in under a second for a refused connection and at the per-request timeout (20 s, `MCP_HTTP_TIMEOUT_MS`; panos and sonicwall 60 s). Retries are bounded and idempotent-only (429, 5xx, ECONNRESET; `Retry-After` honored up to 10 s); POST is not retried. Every connector has refused-port and never-answering-server tests. Connectors also report their `package.json` version in the initialize response (all 12 had drifted), guarded by `test_connector_versions.py`.

Evidence: before, blumira and threatlocker retried silently for 7 s, and a vendor that accepted the connection but never answered left all 12 connectors with no reply in 45 s.

## 12. Test flake

Problem: the omp todo-fallback test failed about 1 run in 2 under load.

Cause: the harness read the wall clock, and the wall-clock spinner made the output vary.

Fix: the harness now uses a frozen clock.

## 13. Benchmark

Same harness as 17.20.0: claude-sonnet-5-5, effort medium, same model for the lead, the workers and the plain baseline, 4 CPUs, n=3 per cell. Warm excludes CLI start and exit; cold includes them. All 24 runs passed every test. Raw lines: /home/user/bench/matrix-fixture-8b.log and matrix-fixture-16.log (bench box only).

| Fixture | Arm | Mode | Runs (s) | Mean (s) | Tokens (k) | Atlas vs plain |
|---|---|---|---|---|---|---|
| 8 modules | plain | cold | 53.6, 48.6, 56.4 | 52.9 | 240, 245, 295 | |
| 8 modules | plain | warm | 51.4, 53.7, 50.0 | 51.7 | 295, 353, 300 | |
| 8 modules | atlas | cold | 28.3, 27.7, 28.2 | 28.1 | 145, 152, 144 | 53% time, 57% tokens |
| 8 modules | atlas | warm | 27.7, 24.7, 23.0 | 25.1 | 144, 144, 144 | 49% time, 46% tokens |
| 16 modules | plain | cold | 114.7, 112.8, 112.7 | 113.4 | 604, 556, 517 | |
| 16 modules | plain | warm | 118.6, 130.3, 116.9 | 121.9 | 614, 709, 497 | |
| 16 modules | atlas | cold | 36.8, 32.8, 34.8 | 34.8 | 216, 215, 215 | 31% time, 38% tokens |
| 16 modules | atlas | warm | 33.4, 29.3, 30.5 | 31.1 | 228, 215, 215 | 26% time, 36% tokens |

The atlas runs were about 2 s slower than the 17.20.0 matrix from earlier the same day (16 modules crew wall mean 20.6 s against 18.5 s). A read of the crew path diff found no added sleep, poll or spawn, and crew wall is 95-97% worker model time. To separate code from model latency, an interleaved A/B ran the 17.20.0 tree (git archive of HEAD) and this tree back to back, 16 modules, atlas only:

| Mode | 17.20.0 runs (s) | This release runs (s) |
|---|---|---|
| warm | 31.7, 28.6, 138.8 | 29.0, 28.7, 29.3 |
| cold | 31.9, 33.9, 30.3 (mean 32.0) | 32.5, 30.4, 28.7 (mean 30.5) |

The 138.8 s run had one worker (duration) at 128.1 s; without it the 17.20.0 warm mean is 30.2 s against 29.0 s. Verdict: this release made the crew neither slower nor faster; the matrix gap was model latency at a different hour. The 1/4 time goal is met warm at 16 modules only within noise (26%), and not at 8 modules (49%, floor in section 1).

## 14. Open

- Telemetry `_flush` writes `last_send.json` without the lock, so concurrent `_note_result` calls can lose a result. This affects the status display only.
- Crew `_group_of` and `_stop_pidfile` still match the run id as a substring of the command line. An exact-match fix passed its own failing-first tests, but one fixture in `test_atlas_crew.py` (the early green summary test, bare `crew-t` argv) needs a one-line change to the real worker shape. That edit was refused, so the fix was reverted and the call is Jerry's.
- Falcon: `falcon_status` echoed the base URL with userinfo; that is fixed, but armada-security has no Falcon coverage.
- Programmer: SEC002 reports fake and path-like values.
- `departments/*/hooks.json` is dead config.
- panos and sonicwall keep a 60 s timeout that ignores `MCP_HTTP_TIMEOUT_MS`.
- Connector tools that make sequential requests can take N times the timeout.
- `node-auvik` (not shipped) still has long backoffs.
- The telemetry dashboard server change needs a production deploy, which waits on Jerry's yes.

