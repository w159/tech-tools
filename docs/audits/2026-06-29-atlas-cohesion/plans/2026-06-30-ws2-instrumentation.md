# WS2 - Instrumentation wiring (re-scoped to verified reality)

Branch: atlas-ws2-instrumentation (off main, post-WS3 merge)
Baseline: main @ cc6e9ac

## Reality check (the spec predates v2.2.3 + WS1; most of WS2 is already shipped)

The program-spec WS2 list was written at audit time. Measured against the live DB
(`~/.atlas/atlas.db`) and current code, almost all of it already works:

| Spec item | Real status (evidence) |
|---|---|
| Wire `log_dispatch` via PostToolUse on Agent\|Task | DONE - `dispatch_tripwire.py:52` calls it for `DISPATCH_TOOLS`; `dispatches` table has 28 rows across 6 runs. |
| `derive_run_metrics` runs after each mirror refresh | DONE - ingest hook calls it on Stop/SubagentStop/SessionEnd/PreCompact (sextant SKILL:37); `metrics` has 44 rows. |
| `finalize_run` passes `wall_clock_s` | DONE - `finalize_run(conn, run_id, wall_clock_s=None)` exists; only 5/44 metrics rows have NULL wall_clock_s (runs without a clean end). |
| `verifier_coverage` derived | DONE - computed from `tool_calls kind='agent' target LIKE '%verifier%'` (atlas_db.py:226-231). |
| Fix tool-kind classifier (builtins were `kind='skill'`/`is_error=1`) | ALREADY CORRECT - live `tool_calls`: builtin=6861, mcp=1122, skill=97, agent=45; Read/Bash/Edit/Write all `kind='builtin'` with realistic (~7%) error rates, not all-error. |
| `SessionEnd` finalize path | DONE - `ingest_session.py` fires on SessionEnd and refreshes/derives. |
| Add new hook -> count becomes 9 | MOOT - no new hook needed; dispatch logging already rides `dispatch_tripwire`. Hook count stays 8. |

The ONE genuine gap: `recall_hits`/`recall_misses` are never populated (0/44 rows). The code
intentionally leaves them NULL (atlas_db.py:212-214) because "usable" is a judgment. The spec
chose the live-signal approach: the engine emits a recall hit/miss at its Orient memory lookup.
That is honest - the engine knows whether ITS OWN lookup returned a usable lesson - so we
implement it.

## Tasks

### Task 1 - `record_recall` + CLI (the real gap)
- atlas_db.py: add `record_recall(conn, run_id, hit: bool) -> None` that ensures a `metrics`
  row exists for the run and increments `recall_hits` (hit) or `recall_misses` (miss). Must NOT
  clobber derived columns (the `derive_run_metrics` upsert at :247-255 already omits the recall
  columns, so a COALESCE-based increment is safe across refreshes).
- Append a CLI verb to the `__main__` block: `record-recall <session> hit|miss` (resolve run via
  `current_run_id or latest_run_id`, mirroring `mark-orchestrating`).
- [ ] Check: a unit test in `scripts/test_atlas_db.py` (RecallSignalTest) - start a run, record 2
  hits + 1 miss, assert `run_metrics` shows `recall_hits=2, recall_misses=1`; then call
  `derive_run_metrics` and assert recall values are UNCHANGED (not clobbered).

### Task 2 - atlas-engine Orient emits the signal + doc reconcile
- atlas-engine/SKILL.md Orient step: after the memory lookup (claude-mem / mem-search), record
  the outcome once: `record-recall "${CLAUDE_CODE_SESSION_ID}" hit` if the lookup returned a
  usable lesson, else `... miss`. Use the same CLAUDE_CODE_SESSION_ID lesson from WS1.
- atlas-sextant/SKILL.md: update the recall description (currently "intentionally NOT derived",
  ":212-214 / :37 / :53-54") to: recall is now recorded live by the engine Orient signal
  (hit=usable lesson returned, miss=empty/none), and may still be refined by sextant on review.
- [ ] Check: `grep -n "record-recall" plugins/atlas/skills/atlas-engine/SKILL.md` present and uses
  `${CLAUDE_CODE_SESSION_ID}`; `grep -n "intentionally NOT derived\|intentionally not derived"
  plugins/atlas/skills/atlas-sextant/SKILL.md` returns nothing stale (claim updated).

### Task 3 - characterization tests + evidence (lock in what already works)
- Add `hooks/test_dispatch_logging.py`: drive `dispatch_tripwire` with an `Agent` PostToolUse
  payload (in an orchestration run) and assert a `dispatches` row is written with the
  `subagent_type`; drive it with a `Read` payload and assert NO dispatch row.
- Add a classifier characterization test in `scripts/test_session_ingest.py` (if not already
  covered): builtin tool names -> `kind='builtin'`, MCP names -> `kind='mcp'`, Agent -> `agent`,
  with `is_error` from the real result (not forced to 1).
- [ ] Check: full suites green - `python3 -m unittest discover -s hooks -p "test_*.py"` and
  `... -s scripts -p "test_*.py"`. Capture a live-DB snapshot (dispatch/kind/metric counts) to
  `docs/audits/atlas-cohesion-2026-06-29/evidence/ws2-instrumentation.md`.

### Task 4 - propagation
- Hook count stays 8 everywhere (no change needed; confirm no doc now claims 9).
- If the sextant SKILL or plugin.json describes recall as underived, update to the live-signal
  reality (Task 2 covers sextant; check plugin.json).
- [ ] Check: `grep -rn "becomes 9\|nine hooks\|9 automation" plugins/atlas` returns nothing.

## Acceptance (whole workstream, honest version)

A scripted run that dispatches 2 agents + 1 verifier and records 2 recall hits + 1 miss yields
`dispatches=3`, `verifier_coverage>0`, `recall_hits=2`, `recall_misses=1`, and builtin tool calls
classified `kind='builtin'` with real error flags. The first four minus recall were already true;
recall is the net-new wiring. Evidence captured under `.../evidence/ws2-instrumentation.md`.

## Out of scope (YAGNI)
- No new hook (dispatch logging already exists). No schema change beyond using existing recall cols.
- No backfill of recall on historical runs (forward-only signal).
