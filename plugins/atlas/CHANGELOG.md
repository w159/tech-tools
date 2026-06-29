# Changelog

## 2.2.2

Makes the run-health metrics from 2.2.1 actually populate operationally, and
corrects three defects found by end-to-end testing against the live hooks.

- **`derive_run_metrics` is now wired into ingest.** 2.2.1 added the function but
  nothing called it outside tests, so `est_context_tokens`, `verifier_coverage`,
  `parallel_waves`, and `in_flight_peak` stayed NULL on every real run.
  `session_ingest.ingest_transcript` now calls it after each mirror refresh, so
  live runs populate on their own (Stop / SubagentStop / SessionEnd / PreCompact).
- **`finalize_run` defaults `wall_clock_s`.** The Stop hook calls
  `finalize_run(run_id)` with no duration, so `wall_clock_s` was NULL on every
  historical run. It now defaults to the run's elapsed time (`now - started_at`).
- **`derive_run_metrics` no longer clobbers a finalized wall clock.** Its upsert
  used `COALESCE(excluded.wall_clock_s, wall_clock_s)`, overwriting finalize's
  authoritative value with the (often zero) transcript span. Flipped to
  `COALESCE(wall_clock_s, excluded.wall_clock_s)` so derive only fills a
  wall-clock that finalize never set (backfill-only sessions).
- **`trends()` returns the full metric set.** It selected three metric columns
  while the `atlas-sextant` Trends table compares dimensions like
  `verifier_coverage` and `parallel_waves`; it now returns all of them.
- **`latest_run_id(conn, session_id)`** added: resolves the most recent run open
  OR closed, so post-Stop metric derivation attaches regardless of hook ordering.
- `atlas-sextant` SKILL.md corrected: `derive_run_metrics` marked auto-wired,
  `latest_run_id` documented, the Trends column list and the example (which used
  `current_run_id`, NULL after Stop) fixed.

## 2.2.1

Fixes a hook-spam bug and fills run-health metrics that were never populated.

- **Hook permission fix.** `hooks.json` invoked every Python hook by bare path
  (`${CLAUDE_PLUGIN_ROOT}/hooks/X.py`), which requires the file's execute bit.
  `dispatch_tripwire.py` shipped at mode 0644, so `/bin/sh` could not exec it and
  every PostToolUse logged `Permission denied`. All hook commands now run through
  `python3 "${CLAUDE_PLUGIN_ROOT}/hooks/X.py"`, so the execute bit is no longer
  required and re-packaging can never reintroduce the failure. Tracked file modes
  corrected to 0755 as well.
- **`atlas_db.derive_run_metrics(conn, run_id, session_id)`.** The `metrics`
  columns `est_context_tokens`, `verifier_coverage`, `parallel_waves`,
  `in_flight_peak`, and `wall_clock_s` had no writer and were always NULL, while
  `atlas-sextant` documented them as live signals. They are now computed from the
  transcript mirror (peak main-thread context, verifier-vs-implementer dispatch
  ratio, timestamp-clustered dispatch waves, session span). `recall_hits` /
  `recall_misses` remain intentionally un-derived - judging whether a memory
  result was usable is semantic, not a count - and the skill now marks a NULL
  there as "not yet assessed".
- `atlas-sextant` SKILL.md documents how each metric is populated and adds
  `derive_run_metrics` to the public API.

## 2.2.0

Added the session-forensics lens to `atlas-sextant`. atlas now indexes the
jsonl/json session transcripts Claude Code writes - the lossless record of every
message, tool call, tool result, and token-usage number - into the observability
DB, so sextant can see what actually happened across every session instead of
only the sparse live-event counters. This is what lets it surface, on its own,
the class of issue where the agent claimed an endpoint failed without ever
trying it.

- New `scripts/session_ingest.py`: parses transcripts incrementally by byte
  cursor (each call reads only new lines), classifies every tool call into
  builtin/skill/mcp/agent + target/server, scrubs secrets from input summaries,
  records per-message token/cache usage, and tags behavioral signals
  (assumption_admission, unverified_claim, user_correction). `--backfill` walks
  `~/.claude/projects` idempotently; one-session mode for the hook.
- New `hooks/ingest_session.py`, wired in `hooks.json` on `Stop`,
  `SubagentStop`, `SessionEnd`, and `PreCompact`. Fail-open and fast; only reads
  new bytes. Disable with `ATLAS_INGEST=off`.
- `atlas_db.py`: new `session_logs`, `messages`, `tool_calls`, `user_prompts`,
  and `signals` tables (joinable to `projects`/`runs` by `session_id`), plus the
  read helpers `tool_usage`, `idle_assets`, `context_tool_health`,
  `signal_counts`, `signal_rollup`, and `repeated_prompts`. Token totals are
  recomputed from child rows, so re-ingest never double-counts.
- `atlas-sextant` SKILL.md documents the third lens and the four questions it
  answers: used-vs-idle tools/skills/MCP/agents, context-tool (context-mode /
  claude-mem / ponytail) health, repeated user requests, and behavioral issues
  that become CLAUDE.md / rule proposals.
- Machine-generated openings (claude-mem observer instructions, continuation
  nudges, slash-command wrappers, IDE markers) are excluded from `user_prompts`
  so the repeated-request signal reflects real human asks.
- Tests: `scripts/test_session_ingest.py` (classification, secret redaction,
  result join, signal detection, token aggregates, idempotency/incremental,
  truncation reset, machine-prompt filtering).

## 2.1.0

Added the asset/context-cost lens to `atlas-sextant`. Previously the skill only
read run telemetry from `~/.atlas/atlas.db`; it had no awareness of the context
weight a session carries. It now also audits installed assets.

- New `scripts/asset_audit.py`: inventories context-loaded skills/agents
  (following the `~/.claude/{skills,agents}` symlinks), estimates each one's
  token cost, detects the project stack, scores relevance, and chooses the
  effective level per asset - `disable-here` (project `settings.local.json`)
  vs `relocate-global` - so off-stack assets that serve another project are
  never cut globally.
- Risk tiers: `AUTO` (novelty/off-stack-everywhere) auto-applies under
  `--apply` by moving (never deleting) into `~/.claude/{skills,agents}-disabled`
  with a restore manifest; `CONFIRM` is presented to the user first.
- `atlas_db.py`: new `asset_verdicts` table + `record_asset_verdicts`,
  `mark_asset_applied`, `note_asset_restore`, `suppressed_assets`,
  `asset_audit_summary`. Learning loop: a restored asset is suppressed and
  never re-flagged; `false_positive_rate` tracks taxonomy quality.
- `scripts/test_asset_audit.py`: covers the learning loop, leveling, and
  tagging. Existing `atlas_db` tests unchanged and still green.

## 2.0.0

Breaking skill renames/removal; hook count + DB path reconciliation.
