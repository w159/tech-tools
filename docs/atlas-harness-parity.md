# Atlas harness parity matrix

Last verified: 2026-10-01 against atlas 8.6.0 in this repo (`plugins/atlas/`). Every
file:line in this matrix was opened while building it. Paths are repo-relative.

A row's **Status** is the weakest side, because parity is a conjunction:

- `enforced` — both harnesses actively enforce the rule (mechanism may differ; noted).
- `enforced (CC) / advisory (omp)` / `enforced (CC) / gap (omp)` — mixed rows; the
  weaker side is named in place.
- `advisory` — instruction/nudge only on the enforcing side(s); the stated harness
  limit makes a hard gate absent or impossible there.
- `gap` — enforced at least on one side, missing on the other.

## Harness limits (Claude Code) observed while building this matrix

Sources read 2026-10-01: [output-styles](https://code.claude.com/docs/en/output-styles.md),
[sub-agents](https://code.claude.com/docs/en/sub-agents.md),
[agent-teams](https://code.claude.com/docs/en/agent-teams.md).

- **Output styles are instructions, not enforcement.** "An output style applies to
  every response in a session. It's an instruction Claude follows, so nothing
  enforces it" (output-styles.md, "Choose between an output style and other
  features"). Anything that must happen needs a hook — which is exactly how atlas
  backs the style with hooks.
- **Output style reaches the main thread and forks only.** "Output styles apply to
  the main conversation and to a fork ... Other subagents run their own system
  prompt, so styles don't change how they respond" (output-styles.md, "How output
  styles work"). Subagent-obedience must ride in dispatch prompts — atlas does this
  via the dispatch TOOLS/spec blocks.
- **`force-for-plugin: true` auto-applies the style** whenever the plugin is enabled,
  overriding the user's `outputStyle` setting (output-styles.md, frontmatter
  reference). atlas uses it (`output-styles/atlas-orchestrator.md:4`).
- **There is no per-subagent thinking setting in Claude Code.** "subagents also
  inherit the main conversation's extended thinking configuration ... There is no
  per-subagent thinking setting" (sub-agents.md, "Choose a model"). Claude-side
  reasoning depth is tuned with the `effort` frontmatter field (sub-agents.md,
  frontmatter table) — omp gets true `thinkingLevel` fields instead.
- **Agent teams make teammates inherit the lead's effort.** "Teammates inherit the
  lead's effort level" (agent-teams.md, "Specify teammates and models"), and a named
  main-conversation Agent call launches as a teammate while teams are enabled
  (sub-agents.md, "Subagent names") — which is why the atlas named-dispatch deny is
  skipped under `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- **SendMessage / addressing**: `SendMessage` is in the background-subagent tool set
  (sub-agents.md, "Available tools") and is added to in-process teammates spawned
  from definitions (agent-teams.md, "Use subagent definitions for teammates"), so
  named atlas siblings are messageable in both team and plain-subagent sessions.
- **Claude Code permits nested subagents** (sub-agents.md, "Let subagents spawn
  their own subagents"); atlas's nested-dispatch deny is the plugin's stricter rule.
- **Team effort/model**: teammate model comes from prompt > definition frontmatter >
  `CLAUDE_CODE_SUBAGENT_MODEL` > lead model (agent-teams.md); a definition's
  `model: inherit` takes the lead's model. atlas pins concrete families instead
  (see tiers row).

## Parity matrix

| Rule | Source of truth | Claude Code enforcement | omp enforcement | Test(s) | Status |
|---|---|---|---|---|---|
| Output-style directives (status header, literal ask, done-is-terminal, length budget, dispatch phrasing) | `output-styles/atlas-orchestrator.md` (whole file); Claude→omp tool names `contracts/tool-names.json` | Claude Code output-style system; auto-applied via `force-for-plugin: true` (`output-styles/atlas-orchestrator.md:4`) | `omp/style.ts` `registerStyle`: `before_agent_start` appends the frontmatter-stripped, name-translated body to the MAIN session system prompt (subagents get nothing, matching Claude Code); idempotent begin marker; `ATLAS_STYLE=off` | `hooks/test_atlas_contract.py:432-442`; `omp/style.test.ts` (9 tests incl. two drift tests: rendered block == translated source, every Claude tool name in the source is mapped); live `omp --print` smoke 2026-10-01 (style on: model quoted the LEDGER line and opened with the ATLAS header; `ATLAS_STYLE=off`: absent) | enforced (both; style is instruction-level in both harnesses by design) |
| Session boot (operating-contract context injection) | `skills/atlas-orchestrate/references/operating-contract.md` | `scripts/session_boot.py:509` (`main`) via SessionStart, `hooks/hooks.json:8-16` (boot + doctor `--hook`) | `—` — omp extension registers only state-reset handlers at `plugins/atlas/omp/index.ts:339-340` | `hooks/test_session_boot.py` (37 tests); `hooks/test_session_boot_db.py` | gap |
| Prompt optimizer (rewrite vague user prompt before turn) | `skills/atlas-orchestrate/references/prompt-optimization.md` | `hooks/prompt_optimizer.py` on UserPromptSubmit, `hooks/hooks.json:19-28` (classify/match at `prompt_optimizer.py:88-142`) | `—` (no UserPromptSubmit-equivalent handler registered) | `hooks/test_prompt_optimizer.py`; `hooks/test_prompt_classifier.py` | gap |
| Native-tool routing — Grep/Glob denied toward lean-ctx | `contracts/native-tools.json` `kinds.search/glob` (mode `deny`, replacement + server) | `_native_tool_policy` reads the contract (`_native_tool_contract`), deny when lean-ctx plausibly reachable (`_lean_ctx_server_key`); wired PreToolUse | per-call deny when the replacement is live: `omp/index.ts` tool_call via `kindOfOmpTool` + `resolveLeanReplacement` (both from `omp/contracts.ts`) | `hooks/test_dispatch_tripwire.py` `NativeToolPolicyTest` incl. `test_contract_drives_replacement_and_mode`, `test_unreadable_contract_allows_silently`; `omp/contracts.test.ts`; `omp/index.test.ts` | enforced (reachability is per-harness: CC = configured-server heuristic, omp = live `getActiveTools()`) |
| Native-tool routing — Read/Bash one-time nudge | `contracts/native-tools.json` `kinds.read/shell` (mode `nudge`) | nudge texts + once-marker in `hooks/dispatch_tripwire.py` (`_native_tool_policy`, `_emit_nudge`) | `omp/index.ts` read/bash branch, `readNudge`/`bashNudge`, replacements from the contract | `omp/index.test.ts`; `hooks/test_dispatch_tripwire.py` | enforced (both advisory-by-design; nudge, never deny; wording per harness because the call mechanism differs) |
| Inline-op threshold (deny tier) | `hooks/dispatch_tripwire.py:42-46` (`DENY_THRESHOLD = 6`) | deny at Nth unsanctioned inline op: `hooks/dispatch_tripwire.py:448-469` (`count >= DENY_THRESHOLD` at `:461`); fail-closed on DB error `:452-459` | `—` (omp counts only edit/write/task for the stop gate; no threshold) | `hooks/test_dispatch_tripwire.py:287-299` (`test_pre_deny_at_ninth_inline_op`, `test_pre_no_deny_when_not_orchestrating`) | gap |
| Inline-op advisory threshold | `hooks/dispatch_tripwire.py:170-175` (`_threshold()`, `ATLAS_TRIPWIRE_THRESHOLD`, default 4) | PostToolUse STOP nag: `hooks/dispatch_tripwire.py:810-816` via PostToolUse wiring `hooks/hooks.json:79-87` | `—` | `hooks/test_dispatch_tripwire.py:95-112,715-724` (`test_under_threshold_is_silent`, `test_trips_at_threshold`) | gap |
| Inline edit of production target code denied | `hooks/dispatch_tripwire.py:441-446` | deny for Edit/Write/MultiEdit/NotebookEdit on non-orchestration paths (`_is_orchestration_path` `:190-211`) | `—` (omp notes the edit and acts only at session_stop) | `hooks/test_dispatch_tripwire.py:397-437` (`test_pre_allows_edit_to_the_session_scratchpad`, `test_pre_denies_edit_to_in_root_source`, `test_pre_deny_prod_edit_allows_docs_edit`, `test_pre_deny_notebook_edit`) | gap |
| Named dispatch (`name:` required on atlas:* Agent calls) | `hooks/dispatch_tripwire.py:327-345` (`_name_missing` docstring states the colony rule) | deny at `hooks/dispatch_tripwire.py:378-391`; teams-env carve-out `:331-336`; call site `_pre_tool_use` `:369` | `—` (advisory only: one-time `TASK_NAMING_HINT` `plugins/atlas/omp/index.ts:269-270`, computed `:278-290`, emitted `:384-388`) | `hooks/test_dispatch_tripwire.py:1631-1704` (`test_missing_name_is_denied`, `test_named_dispatch_is_allowed`, `test_agent_teams_env_lifts_name_requirement`); omp `plugins/atlas/omp/index.test.ts:189-245` | enforced (CC) / advisory (omp) |
| Model-override deny (colony tier pinning) | `hooks/dispatch_tripwire.py:348-367` (`_model_override`); `skills/atlas-orchestrate/references/squad-and-tiers.md:16-18` | deny at `hooks/dispatch_tripwire.py:393-405`; frontmatter scan `_frontmatter_model` `:301-326` | `—` — omp cannot take a per-call `model` (tier is baked into generated frontmatter: `plugins/atlas/omp/atlas-agents.ts:23`, `:68-70`; applied by `plugins/atlas/omp/gen-agents.ts:58-70`), but per-item `effort` IS accepted by omp's task tool (`~/.bun/.../pi-coding-agent/src/task/index.ts:290,315`) with no atlas check | `hooks/test_dispatch_tripwire.py:1607+` (`test_model_override_differs_from_definition_is_denied`); omp tier generation `plugins/atlas/omp/gen-agents.test.ts:40-109` | gap (omp effort-per-item drift unchecked) |
| Nested-dispatch deny (subagents never dispatch) | `hooks/dispatch_tripwire.py:152-170` (`_deny_nested_dispatch`) | unconditional deny from the PreToolUse path: call at `hooks/dispatch_tripwire.py:697` (payload transcript in `/subagents/` → `_in_subagent` `:141-149`) | enforced by construction: generated omp agents carry `spawns: "none"` (`plugins/atlas/omp/gen-agents.ts:71-72`; committed e.g. `plugins/atlas/omp/agents/verifier.md:8-9`) plus omp's own spawn mechanics | `hooks/test_atlas_contract.py:1238` (`test_hook_denies_a_dispatch_from_a_subagent_transcript`), `:1193` (`test_every_agent_disallows_agent_and_task`) | enforced (mechanism differs: CC = runtime deny; omp = definition-level `spawns: "none"`) |
| Dispatch-spec blocks (GOAL/DELIVERABLE/SUCCESS CRITERIA/OUT OF SCOPE/STOP CONDITIONS; one GOAL per dispatch; non-docs TOOLS block present) | `hooks/dispatch_tripwire.py:49-59` (`REQUIRED_SPEC_BLOCKS`) + `skills/atlas-orchestrate/references/subagent-kit.md:5,16-27` | `_unbounded_dispatch` + `_toolkit_gap` denies: `hooks/dispatch_tripwire.py:226-262,408-434` | `—` (dispatch-prompt inspection not implemented for omp task inputs) | `hooks/test_dispatch_tripwire.py:313-445` (`test_pre_deny_atlas_dispatch_with_no_toolsearch`, `test_pre_deny_atlas_dispatch_missing_the_bounding_spec`, `test_pre_deny_dispatch_bundling_several_goals`, plural-labels allow at `:347`) | gap |
| Gate (a) — evidence file this run | `hooks/completion_gate.py:22-27` (docstring), impl `_check_evidence` `:125-147` | Stop hook `hooks/hooks.json:98-104`; block text `hooks/completion_gate.py:774-794` | `—` (omp `session_stop` implements only the delegation subset) | `hooks/test_completion_gate.py:774-786` (`test_missing_evidence_condition_a`, stale/fresh/fallback at `:827-866`) | gap |
| Gate (b) — verified findings entry this run | `hooks/completion_gate.py:29-33`, impl `_check_findings` `:148-182` | same Stop wiring | `—` | `hooks/test_completion_gate.py:353-354,796-815,868-903,526+` | gap |
| Gate (c) — docs/CHANGELOG.md non-empty | `hooks/completion_gate.py:34`, impl `_check_changelog` `:232-236` | same Stop wiring | `—` | `hooks/test_completion_gate.py:917+` (`test_missing_changelog_condition_c`) | gap |
| Gate (d) — docs/ROADMAP.md non-empty | `hooks/completion_gate.py:35`, impl `_check_roadmap` `:237-241` | same Stop wiring | `—` | `hooks/test_completion_gate.py:205+,924+` | gap |
| Gate (e) — README.md non-empty | `hooks/completion_gate.py:36`, impl `_check_readme` `:242-246` | same Stop wiring | `—` | `hooks/test_completion_gate.py:212+,931+` | gap |
| Gate (f) — docs drift forces docs-curator dispatch | `hooks/completion_gate.py:37-46`; shared primitive `hooks/docs_drift.py:38-66` (`docs_drift`, `find_root` `:21`, `git_changed_paths` `:67`) | run-write signal `_run_written_paths` `hooks/completion_gate.py:1057-1104` + `_nondocs_changed` `:270-282` | `—` | `hooks/test_completion_gate.py:219+,238+,275+,310+,940+` (condition-f suite); primitive-level `DocsDriftTest` `:62-99` | gap |
| Gate (g) — verification coverage (implementers vs independent checks) | `hooks/completion_gate.py:47-58` | `_test_verified_this_run` `hooks/completion_gate.py:1218-1276` + `_unpaired_implementer_dispatches` `:1277-1302`; formula in docstring `:56-58` | `—` | `hooks/test_completion_gate.py:416-467,948-996,1535-1850` (incl. `test_stamp_without_executed_test_earns_no_credit` at `:1801`) | gap |
| Gate (h) — ROADMAP reconciliation (no `done` items) | `hooks/completion_gate.py:59-63` | impl `_check_roadmap_reconciled` `hooks/completion_gate.py:247-269` | `—` | `hooks/test_completion_gate.py:1169+` (`test_reason_emits_every_condition` covers all 13 keys) | gap |
| Gate (i) — todo drain | `hooks/completion_gate.py:60-67` | `_open_todos` `hooks/completion_gate.py:344-366`, `_board_open_todos` `:367-391`, `_ledger_open_todos` `:392-419` | `—` | `hooks/test_completion_gate.py:1359-1381,1872-1933` | gap |
| Gate (j) — worktree close-out | `hooks/completion_gate.py:63-67` | `_leftover_worktrees` `hooks/completion_gate.py:483-508` + `_run_used_worktrees` `:509-531` | `—` | `hooks/test_completion_gate.py:1312-1439` (incl. `test_recorded_worktree_dispatch_blocks_on_leftovers` at `:1393`) | gap |
| Gate (k) — plan mandate (a plan surface must exist) | `hooks/completion_gate.py:68-82` | `_has_todo_plan` `hooks/completion_gate.py:436-465` (+ `_has_ledger_line` `:420-435`) | `—` | `hooks/test_completion_gate.py:1961-2009` (`test_no_plan_on_any_surface_blocks`, board/ledger/TodoWrite satisfaction at `:1968-1986`) | gap |
| Gate (l) — dated-doc naming `<YYYY-MM-DD>-<slug>` | `hooks/completion_gate.py:74-82` | `_docs_name_violations` `hooks/completion_gate.py:466-482` (git-scoped) | `—` | `hooks/test_completion_gate.py:2055-2074` (`test_misnamed_plan_blocks_with_condition_l`, date-first allow at `:2074`) | gap |
| Gate (m) — delegation mandate (code writes require a dispatch) | `hooks/completion_gate.py` docstring (m); exemption dirs/extensions `contracts/native-tools.json` `delegationExempt` | `_missing_delegation` (exemption from `_delegation_exempt`, fail open when unreadable); Stop wiring | omp `session_stop` block-once in `omp/index.ts`; `isNonDocsPath` reads the same exemption | `hooks/test_completion_gate.py` `DelegationMandateTest` incl. `test_shared_exemption_cases_match_contract`; `omp/contracts.test.ts` runs the same `delegationExemptCases` through `isNonDocsPath`; `omp/index.test.ts` | enforced (omp counters are per-session; CC reads the run DB) |
| Board claim/notes (durable colony channel) | `scripts/atlas_todo.py:4` (board file), `note` `:505`, `notes` `:530` | workers run the same CLI; gate reads the board (`_board_open_todos` `hooks/completion_gate.py:367`); dispatch-tripwire `tests` reference claim protocol `hooks/test_atlas_contract.py:1461` | omp workers get `CLAUDE_PLUGIN_ROOT` set so the identical CLI works: `plugins/atlas/omp/index.ts:54-69` (`ensureClaudePluginRoot`), header `:46-53` | `hooks/test_todo_capture.py`; `hooks/test_atlas_contract.py:1461-1472`; omp `plugins/atlas/omp/index.test.ts:246-260` | enforced (same CLI both harnesses) |
| Todo mirror (plan → board) | `hooks/todo_capture.py:2-7` | PostToolUse TodoWrite → `atlas_todo.mirror`: `hooks/todo_capture.py:35-42` (`atlas_todo.py:247`), wired `hooks/hooks.json:56-64` | `tool_result` todo → board: `plugins/atlas/omp/index.ts:399-413` (`boardItemsFromTodoDetails` `:78-94`, argv `:107-116`), fail-open `:410-412` | `hooks/test_todo_capture.py`; omp `plugins/atlas/omp/index.test.ts:285-355` (mirror argv runs real python CLI `:303`, main-thread/scoped/error-tolerant `:322-355`) | enforced (omp normalizes statuses to board vocabulary, `:43-44,87-90`) |
| Docs-drift watcher (catch drift at edit time, not Stop) | `hooks/docs_drift_watch.py:2-6` | PostToolUse Edit/Write warn: main `hooks/docs_drift_watch.py:118-193`, message `:177`; wired `hooks/hooks.json:66-77` | `—` | `hooks/test_docs_drift_watch.py:362-392` (`test_warns_on_first_drifting_code_edit`, `test_silent_on_docs_edit`, streak tests) | gap |
| Memory capture (durable facts auto-saved at Stop) | `hooks/memory_capture.py:2-11` | Stop hook main `hooks/memory_capture.py:318-420`, scope guard `_should_capture` `:159`, wired `hooks/hooks.json:114-117` | `—` | `hooks/test_memory_capture.py` (33 tests incl. `test_capture_refuses_subagent_scopes` at `hooks/test_atlas_contract.py:1397`) | gap |
| Self-improvement nudge | `hooks/nudge.py:2-9` | Stop, after capture: main `hooks/nudge.py:39-77`, wired `hooks/hooks.json:118-121` | `—` | `hooks/test_nudge.py` | gap |
| Per-role model/effort/thinking tiers | `agents/*.md` frontmatter (e.g. `agents/verifier.md:4-5` `model: sonnet` / `effort: medium`); tier table `skills/atlas-orchestrate/references/squad-and-tiers.md:13-29`; omp map `plugins/atlas/omp/atlas-agents.ts:23-37` | `model:` + `effort:` frontmatter honored by Claude Code (sub-agents.md frontmatter table); override drift denied by `hooks/dispatch_tripwire.py:348-367,393-405`; ceiling enforced by `hooks/test_atlas_contract.py:681-698` (`test_every_agent_declares_a_valid_effort`, `test_no_agent_exceeds_sonnet`) | generated omp-native agents bake `thinkingLevel:` + `model:` (`plugins/atlas/omp/gen-agents.ts:58-70`, `modelPatternsFor` `plugins/atlas/omp/atlas-agents.ts:68-71`; committed `plugins/atlas/omp/agents/verifier.md:6-7`); harness limit: Claude Code has no per-subagent thinking setting (sub-agents.md), so CC tunes `effort`, omp tunes `thinkingLevel` | `plugins/atlas/omp/gen-agents.test.ts:40-109` (counterpart parity `:40`, idempotent no-diff `:78`, unknown names rejected `:109`); `hooks/test_atlas_contract.py:678-821` (agents exist, effort, sonnet ceiling, color palette at `:708`) | enforced (mechanism differs by harness capability) |
| Claude-mem recall at session start | `contracts/mandates.json` `recall` | `hooks/session_boot.py` `recall_mandate()` line in SessionStart context, armed only when the claude-mem plugin is enabled (`tool_routing.plugin_enabled`); `ATLAS_MANDATES=off` | `omp/mandates.ts` `before_agent_start` appends the same line naming the live `xd://` claude-mem search route; silent when not callable | `hooks/test_session_boot.py` `RecallMandateTest`, `PluginEnabledTest`; `omp/mandates.test.ts`; live `omp --print` smoke (line present; absent under `ATLAS_MANDATES=off`) | advisory (both; no hook can prove the model ran the search) |
| Ponytail pre-commit review | `contracts/mandates.json` `commitNudge` + `gitCommitCases` (shared parse cases) | `hooks/bash_advisor.py` `_match_git_commit` + `_commit_nudge`: one-time per session, armed when the ponytail plugin is enabled | `omp/mandates.ts` `matchGitCommit` + tool_call nudge, armed when `ponytail-review` is listed in the session's system prompt | `hooks/test_bash_advisor.py` (`GitCommitParseTest` reads the shared cases, `CommitReviewNudgeTest`); `omp/mandates.test.ts` (same cases) | advisory (both; nudge, never a commit block) |
| Context-mode routing (noisy shell output) | `contracts/native-tools.json` `kinds.shell.replacements` (`ctx_shell`, `ctx_execute` via lean-ctx or context-mode) | one-time Bash nudge names ctx_shell/ctx_execute (`hooks/dispatch_tripwire.py`) | shell replacements resolved from the contract + context-mode alt text in `bashNudge` (`omp/index.ts`) | `omp/index.test.ts`, `omp/contracts.test.ts`; `hooks/test_completion_gate.py` ctx_execute credit | advisory (both; preference cannot be proven ex ante by a hook) |
| Serena symbol edits (replace_symbol_body over whole-file rewrites) | `skills/atlas-orchestrate/references/tool-routing.md:20-27`; subagents hard rule `hooks/dispatch_tripwire.py:226-262` | enforced for dispatches: TOOLS block must contain serena (`_toolkit_gap` deny `hooks/dispatch_tripwire.py:408-434`); body rule advisory at edit time (harness limit: no Edit-time hook inspects which symbol-edit tool the model *used*) | `—` | `hooks/test_dispatch_tripwire.py:313-347`; `hooks/test_atlas_contract.py:737-784` (`test_code_agents_name_serena_symbol_tools`, `test_agents_name_lean_ctx_not_bash_as_the_serena_fallback`) | enforced (CC, dispatch scope) / gap (omp) |
| Fallow gate (commit/push denied below floor) | `hooks/fallow_gate.py:6-8` | PreToolUse Bash deny: `_deny` `hooks/fallow_gate.py:165-176`, audit run `:129-163`, denies at `:209-234`; wired `hooks/hooks.json:31-44` | `—` | `hooks/test_fallow_gate.py` | gap |
| Format after edit | `hooks/format_after_edit.py:2-8` | PostToolUse formatting: `candidates_for` `hooks/format_after_edit.py:63-87`, `main` `:94`; wired `hooks/hooks.json:66-72` | `—` | `hooks/test_format_after_edit.py` | gap |
| Connector credential watch (stale MCP auth fails the turn, not the session) | `hooks/connector_credential_watch.py:2-6` | PostToolUse matcher over MCP prefixes `hooks/hooks.json:88-95`; detector `looks_like_auth_failure` `hooks/connector_credential_watch.py:84-125` | `—` | `hooks/test_connector_credential_watch.py` | gap |
| Ingest/chronicle (transcript → observability DB + facet rows) | `hooks/ingest_session.py:2-8`; `hooks/chronicle_facet.py:2-8` | Stop + SubagentStop + SessionEnd + PreCompact wiring `hooks/hooks.json:106-156`; ingest spawn `hooks/ingest_session.py:25-52`; facet compute/sync `hooks/chronicle_facet.py:39-61,136` | `—` (omp sessions write nothing to the atlas observability DB today) | `hooks/test_ingest_session.py`; `hooks/test_chronicle_facet.py` | gap |
| Colony adherence observability (lean-ctx/context-mode usage, named-dispatch rate mined) | `scripts/atlas_doctor.py:1135` (section header), `mine_colony_adherence` `:1306+`, classifier `_colony_classify_harness` `:1175`, dispatch stats `_colony_named_dispatch_stats` `:1258`, registered in MINERS `:1708` | SessionStart doctor hook `hooks/hooks.json:12-16` (`atlas_doctor.py --hook`) | `—` — the miner reads only the atlas DB that CC hooks populate; omp sessions produce no telemetry, so adherence is blind there (harness limit) | `scripts/atlas_doctor.py` miner suite in `hooks/test_atlas_contract.py` telemetry checks `:482-510` | advisory (CC-side mining; nothing to mine on omp) |

Known drift worth a follow-up (not a row rewrite): `skills/atlas-orchestrate/references/laws-and-gates.md:28-30` still says the tripwire "DENIES the call outright at 8 inline ops"; the code denies at 6 (`hooks/dispatch_tripwire.py:46`) and advises at 4 (`:170-175`).

## Landed in 8.6.0

1. **omp output style** — `omp/style.ts` (row *Output-style directives*). Harness
   limit kept on purpose: the style never reaches subagents in either harness, so
   subagent rules still travel in dispatch prompts.
2. **Shared contracts** — `contracts/native-tools.json` (native-tool kinds, modes,
   replacements, delegation exemption + shared test cases), `contracts/mandates.json`
   (mandate text + git-commit parse cases), `contracts/tool-names.json` (style
   translation). Each is read by both runtimes; reachability logic and message
   wording stay per harness because the call mechanism differs.
3. **Tool mandates** — claude-mem recall and ponytail pre-commit rows.
4. **tmux mux mode** — `scripts/atlas_mux.py` (`ATLAS_MUX=tmux`): each worker is a
   headless `claude -p --agent atlas:<role>` or `omp -p` process in a window of one
   `atlas-<run>` tmux session, at its definition's tier (claude `model`/`effort`;
   omp first resolvable `model` pattern + `thinkingLevel`), streaming note-shaped
   records to `.atlas/.run/board/<name>.jsonl` that `atlas_todo.py notes --to lead`
   reads. Not agent teams (teammates inherit the lead's effort). Tests:
   `scripts/test_atlas_mux.py` (fake tmux/claude/omp); real tmux smoke 2026-10-01:
   two workers (one per harness) posted notes, the lead read both via
   `atlas_todo.py notes --to lead`, `kill` left no `atlas-*` session.

## Remaining gaps (not closed in 8.6.0)

The `gap` rows above are still open in omp: completion-gate conditions (a)–(l),
session boot beyond the style + recall line, prompt optimizer, inline-op
thresholds and production-edit deny, dispatch-spec blocks, model-override check
on per-item `effort`, docs-drift watch, memory capture, self-improvement nudge,
fallow gate, format-after-edit, connector credential watch. Each needs an omp
handler that ports the Python hook's logic (or shells out to it); none is
blocked by an omp limitation found so far.

## Benchmark

| harness | wall time | tokens | dispatch count | named-dispatch rate | native-reader share | verification pass |
|---|---|---|---|---|---|---|
| Claude Code | | | | | | |
| omp / oh-my-pi | | | | | | |

Not run for 8.6.0: omp atlas workers resolve to `@atlas-worker` → `@smol` (an OpenRouter model), and that key returned HTTP 402 (credit cap) during this session, so an omp run that delegates would measure the billing failure, not the harness. Re-run when the key has credit: same scripted task in `claude -p` (atlas loaded) and `omp -p -e <abs>/plugins/atlas/omp/index.ts`, ingest both, then `atlas_doctor.py --mine` (colony_adherence) and turn scoring.