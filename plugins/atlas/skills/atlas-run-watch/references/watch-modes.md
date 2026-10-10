# Watch modes and tick recipes

Read this before arming any mode. All modes share Step 2's tick order and re-arm
discipline from `SKILL.md` (reused from `atlas-babysit-pr/SKILL.md:52-63`).

## Mode: `log:<path>` — log file tail

1. Resolve the path (must exist and be readable; else 🚫 blocked).
2. On open: record byte size in `offset`, copy the full log to `full.log`.
3. Each tick: run the canonical tick recipe in `SKILL.md` Step 2 — read only bytes past `offset`, spill to `full.log`, update `offset`, one checkpoint line.
4. Terminal condition: a user-supplied success/failure pattern (e.g. "epoch 50/50", "Traceback (most recent call last)"), or the log goes quiet past `interval` × 10 (report, do not stop silently — say the watch went quiet and ask).

## Mode: `pid:<pid>` — process watch

1. `kill -0 <pid>` — alive check is the terminal check (Step 2.1).
2. If the user supplied a log path, run it as a `log:` watch too (PID + log = one ledger entry).
3. No log path: each tick reports `ps -o pid,etime,%cpu,%mem,command -p <pid>` — one compact line, never the full `ps` table.
4. Process gone → check exit semantics the user supplied (a service "exiting" may be normal completion or crash; never guess — report what was observed).

## Mode: `ci:<url-or-run-id>` — CI URL / API

1. GitHub Actions: arm the `xd://github` device `run_watch` op per `atlas-babysit-pr/references/ci-classification.md:7-17` (`{"op": "run_watch", "run": "<id>", "tail": 50}`). Its failure artifact is the `full.log` equivalent — cite its `artifact://<id>` path, never paste.
2. Any other CI (Jenkins, GitLab, raw URL): fetch status fresh each tick (curl or the platform CLI if installed). Parse only status fields; if the response body is the evidence, save it to `runs/<id>/full.log` and pass the path.
3. No device, no CLI, no network access → 🚫 blocked with the missing capability; never fake CI state from memory (`ci-classification.md:26`).

## Mode: `cmd:<command>` — arbitrary command loop

1. Run the command once per tick with output redirected to the run ledger: `cmd 2>&1 | tee -a .atlas/.run/runs/<id>/full.log` — the context only sees what you choose to show (last N lines via `tail`, on request).
2. Exit 0 → ✅ completed. Nonzero → classify per `SKILL.md` Step 3 (flaky signals get ONE bounded re-run; then genuine).
3. Never run a mutating or destructive command from this mode without explicit user consent in the invocation — this loop re-executes whatever you were handed.

## Cross-mode rules

- One capture per tick, everything judged against it (`ci-classification.md:29-35` stale-capture rule).
- Empty/quiet result ≠ state knowledge: bounded wait, then fresh arm (`ci-classification.md:22-24`).
- The ledger path is the evidence handle in every report and dispatch; full logs and response bodies live there, never in context (`ci-classification.md:19-21`).
