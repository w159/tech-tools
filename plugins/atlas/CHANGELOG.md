# Changelog

## Unreleased

Agent-roster and spec-conformance hardening pass (audit:
`docs/audits/atlas-harden-2026-07-07/`). No version bump in this pass - release
timing left to Jerry.

- **Removed.** The five `ux-*` agent specs (`ux-cartographer`, `ux-persona`,
  `ux-fuzzer`, `ux-accuracy-oracle`, `ux-reporter`) and `api-usage-map`, each
  checked for live skill/command dispatches before deletion. `atlas-expedition` is
  now the sole canonical owner of UX testing; `ux-test-swarm.md` collapsed to a
  short pointer at that skill.
- **Routing gained three rows.** `skills/atlas-engine/references/capability-routing.md`
  now routes to atlas-architect (project boot/onboarding), atlas-engine's own
  self-entry (orchestration), and atlas-stacks (skill selection), and annotates the
  built-in/global agent-type mentions it references (`codebase-explorer`, `Explore`,
  `Plan`, `debugger`, etc.) as external to `plugins/atlas/agents/`.
- **Spec conformance.** All 12 remaining agent specs gained a structured
  Report-back section and explicit grounding rules: "I don't know" is a valid
  result, every claim must cite what was actually read, and unproven gaps stay
  marked `[unverified]`.
- **Marketplace repointed** from the stale fork to canonical `w159/tech-tools`;
  `atlas_doctor` now reports healthy with 0 problems.
- **Dev caches gitignored** so pytest/ruff cache debris and similar runtime
  artifacts stop showing up as untracked noise.

## 2.6.0

Single-sourcing release: atlas no longer carries its own copy of the ten vendor MCP
connectors. All ten `.mcpb` bundles (plus `mcp/launch.sh` and `mcp/extract.sh`, ~27 MB
total) were byte-identical duplicates of the copies already shipped by the domain
plugins (verified by SHA-256) - the domain plugins are now the single source.

- **Removed.** `plugins/atlas/mcp/` (10 `.mcpb` bundles + `extract.sh` + `launch.sh`)
  and `plugins/atlas/.claude-plugin`'s `mcpServers` key and its `.mcp.json`. The
  `userConfig` block (all vendor credential keys) was removed from
  `.claude-plugin/plugin.json` - those keys belong to the domain plugin that owns
  each vendor: it-operations (auvik, connectwise-manage, ninjaone, spanning),
  security-compliance (blumira, knowbe4, threatlocker, vanta), microsoft-365 (cipp),
  hr-payroll (paylocity).
- **atlas-harbor rewritten** as the cross-plugin connector setup guide: detects which
  domain plugins are installed (`~/.claude/plugins/installed_plugins.json`, or advises
  `/plugin`), shows enabled/disabled state per vendor by reading the *owning* plugin's
  config, and directs credential entry to that plugin's `/plugin config` - never to
  atlas. `vendors.md` updated to the same model, plus a migration note.
- **Stale references swept**: `skills/atlas-engine/references/capability-catalog.md`,
  `skills/atlas-engine/SKILL.md`, `scripts/discover_capabilities.py`,
  `commands/atlas.md`, and `README.md` no longer claim atlas ships or bundles vendor
  connectors.
- **MIGRATION.** Credentials previously configured on atlas's own plugin config (e.g.
  `paylocity_client_id`) must be re-entered on the owning domain plugin via `/plugin`
  config - atlas's copies of those `userConfig` keys are gone. Run atlas-harbor's
  no-args status scan to see current enabled/disabled state per connector.

## 2.5.0

Connective-tissue release: the orchestration machinery now engages deterministically
instead of depending on the model remembering prose, and the definition-of-done gate
covers the full docs contract (audit findings 2026-07-03).

- **Auto-set orchestration marker.** `hooks/dispatch_tripwire.py` now flags the session
  orchestrating when an orchestration skill (atlas-engine, atlas-survey,
  atlas-cartographer, atlas-expedition, atlas-orbit) is invoked via the Skill tool or when
  an `atlas:*` subagent is dispatched. The manual `mark-orchestrating` CLI remains as a
  fallback. hooks.json PostToolUse matcher extended with `Skill`. 4 new tests.
- **Completion gate widened 3 -> 6 conditions.** `hooks/completion_gate.py` now also
  requires `docs/ROADMAP.md` non-empty (d), root `README.md` non-empty (e), and no docs
  drift (f): if non-docs files changed this run but no `docs/` file did, the Stop blocks
  once and directs an `atlas:docs-curator` dispatch - drift was previously advisory-only.
  4 new tests incl. an end-to-end git-drift case.
- **Elicitation posture reversed.** atlas-engine SKILL.md and `/atlas-prompt` previously
  forbade asking the user anything; both now run one AskUserQuestion round (max 3
  questions, options + recommendation) when goal/scope/acceptance stay ambiguous after
  discovery. Discovery still answers "where/what is broken"; the user answers "what
  outcome do you want."
- **Living knowledge graph hook-in.** `agents/docs-curator.md` step 5: regenerate
  `graphify-out/graph.json` via the graphify skill whenever shipped changes touched source
  and a graph exists - the gate's drift condition makes this deterministic instead of
  optional.
- **Leftovers removed.** Deleted 5 orphan pre-rename skill dirs (atlas-connectors,
  atlas-loop, atlas-operating-contract, atlas-self-improving, atlas-uxt-swarm),
  `__pycache__`/`.ruff_cache` debris, and stale installed caches (1.0.1, 1.2.0) plus the
  obsolete w159-tech-tools marketplace clones. Verified dispatch logging live
  (90 rows in `~/.atlas/atlas.db` dispatches, incl. same-session Agent dispatches).
- **New skill + command: atlas-stacks.** AskUserQuestion-driven skill stacking: elicits
  the goal (one round), inventories the skills actually installed this session, composes
  an ordered Skill-invocation chain (atlas-engine rides along for anything substantive),
  confirms the stack with the user, then executes stage by stage. Counts: 9 skills,
  18 launchers.
- **Elicitation across every skill.** All nine skills now state when to use
  AskUserQuestion dynamically - architect (install/seed consent as multiSelect),
  cartographer (multi-root pick), survey (audit depth), expedition (target/tier),
  orbit (loop candidates + cadence), sextant (lens pick, asset-audit verdicts),
  harbor (connector multiSelect), engine + stacks (goal/scope/acceptance) - always
  "ask what only the user owns, discover everything else, one round max."
  `references/subagent-kit.md`: subagents never AskUserQuestion; they return
  `DECISION NEEDED:` lines the orchestrator batches into one question round.
- **atlas-doctor: two new checks + counting fix.** `stale-assets` scans the installed
  copy, marketplace clone, and user-level skills/agents dirs for renamed/deprecated
  ghosts (atlas-connectors/loop/operating-contract/self-improving/uxt-swarm, pre-plugin
  orchestrate/uxt-swarm/self-improving/connector-ops, and the orc-* agent squad);
  `--fix` quarantines them into a timestamped trash dir (reversible move, never rm).
  `orchestration-wiring` verifies the tripwire sees Skill/Agent/Task and auto-marks -
  the exact wiring whose absence made subagent discipline silently never engage.
  `count_assets` now counts only real assets (dirs with SKILL.md, .md files), fixing
  the phantom "skills": 9 caused by .DS_Store. 5 new tests.
- **Ghost cleanup executed.** Quarantined from the live user dirs: skills
  orchestrate.backup-*, uxt-swarm, self-improving, connector-ops (SKILL.md-less
  skeletons) and 36 orc-* agent files (the deprecated pre-atlas squad) - these were the
  "old variants" polluting the slash/agent pickers.
- Docs reconciled: `references/hooks-automation.md` (6-condition gate, auto-marker incl.
  atlas-stacks), SKILL.md definition-of-done and first-action sections, plugin.json and
  marketplace.json descriptions (nine skills, 18 launchers, elicitation posture).

## 2.4.0

atlas-doctor: detect and repair the plugin-rollback failure mode found 2026-07-01, where
the tech-tools marketplace entry tracked a stale fork (henssler-financial) with autoUpdate
on, so every marketplace update silently rolled atlas back to 1.0.1 and the subagent
engine, hooks, and skills disappeared with no error.

- **`scripts/atlas_doctor.py`.** Eight checks (CHECK), auto-repair with `--fix` (SET),
  re-check after fixing (VERIFY): marketplace source vs the canonical repo named in the
  plugin's own manifest, clone remote, installed-vs-marketplace version sync, rollback
  tripwire against a high-water mark in `~/.atlas/doctor-state.json`, install-path
  integrity incl. `.orphaned_at` GC markers, hooks wiring, and asset inventory.
  Exit 0 healthy/remediated, 1 problems remain, 2 internal error. 7 unit tests
  (`scripts/test_atlas_doctor.py`) recreate the incident in a sandbox.
- **`/atlas-doctor` command.** Runs the script, explains each PASS/FAIL, offers `--fix`,
  and reminds that `/reload-plugins` is needed after repair.
- **SessionStart rollback guard.** `atlas_doctor.py --hook` wired as a second SessionStart
  hook: warn-only, always exits 0, so a future downgrade announces itself at the top of
  the session instead of silently degrading atlas.

## 2.3.0

Atlas cohesion program (WS1-WS5) plus adoption follow-ups; each workstream independently
reviewed before merge. Plans/evidence under `docs/audits/atlas-cohesion-2026-06-29/`.

- **Orchestration marker (WS1).** Per-session `runs.orchestrating` flag set via the
  `mark-orchestrating` CLI; dispatch tripwire, completion gate, and nudge gate on it so
  non-orchestration sessions are never nagged or blocked. Hook inventory reconciled to 8.
- **Recall signal (WS2).** `record_recall` + `record-recall <session> hit|miss` CLI; the
  engine Orient step records recall hit/miss. Survives `derive_run_metrics`.
- **graphify scoping (WS3).** Per-root scoping + non-interactive size gate
  (`GRAPHIFY_NONINTERACTIVE`); repo `.graphifyignore`. Audits no longer stall on monorepo scope.
- **Knowledge-graph hub + launcher (WS4).** `scripts/build_hub.py` (file-granular
  node<->finding manifest + branded hub HTML) and the new `/atlas-launch` command closing the
  audit->remediation loop. 16 launchers.
- **Adoption (WS5).** `/atlas menu` discoverability mode; `references/memory-access.md` codifying
  claude-mem worker-runtime call conventions.

### Sextant self-improvement follow-up (post-WS5)

- **Fixed: `dispatches` metric was a stale snapshot.** `derive_run_metrics` now recomputes
  `dispatches = COUNT(*) FROM dispatches WHERE run_id=?` instead of trusting the one-shot snapshot
  `finalize_run` takes at the first Stop, which missed dispatches landing in later turns of the
  same session. Across the DB, 46 dispatch rows existed across 10 runs but only 3 metrics rows
  showed `dispatches>0`; this was a reporting bug, not a delegation gap.
  (`scripts/atlas_db.py:380-397`)
- **Added: auto-derived session resume on SessionStart.** `session_boot.py` gained
  `resume_block(root)` and three helpers (198 lines) that derive a "Resuming &lt;project&gt;" block
  from claude-mem and the atlas mirror, with zero user input required. Fail-silent. The Stop-time
  `next_step` signal needed to close the remaining gap is intentionally deferred, not shipped.
  (`hooks/session_boot.py:31-216`)
- The WS5 `memory-access.md` calling convention was promoted to the user's global
  `~/.claude/CLAUDE.md` after two further sessions still mis-called `observation_search` in worker
  runtime; the skill-scoped reference alone did not reliably load. See
  `skills/atlas-engine/references/memory-access.md:36`.

## 2.2.3

Extends the observability layer with run-kind tagging, a docs-freshness advisory
gate, and late-dispatch hardening.

- **Run-kind tagging.** Background and subagent worker sessions are now classified
  at ingest time and excluded from run-health aggregates in `atlas_db.py`. This
  fixes false "zero delegation" readings that appeared when a background worker
  had no dispatch events of its own.
- **Docs-freshness advisory gate.** `hooks/completion_gate.py` now warns to
  dispatch `atlas:docs-curator` when code files changed in a session but the
  `docs/` tree did not. The advisory is emitted before the existing completion
  check so it surfaces even when the gate is in advisory-only mode.
- **Late-dispatch hardening.** `hooks/dispatch_tripwire.py` and `scripts/atlas_db.py`
  now handle dispatches that arrive after a run is finalized: they resolve the
  target run via `current_or_last_run_id` so the late event is still logged
  rather than silently dropped.

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
