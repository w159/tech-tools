# Roadmap

Newest activity on top. Items move from Backlog -> In Progress -> Done.

---

## In Progress

- [in-progress] Colony rebuild on herdr (2026-10-07, atlas 10.1.2): vendored
  herdr-web-ui + pinned herdr 0.9.3, `/atlas/**` gateway, herdr transport,
  `atlas_remote.py`, `session_boot.ensure_colony` are documented in
  `docs/atlas-colony.md` and covered by unit and fixture tests (fake herdr
  socket, fake tailscale). Not yet observed end to end here: a full
  lead -> `atlas_launch` -> real herdr pane -> dashboard IRC prompt delivery
  round trip on a clean machine, a first-run `bun install` + build via
  `session_boot`, and a phone reaching the `tailscale serve` URL. To close:
  run those three on a fresh install and record the result.
- [in-progress] atlas 9.5.1 is verified in source, but source/installed parity is
  only enforced opportunistically: `InstalledParityContract`
  (`hooks/test_atlas_contract.py:579`) skips while the installed plugin cache is not
  at the manifest version and re-arms after a reinstall.
- [in-progress] Gate conditions (i) and (j) are verified against fixtures and
  mutation-checked, but never against a live payload: this session's toolset has
  no `TodoWrite`, so no real TodoWrite tool_use has passed through `_open_todos`,
  and no real `isolation: "worktree"` dispatch has passed through the tripwire.
  To close: after reinstall, run one orchestration task that writes a todo list
  and dispatches an isolated writer, then `Stop`. Expected: the gate blocks with
  "(i) Todo list not drained" until the list is completed, and with "(j) N git
  worktree(s) from this run are still on disk" until the trees are merged and
  removed. The durable-board/LEDGER drain fallback is fixture-verified as of
  5.26.0 (`TodoBoardDrainTest`, 7 cases, `hooks/test_completion_gate.py:1999`); a live TodoWrite payload through
  `_open_todos` is still pending.
- [in-progress] `atlas_doctor` has no check that verifies claude-mem,
  context-mode, ponytail, lean-ctx, or serena are actually *registered as MCP
  servers* -- `context-tooling` (added 2026-09-28) only checks that a
  project's `AGENTS.md` carries the routing block that tells agents to use
  them, not that the servers themselves are reachable. `session_boot.py`'s
  existing `has_cmd()`/`detect_dep()` proxy (checks `$PATH` and importable
  Python modules) was considered and rejected as the basis for a new check:
  live on this machine, `which claude-mem` and `which ponytail` both return
  nothing even though claude-mem shows 145 real `tool_calls` across 88
  sessions in `~/.atlas/atlas.db` over the last ~6 months -- it *is*
  registered and working as an MCP server, it just has no CLI binary on
  `$PATH` here. Extending that same proxy to lean-ctx/serena would risk
  exactly the false-"ABSENT" noise it already produces for claude-mem. A
  real check needs to read whatever config surface Claude Code actually
  uses to register user-scope MCP servers (not `$PATH`); that surface was
  not identified in this pass. `--fix` still cannot remediate a missing
  registration for any of the five tools either way (`repair.md` documents
  this explicitly as of 2026-09-28) -- the repair today is the manual
  install command from `install.md` Stage 1.
- [in-progress] `atlas_doctor.py --fix` on a genuinely empty `~/.claude`
  (no `installed_plugins.json`, no `known_marketplaces.json`) reports
  "FIX: cannot fix: context incomplete" rather than bootstrapping a
  first-time install. Verified live (temp `HOME`, empty `.claude/`):
  `CHECK` fails `config-readable` before any other check can run, and
  `--fix` correctly declines rather than guessing at a marketplace
  registration it cannot construct from nothing. This is arguably correct
  behavior (there is no source of truth to fix *from* on a truly first-run
  machine -- the marketplace add + `/plugin install` step has to happen
  once, by a human, before `atlas_doctor` has anything to verify), but it
  means "reproduce the behavior in any and all new installs" still has a
  manual first step that `atlas-setup`'s `install.md` documents in prose
  but no script currently automates end-to-end from a bare machine.

- [in-progress] Vendored upstream clones (aider/, claude-code/, cline/, codex/, cursor/,
  gemini-cli/, github-copilot/, pi/, windsurf/, frameworks/, vendors/) still live in docs/.
  Decision needed: move to `reference/` at repo root, or keep in docs/ as reference material.
  These carry their own nested .git dirs and are not project documentation.

## Backlog

### Residuals: atlas 10.4.0 channel repair (added 2026-10-08)

- Note `owner` is self-asserted. A process that knows a registered member's name can post as it and the note is delivered to the lead; the guard (`atlas_todo.may_post`, `worker_inbox.drain`) blocks unregistered names, not impersonation of a registered member. Fix would need an identity the poster cannot choose (for example a per-worker token minted at registration).
- Workers started outside `atlas_launch`, `atlas_mux spawn` or a dispatch are not registered (`_register_worker` self-registration was removed). Their notes land on the main channel and never reach a lead or clear completion gate (p). Register such workers through the lead side if they must take part.
- omp `InstalledParityContract` (`hooks/test_atlas_contract.py`, three tests) skips with "atlas not installed at the manifest version" until atlas 10.4.2 is installed; it compares the repo hooks (`completion_gate.py`, `dispatch_tripwire.py`, `worker_inbox.py`) with the installed copy once it is. Users must update or reinstall atlas from the marketplace and restart the session; until then a live session keeps the old inbox and gate behavior.
- Colony pid identity (10.4.2) compares `ps` `lstart` (1 s resolution): a pid reused within the same second as the member's start would still match and be signalled by Kill.
- Worker exemption (10.4.1) trusts `ATLAS_WORKER_NAME`: a session that sets it itself escapes the dispatch tripwire and arming, the same trust model as the omp leaf marker. Closing it needs a worker identity the process cannot choose (see the note-owner residual above).

### Atlas 9.0.0 follow-ups (added 2026-10-05)

- Four duplicate reference-file pairs found during the skills best-practices
  pass were reported but not merged: `workflow-template.md` x2 (identical),
  `graphify-wiring.md` x2 (identical), `self-telemetry.md` x2 (differ by 3
  lines), `docs-ssot.md` x2 (differ by 61 lines). Decide whether to merge to
  one canonical copy per pair or keep both with a documented reason.
- The 9.0.0 omp fixes (`atlas_mux.py` `FORWARDED_ENV` widening (tmux-era;
  as of 2026-10-07 workers are herdr panes by default and `FORWARDED_ENV` is
  applied by `pane_env`/`pane_command`, see `docs/atlas-colony.md`), omp
  plugin-enablement detection via `omp-plugins.lock.json`, the
  `outputStyle`/`TodoWrite`-gating fixes in `omp/style.ts` and
  `hooks/session_boot.py`) were verified by `bun test` (245 pass, 0 fail) and
  pytest only. Live-omp verification of the 9.0.0 fixes is still needed; omp now
  has atlas 9.5.1 installed (lock + node_modules), so the fixes can be checked in a
  live session. Re-run the paired Claude Code / omp
  benchmark in `docs/atlas-harness-parity.md` against a live 9.0.0 omp
  install once upgraded.
- Evaluate the 47 rewritten SKILL.md descriptions for trigger accuracy against
  Anthropic's testing checklist (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):
  run realistic prompts through Haiku, Sonnet, and Opus and confirm each
  skill is selected on relevant prompts and skipped on irrelevant ones. Not
  done in the 9.0.0 release; descriptions were rewritten to the structural
  checklist (third person, "Use when ...", length limits) but not behaviorally
  evaluated against multiple models.
- Write at least three realistic evaluation prompts per skill (per the same
  Anthropic checklist) to catch description regressions going forward. Not
  done in the 9.0.0 release.
- Pay down the findings recorded in `fallow-baselines/` (added with 9.0.0 so the
  fallow commit/push gate stops failing on code this release does not author).
  The baselines are WHOLE-REPO, not only the 8.7.x omp code. Dead-code: 165
  entries (141 `mcp_servers/*`, 21 `plugins/atlas`, 2 `mcp_node/*`, 1
  `skills/webapp-testing`). Health: 145 files (113 `mcp_servers/*`, 21
  `plugins/atlas`, 10 `mcp_node/*`, plus `test-mcp-tools.mjs`). Everything in
  them is exempt from the gate until fixed. The omp part: 30 complexity
  findings, led by `omp/hook-bridge.ts` `loadBridgedHooksFor` (cyclomatic 32)
  and `omp/stop-bridge.ts` `discard` (17), `runStateArgv` in `run-state.ts`
  (9); 8 unused exports (`TURN_EVENTS`, `loadUnderscoredServers`, `hookEnv`,
  `TRANSCRIPT_SCRIPT`, `MAX_INGEST_PER_SESSION`, `REBASELINE_BUDGET_MS`,
  `DETACHED_SCRIPT`, and the `FrozenBlocks` type in `style.ts`); and duplicate
  groups in `hook-bridge.ts`. One of those groups (`hook-bridge.ts` 545-561
  vs 579-595) still shows as a `warn` in the gate's default audit. Refactor or
  remove them, then re-save each baseline with `fallow dead-code|health|dupes
  --save-baseline fallow-baselines/<name>.json` so the files only shrink.

### Bug: dashboard credential save never reaches the installed plugin for sensitive fields (found 2026-09-01)

`atlas_dashboard.py` writes connector credentials to settings.json `pluginConfigs`
and the repo `plugins/atlas/.env`. Sensitive userConfig fields (`sensitive: true`
in `plugin.json`, e.g. `threatlocker_api_key`) are read by Claude Code from secure
storage (macOS Keychain item `Claude Code-credentials`, `pluginSecrets`), and the
installed plugin cache ships no `.env`, so neither write is seen by a running
connector. Evidence and the ThreatLocker case are in `docs/CHANGELOG.md`
(2026-09-01, ThreatLocker 440) and `.atlas/.run/findings.json` S8. Fix options:
have the dashboard call the plugin configure flow, or write `pluginSecrets`
directly, and in either case stop writing a repo `.env` that only a dev checkout
reads. Until then the dashboard note must say sensitive values go through the
plugin configure prompt.

### Atlas self-improvement follow-ups (added 2026-08-05)

Chronicle/insights schema and `atlas-doctor` skill shipped this date (see CHANGELOG). One
gap remains; the other two closed in 5.6.0 (2026-08-06):

- [closed 2026-08-06] Gate-block persistence: `completion_gate.py` now writes a
  `friction_events` row per block and `chronicle_facet.py` counts it into
  `facets.gate_block_count`. Also fixed the unscoped friction delete that was erasing those
  rows. See CHANGELOG 2026-08-06 (5.6.0).
- [closed, was never open] The memory-drop test was already written:
  `test_unstorable_lesson_is_recorded_not_dropped` in `hooks/test_memory_capture.py:192`
  asserts a refused `atlas_memory.add()` lands in `friction_events`. This entry was stale,
  not a real gap. 33 tests pass in that file.
- Anonymized feedback exporter: `atlas_feedback.py` was built, then deleted at the user's
  direction after an adversarial verifier proved it leaked the user's vendor stack (MCP
  connector UUIDs, vendor tool names, internal skill codenames) into what was meant to be a
  shareable export. See `docs/decisions/no-anonymized-feedback-exporter-without-designed-in-redaction.md`.
  Facets/findings data keeps accumulating, so this can be rebuilt later with anonymization
  designed in from the start rather than retrofitted.
- [closed 2026-08-06] Phase 1 facet enrichment had no deterministic entry point.
  `atlas_doctor.py --enrich-facet <session_id> '<json>'` now validates against
  `atlas_db.FACET_COLUMNS` and writes the LLM-judged columns; the judgment stays the
  model's, the write is testable.

### Extract MCP connector servers into standalone repos (approved 2026-07-31)

Goal: deliver each of the MCP connector servers (10 when approved; `mcp_servers/` now also holds `panos-mcp`) via
`npx -y git+https://github.com/w159/<vendor>-mcp.git` instead of as folders inside this
monorepo. Approved as a follow-on target; not started. Four independent blockers confirmed
this session:

1. All 10 are folders in this monorepo, not standalone repos. `git -C mcp_servers/<name>
   rev-parse --show-toplevel` returns the tech-tools root for every one; single remote
   `https://github.com/w159/tech-tools.git`; no `.gitmodules`, no nested `.git`. npm git URLs
   have no subdirectory form, so a git+ URL today would install the whole monorepo, not one
   server.
2. 6 of 10 (as counted at approval; re-count with `grep -l 'file:../../mcp_node' mcp_servers/*/package.json` before restating) depend on local `file:../../mcp_node/node-*` paths and cannot install standalone:
   blumira-mcp, kaseya-spanning-backup-mcp, ninjaone-mcp, paylocity-mcp, threatlocker-mcp,
   vanta-mcp.
3. `dist/` is gitignored for all 10, and only 3 of 10 (blumira, cipp, threatlocker; re-count with `grep -L prepare mcp_servers/*/package.json`) have a
   `prepare` script. npm runs `prepare` (not `build`) on git installs, so the other 7 would
   install as empty packages.
4. None of the 10 are published to npm. All names are unscoped (auvik-mcp, blumira-mcp,
   cipp-mcp, connectwise-manage-mcp, kaseya-spanning-backup-mcp, knowbe4-mcp, ninjaone-mcp,
   paylocity-mcp, threatlocker-mcp, vanta-mcp).

What would unblock it, in order:
- Publish the `mcp_node/node-*` client libraries to npm.
- Replace the 6 `file:` dependencies with published npm versions.
- Add `prepare` scripts to the 7 servers lacking them, or commit `dist/`.
- Extract each server to its own repo (`w159/<vendor>-mcp`). Only `w159/atlas-connectwise`
  exists today and it is unrelated.

Interim decision (approved 2026-07-31): vendor the built servers directly into
`plugins/atlas/mcp/<server-key>/` and launch them with `node` against
`${CLAUDE_PLUGIN_ROOT}`, which works today with no registry or repo work. The npx-from-git
delivery above remains the eventual target, not the current mechanism. Vendoring work itself
is in progress and unverified as of this entry - not recorded here as done.

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
- [resolved 2026-07-29] atlas_doctor `marketplace-source`/`clone-remote` FAILs: this
  was never a marketplace-source mismatch or a fork - the GitHub repo was renamed
  `w159/atlas` -> `w159/tech-tools`, and the `atlas` plugin's own `repository` field
  (which `atlas_doctor.py` reads to derive its expected repo) still carried the
  pre-rename URL. Fixed by repointing that field, and the marketplace catalog name
  itself, to `tech-tools`; see CHANGELOG 2026-07-29.
- Improvement #28 (user-gated): one-line global CLAUDE.md rule that the Skill tool
  is only for listed skills (34 historical Skill(bash/read/write) misfires, 100%
  error rate).

### Atlas context/cost tuning recommendations (carried from Phase 3)

Surface autocompact and thinking-token budgets plus model routing as recommend-then-confirm options
(modeled on ECC), opt-in only. Not yet implemented.

### Tech debt: error-envelope DRY divergence (re-scoped again 2026-07-17, commit adace06)

Commit `adace06` restored a top-level `mcp_servers/_shared/` (see CHANGELOG), but this is a
restore, not the per-server consolidation this item originally asked for.
Resolved: all six servers import `mcp_servers/_shared/` through the `@shared/*` alias
(`<svc>-mcp/tsconfig.json`); no per-server error-envelope copies remain. Close this item.

### Bug: vitest 4 globs into node_modules.nosync.noindex symlink target during npm test (found 2026-07-17)

The repo's `node_modules -> node_modules.nosync.noindex` symlink convention (iCloud
hygiene) is not excluded by vitest 4's default test glob, so `npm test` picks up test
files belonging to vendored packages. Reproduced 2026-07-17: `cd
mcp_servers/threatlocker-mcp && npm test -- --run` -> 15 of 184 test files fail, all
under `node_modules.nosync.noindex/zod/src/v4/classic/tests/*.test.ts` (missing
optional peer deps `recheck`, `@web-std/file`, `@seriousme/openapi-schema-validator`)
and `node_modules.nosync.noindex/node-threatlocker/tests/unit/computers.test.ts` (a
different project's tests reached through the symlink). Real test count for the
project itself: 1882 passed, 3 failed on an unrelated live-HTTP-440 issue.
Fixed: `mcp_servers/threatlocker-mcp/vitest.config.ts:12` excludes `node_modules.nosync.noindex`. Check the other projects' `vitest.config.ts` and close the item for those that match. The fix needed
an explicit `test.exclude` (or `test.dir` scoping to `tests/` and `src/`) added to
each project's `vitest.config.ts` bumped to vitest 4 in the 2026-07-17 dependency
remediation. Out of scope for that remediation (package.json/lockfile only).

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

### Tech debt: root .gitignore fails its own zero-trust validator (found 2026-07-17)

`bash plugins/atlas/skills/atlas-gitignore/scripts/validate_gitignore.sh .gitignore` FAILs
on "banned Unicode (em/en dash, curly quotes, or ellipsis) present." Root cause: about 20
pre-existing comment lines (`.gitignore:30-377`, e.g. lines 30-36, 43-55, 132-202, 260-306,
377) use em dashes in prose. Unrelated to the 2026-07-17 canonical-structure change (which
added only ASCII allowlist lines for `.atlas/findings/`, `.atlas/decisions/`,
`.atlas/archive/`, `.atlas/understand-anything/`, `.atlas/graphify/`,
`.atlas/self-improvement/`, `.atlas/memory/`, `.atlas/nudge/`, `.atlas/CLAUDE.md`,
`.atlas/AGENTS.md` - the missing allowlist entries that had been silently gitignoring those
dated/durable subfolders). The validator also exits on the first failing check, so whether
the structural (pairing) and runtime (`git check-ignore`) checks pass is unverified until
this Unicode sweep lands. Needs an ASCII sweep of `.gitignore` comment prose (em dash ->
hyphen/comma/rewrite) followed by a clean validator run.
