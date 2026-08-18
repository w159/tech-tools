# Changelog

## 5.9.0 (2026-08-18)

Four defects the usage-insight report for 2026-07-02..2026-08-17 measured across
369 sessions, each traced to a specific line of atlas rather than to model
behavior.

**1. The verifier had no way to write its verdict.** `agents/verifier.md` ships
`disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]` and never mentioned
`findings.json`. The completion gate's condition (b) reads
`.atlas/.run/findings.json` for `status: "verified"`. So the contract demanded a
file the agent was structurally prevented from writing and never told about:
verdicts came back as prose, the gate tripped, and the orchestrator re-dispatched
the same verifier. The report logged this as "sub-agent verifiers repeatedly
omitted their verdicts from findings.json, tripping the definition-of-done gate
multiple times in a single session."

- New `scripts/atlas_finding.py`: append one schema-valid entry to
  `.atlas/.run/findings.json` with an atomic write. Bash is allowed to the
  verifier, so this is a write path it can actually use.
- `agents/verifier.md` now ends with a MANDATORY step invoking it, including the
  `needs-evidence` case - a missing row is indistinguishable from work never done.
- `dispatch_tripwire.py` brackets every `*verifier*` dispatch: it snapshots the
  entry count on `PreToolUse` and, if the verifier returns without adding a row,
  names the one-command fix immediately. The gap surfaces mid-session, not at Stop.

**2. Closeout gates converted a handoff request into a fresh dispatch wave.**
"Claude spent nine consecutive sessions trying to write a handoff summary and got
blocked by its own docs-drift Stop hook every single time." Two causes: the gate's
block text led with "dispatch atlas:completeness-critic", and `atlas-handoff` had
no preflight.

- `completion_gate.py`'s remediation is now ordered smallest-first: write the
  unwritten record inline (docs/ and .atlas/ are the two trees an orchestrator may
  edit directly), dispatch only when the evidence genuinely does not exist yet, and
  do not start a dispatch that cannot finish this session.
- `skills/atlas-handoff/SKILL.md` gains Step 0, a gate preflight that runs before
  a word of the summary: reconcile findings.json, reconcile docs drift, name what
  cannot be closed. The gate is deterministic and its firing was predictable.

**3. Stale MCP credentials ate whole sessions.** The ConnectWise connector
returned HTTP 400 "Invalid Token" on every endpoint and the session kept sweeping
endpoints; Ramp and CIPP failed the same way. A running MCP server caches its
credentials at startup, so a rotated secret never reaches it.

- New `hooks/connector_credential_watch.py`, `PostToolUse` on `mcp__.*`: on the
  first 401/403 (or a 400 whose body names the token) from any MCP tool, inject one
  instruction - restart the server, do not retry other endpoints. Once per server
  per session, advisory only, `ATLAS_CONNECTOR_WATCH=off`.

**4. nudge.py announced its own success on Stop.** additionalContext on Stop
prompts another model turn. A turn spent saying "memory facts captured" is a turn.
It is now silent on the success path and speaks only when it needs something done.

**Verification.** 1082 tests pass, including 9 new in
`scripts/test_atlas_finding.py`, 11 in `hooks/test_connector_credential_watch.py`,
6 verifier-bracket cases in `hooks/test_dispatch_tripwire.py`, and 7 permanent
invariants in `hooks/test_atlas_contract.py::InsightRemediationContract` that
pin each of the four fixes so they cannot silently regress.

## 5.8.0 (2026-08-11)

Subagents were not ignoring their MCP tools. They were obeying a fallback that
fired on every dispatch, because serena died first and nothing else was loaded.

**The measurement.** Across the 12 most recent recorded subagent runs: 378 Bash
calls (190 `cd`, 61 `grep`, 25 `cat`, 15 `sed`) against 8 successful MCP calls.
Every one of the 9 serena calls failed - `No active project ... known projects:
[]`, `KeyError: 'languages'` from `activate_project`, `No such tool available`
for `search_for_pattern`. Zero lean-ctx calls in any run. Three of the twelve
never called `ToolSearch` at all.

**Three defects in series.**

1. The batched `ToolSearch("select:...")` every agent spec mandates named only
   serena. When serena failed - which was always, on a repo whose
   `.serena/project.yml` predates serena 1.6 - the agent had loaded nothing else,
   so `Bash grep` was the only reader left in reach. lean-ctx appeared in the
   agents' tool *tables* but never in the line that actually loads a schema.
2. Nothing repaired the broken serena config. 5.7.1 taught agents to *recognize*
   `KeyError: 'languages'` and fall back; it never fixed the file, so the
   fallback fired forever.
3. A dispatch could omit the TOOLS block entirely and nothing objected.

**The fixes.**

- All 12 agent specs load one batched `ToolSearch` covering lean-ctx, serena, and
  context-mode before the first `Read`/`Grep`/`Bash`. The serena-down path now
  routes to `ctx_search`/`ctx_read`/`ctx_compose` explicitly, and names
  `Bash grep`/`cat`/`sed` as the defect rather than the fallback.
- `session_boot.py` gains `heal_serena_project()`: on SessionStart it appends the
  `languages:` key serena >= 1.6 requires to a `.serena/project.yml` that lacks
  it, inferring languages from the tree. Idempotent, never creates a config that
  is not there, fails open. Symbol tools come up for the session and every
  subagent under it.
- `dispatch_tripwire.py` denies an `atlas:*` dispatch whose prompt never orders
  the batched `ToolSearch`, and `hooks.json` binds it to `Agent|Task` on
  PreToolUse. Forks and non-atlas agents are exempt.
- `subagent-kit.md`'s TOOLS block carries the verbatim batched call and the
  serena-down ladder.
- 10 contract tests added across `test_atlas_contract.py` (toolset-load shape,
  lean-ctx fallback clause, dispatch template, six `heal_serena_project` cases)
  and `test_dispatch_tripwire.py` (deny/allow/exempt for the dispatch guard).

## 5.7.1 (2026-08-11)

Serena was wired, named, and had never activated a project. Two config defects
sat in series underneath 5.7.0's fix.

**The defect.** serena 1.6 made `languages:` a `ProjectConfig` field with no
default (`FIELDS_WITHOUT_DEFAULTS`). Every `.serena/project.yml` on the machine
predates that rename and carries only `language_servers:`, so
`serena_config.py:569` raises `KeyError: 'languages'`, the project is skipped at
load, and every symbol tool answers `No active project`. Separately, the MCP
entry the session actually reads (`~/.mcp.json:57`) launched the server with
`--context claude-code` and no `--project`, so nothing activated even where the
yml was valid. Net effect: an always-empty status bar, a `tools/list` handshake
followed by silence, and a 29% tool error rate that read as a bad tool rather
than a bad config.

**The correction.** The first determination was to remove serena as redundant
with the native `LSP` tool. That was wrong. `LSP` requires
`(filePath, line, character)` and returns *locations*; `find_symbol` takes a
*name* and returns the *body*. Reaching a position for `LSP` means Read or Grep
first, which is the context cost serena exists to remove. Serena's symbol-edit
tools - `replace_symbol_body`, `insert_before/after_symbol`, `rename_symbol`,
`safe_delete_symbol`, `replace_content`, `replace_in_files` - have no native
equivalent. And serena never competed with lean-ctx or context-mode: the
`claude-code` context excludes `read_file`, `create_text_file`,
`execute_shell_command`, `find_file`, `list_dir` and `search_for_pattern` by
construction, so it only ever offered what the harness lacks.

**Changed**

- All 12 agent bodies load the symbol toolset in **one** up-front `ToolSearch`
  before the first `Read`/`Grep`/`Bash`, per serena's own claude-code context
  instruction. Per-tool schema fetching mid-task is how an agent still ends up
  on `Grep`.
- Every agent now recognizes `No active project` / `KeyError: 'languages'` as a
  one-line config report instead of retrying every tool.
- `subagent-kit.md` dispatch brief carries a required `NON-INTERACTIVE` clause.
  serena's global `default_modes` include `interactive`, whose prompt tells the
  model to stop and ask the user for clarification - which a subagent cannot do.
  serena 1.6.1's claude-code context exposes no `switch_modes` tool, so the
  brief invokes serena's own documented escape hatch instead.
- `lsp-and-symbols.md` gains the serena-vs-native-`LSP` split (name->body vs
  position->locations) and serena's active-project preconditions.
- `capability-routing.md` Step 2b specifies the batched `ToolSearch` form and
  names the six context-excluded tools that must never appear in a spec.
- `atlas-handoff` stopped routing to `prepare_for_new_conversation`, a tool
  serena 1.6 does not have. It had been instructing agents to make a call that
  always fails; the handoff record is now composed from the field schema and
  stored with `write_memory`.
- Four contract tests added: `test_agents_load_symbol_toolset_up_front`,
  `test_agents_do_not_name_context_excluded_serena_tools`,
  `test_dispatch_brief_overrides_serena_interactive_mode`, and
  `test_no_atlas_file_routes_to_a_nonexistent_serena_tool` (scans every plugin
  markdown file, not just the agents).

**Known gap.** Roughly 40 other `.serena/project.yml` files on the machine still
lack `languages:` and will keep failing until each is fixed; the sweep was
declined. A repo with *no* project.yml is unaffected - `--project-from-cwd`
autogenerates a current one.

## 5.7.0 (2026-08-06)

Subagents now name the tools they are supposed to use, and cost what a
spec-executing agent should cost.

**The defect.** Every agent body said "use `serena`" or "route noisy output
through `context-mode`" as prose. Those are deferred MCP tools: their schemas are
not in a subagent's tool list until it calls `ToolSearch`. An agent told to "use
serena" finds no such tool, falls back to `Grep` + `Read`, and reports success.
Three agents were worse off: `schema-inventory`, `rls-privilege-audit` and
`naming-glossary-audit` carried a `tools:` frontmatter allowlist (`Bash, Write`),
which excludes every `mcp__*` tool outright. No agent mentioned `lean-ctx` or
`claude-mem` at all.

**Agents (all 12).** Each now carries a concrete tool-routing table ahead of its
Method section: the need, the exact tool name (`ctx_compose`,
`get_symbols_overview`, `find_symbol`, `find_referencing_symbols`,
`replace_symbol_body`, `get_diagnostics_for_file`, `ctx_callgraph`, `ctx_search`,
`ctx_batch_execute`, `ctx_execute_file`, `ctx_fetch_and_index`, `query-docs`,
claude-mem `search`/`timeline`/`get_observations`), and what it replaces. Each is
told to `ToolSearch` for schemas first and to search by keyword rather than
hardcode a server prefix, since prefixes differ per install. The three `tools:`
allowlists are removed; `disallowedTools` already carried the read-only
guarantee.

**Model and effort.** `effort` is agent frontmatter (`low`/`medium`/`high`/
`xhigh`, or an integer) and is the only reasoning-depth lever for a subagent -
there is no `thinking` key. Every agent now declares one. Sonnet is the ceiling:
`rls-privilege-audit` drops from opus, and `SKILL.md` no longer routes `planner`,
`completeness-critic` or critical `verifier` work to opus. Effort is `low` for the
nine roles that execute a spec the orchestrator already wrote, `medium` for the
three that render an independent verdict against evidence they were not handed
(`verifier`, `completeness-critic`, `rls-privilege-audit`). A subagent that seems
to need a bigger model is an underspecified prompt.

**Orchestrator side.** `subagent-kit.md`'s dispatch spec gains a required `TOOLS`
block naming real tools, replacing the old "use serena/LSP over grep+read" aside,
plus a cost caution that a fork inherits the parent's model and effort so the
agent file's tiers do not apply. `capability-routing.md` gains a Step 2b table of
the exact names to put in a prompt, with the claude-mem worker-runtime arg shapes
that caused its historical error rate. `prompt-optimization.md` makes naming exact
tools a per-dispatch requirement.

**Contract test.** `hooks/test_atlas_contract.py` gains `AgentTierContract`
(7 tests): every agent declares a valid `effort`, no agent exceeds sonnet, only
the three verdict roles get `medium`, no agent carries a `tools:` allowlist, every
agent names a `ToolSearch` instruction and a context-mode/lean-ctx tool, and the
five code-facing agents name a serena symbol tool.

Evidence: `python3 -m pytest plugins/atlas/hooks/test_atlas_contract.py -q` ->
**31 passed, 48 subtests passed**. Negative control: setting `planner` to
`model: opus` and stripping its `effort` fails 3 of the 7 new tests.

## 5.6.0 (2026-08-06)

Gap closure. Everything here was already known and written down somewhere as
open, which is exactly why it needed shipping rather than re-recording.

**Hooks**

- `completion_gate.py` records every block as a `friction_events` row
  (category `gate_block`, snippet naming the failed conditions), so
  `facets.gate_block_count` is a real measurement instead of a permanent NULL.
- `completion_gate.py` falls back to the git working tree when a run logged no
  telemetry at all (zero events, zero tool_calls). A run that logged activity
  and reports no writes is still trusted, so a dirty tree from an earlier
  session still cannot block it. Closes the KNOWN GAP the contract suite had
  been asserting: a session whose telemetry never landed used to get a gate
  that enforced only "the docs files exist".
- `chronicle_facet.py` no longer wipes friction rows it does not own. Its
  `signals` re-mirror deleted every row for the session, silently erasing the
  new `gate_block` rows and `memory_capture`'s `memory_drop` rows.

**Scripts**

- `scripts/skill_factory.py` and its test deleted. 5.5.0 unwired the hook but
  left the code that wrote the SKILL.md files in place; `atlas-setup` was still
  verifying its presence as a deployment step.
- `atlas_doctor.py --enrich-facet <session_id> '<json>'`: writes the LLM-judged
  facet columns through a validated command. Unknown columns and bad JSON exit 2.
- `test_connectors_wiring.py` rewritten for the vendored ESM bundle layout it
  should have moved to on 2026-07-31. It was globbing `*.mcpb`, so three tests
  were vacuous and one failed: the repo's one standing test failure.

**Security**

- Ten more secret shapes (`*.pgdump`, `*.dmp`, `*.rdb`, `*.bacpac`, `*.sqlite`,
  `*.sqlite3`, `*.db`, `*.jceks`, `*.keytab`, `*.p7b`) were trackable inside
  allowlisted folders. Added to `.gitignore`'s terminal block, with a
  `GitignoreSecretContract` probing 24 paths on every test run.

**Contract tests**

- No script may write a SKILL.md (the hook-only rule missed the factory).
- Gate blocks are persisted; the git fallback fires only without telemetry.
- Secret shapes stay ignored, real docs stay trackable.

Evidence: `python3 -m pytest hooks scripts -q` -> 1028 passed, 3 skipped
(installed-parity, un-skips after reinstall), 56 subtests passed.

## 5.5.0 (2026-08-06)

Reporting discipline and deterministic verification. Atlas was producing
unusable output: `done` was emitted repeatedly inside one exchange, each time
followed by more work, and the user's decision points were buried under
restated state. Separately, verification leaned on dispatched subagents that
ran longer than the changes they checked and returned prose instead of
verdicts.

**Output style (`output-styles/atlas-orchestrator.md`)**

- `done` is now terminal and conditional: forbidden while any subagent or
  background task is pending, while any question to the user is unanswered,
  or while anything remains to do. Emitting it otherwise is a defect.
- Length budget: 12 lines of prose for any non-report reply. Evidence blocks
  are exempt; the budget never excuses skipping evidence.
- New information only: a re-invocation with nothing new gets one line, not a
  restatement of outstanding state.
- Decisions go first: any question sits at the top under `DECISION NEEDED:`
  and repeats until resolved.
- Verification doctrine replaced: verify with a deterministic test, dispatch a
  verifier subagent only when no test can express the check, and say why.

**Hooks**

- Removed `auto_skill.py` and its tests. It wrote `SKILL.md` files into
  `~/.claude/skills/` unprompted, producing 19 `learned-*` slash commands the
  user never asked for. The hook, its binding, and the generated skills are
  gone; `nudge.py` lost its dead skill-probe with them.
- `completion_gate.py` no longer narrates on a pass. Silence is the contract:
  it speaks only when it blocks. Conditions (a) and (b) apply only once a run
  has shipped non-docs code, so research-only runs stop being gated.
- `nudge.py` unbound from `SubagentStop`. Landing there injected its prompt
  into a dispatched agent's context immediately before its final response, and
  agents answered the nudge instead of returning their deliverable.
- New `docs_drift_watch.py` (PostToolUse): warns inline the moment a non-docs
  edit drifts from `docs/`, instead of waiting for the Stop gate. Debounced per
  `session_id`, backing `git diff` cached 2s, atomic state writes.
- Extracted `docs_drift.py` (`find_root`, `docs_drift`, `git_changed_paths`),
  shared by the gate and the watcher.
- `bash_advisor.py`, `format_after_edit.py` and `prompt_optimizer.py` now
  coerce non-dict JSON payloads to `{}`. All three crashed with
  `AttributeError` on `null` or a list, which fail-open was assumed to cover
  and never tested.

**Verification**

- New `hooks/test_atlas_contract.py`: the deterministic replacement for a
  verifier subagent. Asserts wiring integrity, that no hook can write a
  `SKILL.md`, that nothing instruction-injecting binds to `SubagentStop`, gate
  silence on pass, drift-warning behavior, session-scoped debounce, fail-open
  under garbage stdin for every hook, the output-style rules, and
  docs-match-code. Runs in under two seconds and found four real defects on
  its first run.
- Documented a known gap as a passing test: the gate's conditions (a), (b),
  (f) and (g) all key off `atlas_db` run rows, so a session with no run row
  gets a gate that enforces only "the docs files exist".

## 5.4.0 (2026-08-05)

Self-improvement was not missing, it was stalled. Atlas had been recording
telemetry faithfully for a month and consuming none of it: `improvements` had
not been written in 24 days, `asset_verdicts` in 27, and `~/.atlas/memory/`
had not changed since 2026-07-16. Three compounding causes, each proven before
anything was changed.

**Root causes fixed**

- **A 4,000-byte cap on accumulated memory, failing silently.** `MEMORY.md`
  sat at 4,058 bytes, so `atlas_memory.add()` returned `success=False` and
  `memory_capture.py` skipped the lesson with no error anywhere. Every lesson
  since 2026-07-16 was discarded. `WORKING_CAP_CHARS` raised to 20,000 with
  rotation to a dated archive instead of rejection (`atlas_memory.py:53`,
  `:156-194`). Verified: forced rotation of 50 over-cap entries preserved all
  50 across live plus archive, and the real 4,058-byte file gained an entry
  with the original unchanged.
- **`atlas_doctor --hook` never persisted its verdict.** The SessionStart path
  returned before writing, so 27 days of health checks recorded nothing.
  `record_hook_verdict()` is now wired into that branch.
- **A blocked Stop silenced every learning hook.** When `completion_gate`
  blocks, Claude Code re-fires Stop with `stop_hook_active=true`, and
  `atlas_hook_guard.should_run()` returned False for all hooks
  (`atlas_hook_guard.py:146`). The gate's false positives were switching off
  atlas's own learning. `should_run()` gained a `kind` parameter: capture
  hooks (`ingest_session`, `memory_capture`, `chronicle_facet`) survive a
  blocked Stop; emit hooks (`nudge`, `auto_skill`) stay suppressed, which is
  what the flag exists for. Default stays `"emit"` for back-compat.

**New**

- **`facets`, `friction_events`, `findings` tables**, plus `improvements`
  extended additively with `finding_id`, `metric`, `baseline_value`,
  `target_value`, `measure_after_runs`, `remeasured_at`, `remeasured_value`,
  `verdict` (`atlas_db.py:43-67`, `:165-172`). Migration verified
  non-destructive against a copy of a live 119 MB database: all 12
  pre-existing tables unchanged, `improvements` kept its 38 rows.
- **`hooks/chronicle_facet.py`**, a Stop hook writing one deterministic facet
  row per session from data `ingest_session` already stored. No LLM call, no
  network. Runs after `ingest_session`, before `memory_capture`. Writes NULL,
  not a fabricated 0, for counts on sessions that were never ingested.
- **`skills/atlas-doctor/`**, promoted out of `atlas-setup` into its own
  skill. Five phases: enrich pending facets, mine findings, ask the user per
  finding (apply / skip / modify) via `AskUserQuestion`, apply what is
  accepted as real edits, then record a baseline and re-measure later into
  `improved` / `no_change` / `regressed`. Not a report generator and not a
  prompt vending machine.
- **`MINERS` registry in `atlas_doctor.py`** with 8 miners and a CLI
  (`--mine`, `--list-findings`, `--set-status`, `--baseline`, `--remeasure`,
  `--pending-facets`, `--json`). Findings dedupe on a UNIQUE fingerprint, so
  re-running updates rather than duplicating.
- **`memory_capture` now records refusals.** Both `atlas_memory.add()` call
  sites gained an `else` branch writing a `memory_drop` row to
  `friction_events` and surfacing it on stderr. Atlas's own
  `mine_memory_capture_silent_drop` miner reported this defect before the fix
  and reports nothing after.

**Fixed**

- **`completion_gate` conditions (f) and (g) rescoped.** Both now consider
  only files the current run wrote, via the atlas_db run signal, instead of
  the whole git working tree. A dirty tree inherited from an earlier session
  no longer blocks a run that touched nothing, and (f) warns rather than
  blocks when a run wrote no non-docs files.
- **SECURITY: secrets were trackable inside every allowlisted folder.**
  `.gitignore` declares its secret patterns above the allowlist, and last rule
  wins, so every `!docs/<subdir>/**` and `!.atlas/<subdir>/**` entry re-admitted
  them. Before the fix `git check-ignore` proved `docs/decisions/id_rsa`,
  `docs/audits/secret.key`, `docs/specs/id_rsa` and `customers_dump.sql` were
  all committable. Only `.env` was safe, via its own post-allowlist rule. A
  terminal re-exclusion block now mirrors the full secret vocabulary and must
  remain the last rules in the file. Pre-existing defect, not introduced by
  this release.

**Not shipped**

- The anonymized feedback exporter was built and then removed. An adversarial
  verifier proved it leaked MCP connector UUIDs, vendor tool names and
  internal skill codenames into a payload intended to be shared publicly. See
  `docs/decisions/no-anonymized-feedback-exporter-without-designed-in-redaction.md`.
  The underlying facet and finding data still accumulates, so it can be rebuilt
  with redaction designed in rather than retrofitted.
- Gate-block persistence is not implemented, so `facets.gate_block_count`
  stays NULL.

Evidence: `python3 -m pytest scripts hooks -q` from `plugins/atlas` gives
1045 passed with one pre-existing failure (`test_connectors_wiring`, confirmed
unrelated by reproducing it on a clean stashed tree).

## 5.3.0 (2026-07-31)

All 10 vendored MCP connectors fixed: `.gitignore` had `*.mcpb`, so the 10
bundles were never committed, and an installed plugin's `mcp/<name>/` folder
held only `extract.sh` + `launch.sh` with nothing for `launch.sh` to launch.
Zero `mcp__plugin_atlas_*` tools existed in any session. `.mcpb` is also a
Claude Desktop installation format Claude Code plugins cannot execute
natively (`code.claude.com/docs/en/plugins-reference.md`), so the
extract-and-exec wrapper was never a viable plugin mechanism.

- **Replaced `.mcpb` + `launch.sh` + `extract.sh` with one self-contained
  ESM bundle per server**: `mcp/<key>/server.mjs`, tsup `noExternal:[/.*/]`,
  no `dist/`, no `node_modules/`. Removed the 4 domain subfolders (`hr`,
  `it-operations`, `microsoft-365`, `security`), the 8 shell scripts, and
  the 10 `.mcpb` bundles. One folder per connector key: auvik, blumira,
  cipp, connectwise, knowbe4, ninjaone, paylocity, spanning, threatlocker,
  vanta. `mcp/` went from 31 MB to 4.3 MB.
- `.mcp.json`: all 10 entries rewired to `command: "node"`, `args:
  ["--import", "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.mjs",
  "${CLAUDE_PLUGIN_ROOT}/mcp/<key>/server.mjs"]` (`.mcp.json:99-105` for
  ninjaone).
- **New preloader `mcp/_env/load.mjs`**, dependency-free ESM: loads
  `ATLAS_ENV_FILE` (default `${CLAUDE_PLUGIN_ROOT}/.env`) with override
  semantics, then promotes `CFG_<NAME>` to `<NAME>` only when `<NAME>` is
  unset, non-empty, and not an unexpanded `${...}` literal (`load.mjs:5-34`).
  Never writes to stdout, since stdout is reserved for JSON-RPC.
- **Credential precedence changed**: `.env` now beats the plugin's
  `userConfig` Keychain values (which remain as fallback). Node's
  `--env-file` does not override variables already in the environment, so
  `userConfig` would otherwise always win. Added `.env.example` covering
  all 40 credential variables, commented, no values.
- `.gitignore:307-314` allowlists `plugins/atlas/mcp/` (re-included after
  the generic `dist/`/`node_modules/` excludes) so the bundles actually
  ship; `plugins/atlas/.env` stays re-excluded (`.gitignore:339-340`).
  `*.mcpb` rule retained.
- Marketplace cleanup: removed the stray root `marketplace.json` (duplicated
  all 3 plugins, produced 6 cards for 3 plugins in the plugin browser);
  `plugins/programmer/.claude-plugin/plugin.json:5` author corrected
  `"Jerry"` -> `"w159"`; corrected stale skill counts in
  `.claude-plugin/marketplace.json:4,13` ("22 plainly named skills" -> 20,
  "16 task skills" -> 14).
- Version 5.2.0 -> 5.3.0. Minor bump: new capability (bundled ESM connector
  mechanism, `.env` credential precedence) plus a bug fix (all 10
  connectors restored from completely dead to working), no breaking change
  to the plugin's own interface.

Known limitation, recorded honestly: Claude Code has no per-MCP-server
enable/disable, only plugin-level `defaultEnabled`
(`plugins-reference.md:509-518`). All 10 servers load together; those
without credentials sit in a reduced diagnostic mode.

Evidence (independently verified by a fresh-context verifier): all 10
servers complete an MCP initialize handshake and return `tools/list`
(auvik-mcp 0.4.2 39 tools, blumira-mcp 1.1.5 2 credential-gated, cipp-mcp
0.2.2 43, connectwise-manage-mcp 1.5.2 2 without credentials/52 with,
kaseya-spanning-backup-mcp 1.1.3 14, mcp-server-knowbe4 1.1.2 30,
ninjaone-mcp 1.6.2 26, paylocity-mcp 0.1.4 16, threatlocker-mcp 1.3.0 18,
vanta-mcp 0.2.3 28), all exit cleanly. `ninjaone/server.mjs` copied alone
into an empty temp dir ran and returned its full 26-tool list with no
`node_modules` present. All 10 bundles confirmed git-addable; `.env`
confirmed ignored. 40 `userConfig` keys reconcile exactly across
`plugin.json`, `.mcp.json`, and `.env.example` with none renamed, dropped,
or orphaned. Credential precedence verified in all four cases. Preloader
stdout-safety verified against malformed input, a missing file, and a
directory passed instead of a file: zero stdout bytes, never throws.

Not yet verified: working from an installed plugin cache, since that
requires this commit to be pushed first.

## 5.2.0 (2026-07-28)

Stop-hook loop guard, generalized. An earlier point fix patched
`memory_capture.py` directly for a Stop-hook loop that burned a usage
limit; the invariant it enforced (a Stop hook must not re-emit identical
feedback forever) was still hand-implemented per hook, so a new hook would
inherit nothing. This release centralizes it.

- **New shared module `scripts/atlas_hook_guard.py`** (about 218 lines):
  `read_payload()`, `should_run(payload, hook_name, window_seconds=None)`,
  `emit(payload, hook_name, message)`. Per-session JSON state at
  `~/.atlas/hookstate/<session_id>.json` (override: `ATLAS_HOOKSTATE_DIR`).
  Tracks `last_run` per hook, `stop_events` for the circuit breaker, and
  emitted message hashes (sha256, first 16 hex chars).
- **Session circuit breaker.** `STOP_BURST_LIMIT = 5` Stop events within
  `STOP_BURST_WINDOW = 120` seconds trips it for the rest of the session,
  silencing every atlas Stop hook. A per-hook throttle can only ask "have I
  spoken recently"; only the breaker sees the whole Stop chain thrashing.
  Notice goes to stderr only, never stdout.
- **All five Stop hooks rewired to the guard**, each keeping its previous
  throttle window: `nudge.py` 900s, `auto_skill.py` 600s,
  `memory_capture.py` 900s; `ingest_session.py` and `completion_gate.py`
  carry no throttle of their own (breaker only).
- **`completion_gate.py` uses `should_run()` only, not `emit()`.** Its
  definition-of-done block message must repeat identically every Stop
  until the conditions are actually met; content-hash dedupe would
  silently defeat the gate. Only the breaker can silence it.
- `memory_capture.py` keeps its own fact-level seen-marker
  (`~/.atlas/.memory_capture_seen`) separately from the guard's
  message-level dedupe; the two track different things and both stay.
- Version 5.1.1 -> 5.2.0. Minor bump: new capability (the guard module and
  breaker) plus a bug fix, no breaking change.

Evidence: 23 passed in `test_atlas_hook_guard.py`; 129 passed across the
five wired hook suites; 562 passed in `scripts`; 427 passed in `hooks`;
ruff clean. Incident replay against the real `memory_capture.py` hook (4
calls about 1s apart): call 1 emitted `additionalContext`, calls 2-4 emitted
nothing, exit 0 throughout. Breaker probe at a 13s cadence blocked at Stop 6
(t=65s); a legitimate 5-Stops-over-10-minutes cadence never trips; the
breaker is per-session (tripping session A does not silence session B).
Fail-open held under ten adversarial probes (corrupt JSON state, state path
as a directory, chmod 000 state dir, malformed stdin, missing `session_id`,
poisoned schema).

## 5.1.1 (2026-07-17)

Audit remediation: every reproduced defect from atlas-audit-2026-07-17.md
fixed and verified (972+ tests, 0 failures).

- **SessionStart context restored.** `hooks/session_boot.py` emitted
  `additionalContext` at the top level of its JSON output, which Claude
  Code silently ignores; it is now nested under
  `hookSpecificOutput.hookEventName: "SessionStart"`. Same fix applied in
  `memory_capture.py`, `nudge.py`, and `auto_skill.py`. The boot, memory,
  and resume context now actually reaches the model.
- **`/atlas` skill loads.** The plugin-root `SKILL.md` was inert (a
  root SKILL.md only loads when the plugin has no `skills/` directory);
  moved to `skills/atlas/SKILL.md`. The plugin now ships 22 skills. The
  phantom `atlas-grafana` menu entry was removed.
- **Self-improvement loop closed.** `scripts/skill_factory.py` wrote
  generated skills to `~/.atlas/skills/`, which Claude Code never loads;
  it now writes to `~/.claude/skills/` (override: `ATLAS_SKILLS_DIR`,
  honors `CLAUDE_CONFIG_DIR`). `atlas_curator.py` follows the same
  resolution. The auto path no longer crashes on a schema-less DB
  (`no such table: runs` is now a soft no-op).
- **Trigger flags reconciled.** Ten task skills shipped with
  `disable-model-invocation: true` (unreconciled context-optimizer
  output); restored to auto. Manual skills are exactly `atlas` and
  `atlas-setup` (22 skills: 2 manual, 20 auto).
- **resume_block fixed.** `session_boot.resume_block()` returned None
  for atlas-ctx-only resumes because the DB was opened without `init()`;
  fixed, own test now passes.
- **CLI hardening.** `build_hub.py` gained argparse (previously
  `--help` created a literal `--help/hub/` directory); `atlas_memory`,
  `atlas_curator`, `atlas_context_optimizer`, `skill_factory`, and
  `atlas_db` now exit 2 with usage on unknown commands (previously
  exit 0).
- **Prompt-optimizer timeout.** `hooks.json` now sets `"timeout": 120`
  on the UserPromptSubmit entry (Claude Code's 30 s default killed the
  optimizer path).
- **Docs and manifests reconciled to reality.** Hook count corrected to
  11 (was variously 8 and 10), skills to 22, `27 skills + 23 agents`
  stale claim removed, versions unified on 5.1.1,
  `manual-vs-auto-map.md` rewritten, malformed
  `..`atlas-orchestrate`/...` reference paths repaired,
  `plugin-health.py` path citations corrected, doctor's documented
  checks matched to `atlas_doctor.py` reality. `plugins/README.md`
  rewritten (previously described 11 plugins that do not exist in this
  repo); stale Task Master `plugins/CLAUDE.md` removed;
  `.kimi-plugin/marketplace.json` now lists `atlas` and `armada`.
- **Hygiene.** Tracked `.coverage` artifacts untracked and removed;
  caches cleaned and gitignored; `lint_skill_names.py` wired into the
  test suite (was referenced by nothing); strict-YAML frontmatter fixed
  in three skills; `atlas-gitignore` argument-hint normalized.

## 5.1.0 (2026-07-16)

Wiring-repair patch: connector MCP registration fixed, evidence paths
unified on the 5.0.1 convention, and portability holdouts removed.

- **`.mcp.json` moved from `.claude-plugin/` to the plugin root.** The
  manifest's `mcpServers: "./.mcp.json"` resolves relative to the plugin
  root per the Claude Code plugin spec, so all 10 connector servers
  (auvik, blumira, cipp, connectwise, spanning, knowbe4, ninjaone,
  paylocity, threatlocker, vanta) were silently never registered.
  `scripts/test_connectors_wiring.py` and
  `skills/atlas-setup/references/connectors.md` updated to the new path.
- **Evidence path unified.** `agents/ui-runtime-tester.md` and
  `agents/db-prober.md` directed evidence writes to `docs/evidence/`,
  which `hooks/completion_gate.py` never reads; both now write to
  `.atlas/evidence/`.
- **Audits location unified on `docs/audits/`.** The atlas-setup scaffold
  tree showed `audits/` under `.atlas/`, contradicting
  `scaffold_docs.py` (creates `docs/audits/` and refuses to scaffold over
  `.atlas/audits/`), atlas-audit (writes), and atlas-launch (reads). The
  tree and the completion-gate docstring now match the code.
- **Operating-contract fallback anchored.** 14 task skills told the model
  to fall back to a skill-relative `references/operating-contract.md`
  that exists only at the plugin root; all now use
  `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md`.
- **Rename residue and portability fixes.** atlas-launch no longer says
  "use after atlas-audit or atlas-audit"; atlas-audit's boundary section
  no longer defers to itself (names CODE vs ARCHITECTURE mode);
  atlas-wiki drops a hardcoded `/Users/...` path; atlas-db-audit anchors
  the read-only SQL guard at
  `${CLAUDE_PLUGIN_ROOT}/hooks/validate-readonly-query.sh`.
- **ASCII sweep.** 18 lines of em dashes removed across
  `agents/docs-curator.md`, both `docs-ssot.md` references,
  `atlas-setup/SKILL.md`, and `atlas-setup/references/install.md`.

## 5.0.1 (2026-07-14)

Docs-consolidation patch: `.atlas/docs/` retired, `docs/` is now the sole
project-documentation single source of truth. `.atlas/` never contains a
`docs/` subdirectory; it holds only atlas's own internal state (evidence,
audits, ephemeral `.run/`).

- **`.atlas/docs/` deleted.** Project documentation (CHANGELOG.md,
  ROADMAP.md, AGENTS.md, architecture/, features/, specs/, plans/,
  reference_files/, wiki/, lessons/) lives only under `docs/`.
  Atlas-internal state moved directly under `.atlas/`: `.atlas/evidence/`,
  `.atlas/audits/`, `.atlas/.run/`.
- **`scripts/scaffold_docs.py` rewritten.** Now scaffolds `docs/` and
  `.atlas/` (evidence/, audits/) from a single `<repo-root>` argument
  (previously took a `.atlas/docs` path directly). Refuses (exit 1) to
  scaffold over a non-empty legacy `.atlas/docs/` rather than silently
  warning and proceeding. `test_scaffold_docs.py` rewritten to match
  (idempotent no-op, never-creates-legacy-dir, and legacy-guard tests).
- **`hooks/completion_gate.py` rewritten.** `_find_ssot` (returned the
  `.atlas/docs/` dir) replaced by `_find_root` (returns the project root
  holding `docs/`); evidence/findings checks now read `.atlas/evidence/`
  and `.atlas/.run/findings.json` directly, CHANGELOG/ROADMAP checks read
  `docs/`. `test_completion_gate.py` rewritten to match (53 tests, all
  passing).
- **`hooks/dispatch_tripwire.py` fixed.** `_is_orchestration_path` now
  recognizes both `docs/` and `.atlas/` as orchestration-owned (previously
  only `.atlas/docs/`), so inline edits to either tree are correctly
  exempted from the inline-edit deny tier. `test_dispatch_tripwire.py`
  updated.
- **`hooks/session_boot.py`** advisory message updated to say `docs/ SSOT`.
- **`skills/atlas-wiki/scripts/check_wiki_freshness.sh`** now compares
  `docs/architecture/` against `docs/wiki/diagrams/`.
- Every `.atlas/docs/*` path reference across `plugins/atlas/skills/**`
  (SKILL.md files, `references/*.md`, `templates/*`) and
  `plugins/armada/skills/armada/references/org-config-schema.md`
  rewritten: durable/project paths now read `docs/*`; atlas-internal paths
  now read `.atlas/evidence/`, `.atlas/audits/`, `.atlas/.run/`. The two
  `docs-ssot.md` copies (atlas-orchestrate, atlas-loop) rewritten in full
  to document both trees, their ownership, and the legacy-guard behavior.
- Root `README.md` and `.gitignore` updated: `docs/` is stated as the sole
  SSOT (the prior "dual source of truth" clarification is retracted), and
  `.atlas/evidence/`, `.atlas/audits/` are allowlisted for tracking while
  `.atlas/.run/` stays gitignored.

## 5.0.0 (2026-07-12)

Skill consolidation driven by session forensics: a mined 4.7-hour production
session (38 dispatches, 1 skill auto-invocation) showed the mythological names
never routed, the fleet was 3x its working set, and verifiers confirmed changes
the running app contradicted. Breaking release.

- **Mythological names retired; fleet collapsed 27 -> 21 skills.**
  atlas-metis -> atlas-orchestrate; atlas-chronos -> atlas-loop;
  atlas-odysseus -> atlas-ux-test. atlas-athena, atlas-ariadne, and
  atlas-argus merged into atlas-audit (code / architecture / self modes,
  the demoted bodies live on as references/architecture-map.md and
  references/self-telemetry.md). atlas-olympus, atlas-hephaestus,
  atlas-hermes, and atlas-doctor merged into atlas-setup (onboard /
  install / connectors / repair modes; scripts/atlas_doctor.py is
  unchanged and still wired at SessionStart). atlas-nestor (skill-stacking
  concierge) deleted: a concierge over a smaller fleet is routing overhead.
- **armada split into its own plugin** (`plugins/armada`): the 3.0 MB
  org-deployment tree and the 11 armada-* department agents moved out of
  atlas; atlas alone now carries 12 core agents. New marketplace entry.
- **Runtime-evidence gate.** agents/verifier.md and the atlas-orchestrate
  definition-of-done now require runtime parity for a `verified` verdict:
  user-facing changes need an atlas:ui-runtime-tester pass or observed
  live behavior in the same wave; schema-touching backend changes need
  migration parity with the environment the user runs (suites that
  `create_all` their own schema do not count). Motivated by the mined
  session where every backend gate ran against in-memory SQLite while dev
  sat at migration rev 129.
- **Writers never share a tree.** Law 2 hardened: any wave with more than
  one writing agent uses `isolation: "worktree"` per writer or serializes;
  "they touch different files" is explicitly not an exemption.
- **Manifests made honest.** plugin.json, .kimi-plugin/plugin.json,
  marketplace.json, README.md, and the setup references
  (skill-routing.md, manual-vs-auto-map.md, recommendation-engine.md)
  rewritten for the 21-skill fleet; the stale 18-file commands/ tree
  claim removed from README (the directory does not exist).
- dispatch_tripwire.py ORCH_SKILLS and atlas_context_optimizer.py
  CORE/NICHE lists deduplicated for the merged names; optimizer tests
  updated (atlas-wiki replaces atlas-nestor as the niche fixture).
- README.md follow-up: 2 high-severity defects caught by atlas:completeness-critic
  (Kimi manifest armada false-positive, mcp_servers _shared omission) corrected;
  new README 343 lines, US-ASCII, 0 banned chars. See docs/CHANGELOG.md 2026-07-12
  follow-up entry.

## 4.0.0 (2026-07-11)

Skills mastery rebuild: rebuild the full 184-skill fleet (28 top-level
plus 156 armada across 11 departments) to the Claude Code Skills Mastery
Framework standard. The run is complete and verified: S1 through S8 are
green (S7 armada all 11 departments verified, S8 scaffold verified), and
S10 content fixes are verified. The only remaining items are advisory:
9 reserved placeholder directories with no SKILL.md yet (listed below).

- **Mastery framework standard applied.** Every skill now follows the
  three-layer progressive disclosure standard (L1 metadata, L2 SKILL.md
  body under 500 lines, L3 references/scripts/templates loaded on
  demand). The authoritative spec lives at
  plugins/atlas/skills/atlas-olympus/references/mastery-framework.md
  (frontmatter fields, the L1/L2/L3 budget rules, and the explicit note
  that `triggers:` is NOT a real Claude Code field and auto-trigger comes
  only from `description` plus `when_to_use`).
- **Olympus rebuilt as the manual onboarding layer.** atlas-olympus is
  one of only two manual skills in the fleet. Its frontmatter carries
  `disable-model-invocation: true`
  (plugins/atlas/skills/atlas-olympus/SKILL.md:5). It gained
  references/mastery-framework.md, references/manual-vs-auto-map.md,
  references/graphify-wiring.md, references/skill-routing.md, and
  references/recommendation-engine.md. The
  scripts/scaffold_docs.py deterministic scaffolder builds the 12-folder
  .atlas/docs/ tree from templates/ (verified idempotent, exit 0).
- **Gate flips: 2 manual, 26 auto.** Only atlas-olympus and atlas-doctor
  keep `disable-model-invocation: true`; the other 26 top-level skills
  are auto-trigger. Verified by grep for `disable-model-invocation`
  across plugins/atlas/skills/*/SKILL.md, which returns exactly
  atlas-doctor/SKILL.md and atlas-olympus/SKILL.md.
- **Inert `triggers:` field removed.** The atlas-invented `triggers:`
  frontmatter field is not a real Claude Code field and was removed from
  the armada skills; its keywords were folded into `description` and
  `when_to_use`.
- **allowed-tools pre-approval.** Skills gained `allowed-tools`
  frontmatter pre-approving safe read-only tools, and the armada
  department skills gained per-department MCP allowed-tools scoping
  (for example, it-ops gets auvik, ninjaone, connectwise, spanning
  wildcards that match the real .mcp.json server names; m365 gets cipp,
  microsoft-graph, microsoft-docs).
- **context:fork on isolation skills.** The research and isolation
  skills (ariadne, athena, argus, nestor) gained `context:fork` so their
  tool output does not pollute the parent context. Syntax confirmed
  against the Anthropic claude-code-setup skills reference.
- **Data interactive-dashboard-builder split.** The 786-line
  data/interactive-dashboard-builder SKILL.md was split into a 235-line
  SKILL.md plus references/interactive-dashboard-reference.md, keeping
  the SKILL.md under the 500-line L2 budget
  (plugins/atlas/skills/atlas-armada/departments/data/skills/interactive-dashboard-builder/SKILL.md).
- **Finance audit-support 5-way split.** The finance audit-support skill
  was split into an 80-line SKILL.md plus five references, all under 400
  lines: control-types.md, deficiency-classification.md,
  sample-selection.md, sox-testing-methodology.md, workpaper-standards.md
  (plugins/atlas/skills/atlas-armada/departments/finance/skills/audit-support/references/).
- **atlas-wiki producer skill added.** A new auto-trigger top-level
  skill atlas-wiki (198-line SKILL.md) invokes the repo-root graphify
  skill to render .atlas/docs/wiki/ diagrams from .atlas/docs/architecture/.
  It ships scripts/check_wiki_freshness.sh, which compares the newest
  mtime under .atlas/docs/wiki/diagrams/ against .atlas/docs/architecture/
  and emits FRESH, MISSING, or STALE (exits 0, 0, 1). This brings the
  top-level skill count to 28 (was 27).
- **m365 Microsoft Learn citations.** The m365 department skills gained
  references/microsoft-graph-api.md across 19 skills with 53-plus
  learn.microsoft.com citations.
- **.atlas/docs/ SSOT scaffolded.** The 12-folder durable docs tree
  (AGENTS.md, architecture/, audits/, CHANGELOG.md, evidence/, features/,
  lessons/, plans/, reference_files/, ROADMAP.md, specs/, wiki/) is
  scaffolded and non-empty. This tree is gitignored so it produces no
  git-diff entry; the tracked docs that move with the code are this
  CHANGELOG and plugins/atlas/README.md.
- **Subagent squad count corrected.** The README "Subagent squad" count
  was stale (said 18 and 12). Verified count is 23
  (plugins/atlas/agents/ holds 23 agent files; confirmed by
  plugin-health.py reporting 23 agents).

Additional verified fixes (S10 content pass):
- **Security audit-rubric directive.** Three security SKILL.md files
  (audit-forensics, evidence-gap-hunter, framework-audit-readiness)
  gained a one-line L2 read-directive to references/audit-rubric.md,
  fixing an orphaned reference (orphaned-ref fix).
- **Engineering Sentry allowed-tools corrected.** Five engineering
  Sentry skills (sentry-api-patterns, sentry-issue-triage,
  sentry-error-investigation, sentry-release-health,
  sentry-seer-root-cause) had allowed-tools corrected to
  mcp__io_github_getsentry_sentry-mcp__* (the real server key
  io.github.getsentry/sentry-mcp).
- **Olympus cleanup.** atlas-olympus had `import os` removed and
  allowed-tools corrected to Bash(python3:*); the scaffold runs 12/12
  idempotent.
- **manual-vs-auto-map.md updated.** atlas-wiki added; the map now
  lists all 28 top-level skills (2 manual, 26 auto). Resolved.
- **metis em-dash fixed.** The pre-existing em-dash at
  metis/references/multi-stage-planning.md:79 was replaced with plain
  ASCII. Resolved.

Reserved placeholder directories (advisory, not blocking):
Nine empty placeholder directories have 0-line SKILL.md files, are
reserved/planned, and will not auto-trigger. They are not deleted (Law 6
gate-write not authorized):
- hr: new-hire-flow, pay-rate-audit, roster-snapshot (3).
- finance: ramp-api-patterns, ramp-bill-vendor-reconciliation,
  ramp-card-controls, ramp-reimbursement-review, ramp-spend-triage (5).
- engineering: sonarqube-quality-gate (1).

## 3.2.0 (2026-07-11)

Close the two stalled self-improvement items from run 215 and fix the
marketplace-source doctor check that was failing on the real
known_marketplaces.json format.

- **Marketplace-source doctor fix.** `atlas_doctor.py` read
  `mkt["source"]["url"]` but Claude Code's `known_marketplaces.json`
  stores the repo as `{"source": "github", "repo": "owner/name"}`,
  with no `"url"` key. The check now reads `src.get("url") or src.get("repo")`
  so both formats pass. The fix function was updated to handle both
  formats too. Doctor now reports HEALTHY on the real install.
- **Verifier coverage made concrete.** The engine SKILL.md step 3 now
  requires a `docs/.run/findings.json` entry for every
  implementer→verifier pair, with a concrete JSON schema. The
  mechanical rule is stated explicitly: every implementer dispatch
  MUST be followed by a verifier dispatch; pending stages block
  dependents. This closes the stalled improvement where
  `verifier_coverage` was NULL on every recent run because the prompt
  described verification but never gave a writable artifact to track
  it. `multi-stage-planning.md` gains the matching `findings.json`
  format section with rules.
- **Parallel dispatch made mechanical.** Engine SKILL.md step 2 now
  has an explicit batch-dispatch paragraph: independent stages MUST
  go in a single assistant message with multiple Agent tool calls.
  The `parallel_waves` metric is named directly so the orchestrator
  knows it is being measured. This closes the stalled improvement
  where `parallel_waves` stayed at 0-1 despite 16-34 dispatches per
  run because the prompt said "must" but never made batching
  mechanical.
- **Stale agent reference fixed.** `capability-routing.md:41`
  referenced `orc-audit` (a pre-atlas agent name removed in the
  v2.0.0 rename). Now correctly routes to `atlas:explorer`.
- **DB audit agent Write permission constrained.** Three read-only
  DB audit agents (`schema-inventory`, `naming-glossary-audit`,
  `rls-privilege-audit`) had `Write` in their `tools:` frontmatter
  without `disallowedTools` for Edit/MultiEdit. Added
  `disallowedTools: [Edit, MultiEdit, NotebookEdit]` and an
  explicit constraint: "Write is permitted ONLY for the `.audit/`
  output file. Never write to source code, config, schema, or any
  path outside `.audit/`."
- **Observability DB VACUUM.** Reclaimed 755MB of space from the
  July 9 observer purge that removed rows but never compacted the
  file. DB went from 803MB to 48MB.

## 3.1.3 (2026-07-10)

Close the rest of the Windows-invalid-path class. An independent atlas:verifier
confirmed the 3.1.2 fix but flagged that the same defect was still live in three
untouched writers: atlas-chronos's `loops/<id>.md`, and the atlas-metis naming
conventions (`docs/plans/<slug>.md`, `docs/features/<feature-slug>.md`,
`docs/runs/<id>/`, etc.) that every atlas-metis task composes. 3.1.2 fixed only
the two audit skills; 3.1.3 closes the general case.

- **Canonical slug rule.** `atlas-metis/references/docs-ssot.md` "Naming
  conventions" now defines one filesystem-safe slug algorithm for every `<slug>`,
  `<id>`, `<scope>` it lists, with the Windows-reserved set and reserved device
  names spelled out. This is the single source the other skills point to.
- **atlas-chronos.** `SKILL.md` loop-creation step now requires `<id>` to be a
  filesystem-safe slug and references the canonical rule.
- **session-lifecycle.** The `docs/runs/<id>/` archive note now requires a
  filesystem-safe id, referencing the canonical rule.
- **Why it matters.** docs-ssot naming is load-bearing for all atlas-metis
  output, not just audits; a raw `frontend:auth` task name flowing into
  `docs/plans/` would have reproduced the exact same checkout failure.

## 3.1.2 (2026-07-10)

Filesystem-safe audit filenames. atlas-ariadne and atlas-athena wrote
per-feature and per-finding files from raw, model-chosen names. When a name
carried a colon (e.g. `charts/frontend:public-site-and-auth.md`), Git on Windows
rejected the whole checkout with `error: invalid path`, blocking everyone from
syncing the repo. The generators now slug every filename before writing.

- **Slug rule.** `atlas-ariadne/SKILL.md` gains a "Filename safety" section:
  lowercase, replace any character outside `a-z 0-9 . _ -` (the Windows-reserved
  set `< > : " / \ | ? *` plus spaces) with `-`, collapse and trim, guard against
  reserved device names and slug collisions. The human-readable name still heads
  the file, so nothing is lost.
- **Both write points constrained.** Inline reminders at the `charts/<feature>.md`
  and `handoffs/<system>.md` writes, plus slugged placeholders in the output tree.
- **Sibling skill covered.** `atlas-athena/SKILL.md` shared the same latent
  exposure via `handoffs/<finding-id>.md`; it now carries the matching constraint.
- **Scope note.** `build_hub.py` only reads existing handoff files and writes
  fixed names, so it was never a source; the fix is in the orchestrator prompts.

## 3.1.1 (2026-07-10)

Phase glyphs in the status header. The `ATLAS | <phase> | <state>` line now
carries a per-phase emoji so the current stage reads at a glance in the
terminal, where markdown offers no color and ANSI escapes do not pass through.

- **Glyph vocabulary.** `atlas-orchestrator.md` maps each engine phase to one
  glyph: research 🔍, theory 💡, test 🧪, validate 📋, implement 🔧, verify ✅,
  done 🏁, blocked ⛔. Header format becomes `ATLAS | <glyph> <phase> | <state>`.
- **Scoped ASCII exception.** The plain-ASCII rule now permits exactly the eight
  header glyphs and nothing else; prose stays emoji-free.

## 3.1.0 (2026-07-09)

Enforcement teeth, fork doctrine, multi-agent chronicle, de-overlap. Every change
independently verified (`docs/.run/findings.json` at repo root); 115/115 tests.

- **Arm-early classifier.** `prompt_optimizer.py` arms the orchestration flag on
  substantive engineering prompts (two-tier verb design; `ATLAS_ENGINE_ARM=off`)
  and nudges engine invocation, ending the flag's dependence on a first dispatch.
- **Tripwire deny tier.** `dispatch_tripwire.py` now also runs on PreToolUse:
  denies the 9th undelegated inline op and inline edits to production paths,
  orchestration sessions only; `ATLAS_TRIPWIRE_HARD=off` escape; the PostToolUse
  advisory at 4 is unchanged.
- **Gate condition (g).** `completion_gate.py` blocks Stop when implementer
  dispatches lack paired verifier dispatches (Law 5, machine-enforced), via the
  new `atlas_db.unpaired_implementer_dispatches`.
- **Coverage re-sourced.** `verifier_coverage` derives from the `dispatches`
  table (NULL when no implementer dispatches), replacing the mismatch-prone
  `tool_calls` computation.
- **Fork doctrine.** `subagent-kit.md` routes planner/critic/curator/synthesis
  dispatches to `subagent_type: "fork"` (full-history inheritance,
  `CLAUDE_CODE_FORK_SUBAGENT=1`); verifier/explorer stay fresh-context.
- **Output style auto-applies.** `atlas-orchestrator.md` gains
  `force-for-plugin: true`, trimmed 66 -> 49 lines.
- **Observer pollution fixed + purged.** Ingest excludes
  `.claude-mem/observer-sessions`; `purge_observer_sessions` removed 14,078
  polluted session rows from the live DB (evidence at repo
  `docs/evidence/2026-07-09-observer-purge.md`).
- **Codex chronicle.** `session_logs.agent` column + adapter registry with a
  codex JSONL adapter; `session_ingest.py --backfill-agent codex` ingested 170
  real sessions (idempotent, observer-excluded, secret-scrubbed). Known
  limitation: codex token deltas partially persisted (undercount) - see the
  sextant skill's caveat.
- **De-overlap.** 33/40 frontmatter descriptions rewritten to tight unique
  triggers (plugin description 1548 -> 281 chars); atlas-nestor command is
  routes-only; docs-auditor solely owns docs-drift; no functionality changed.
- **Docs synced.** Engine SKILL.md, hooks-automation.md (seven conditions),
  README hook table, and sextant public-API docs reconciled against the shipped
  code and re-verified claim-by-claim.

## Unreleased

Agent-roster and spec-conformance hardening pass (audit:
`docs/audits/atlas-harden-2026-07-07/`). No version bump in this pass - release
timing left to Jerry.

- **Removed.** The five `ux-*` agent specs (`ux-cartographer`, `ux-persona`,
  `ux-fuzzer`, `ux-accuracy-oracle`, `ux-reporter`) and `api-usage-map`, each
  checked for live skill/command dispatches before deletion. `atlas-odysseus` is
  now the sole canonical owner of UX testing; `ux-test-swarm.md` collapsed to a
  short pointer at that skill.
- **Routing gained three rows.** `skills/atlas-metis/references/capability-routing.md`
  now routes to atlas-hephaestus (project boot/onboarding), atlas-metis's own
  self-entry (orchestration), and atlas-nestor (skill selection), and annotates the
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
- **atlas-hermes rewritten** as the cross-plugin connector setup guide: detects which
  domain plugins are installed (`~/.claude/plugins/installed_plugins.json`, or advises
  `/plugin`), shows enabled/disabled state per vendor by reading the *owning* plugin's
  config, and directs credential entry to that plugin's `/plugin config` - never to
  atlas. `vendors.md` updated to the same model, plus a migration note.
- **Stale references swept**: `skills/atlas-metis/references/capability-catalog.md`,
  `skills/atlas-metis/SKILL.md`, `scripts/discover_capabilities.py`,
  `commands/atlas.md`, and `README.md` no longer claim atlas ships or bundles vendor
  connectors.
- **MIGRATION.** Credentials previously configured on atlas's own plugin config (e.g.
  `paylocity_client_id`) must be re-entered on the owning domain plugin via `/plugin`
  config - atlas's copies of those `userConfig` keys are gone. Run atlas-hermes's
  no-args status scan to see current enabled/disabled state per connector.

## 2.5.0

Connective-tissue release: the orchestration machinery now engages deterministically
instead of depending on the model remembering prose, and the definition-of-done gate
covers the full docs contract (audit findings 2026-07-03).

- **Auto-set orchestration marker.** `hooks/dispatch_tripwire.py` now flags the session
  orchestrating when an orchestration skill (atlas-metis, atlas-athena,
  atlas-ariadne, atlas-odysseus, atlas-chronos) is invoked via the Skill tool or when
  an `atlas:*` subagent is dispatched. The manual `mark-orchestrating` CLI remains as a
  fallback. hooks.json PostToolUse matcher extended with `Skill`. 4 new tests.
- **Completion gate widened 3 -> 6 conditions.** `hooks/completion_gate.py` now also
  requires `docs/ROADMAP.md` non-empty (d), root `README.md` non-empty (e), and no docs
  drift (f): if non-docs files changed this run but no `docs/` file did, the Stop blocks
  once and directs an `atlas:docs-curator` dispatch - drift was previously advisory-only.
  4 new tests incl. an end-to-end git-drift case.
- **Elicitation posture reversed.** atlas-metis SKILL.md and `/atlas-prompt` previously
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
- **New skill + command: atlas-nestor.** AskUserQuestion-driven skill stacking: elicits
  the goal (one round), inventories the skills actually installed this session, composes
  an ordered Skill-invocation chain (atlas-metis rides along for anything substantive),
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
  atlas-nestor), SKILL.md definition-of-done and first-action sections, plugin.json and
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
  `skills/atlas-metis/references/memory-access.md:36`.

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
  while the `atlas-argus` Trends table compares dimensions like
  `verifier_coverage` and `parallel_waves`; it now returns all of them.
- **`latest_run_id(conn, session_id)`** added: resolves the most recent run open
  OR closed, so post-Stop metric derivation attaches regardless of hook ordering.
- `atlas-argus` SKILL.md corrected: `derive_run_metrics` marked auto-wired,
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
  `atlas-argus` documented them as live signals. They are now computed from the
  transcript mirror (peak main-thread context, verifier-vs-implementer dispatch
  ratio, timestamp-clustered dispatch waves, session span). `recall_hits` /
  `recall_misses` remain intentionally un-derived - judging whether a memory
  result was usable is semantic, not a count - and the skill now marks a NULL
  there as "not yet assessed".
- `atlas-argus` SKILL.md documents how each metric is populated and adds
  `derive_run_metrics` to the public API.

## 2.2.0

Added the session-forensics lens to `atlas-argus`. atlas now indexes the
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
- `atlas-argus` SKILL.md documents the third lens and the four questions it
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

Added the asset/context-cost lens to `atlas-argus`. Previously the skill only
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
