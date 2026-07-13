# Roadmap

Newest activity on top. Items move from Backlog -> In Progress -> Done.

---

## Done

### Atlas v5.0.0 -- skill consolidation: mythology retired, 21 plain names, armada split out, runtime-evidence gate (resolved 2026-07-12)

Skill consolidation driven by session forensics: a mined 4.7-hour production
session (38 dispatches, 1 skill auto-invocation) showed the mythological names
never routed, the fleet was 3x its working set, and verifiers confirmed changes
the running app contradicted. Breaking release.

- Mythological names retired; fleet collapsed 27 -> 21 skills. atlas-metis ->
  atlas-orchestrate; atlas-chronos -> atlas-loop; atlas-odysseus -> atlas-ux-test.
  atlas-athena, atlas-ariadne, and atlas-argus merged into atlas-audit. atlas-olympus,
  atlas-hephaestus, atlas-hermes, and atlas-doctor merged into atlas-setup.
  atlas-nestor deleted.
- armada split into its own plugin (`plugins/armada`): the 3.0 MB org-deployment
  tree and the 11 armada-* department agents moved out of atlas; atlas alone now
  carries 12 core agents. New marketplace entry.
- Runtime-evidence gate. `verified` now requires runtime parity: user-facing
  changes need an atlas:ui-runtime-tester pass or observed live behavior in
  the same wave; schema-touching backend changes need migration parity with
  the environment the user runs.
- Manifests made honest. plugin.json, .kimi-plugin/plugin.json, marketplace.json,
  README.md, and the setup references rewritten for the 21-skill fleet.
- Follow-up (same day): README rewrite to correct the 12-plugin catalog mismatch.
  New README mirrors on-disk state (Claude Code marketplace: 2 plugins; Kimi
  manifest: 12 plugins without `armada`; mcp_servers/: 11 entries; plugins/:
  2 plugin folders). See `docs/CHANGELOG.md` 2026-07-12 README rewrite entry
  and `plugins/atlas/CHANGELOG.md` 5.0.0 sub-bullet.

Plugin version 4.0.0 -> 5.0.0 (`plugins/atlas/.claude-plugin/plugin.json:3`).
See `plugins/atlas/CHANGELOG.md` 5.0.0 entry for the full per-skill breakdown
and `docs/CHANGELOG.md` v5.0.0 entry for the rollup.

### Atlas v4.0.0 -- skills mastery rebuild: 184-skill fleet (resolved 2026-07-11)

Full atlas skills mastery rebuild. 184 skills (28 top-level plus 156 armada
across 11 departments) rebuilt to the Claude Code Skills Mastery Framework
standard. All 11 armada departments independently verified by fresh
atlas:verifier passes. S10 content fixes verified (security audit-rubric
directive, engineering Sentry allowed-tools, manual-vs-auto-map 184/28,
em-dash removal). Plugin version 3.3.0 -> 4.0.0
(`plugins/atlas/.claude-plugin/plugin.json:3`).

9 reserved placeholder directories (0-line SKILL.md, will not auto-trigger)
remain as advisory items, not deleted (Law 6): 3 hr, 5 finance, 1
engineering. See `docs/CHANGELOG.md` v4.0.0 entry and
`plugins/atlas/CHANGELOG.md` 4.0.0 for full detail.

### Atlas v3.1.2 + v3.1.3 -- Windows invalid-path filenames (2026-07-10)

Fixed the Windows `git error: invalid path` that blocked syncing any repo
containing atlas-generated files with colons in their names.

- v3.1.2 (commit `940087e`): slugged the two audit-output writers -
  `atlas-audit/SKILL.md:84-95` (charts + handoffs) and
  `atlas-audit/SKILL.md:87` (finding handoffs).
- v3.1.3: an independent atlas:verifier confirmed 3.1.2 but found the same
  defect class still live in the general atlas-orchestrate naming conventions and
  atlas-loop. Closed by defining one canonical filesystem-safe slug rule in
  `atlas-orchestrate/references/docs-ssot.md` "Naming conventions" and pointing
  `atlas-loop/SKILL.md` and `session-lifecycle.md` at it.

Verified with observed-behavior proof
(`docs/evidence/2026-07-10-cartographer-slug-fix.md`, all 7 real failing names
become Windows-valid) and an independent atlas:verifier verdict
(`docs/.run/findings.json`).

Follow-up still open: rename the colon files already committed to
`gwh-firstrespondersapp` (colon -> hyphen) from a macOS/Linux checkout - the
generator fix does not touch files that already exist in that repo.

## Backlog

### Atlas v3.1.0 follow-ups (added 2026-07-09)

- Post-release smoke test: reload plugins (installed cache is still 3.0.2), open a
  fresh session, confirm the ATLAS output-style header appears without /config
  selection and the arm/deny behavior engages live. Everything shipped is verified
  at the code/test level but [unverified live] until the reload.
- Codex token fidelity: persist all token_count deltas, not just the one nearest
  each stored message (~59% of events currently discarded -> systematic
  undercount; see `plugins/atlas/skills/atlas-audit/SKILL.md:270-280`).
- `context_tool_health()` agent filter: totals currently blend claude and codex
  token regimes once codex rows exist (`plugins/atlas/scripts/atlas_db.py:846-854`).
- Classifier arm-precision monitoring: use sextant (runs.orchestrating vs actual
  dispatches) to measure real-world false-arm rate of the accepted dual-use-verb
  residual (audit/investigate/debug/profile/harden).
- atlas_doctor marketplace-source repair: pre-existing FAILs (installed cache
  tracks henssler-financial remote, expected w159/atlas per
  `plugins/atlas/.claude-plugin/plugin.json:8`; the marketplace name itself
  is `atlas` per `.claude-plugin/marketplace.json:3`, and the marketplace
  now lists 2 plugins, not 12) - run
  `python3 plugins/atlas/scripts/atlas_doctor.py --fix` then reload plugins.
- Improvement #28 (user-gated): one-line global CLAUDE.md rule that the Skill tool
  is only for listed skills (34 historical Skill(bash/read/write) misfires, 100%
  error rate).

### Atlas context/cost tuning recommendations (carried from Phase 3)

Surface autocompact and thinking-token budgets plus model routing as recommend-then-confirm options
(modeled on ECC), opt-in only. Not yet implemented.

## In Progress

Nothing in progress.

## Done

### Atlas v3.1.0 -- enforcement teeth, fork doctrine, multi-agent chronicle, de-overlap (resolved 2026-07-09)

Eleven-stage orchestrated overhaul, every stage independently verified in a fresh
context (`docs/.run/findings.json`): arm-early classifier + two-tier tripwire
(PreToolUse deny) + completion-gate condition (g); verifier coverage re-sourced to
the dispatches table; fork routing doctrine (CLAUDE_CODE_FORK_SUBAGENT=1 enabled
globally, exercised live by the critic and curator forks this run);
force-for-plugin output style; observer-session exclusion + purge of 14,078
polluted rows (`docs/evidence/2026-07-09-observer-purge.md`); codex ingest adapter
+ 170-session backfill (`docs/evidence/2026-07-09-codex-backfill.md`); de-overlap
of 33/40 asset descriptions; docs synced; 115/115 tests; 3.0.2 -> 3.1.0. See
`docs/CHANGELOG.md` and `docs/plans/atlas-overhaul-3.1.0.md`.

### Atlas v2.3.0 -- cohesion program (resolved 2026-06-30)

WS1 orchestration marker + hook gating; WS2 recall signal; WS3 graphify per-root scoping +
non-interactive size gate; WS4 knowledge-graph hub + `/atlas-launch` (15 -> 16 launchers); WS5
adoption memo + `/atlas menu` + claude-mem worker-runtime conventions + supermemory-to-cloud. Each
workstream independently reviewed before merge. Plans/evidence under
`docs/audits/atlas-cohesion-2026-06-29/`.

A follow-on `atlas-audit` self-improvement pass (post-WS5) added two more fixes under the same
2.3.0 release: the `dispatches` run-health metric was recomputed from a live `COUNT(*)` instead of
a stale first-Stop snapshot (`plugins/atlas/scripts/atlas_db.py:380-397`), and `session_boot.py`
gained an auto-derived "Resuming &lt;project&gt;" block on SessionStart
(`plugins/atlas/hooks/session_boot.py:31-216`). See `docs/CHANGELOG.md` for full detail and the
related global-instructions cross-references.

### Atlas v2.2.3 -- run-kind tagging, docs-freshness gate, late-dispatch hardening, docs SSOT backfill (released 2026-06-29)

Four items extending the observability work from v2.2.1/2.2.2.

- Run-kind tagging: add `run_kind` (orchestrator/worker) to the `runs` table so Trends aggregates
  exclude leaf worker sessions from run-health metrics.
  (`plugins/atlas/scripts/atlas_db.py`)
- Docs-freshness advisory completion gate: `completion_gate.py` emits a one-time advisory when
  `docs/CHANGELOG.md` or `docs/ROADMAP.md` are stale relative to the last skill/hook change.
  (`plugins/atlas/hooks/completion_gate.py`)
- Late-dispatch drop hardening: `current_or_last_run_id` helper so post-Stop hooks never lose
  metric derivation when `current_run_id` is NULL after Stop. (Extends the `latest_run_id` fix
  from v2.2.2.)
  (`plugins/atlas/scripts/atlas_db.py`)
- Docs SSOT backfill: bring `docs/CHANGELOG.md`, `docs/ROADMAP.md`, and `docs/AGENTS.md` current
  with v2.2.1 and v2.2.2 (previously only in `plugins/atlas/CHANGELOG.md`).
  (`docs/CHANGELOG.md`, `docs/ROADMAP.md`, `docs/AGENTS.md`)

### Atlas v2.2.2 -- run-metrics population fix and defect corrections (resolved 2026-06-29)

Three defects in v2.2.1 left `est_context_tokens`, `verifier_coverage`, `parallel_waves`,
`in_flight_peak`, and `wall_clock_s` NULL on every live (non-test) run: `derive_run_metrics`
was never called from `ingest_transcript`; `finalize_run` defaulted to NULL instead of
`now - started_at`; the COALESCE order in the upsert overwrote finalize's wall clock with the
transcript span. All three corrected. Also: `trends()` returns the full metric set;
`latest_run_id()` added so post-Stop hooks attach regardless of ordering.
Commit 1d0f6c4. (`plugins/atlas/scripts/atlas_db.py:179`, `plugins/atlas/scripts/atlas_db.py:276`,
`plugins/atlas/scripts/atlas_db.py:325`, `plugins/atlas/scripts/session_ingest.py`)

### Atlas v2.2.1 -- session transcript ingestion, hook exec-bit fix, run metrics (resolved 2026-06-26)

Adds a session-forensics lens to atlas-audit: five new mirror tables (session_logs, messages,
tool_calls, user_prompts, signals) in the observability DB, populated by a new
`hooks/ingest_session.py` wired on Stop/SubagentStop/SessionEnd/PreCompact, and six read helpers.
Fixes the hook exec-bit defect (dispatch_tripwire.py shipped 0644; all hooks now invoked via
`python3 "${CLAUDE_PLUGIN_ROOT}/hooks/X.py"`). Adds `derive_run_metrics()` for wall_clock_s and
est_context_tokens. 15-test suite green. Plugin bumped 2.0.0 -> 2.2.1.
Commit 0c792dd. (`plugins/atlas/scripts/atlas_db.py:44-83`, `plugins/atlas/hooks/hooks.json`,
`plugins/atlas/scripts/session_ingest.py`, `plugins/atlas/scripts/atlas_db.py:268`)

### Atlas redesign -- final 8-skill set, observability DB, de-hardcoded swarms (resolved 2026-06-25)

atlas-loop renamed to atlas-loop, atlas-connectors renamed to atlas-setup, atlas-self-improving
replaced by atlas-audit (SQLite observability DB + metric-backed improvement proposals).
atlas-uxt-swarm and atlas-operating-contract removed; their work absorbed by atlas-ux-test and
atlas-orchestrate respectively. Two new swarms added: atlas-ux-test (app-discovering UX swarm with
no hardcoded routes) and atlas-audit (discovery-first quality/security/OWASP audit swarm).
Manifests, README, capability-catalog, capability-routing, and marketplace.json all reconciled to
the final 8-skill set. plugin.json bumped 1.2.1 -> 1.3.0.
(`plugins/atlas/.claude-plugin/plugin.json`, `plugins/atlas/README.md`,
`plugins/atlas/skills/atlas-orchestrate/references/capability-catalog.md`,
`plugins/atlas/skills/atlas-orchestrate/references/capability-routing.md`,
`.claude-plugin/marketplace.json`)

### Connector .mcpb bloat fixed + marketplace install repaired (resolved 2026-06-23)

The canonical packer dragged each file:-linked vendor lib's iCloud
`node_modules.nosync.noindex` twin into the bundle, ballooning 5 connectors to
25-100M (spanning 99M, a hair under GitHub's 100M push limit). Two earlier packer
variants tried to fix this but their regexes missed the `.nosync` twin. Fixed
`mcp_servers/_shared/pack-mcpb.js` (dereference symlink + drop nested
`node_modules` and `.nosync*`), propagated to all 10 per-server copies (now one
md5), and rebuilt the 5 oversized bundles staged in /tmp: spanning 99M->2.78M,
blumira 60M->2.61M, vanta 51M->2.77M, threatlocker 47M->2.76M, paylocity
25M->2.77M. Each verified credential-free launch with full tools/list. Atlas now
ships all 10 slimmed connectors under `plugins/atlas/mcp/` with an added
`extract.sh` search path so its declared connectors resolve standalone. Also fixed
`bash_advisor.py` exec bit (git mode 100644->100755). Details in CHANGELOG
2026-06-23. Diagnosis: was the dominant cause of connector-heavy plugins not
appearing in a Claude Desktop marketplace install.

### Atlas optimization (Phases 1-3) -- shipped and verified (resolved 2026-06-23)

Skill renames (atlas-* prefix), loop-library + atlas-loop, all 10 connectors (disabled, extract-on-demand),
project self-improvement settings, Architect Mode + no-args scan, ponytail/loop-library/connector
discovery, session-lifecycle docs, and the opt-in visual layer (colored subagents, output style,
statusline). All additive/opt-in; independently verified zero-degradation. Details in CHANGELOG 2026-06-23.

### ThreatLocker approve tool -- shipped; API-limited to approve only (resolved 2026-06-22)

`threatlocker_approvals_approve` added (DESTRUCTIVE, POST /ApprovalRequest/ApprovalRequestPermitApplication).
No deny tool: the ThreatLocker Portal API exposes no deny endpoint; deny must be done in the
Portal UI. Documented in `docs/vendors/threatlocker/README.md`.
(`mcp_servers/threatlocker-mcp/src/domains/approvals.ts`)

### Error-envelope HTTP classifier -- FORBIDDEN/NOT_FOUND/RATE_LIMITED now correct (resolved 2026-06-22)

`_shared/error-envelope.ts` `classifyError()` now reads `statusCode` and `response` in
addition to `status`, so vendor HTTP errors classify correctly instead of falling through to
INTERNAL_ERROR. Affects node-threatlocker and node-vanta.
(`mcp_servers/_shared/error-envelope.ts`)

### Auvik verb-first description pass -- all 39 tools updated (resolved 2026-06-22)

All 39 auvik-mcp tool descriptions rewritten verb-first. No tool count change.
(`mcp_servers/auvik-mcp/src/domains/`)

### Blumira DESTRUCTIVE/VISIBLE-TO-OTHERS risk-prefix pass -- 6 tools updated (resolved 2026-06-22)

Six blumira-mcp tools prefixed DESTRUCTIVE or VISIBLE-TO-OTHERS per the tool-quality contract.
(`mcp_servers/blumira-mcp/src/domains/`)

### Vanta README and vitest suite -- 20 specs added (resolved 2026-06-22)

vanta-mcp received a README.md and 20 vitest unit specs covering the main domain handlers.
(`mcp_servers/vanta-mcp/README.md`, `mcp_servers/vanta-mcp/src/__tests__/`)

### Ramp connector -- removed; no wireable endpoint exists (resolved 2026-06-22)

Decision reversed from "pending." Ramp publishes no hosted MCP endpoint. The five ramp-*
skill folders were deleted and all Ramp references removed from the finance plugin manifest
and marketplace.json. To restore: recover from git history and follow the pax8/pandadoc
`.mcp.json` pattern if Ramp ships an official MCP server in the future.
(`plugins/finance/skills/`, `plugins/finance/CONNECTORS.md`,
`plugins/finance/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)

### Marketplace keyword parity fix -- all 12 plugins in sync (resolved 2026-06-22)

Keyword lists in `.claude-plugin/marketplace.json` brought into parity with each plugin's
`plugin.json`. Three plugins patched: finance (+pax8, +pandadoc), it-operations (+endpoint),
security-compliance (+email-security). All 12 plugins now match; marketplace.json valid.
(`.claude-plugin/marketplace.json`)

> Note (2026-07-12, v5.0.0): the Claude Code marketplace was reduced to 2 plugins
> (`atlas`, `armada`); the 11 legacy domain plugins still ship via the Kimi manifest
> at `.kimi-plugin/marketplace.json` and are no longer Claude Code marketplace entries.

### Phase 3 -- finance connectors wired, nudge standalone, ASCII normalization (shipped 2026-06-22)

All three open decisions from Phase 2 resolved (finance wiring, nudge plist, ASCII sweep).
See `docs/CHANGELOG.md` Phase 3 entry dated 2026-06-22.

- finance: pax8 + pandadoc connectors wired via `.mcp.json`; `plugin.json` bumped 1.3.0 -> 1.4.0;
  userConfig keys verified against `${user_config.*}` references.
  (`plugins/finance/.mcp.json`, `plugins/finance/.claude-plugin/plugin.json`)
- productivity/nudge: macOS launchd/plist dependency removed; command is now OS-agnostic;
  plist template question resolved by dropping the launchd approach entirely.
  (`plugins/productivity/commands/nudge.md`)
- ASCII normalization: 0 non-ASCII codepoints confirmed across all 12 plugins, `_templates/`,
  and `CLAUDE.md`. Em/en dashes, arrows, box-drawing, emoji, math symbols all replaced.
  (`plugins/_templates/`, `plugins/CLAUDE.md`, all 12 plugin clusters)

> Note (2026-07-12, v5.0.0): the "all 12 plugins" referenced here are the pre-v5.0.0
> Claude Code marketplace shape. The Claude Code marketplace now lists 2 plugins
> (`atlas`, `armada`); the 11 legacy domain clusters still ship via the Kimi manifest.
- Re-verification: 362 frontmatter files, 0 PyYAML failures; marketplace.json 12/12 matches disk.

### Phase 2 -- marketplace-wide hygiene (shipped 2026-06-22)

All items verified; 0 PyYAML failures across 362 frontmatter files.
See `docs/CHANGELOG.md` entry dated 2026-06-22 (Phase 2 section).

- plugin-dev validation sweep: all 12 non-atlas plugins validated; marketplace.json 12/12.
- Frontmatter re-verify: 2 CRITICAL YAML corruptions fixed; 12 non-ASCII frontmatter files
  corrected across hr-payroll, finance, engineering, data clusters. 362 files, 0 failures.
  (`plugins/finance/skills/ramp-api-patterns/SKILL.md`,
  `plugins/engineering/skills/dead-code-cleanup/SKILL.md`)
- .env.template backfill: confirmed already complete (prior work resolved obs #13987).
- README stale-name fixes: root README.md and plugins/it-operations/README.md corrected;
  leaked personal path removed from plugins/productivity/commands/nudge.md.
  (`README.md`, `plugins/it-operations/README.md`, `plugins/productivity/commands/nudge.md`)

> Note (2026-07-12, v5.0.0): this README stale-name fix is superseded by the v5.0.0
> README rewrite (343 lines, US-ASCII, 0 banned chars) and its 2026-07-12 follow-up
> correcting the 12-plugin catalog mismatch. See `docs/CHANGELOG.md` 2026-07-12
> follow-up entry for the rollup.

### Phase 1 -- atlas plugin optimization (shipped 2026-06-22)

All items below were independently verified by atlas:verifier (verdict: CONFIRMED).
See `docs/CHANGELOG.md` entry dated 2026-06-22 and
`docs/evidence/2026-06-22-atlas-hook-contract.md` for smoke-test evidence.

- Hard hook contract established: no atlas hook emits `permissionDecision` or exits 2.
  (`plugins/atlas/hooks/bash_advisor.py`, `plugins/atlas/hooks/hooks.json`)
- `bash_guard.py` renamed to `bash_advisor.py`, rewritten advisory-only; catastrophic-command
  list narrowed to four near-irreversible patterns; old "ask" list removed.
  (`plugins/atlas/hooks/bash_advisor.py`)
- `session_boot.py` orchestrator-delegation statement strengthened.
  (`plugins/atlas/hooks/session_boot.py`)
- `completion_gate.py` docstring corrected (opt-out, not opt-in).
  (`plugins/atlas/hooks/completion_gate.py`)
- All `[orchestrate ...]` output tokens renamed `[atlas ...]` across hooks, scripts, commands.
  (`plugins/atlas/scripts/install_hooks.py`)
- Manifests corrected to 18-agent count; version bumped 1.0.1 -> 1.1.0; all launchers
  enumerated; marketplace description de-staled.
  (`plugins/atlas/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`)
- New `atlas-validate` launcher added.
  (`plugins/atlas/skills/atlas-validate.md`)
- Reliability guidance (path-exists, ToolSearch-before-deferred, timeout+retry) added to
  references and agent prompts.
  (`plugins/atlas/references/verification-and-grounding.md`,
  `plugins/atlas/references/subagent-kit.md`,
  `plugins/atlas/agents/explorer.md`,
  `plugins/atlas/agents/implementer.md`)

---

## Backlog

### Tech debt: consolidate error-envelope DRY divergence

The bug that caused CIPP and auvik to misclassify HTTP errors existed because three
servers carry private copies of the classifier instead of importing the shared module.
Consolidate `connectwise-manage-mcp/src/_shared/error-envelope.ts`,
`cipp-mcp/src/_shared/error-envelope.ts`, and `auvik-mcp/src/errors.ts` into the single
`mcp_servers/_shared/error-envelope.ts` so future classifier changes propagate everywhere
without manual synchronization. (Surfaced by 2026-06-22 error-envelope fix.)

### Tech debt: tool-description polish pass on cipp / connectwise / ninjaone / paylocity

cipp-mcp, connectwise-manage-mcp, ninjaone-mcp, and paylocity-mcp still have tool
descriptions that do not fully satisfy the quality contract (verb-first sentence, explicit
"returns X", "when an agent should call it" clause). A targeted rewrite pass similar to
the 2026-06-22 auvik pass is needed for each server.

### Tech debt: repo-wide implicit-any in .map() callbacks (TS7006)

A latent `item => ...` pattern throughout the server sources produces TS7006 implicit-any
warnings that tsup does not surface during builds. A repo-wide pass to add explicit
parameter types would catch type drift earlier and make the linter clean.

### Verify: knowbe4-mcp inlined-client error shape vs classifier

knowbe4-mcp uses an inlined HTTP client whose error shape may not match the
`{ statusCode, response }` structure the classifier now expects. Confirm a real 403 from
KnowBe4 is recognized as FORBIDDEN rather than falling through to INTERNAL_ERROR.
