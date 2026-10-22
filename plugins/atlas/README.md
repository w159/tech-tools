# atlas

A self-configuring Claude Code plugin that turns any coding agent into a disciplined
multi-agent architect. Run `atlas-setup` once to onboard a project, then drive work
through the auto-triggering skills and the `atlas:<role>` subagent squad. A
SessionStart hook loads the runtime automatically every session, and the
self-improvement hooks (memory capture, chronicle facet capture, nudge, session
ingest) make the agent better in a codebase the more it is used. No hook creates a
skill or a slash command: durable knowledge goes to findings, docs, and memory.

Org deployment (11 departments, 156 department skills) lives in the separate
`armada` plugin in this repo; install it alongside atlas only for org use.

## The skill fleet (39 skills, plainly named)

One manual skill, 38 auto-trigger skills. Auto-trigger comes primarily from each skill's `description` (Claude Code
loads on relevance); `when_to_use` is retained as atlas-local routing metadata.
The manual skill sets `disable-model-invocation: true`.

Overlapping capabilities are modes of one skill rather than separate skills: atlas-setup (onboard, install, connectors, repair, tour), atlas-dogfood (full, smoke), atlas-frontend (build, component, polish), atlas-run-watch (jobs, PR CI), atlas-bakeoff (bakeoff, verdict), atlas-brainstorm (requirements, strategy), atlas-orchestrate (engine, feature flow), atlas-ship (full, commit-only), atlas-status (status, announce), atlas-audit (code, architecture, self, act), atlas-sweep (sweep, analyze). Each SKILL.md opens with its mode table. atlas keeps its own orchestrator, named agents, docs/.atlas SSOT, findings ledger and explicit-push-consent policy as the execution and safety authority throughout.

| Skill | Mode | What it does |
| --- | --- | --- |
| atlas-audit | auto | Audits a codebase: CODE (quality, security, hotspots, dead code, docs drift), ARCHITECTURE (flowcharts, duplication), SELF (atlas run health), or ACT (open a remediation session for one audit finding by id; no id lists them). Use to audit a repo, map architecture or fix a finding. |
| atlas-autopilot | auto | Consent-gated autonomous pipeline: runs a ready plan or diagnosed fix via atlas-orchestrate, simplifies, reviews, fixes under a budget, stops at the local commit. Use to run a plan end to end. |
| atlas-bakeoff | auto | Decides a technical choice with evidence: compares 2-3 approaches against named criteria (bakeoff), or grades one option Adopt, Trial, Hold or Reject (verdict). Use when a costly, hard-to-reverse choice or a second opinion is needed; reversible picks go to atlas-plan. |
| atlas-brainstorm | auto | Grills a vague idea one hard question at a time, recommending an answer each turn, until shared understanding. Default mode writes a requirements-only docs/plans/ artifact (WHAT, not HOW); strategy mode writes docs/architecture/product-strategy.md. Writes no product code. Use before atlas-plan. |
| atlas-compound | auto | Captures one durable, verified, non-obvious lesson into docs/lessons/ after an eligibility gate and overlap check. Use after solving and verifying a problem a future engineer would repeat. |
| atlas-db-audit | auto | Audits a live database read-only via parallel subagents: schema inventory, schema-to-code reconciliation, privileges, naming. Use before a schema or permission change. |
| atlas-debug | auto | Diagnoses a reproducible bug, exception, stack trace or bad output and fixes the root cause with evidence. Use when the cause of a failure must be found and fixed. |
| atlas-doctor | auto | Atlas self-improvement loop: mines cross-session findings from atlas.db, applies accepted changes, records a baseline. Use when telemetry has accumulated or before changing a skill, hook or agent. |
| atlas-dogfood | auto | Drives the branch or PR diff in a live browser via atlas:ui-runtime-tester: full mode repairs genuine breaks in a bounded loop, smoke mode only reports Pass, Fail or Skip per route. Use for end-to-end flow checks or a quick render check. |
| atlas-explain | auto | Explains how or why existing code behaves, in chat, with file:line evidence from an atlas:explorer trace; read-only. Use when asked how something works or what code means. |
| atlas-frontend | auto | Builds, refactors or polishes frontend UI on one design system (shadcn/ui, Tailwind, Radix), verified live in the browser. Modes: build (screens, flows), component (one reusable async component), polish (live visual refinement). Use when creating or reworking UI. |
| atlas-gitignore | auto | Generates a zero-trust, deny-by-default .gitignore for a named stack, secrets re-excluded last. Use when starting a repo or hardening a .gitignore. |
| atlas-handoff | auto | Produces a dense session handoff so a fresh session resumes without re-discovery. Use at a checkpoint before context fills, before a break, or when handing work to another session. |
| atlas-harden | auto | Writes an idempotent endpoint remediation script (CHECK/SET/VERIFY) for RMM or MDM that proves whether it changed state. Use to remediate or enforce an endpoint setting at scale. |
| atlas-loop | auto | Matches a recurring or iterative task to a library loop: interval loops use /loop, fan-out loops run as a parallel verify workflow. Use to repeat, poll, iterate until a condition holds, or sweep. |
| atlas-optimize | auto | Single-experiment loop: baseline, one hypothesis, one change, identical re-measure, real delta reported. Use when a working system's metric should improve; not for bugs or restructuring. |
| atlas-orchestrate | auto | Orchestrates multi-step, multi-surface or whole-codebase work (build, fix, audit, refactor, investigate) via subagents with independent verification. Includes a feature flow that builds one feature across UI, API and data with the squad. Use when a task spans layers or the repo. |
| atlas-plan | auto | Writes an implementation-ready plan to docs/plans/ from a brainstorm artifact or feature description, with U-numbered units and a verification contract. Use when requirements are settled. |
| atlas-prompt | auto | Rewrites a vague coding request into a structured, environment-aware prompt, asking up to three questions if scope is ambiguous. Use when a request is underspecified. |
| atlas-proof | auto | Human-review workflow for project markdown: publishes a doc for review, records anchored comments in a sidecar file, folds feedback back. Use to share a plan, spec or draft for review; not proofreading. |
| atlas-prototype | auto | Builds a throwaway prototype in an isolated run directory to answer one visual, interaction or product-shape question, then promotes decisions into a plan or discards it. Use when showing beats arguing. |
| atlas-pulse | auto | Generates a time-windowed product pulse (usage, performance, errors) from wired telemetry, read-only, into docs/pulses/. Use for a product pulse or usage and error summary. |
| atlas-readme | auto | Generates an onboarding-grade README.md by inspecting the repo, tracing every claim to a file. Use when a repo has no README or a stale one. |
| atlas-refactor | auto | Refactors, renames or restructures code without changing behavior, with before/after evidence. Use when code works but is messy, hard to navigate or carries dead weight. |
| atlas-resolve-pr-feedback | auto | Resolves PR review feedback: triages each thread (fix, reply, needs-human), applies approved fixes, drafts replies, confirms before pushing or posting. Use when a PR has open review comments. |
| atlas-review | auto | Risk-selected multi-persona review of a diff, branch or PR; P0/P1 findings verified, report-only verdict (Ready, Ready-with-fixes, Not-ready). Use before merge. |
| atlas-run-watch | auto | Watches a long-running job (PID, log tail, CI URL, API, command loop) or one open GitHub PR's CI with tick/checkpoint/re-arm, spilling logs to a run ledger. PR targets repair genuine CI failures in a bounded loop, ask before pushing and never merge. Use when a job or PR needs watching. |
| atlas-setup | MANUAL | Manual atlas lifecycle: onboard (scaffold docs/ and .atlas/), install (claude-mem, context-mode, hooks), connectors (vendor MCP), repair, tour (first-session walkthrough), menu. Use to bring atlas online, fix it or learn it. |
| atlas-ship | auto | Ships finished work: fresh-context verifier checks a clean tree, local commit, stops for confirmation before any push or PR. Commit-only mode makes just the local conventional commit from a file list. Use when work is ready to commit or open a PR. |
| atlas-simplify | auto | Behavior-preserving simplification pass over a fresh diff (reuse, quality, efficiency reviewers), then re-runs the gate. Use after implementing, before review or commit; restructuring is atlas-refactor. |
| atlas-status | auto | Builds a stakeholder-readable status rollup for a plan or feature from docs/plans/, findings, the todo board and commits, claims labeled verified or assumed. Announce mode drafts plain-language release notes, Slack updates and changelog entries for shipped work. Use when asked how a feature is going or to announce it. |
| atlas-sweep | auto | Turns feedback into triaged findings. Sweep mode ingests new GitHub issues, triages them, verifies claimed fixes and updates a docs/features/ triage doc, never auto-closing or replying. Analyze mode turns a transcript, support thread or notes into findings tied to verbatim quotes. Use when feedback needs triage or analysis. |
| atlas-test-xcode | auto | Tests an iOS app on the simulator: boots it, builds and tests via xcodebuild, captures screenshots and logs. Use to build or test an iOS or Xcode project; macOS only. |
| atlas-testing | auto | Plans, generates, and runs tests in any language: detects the stack and existing tests, maps gaps across every testing type (unit through mutation, fuzz, load, security, accessibility), recommends the highest-value next test, writes it, runs it, and reports evidence. Use to add tests, choose a test strategy, or find what testing is missing. |
| atlas-tui | auto | Opens the Atlas Colony workspace TUI (SESSIONS, CHANNEL, PEEK, STEER) over live colony tmux workers (omp/claude/codex); read the channel, steer or hold a seat. |
| atlas-ux-test | auto | UX test swarm for a web app: generates personas, drives real-browser walkthroughs and fuzzing, gates on client-surface correctness. Use for a full UI/UX pass or persona testing. |
| atlas-validate | auto | Verifies a finished Claude Code plugin: structure, manifest and content quality, file:line findings, pass or fail per check, no auto-fixing. Use when a plugin is believed complete. |
| atlas-wiki | auto | Generates and refreshes docs/wiki/ diagrams from docs/architecture/ using graphify. Use when architecture docs changed, before the completion gate, or when wiki diagrams are stale. |
| atlas-worktree | auto | Git-worktree primitive: creates or reuses linked worktrees, tears down with dirty-state protection. Use to isolate parallel implementer waves, spikes or bakeoffs, or close them at wave end. |

## Layout

```
atlas/
|-- .claude-plugin/plugin.json     # manifest (name: atlas, v12.8.0; 58 userConfig keys)
|-- package.json                   # omp.extensions entry ("./omp/index.ts") for marketplace installs
|-- contracts/                     # shared rules read by the Python hooks AND the omp modules (native-tools, mandates, tool-names, hook-bridge)
|-- omp/                           # omp extension package (index.ts, hook-bridge, mandates, style, advisor, workers, ...; omp/agents/ is GENERATED by gen-agents.ts)
|-- mcp/                           # 12 bundled connector servers (11 Node server.mjs + vendored falcon); declared in .mcp.json
|-- hooks/                         # 17 hook programs / 22 bindings (16 in hooks/ + atlas_doctor.py in scripts/, SessionStart; hooks.json wires them all)
|   |-- session_boot.py            #   SessionStart: activate runtime, surface lessons
|   |-- prompt_optimizer.py        #   UserPromptSubmit: optional rewrite + orchestration arm-early classifier
|   |-- bash_advisor.py            #   PreToolUse(Bash): advisory warning on catastrophic commands only
|   |-- recall_gate.py             #   PreToolUse(all tools): deny every non-claude-mem call until one real recall happens (TodoWrite exempt; armed when claude-mem is enabled)
|   |-- fallow_gate.py             #   PreToolUse(Bash): fallow audit gate on git commit/push (fail-open if CLI absent)
|   |-- todo_capture.py            #   PostToolUse(TodoWrite): mirror the plan into the durable board <project>/.atlas/.run/todos.json
|   |-- format_after_edit.py       #   PostToolUse(Edit/Write): format after edits
|   |-- edit_read_nudge.py         #   Pre/PostToolUse advisory: edit of a file read only via ctx_read
|   |-- delegation_prewarn.py      #   PostToolUse(Edit/Write/MultiEdit/NotebookEdit): once-per-session pre-warn that an inline code edit will trip completion_gate (m)
|   |-- docs_drift_watch.py        #   PostToolUse(Edit/Write/MultiEdit/NotebookEdit): inline docs-drift warning, debounced
|   |-- dispatch_tripwire.py       #   PostToolUse advisory + PreToolUse deny: curb inline drift; flag a verifier that wrote no findings.json row
|   |-- connector_credential_watch.py # PostToolUse(mcp__plugin_atlas_.* + known bare MCP prefixes): one warning on connector auth failure -- restart, do not sweep endpoints
|   |-- stop_tail.py               #   Stop: one process runs ingest_session, chronicle_facet, memory_capture, nudge in order (replaces four Stop entries)
|   |-- completion_gate.py         #   Stop: block premature "done" until the definition-of-done holds
|   |-- ingest_session.py          #   Stop/SubagentStop/SessionEnd/PreCompact: mirror transcript to the observability DB
|   |-- chronicle_facet.py         #   Stop: write one facets row + mirror signals into friction_events
|   |-- memory_capture.py          #   Stop: persist lessons to ~/.atlas/memory/ (not bound to SubagentStop)
|   |-- nudge.py                   #   Stop only: self-improvement nudge (throttled)
|   |-- worker_report_gate.py      #   SubagentStop: block an atlas:* subagent whose final message is not the fixed report container (once per agent_id; fail-open)
|   |-- docs_drift.py              #   not a hook; shared find_root/docs_drift/git_changed_paths used by completion_gate.py and docs_drift_watch.py
|   `-- validate-readonly-query.sh #   not auto-loaded; DB-audit subagents wire it during read-only audits
|-- scripts/                       # 25 non-test tools, each with a test_*.py beside it: atlas_doctor.py (repair + --mine miners; also wired via hooks.json --hook, SessionStart),
|                                  # atlas_db.py (observability), atlas_todo.py (durable todo board + notes), atlas_finding.py (verifier's findings.json write path),
|                                  # atlas_dashboard.py + atlas_control.py (local dashboard and its control plane), atlas_mux.py (colony workers: herdr panes, tmux fallback), atlas_herdr.py + atlas_launch.py + atlas_remote.py (herdr colony, pinned binary, tailnet access), atlas_wt.py (isolated-worker git worktrees: add/status/merge/prune, branch worker/<agent>, worktree .atlas/wt/<agent>), atlas_packs.py,
|                                  # atlas_memory.py, atlas_curator.py, atlas_context_optimizer.py, atlas_hook_guard.py, session_ingest.py, sweep_state.py,
|                                  # tool_routing.py, turn_scoring.py, typesafe_client.py, lint_docs_names.py (gate condition (l)), lint_skill_names.py,
|                                  # asset_audit.py, discover_capabilities.py, build_hub.py, install_hooks.py
|-- references/                    # plugin-wide references every skill and agent may load
|   |-- operating-contract.md      #   the research -> document -> implement -> verify -> report loop
|   |-- connector-config-flow.md   #   how a vendor connector gets configured
|   `-- connector-tool-disclosure.md
|-- output-styles/
|   `-- atlas-orchestrator.md      # force-for-plugin: true - auto-applies whenever atlas is enabled
|-- agents/                        # 14 core agents (atlas:<role>), auto-registered
|   |-- explorer.md                #   read-only codebase mapping (never fork)
|   |-- implementer.md             #   bounded, verified code edits
|   |-- verifier.md                #   adversarial confirm/refute with runtime-parity requirement (never fork)
|   |-- test-engineer.md           #   authors and runs tests for one slice: seeded-fault proof, suite run, mutation report
|   |-- db-prober.md               #   read-only schema/RLS/index inspection
|   |-- schema-inventory.md        #   PostgreSQL catalog inventory
|   |-- rls-privilege-audit.md     #   read-only RLS/grants/privilege audit
|   |-- naming-glossary-audit.md   #   table/column name audit against project glossary
|   |-- ui-runtime-tester.md       #   live browser/runtime behavior
|   |-- planner.md                 #   multi-stage decomposition + stage maps (fork)
|   |-- docs-curator.md            #   maintains the docs/ single source of truth (fork)
|   |-- docs-auditor.md            #   audits docs/ for drift against code
|   |-- completeness-critic.md     #   "what did we miss" gap pass before done (fork)
|   `-- runner.md                  #   mechanical executor (haiku/low) for <=7 exact numbered STEPS; fixed STEPS: report
`-- skills/                        # the 39 skills, one directory each (SKILL.md; most add references/)
```

## Getting started

Install the plugin (place this directory under your plugins root, or install from
the marketplace). On the next session the boot hook activates the runtime
automatically. Then run `atlas-setup` once per project: it scaffolds
`docs/`, installs claude-mem and context-mode if you approve, recommends
the capabilities your stack needs, and tells you what to run next.

For omp, load the extension package by DIRECTORY -- agents are only discovered
from a directory entry:
`omp --extension <abs>/plugins/atlas/omp`, or add that directory to
`extensions:` in `~/.omp/agent/config.yml`. The extension adds the enforcement
this CLI needs: native `grep`/`glob` route to lean-ctx, `read`/`bash` get one
nudge per session, and `session_stop` blocks once for main-thread non-docs
`edit`/`write` calls without a `task` dispatch. Native atlas agents (generated
from `agents/*.md` with tuned `thinkingLevel` and model-role fallbacks -- see
`omp/README.md`; agents carry `tier_allow` and `effort_allow` in frontmatter and
the scope resolver emits the `model` per seat) make omp workers first-class colony members: the lead's omp
`todo` plan mirrors into the durable board, and workers get
`CLAUDE_PLUGIN_ROOT` set so `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py`
works. The same `ATLAS_TRIPWIRE_HARD=off` and `ATLAS_GATE=off` kill switches
apply.

On omp, `~/.atlas/settings.json` `env` (Command Center settings) is applied at
extension load (`applyAtlasStoreEnv` in `omp/index.ts`), and while `task`
subagents run an `atlas-channel` widget (`omp/channel-view.ts`) shows the live
channel notes and member status (`ATLAS_CHANNELS=off` disables it). Doctor checks
`install-content` and `omp-content` (`check_content_drift`) warn when an installed
copy differs from the source checkout.

## Hooks

The hooks auto-load from `hooks/hooks.json` when the plugin is installed - no
manual step. All are stdlib-only. Most fail open on an internal error (exit 0
or an explicit `fail-open` decision), but two fail closed on purpose:
`dispatch_tripwire.py` denies a `Skill`/`Agent`/`Task` dispatch outright when it
cannot read the inline-op count from the observability DB (`_deny`, "DENY -
tripwire could not verify... Failing closed") and unconditionally denies any
nested subagent dispatch regardless of DB state; `completion_gate.py` denies
"done" whenever its checked conditions fail, and only its own unhandled
exceptions fail open. `fallow_gate.py` also denies on purpose (`verdict: fail`
from the fallow CLI on git commit/push) but is fail-open by design when the
CLI itself is missing (`ATLAS_FALLOW=off`).

`completion_gate.py` conditions (a)-(l) gate sessions flagged `orchestrating`
in the observability DB. Condition (m), the delegation mandate, also blocks
once in an unflagged `docs/` project when the main thread shipped non-docs
code with zero `Task`/`Agent` dispatches; sidechains are exempt and errors
fail open. The flag is set by two independent writers -
`dispatch_tripwire.py`, when a `Skill` dispatch names an orchestration skill
(gated by `ATLAS_TRIPWIRE`), and `prompt_optimizer.py`'s `arm_orchestration`,
when a prompt reads as substantive engineering work (gated by
`ATLAS_ENGINE_ARM`). Ambiguous prompts, a common verb plus a generic noun
such as "table", or a longer prompt the regex does not arm, can be
reclassified by a local System One model (`hooks/prompt_decision.py`,
default `http://127.0.0.1:11434`, model `nimble`). A confident conversation
label vetoes a regex arm. A confident `code_change` or `investigation`
label can arm a regex miss. Timeout, low confidence, a bare defect label,
and `ATLAS_DECISION=off` leave the regex answer in place. File and sqlite
gates are not model calls. Either write arms conditions (a)-(l); disabling both
writers prevents new flags but does not disable (m) or clear existing flags.
`ATLAS_GATE=off` disables the whole completion gate.

| Hook | Event | Purpose |
| --- | --- | --- |
| `session_boot.py` | `SessionStart` | Activate the runtime, report dependency state, surface relevant lessons, carry the todo board over, and repair the durable `docs/` tree (creates any missing scaffolder-owned subfolder; only when `docs/` already exists, so a project that never asked for one is never scaffolded behind the user's back -- it gets a one-line notice instead; `ATLAS_DOCS_REPAIR=off`); when the claude-mem plugin is enabled, adds a "Recall first" line telling the session to run one claude-mem search before planning (`ATLAS_MANDATES=off`) |
| `atlas_doctor.py --hook` | `SessionStart` | Rollback guard: warn loudly if the installed plugin was downgraded, the marketplace points at a fork, or hooks/assets are missing (warn-only, always exits 0) |
| `prompt_optimizer.py` | `UserPromptSubmit` | Optional trigger-gated prompt rewrite; also arm-early classifier that flags substantive engineering prompts as orchestration runs (`ATLAS_ENGINE_ARM=off`). The ambiguous band may call a local System One model (`ATLAS_DECISION=off` keeps the regex) |
| `bash_advisor.py` | `PreToolUse` (Bash) | Advisory only: warns on catastrophic patterns (`rm -rf /`, `mkfs`, `dd` to a disk, fork bomb), and once per session nudges a ponytail-review of the staged diff before `git commit` when the ponytail plugin is enabled (`ATLAS_MANDATES=off`). Never denies |
| `fallow_gate.py` | `PreToolUse` (Bash) | Fallow agent gate: on `git commit`/`git push`, runs `fallow audit --format json --quiet --explain --gate-marker agent` and denies when `verdict` is `fail`. Fail-open if the fallow CLI is missing (`ATLAS_FALLOW=off`, `FALLOW_GATE_MIN_VERSION`). Docs: `skills/atlas-orchestrate/references/fallow-tools.md` |
| `recall_gate.py` | `PreToolUse` (all tools) | claude-mem recall gate: the first main-thread tool call that is neither a claude-mem call nor `TodoWrite` is denied on every attempt until a real claude-mem call happens, naming the claude-mem search tool and an example argument (only a claude-mem call satisfies it). Armed only when the claude-mem plugin is enabled (hooks cannot see the callable tool set, so this is the proxy); skips subagent transcripts; fail-open (`ATLAS_MANDATES=off`). The omp twin is `omp/mandates.ts`; shared cases in `contracts/mandates.json` |
| `dispatch_tripwire.py` | `PostToolUse` + `PreToolUse` | In `docs/` projects where lean-ctx is reachable (binary on PATH AND a lean-ctx MCP server in `.mcp.json` / Claude settings; a server supplied only by an installed plugin's `.mcp.json` is not detected and falls back to the nudge), deny native `Grep`/`Glob` toward `ctx_search`/`ctx_glob` (naming the `ToolSearch` load step), including subagents and unflagged sessions; otherwise allow with a one-time nudge. Allowed native calls still hit the armed inline-op threshold deny; nudge `Read`/`Bash` once per session toward `ctx_read` and `ctx_shell`/context-mode `ctx_execute` (markers: `.atlas/.run/native_nudges/`; `ATLAS_TRIPWIRE_HARD=off`). Flag orchestration sessions, count inline ops, advise at the threshold; deny tier blocks at 6 unsanctioned inline ops (the orchestrator's own docs//.atlas/ writes are excluded, since the completion gate requires them at closeout) or any non-docs edit in an orchestration run (`ATLAS_TRIPWIRE=off`, `ATLAS_TRIPWIRE_HARD=off`). Denies an `atlas:*` dispatch whose `model` param overrides the agent definition's own `model:` frontmatter (`inherit` and an absent param accept anything; an unreadable definition fails open), and denies an `atlas:*` dispatch with no `name` -- named dispatches are what hand a subagent the sibling roster and `SendMessage`. Both follow the existing `atlas:*` gating (`ATLAS_TRIPWIRE_HARD=off` lifts them), except that with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` the name-required deny is lifted: a named main-conversation dispatch would launch as a teammate that inherits the lead's effort and cwd, defeating the per-worker effort tier. Denies an `atlas:*` dispatch that omits the code-nav TOOLS block, omits the bounding dispatch spec from `subagent-kit.md` (`GOAL:`, `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`, `STOP CONDITIONS:`), or bundles more than one `GOAL:` into a single subagent -- an unbounded or multi-task dispatch is how one agent ends up running for an hour instead of a wave of small ones. Also denies, unconditionally and ahead of the kill switch, any nested `Agent`/`Task` dispatch whose `transcript_path` is a `subagents/` transcript: a subagent must never dispatch another subagent. Also brackets every `*verifier*` dispatch: snapshots the `findings.json` entry count on `PreToolUse` and, if the verifier returns without adding a row, tells the orchestrator to write the verdict with `scripts/atlas_finding.py` rather than re-dispatching |
| `todo_capture.py` | `PostToolUse` (TodoWrite) | Mirror every `TodoWrite` plan into the durable board `<project>/.atlas/.run/todos.json` (`ATLAS_TODO=off` disables) so the dashboard Work tab, parallel subagents, and the completion gate's drain fallback all read the session's real progress; keeps existing claims on matching content |
| `format_after_edit.py` | `PostToolUse` (Edit/Write) | Run the repo's formatter after edits |
| `edit_read_nudge.py` | `PreToolUse` (Edit/MultiEdit) + `PostToolUse` (Read/ctx_read) | Advisory nudge when an edit targets a file read only via ctx_read |
| `delegation_prewarn.py` | `PostToolUse` (Edit/Write/MultiEdit/NotebookEdit) | Once per session, at the lead's first inline non-docs edit, warns that `completion_gate.py` condition (m) will block at Stop unless an atlas:implementer is dispatched. |
| `docs_drift_watch.py` | `PostToolUse` (Edit/Write/MultiEdit/NotebookEdit) | Inline backstop for `completion_gate.py` condition (f): warns the moment a non-docs edit ships without a `docs/CHANGELOG.md` entry, instead of waiting for Stop. Debounced per session_id (first drifting edit, then every 5th; resets when the CHANGELOG reappears in the diff or a new/missing session_id arrives); silent with no `docs/`, `ATLAS_GATE=off`, or on a `docs/`/`.atlas/` path. The backing `git diff` is cached for 2s (`time.monotonic`) to keep the common-path cost low |
| `stop_tail.py` | `Stop` | Runs `ingest_session.py`, `chronicle_facet.py`, `memory_capture.py` and `nudge.py` in one interpreter (one cold start instead of four); each keeps its own logic, throttle and fail-open handling |
| `completion_gate.py` | `Stop` | Thirteen conditions block a premature "done" until the definition-of-done holds. Condition (m) independently blocks once when a main-thread run in a `docs/` project shipped non-docs code with zero `Task`/`Agent` dispatches, even without an orchestration flag; sidechains are exempt and errors fail open. Conditions (a)-(l) remain orchestration-scoped: evidence artifact and independent verifier (only once this run shipped non-docs code), verifier coverage, a drained todo list, and -- condition (k) -- a todo list that was made at all, since an absent list has zero open items and used to satisfy the drain check trivially. Condition (f) requires `docs/CHANGELOG.md` specifically: any single `docs/` path used to clear it, so an unrelated doc edit kept the gate quiet while the CHANGELOG, ROADMAP and README rotted. Condition (l) requires every dated record the run touched (plan, spec, lesson, decision, audit, finding) to be named `<YYYY-MM-DD>-<slug>`, run-scoped via `scripts/lint_docs_names.py` so historical names never wedge a run. `ATLAS_GATE=off` disables all conditions. Also stays silent, before any condition is evaluated, whenever the Stop payload's `background_tasks` still lists an in-flight `subagent`/`workflow`/`teammate` dispatch -- a wave with implementers still running is not a completion claim yet, so the gate does not re-fire once per Stop of the wave; a long-running `shell` or `monitor` task does not suppress it. Silent on pass -- speaks only when it blocks |
| `memory_capture.py` | `Stop` | Persist session lessons to `~/.atlas/memory/`, silently. Not bound to `SubagentStop`: per-dispatch capture filed the same lesson once per subagent scope (`agent-<hex>`, `.run`), and the parent `Stop` already resolves subagent sessions. Refuses those scopes outright, never captures tool-error tallies (they live in atlas_db; as recall lines they buried every real lesson), and truncates on a word boundary |
| `connector_credential_watch.py` | `PostToolUse` (`mcp__plugin_atlas_.*`, plus bare `mcp__cipp.*` / `mcp__connectwise.*` / `mcp__falcon-mcp__.*` / `mcp__plaid__.*` / `mcp__gcloud__.*`) | A running MCP server caches credentials at startup, so a rotated secret never reaches it and every endpoint fails identically. On the first 401/403 (or a 400 naming the token) from a matched connector tool, inject one instruction: restart the server, do not retry other endpoints. Once per server per session, advisory only (`ATLAS_CONNECTOR_WATCH=off`). Plugin-scoped tool names look like `mcp__plugin_atlas_<server>__<tool>`. |
| `nudge.py` | `Stop` only | Self-improvement: prompt to capture a lesson and check docs drift (throttled). Silent when memory_capture already wrote this turn -- a success announcement on Stop is additionalContext, which costs a whole extra model turn to say nothing. Not bound to `SubagentStop` -- landing there injected its prompt into a dispatched subagent's context right before it composed its final response, so the subagent answered the nudge instead of returning its deliverable |
| `ingest_session.py` | `Stop`, `SubagentStop`, `SessionEnd`, `PreCompact` | Mirror the session transcript into the observability DB for atlas-audit self mode (`ATLAS_INGEST=off`) |
| `worker_report_gate.py` | `SubagentStop` | Block an `atlas:*` subagent whose final message is not the fixed report container defined in `contracts/worker-protocol.json`. Blocks once per `agent_id`; fails open on every error |
| `chronicle_facet.py` | `Stop` | Write one deterministic `facets` row per session and mirror `signals` into `friction_events` |

An `atlas-orchestrator` output style ships under `output-styles/` with
`force-for-plugin: true` - it auto-applies whenever the atlas plugin is enabled
(status-header + named-dispatch reporting; keeps Claude Code's own coding behavior
intact). Fork routing is doctrine, not a style choice: `atlas:planner`,
`atlas:completeness-critic`, and `atlas:docs-curator` dispatch as
`subagent_type: "fork"` (requires `CLAUDE_CODE_FORK_SUBAGENT=1` set globally) to
inherit history cheaply; `atlas:verifier` and `atlas:explorer` never fork, so
their judgment stays uncontaminated.

For installs outside a plugin, `scripts/install_hooks.py` wires the hooks into
settings manually. The optional ollama-backed optimizer is configured with
`ATLAS_OPTIMIZE_CMD`, `ATLAS_OPTIMIZER_MODEL`, and `ATLAS_OLLAMA_URL`
(see `skills/atlas-orchestrate/references/hooks-automation.md`); it is not required.

## One contract, two harnesses (Claude Code and omp)

The rules atlas enforces are defined once and read by both runtimes:
`contracts/native-tools.json` (which native tools are denied or nudged, toward
which lean-ctx/context-mode replacement, which exploration-only shell commands
are denied, and which paths are exempt from the delegation mandate),
`contracts/mandates.json` (claude-mem recall and ponytail-before-commit text
plus the shared git-commit parse cases), `contracts/tool-names.json` (Claude to
omp tool names, used to render the output style for omp), and
`contracts/hook-bridge.json` (which Claude hooks the omp hook bridge may run,
and why the rest are not bridged). The Python hooks and `omp/` modules each read
them; tests in both suites run the same shared cases.

**omp parity is broad but not complete.** As of 8.7.0 omp has the output style,
the hook bridge, the claude-mem recall gate, the ponytail-before-commit nudge,
the exploration-shell deny, lean-ctx shell routing, a delegation gate that counts
shell-written code, an advisor board gate (`ATLAS_ADVISOR_GATE`), a worker
output-token cap (`ATLAS_WORKER_MAX_TOKENS`, default 32000), and (new) the
Stop-family bridge: `omp/stop-bridge.ts` converts the omp session to the Claude
transcript shape (`scripts/omp_transcript.py`), records run state
(`scripts/omp_runstate.py`, `omp/run-state.ts`), and runs the definition-of-done
gate (a)-(l), ingest, chronicle, memory capture and the nudge on `session_stop`,
`session_shutdown` and `auto_compaction_start`. `dispatch_tripwire.py` runs
through the bridge (dispatch-spec blocks, one-GOAL rule, production-edit deny,
inline-op threshold deny, which counts edits, writes and mutating Bash only:
Read/Grep/Glob, exploration-only Bash and read-only git are never counted or
blocked), and the model-override deny runs on
`before_subagent_spawn`. The bridge sets `ATLAS_NATIVE_POLICY=off` for the hooks
it runs, which makes `dispatch_tripwire.py` skip its own native-tool deny/nudge
(omp's `index.ts` already produces it) and still reach the inline-op threshold;
Claude Code never sets it, so nothing changes there. Still open, per
`docs/atlas-harness-parity.md`: memory capture's durable-write path is not yet
shown working on a live omp run, and the connector credential watch coverage on
omp (via the hook-bridge name re-split) has no live-run verification either; the
omp inline-op, production-edit and dispatch-spec denies are tested against the
real hook but not observed in a live omp session; and the delegation-policy
decision (the lead may still edit inline and then dispatch a verifier).
Row-by-row status and how each surface is created, read, updated, and deleted:
[docs/atlas-harness-parity.md](../../docs/atlas-harness-parity.md).

## Statusline

One widget, two harnesses: project, model and effort, a context meter, 5h and 7d rate-limit meters, session cost and tokens, a provider row and a fallow impact row.

- omp: atlas registers `omp/usage-statusline.ts` from its extension. A personal `~/.omp/agent/extensions/usage-statusline.ts` (or `<cwd>/.omp/extensions/usage-statusline.ts`) takes precedence and atlas skips its own copy. `ATLAS_STATUSLINE=off` disables it.
- Claude Code: the same layout from the `statusLine` stdin JSON, without the critter lane, tok/s, tools, runs, extra provider rows or the pi-lens merge. Install and remove:

```
python3 ~/.claude/plugins/cache/tech-tools/atlas/<version>/scripts/atlas_statusline.py install
python3 ~/.claude/plugins/cache/tech-tools/atlas/<version>/scripts/atlas_statusline.py uninstall
```

`install` saves your previous `statusLine` once and `uninstall` restores it.
- Both read `~/.omp/agent/usage-statusline.json` (bar style, widths, which rows show), so one edit restyles both.

## The Claude Code mod (in-terminal UI)

The plugin ships an in-process mods module (`mod/`, wired by the `modules` entry in
`hooks/hooks.json`; needs Claude Code 2.1.287+) that draws two native-element surfaces
(no `Client` panes): a one-row band above the prompt (phase + progress bar + up to 3
named live workers + gate count, collapsing to narrower tiers below 60 columns, idle
to `⚑ idle` with none running) and an Atlas sidebar with a hotkey tab strip - `r: route
│ t: team │ c: channel │ g: gates` - over exactly one view at a time. Route shows the
operating-contract rail and the current phase's tasks; Team is a worker table (failures
and blocked workers always on top) plus a message field; Channel is an IRC-style log of
board notes; Gates groups completion conditions, inline-op tripwire, tool routing and
the last-reply header check, with fix commands that copy on press. The pane docks itself
only in a fullscreen terminal at 110+ columns; otherwise it stays closed until
`/atlas-cc`, which opens a focused 12-row inline pane. Gate readings come from
`scripts/atlas_gates.py --session --root --json`, which shares `evaluate()` with the
Stop hook (`hooks/completion_gate.py`); the header check comes from `mod/discipline.ts`.
The contract header (`ATLAS | <phase> | <sentence>`) is restyled onto the reply itself;
restyled spinner/tool/turn-receipt sites and a context-discipline module nudge heavy
inline reads toward subagent delegation and sharpen vague prompts with repo facts. The
mod reads `.atlas/.run/` and changes state only through the existing CLIs;
`ATLAS_MOD=off` disables it. Full detail: `docs/atlas-mod.md`.

Parallel implementer dispatches get git-worktree isolation via `scripts/atlas_wt.py`
(`add`/`status`/`merge`/`prune`; branch `worker/<agent>`, worktree `.atlas/wt/<agent>`).
`merge` refuses without a `verified` findings.json entry naming the branch or agent, and
the script never pushes or force-deletes. Protocol: `agents/implementer.md` (Worktree
dispatch) and `skills/atlas-orchestrate/references/implementation-units.md` (Worktree
protocol); enforced by completion-gate condition (q) (`ATLAS_WT_GATE=off` to disable).

## Colony work (shared board + notes)

Subagents work off one durable todo board at `<project>/.atlas/.run/todos.json`:
flock plus tmp-rename locking (proven with 8 processes racing for 40 items --
exactly 40 claims), claims survive across harnesses, and an unparseable board is
moved aside to `todos.json.corrupt-<ns>` instead of being silently replaced by
an empty one. A linked git worktree resolves to the main repo's board, so
isolated workers and the lead stay on one queue. For coordination prose, each
worker has an append-only notes file (`.atlas/.run/board/<owner>.jsonl`; no
cross-writer contention):

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" note --owner <name> [--to <name|all>] [--item <id>] "<text>"
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" add [--unique] [--session <id>] "<text>"
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" notes [--to <name>] [--since <ts>]
```

How `${CLAUDE_PLUGIN_ROOT}` resolves differs by harness: Claude Code is documented
to expose it to plugin hooks/commands (code.claude.com/docs/en/plugins); its
env/markdown substitution behavior for agents is not re-verified here. The omp
extension sets it on load when unset (verified in `omp/index.ts`). Name your dispatches (`name:` on
each task item) -- a named dispatch is what gives a subagent the sibling roster
it needs to reach peers. One honest limitation: Claude Code has no per-subagent
thinking setting -- subagents inherit the session's thinking (per
code.claude.com/docs/en/sub-agents) -- so worker cost there is controlled by
each agent's existing `model:`/`effort:` frontmatter.

## Local dashboard (Atlas Command Center)

Open `http://127.0.0.1:7421/` once. All concurrent terminals share it; switch scope with the project switcher. The Command Center is a static single-page UI (`scripts/dashboard_ui/`) with a band (title row, chevron phase rail, live counts), a seats rail and six routes: Run, Agents, Board, Channels, Health and Settings (design contract: `docs/command-center-redesign.md`). Run shows the channel feed with steer (`POST /api/v2/channels`), needs-you, gates chips (`GET /api/v2/gates`, token required, `?project=` or `?session=`) and a last-7-days table. Agents holds the colony roster with send, stop, pause, resume and a drawer with the terminal, messages and tasks; Board is the durable todo board `<project>/.atlas/.run/todos.json`; Channels are per-branch and per-lead message channels (`docs/atlas-channels.md`), each message with a delivery status of `queued`, `read`, `delivered`, `refused` or `undeliverable`; Settings lists every `ATLAS_*` key with its current value. Old hashes (`#/activity`, `#/improve`, `#/projects`, `#/colony`, `#/terminal`, `#/herd`, `#/work`, `#/irc`) redirect to the owning page. To run from source: `python3 plugins/atlas/scripts/atlas_dashboard.py serve --port 7421`. It updates over Server-Sent Events (`/api/v2/stream`, a 5 s tick with hash-gated `herd`/`agents`/`todos`/`irc`/`health`/`improve` events and a 15 s heartbeat) and only falls back to polling every 8 s if the stream drops. Preferences persist in `~/.atlas/dashboard-prefs.json`. Keyboard: `1`, `2`, `3`, `f`, `i`, `m`, `h`, `Escape`, and `/` for the palette. Manual todos never block the completion gate. Product overview: `docs/atlas-workboard.md`.

### Agents, Channels, Settings (14.0.0)

- **Agents** (`#/agents`): the Atlas-scoped roster for the selected project, the lead plus Atlas-launched workers, each with a state of `running`, `idle`, `stuck`, `finished` or `dead`. The drawer has Terminal, Messages and Tasks tabs. **Send** and **Kill** act only on the member's recorded herdr pane id or on a recorded pid whose start time (`ps -o lstart=`, stored as `pid_start`) still matches; a recycled or unverifiable pid counts as dead and Kill answers `409 member_dead`. Every composer uses one send path. The drawer terminal streams tmux targets only (herdr pane ids are not streamable); sockets use a single-use ticket (`POST /api/v2/term/ticket`) and a PTY idle for `ATLAS_TERM_IDLE_S` seconds (default 900) is closed.
- **Board** (`#/board`, alias `#/work`) and **Channels** (`#/channels`, alias `#/irc`): the todo board, and message channels refreshed on the SSE `irc` event.
- **Settings** (`#/settings`): every `ATLAS_*` key has a row showing its current value, source and when it applies (`applies now`, `next session`, `restart dashboard`), with a typed control (switch, select, bounded number, url, model picker). A save is verified: the row shows `verified` with the layers that read back, or `not saved`. The model picker lists local Ollama and cloud models and can pull a model. Shell-scope rows are writable: a save writes the Claude Code `settings.json` `env`, the omp `config.yml` `env`, and `~/.atlas/env.sh` (plus one guarded line in `~/.zshenv`), all inside `# >>> atlas managed >>>` markers.
- Workers post one final report to their lead channel; their full stdout and stderr go to `<project>/.atlas/.run/logs/<worker>.log`.

## Local dashboard API

For a browser UI (or any local client) that needs live visibility into runs, the colony, the todo board, connector configuration and agent overrides:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" serve --port 7421
```

Loopback-only JSON API: `serve` refuses a non-loopback `--host` (anything besides `127.0.0.1`, `::1`, or `localhost`) unless `--allow-remote` is also passed. Every request passes a central guard: the `Host` must be this dashboard (`403 bad_host`), mutations must send `Content-Type: application/json` (`415`), a present `Origin` must be this dashboard (`403 bad_origin`), and mutations plus the live stream and transcript-like GETs need the per-daemon `X-Atlas-Token` (`401 bad_token`; the page carries it in `<meta name="atlas-token">`, and `EventSource` passes `?token=` on `/api/v2/stream`). `/api/health` needs only the Host check. The v1 routes (`/api/status`, `/api/sessions`, `/api/connectors`, `/api/todo`, `/api/agents`, `/api/memory`, ...) remain beside the `/api/v2/*` herd, todos, IRC, overview, health, activity, improve, projects and prefs routes. Remote access never opens this port: the vendored herdr web UI (`colony/herdr-web-ui`, `127.0.0.1:7317`) runs its own auth and proxies the dashboard same-origin at `/atlas/**`. See `skills/atlas-orchestrate/references/dashboard-api.md`.

## Self-improvement

These hooks and scripts close the loop the fleet used to leave to manual runs:

- `memory_capture.py` persists durable lessons per project to `~/.atlas/memory/`.
- `scripts/atlas_doctor.py --mine` turns session telemetry into findings the
  `atlas-doctor` skill walks you through; `--baseline`/`--remeasure` prove a fix.
- `scripts/atlas_context_optimizer.py` disables unused skills via
  `disable-model-invocation: true` and unused agents by moving them to a `.disabled/`
  directory, based on real usage in the observability DB.
- `scripts/atlas_curator.py` archives stale legacy `created_by: atlas-auto`
  skills under `~/.claude/skills/` (stale/archive/pin/restore); it never deletes
  and does not touch this plugin's skills.

atlas-audit's self mode reads the same observability DB to report run health
(verifier coverage, inline ops, parallel waves) and recommend fixes.

### Turn scoring (optional)

With `TYPESAFE_API_KEY` set in the environment, a detached scorer sends recent
assistant replies to TypeSafe (api.typesafe.ai, model Jev) and stores verdicts
in `turn_scores`. The `turn_quality` doctor miner turns recurring failures into
findings that name the surface to fix, and `--baseline`/`--remeasure` prove the
fix worked. Transcript excerpts leave the machine (secrets scrubbed);
`ATLAS_TYPESAFE_SCORING=off` disables it. Knobs: `ATLAS_TYPESAFE_SCORING`,
`ATLAS_TYPESAFE_MODEL` (default `jev-latest`), `ATLAS_TYPESAFE_MAX_CALLS`
(default 200). See `docs/atlas-turn-scoring.md`.

## Dependencies

Atlas integrates session companions and code-nav tools, recommended during setup:
- claude-mem - cross-session memory that backs the self-improvement layer.
- context-mode - large-output sandbox that keeps raw bytes out of the context window.
- ponytail - optional less-code session posture.
- **serena** - symbol intelligence (`activate_project` first, then overview/find/edit).
- **lean-ctx** - shaped compose/search/read; serena fallback; never Bash-grep first.

SessionStart injects a compact tool-routing blurb; the full matrix is
`skills/atlas-orchestrate/references/tool-routing.md`. Dispatch tripwire denies
`atlas:*` prompts that omit ToolSearch + serena/lean-ctx. On JS/TS trees it also
recommends [Fallow](https://docs.fallow.tools) (CLI + MCP + skills); `fallow_gate`
audits agent git commit/push when the CLI is present. Atlas degrades gracefully
and uses only the tools present in the session.

## License

Apache-2.0 . (c) w159
