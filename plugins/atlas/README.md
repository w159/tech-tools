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

## The skill fleet (47 skills, plainly named)

Two manual skills, forty-five auto-trigger skills. Auto-trigger comes primarily from each skill's `description` (Claude Code
loads on relevance); `when_to_use` is retained as atlas-local routing metadata.
Manual skills set `disable-model-invocation: true`.

This release ports the Compound Engineering plugin's capabilities onto atlas's control
plane: atlas keeps its own orchestrator, named agents, docs/.atlas SSOT, findings ledger,
and explicit-push-consent policy as the execution and safety authority throughout - CE
contributed artifact schemas, review rubrics, and workflow shapes, not a second engine.

| Skill | Mode | What it does |
| --- | --- | --- |
| atlas | MANUAL | Boot the workspace: verify claude-mem and context-mode, scan the project, recommend tooling (confirm first), wire hooks, seed the docs/ SSOT |
| atlas-setup | MANUAL | The lifecycle skill: onboard (scaffold `docs/`, inventory, recommend what to run next), install (claude-mem, context-mode, hooks, config), connectors (vendor MCP setup), Compound Pack health check, repair (`--fix` runs `scripts/atlas_doctor.py`) |
| atlas-orchestrate | auto | The engine: decompose a task, route every code edit to a subagent, demand execution evidence, verify with an independent agent (runtime evidence included), keep `docs/` the single source of truth. Now carries CE's implementation-unit rigor: per-unit idempotency, proof-first/characterization test strategy, bounded parallel waves |
| atlas-audit | auto | Three audit modes: code (quality/security/OWASP swarm), architecture (feature map + duplication + unify proposal), self (atlas run health, context/asset waste, session forensics from the observability DB) |
| atlas-doctor | auto | Interactive self-improvement: mine findings from session telemetry, ask per finding, apply what you accept, re-measure against a baseline. Now includes CE's measurement-first retuning gate and a `docs/lessons/` citation-drift refresh pass |
| atlas-loop | auto | Match a recurring or iterative task to a curated loop-library entry (loop-until-dry, fan-out-adversarial-verify, red-green-tdd, and more) and instantiate it |
| atlas-ux-test | auto | App-discovering UX swarm: auto-finds routes and forms in a running web app, then runs cartographer -> persona -> fuzzer -> oracle -> reporter |
| 14 task skills | auto | atlas-component, atlas-db-audit, atlas-debug (now with CE's ranked-hypothesis/red-for-the-right-reason/three-failed-fix rigor), atlas-feature, atlas-frontend, atlas-gitignore, atlas-handoff, atlas-harden, atlas-launch, atlas-prompt, atlas-readme, atlas-refactor, atlas-validate, atlas-wiki |
| **The CE core loop (ported from Compound Engineering)** | | |
| atlas-brainstorm | auto | WHAT-stage requirements elicitation: one-question-at-a-time dialogue, 2-3 approaches with a mandatory non-obvious option, writes a requirements-only `docs/plans/<date>-<slug>-brainstorm.md` |
| atlas-plan | auto | HOW-stage implementation-ready planning: stable `U<N>` implementation units, a Verification Contract and Definition of Done, mandatory `atlas:completeness-critic` review, hands off to `atlas-orchestrate` |
| atlas-simplify | auto | Bounded post-implementation simplification pass over a fresh diff: three independent read-only reviewers (reuse/quality/efficiency), behavior-preserving apply, full gate re-run |
| atlas-review | auto | Risk-selected multi-persona diff/PR review (correctness always-on, conditional security/performance/API/migration/reliability/adversarial/etc.), typed findings with confidence anchors, report-only by default |
| atlas-compound | auto | Durable learning capture into `docs/lessons/`: a hard solved-and-verified-and-non-obvious eligibility gate, overlap detection before writing, CE's bug/knowledge frontmatter schema |
| atlas-autopilot | auto | Atlas's consent-gated equivalent of CE's `lfg`: brainstorm/plan -> work -> simplify -> review -> compound -> local commit, then a hard stop for explicit push/PR/merge confirmation |
| **On-demand and around-loop (ported from Compound Engineering)** | | |
| atlas-strategy, atlas-pulse, atlas-sweep | auto | Product strategy anchor (`docs/architecture/product-strategy.md`), time-windowed telemetry pulse report, feedback-source ingestion into a rolling triage doc |
| atlas-bakeoff, atlas-pov, atlas-explain | auto | Competing-approach generation and selection; evidence-floored independent "oracle" opinion with optional non-voting peer checks; evidence-backed explanation of existing behavior (also answers "wtf does this do") |
| atlas-prototype, atlas-optimize, atlas-feedback-analysis | auto | Throwaway demonstrate-then-decide prototyping; measurement-first optimization experiments; raw feedback (transcripts/tickets/notes) into evidence-quoted findings |
| atlas-commit, atlas-ship, atlas-babysit-pr, atlas-resolve-pr-feedback | auto | Local-only commit; commit+push+PR with a mandatory confirmation gate before anything leaves the machine; bounded CI-repair loop; review-comment triage, fix, and reply (never auto-posted) |
| atlas-polish, atlas-dogfood, atlas-test-xcode, atlas-test-browser | auto | Live interactive UX polish; diff-scoped autonomous browser QA with a repair loop; iOS Simulator test runtime; diff-scoped no-fix-loop browser smoke check |
| atlas-proof, atlas-promote, atlas-worktree | auto | Publish/annotate/collect review workflow for durable docs; post-shipping announcement drafts (never auto-posted); atlas's own host-portable `git worktree` isolation primitive |

## Layout

```
atlas/
|-- .claude-plugin/plugin.json     # manifest (name: atlas, v5.27.2)
|-- hooks/                         # 15 hook programs / 19 bindings (hooks.json wires them all; atlas_doctor.py lives in scripts/, SessionStart)
|   |-- session_boot.py            #   SessionStart: activate runtime, surface lessons
|   |-- prompt_optimizer.py        #   UserPromptSubmit: optional rewrite + orchestration arm-early classifier
|   |-- bash_advisor.py            #   PreToolUse(Bash): advisory warning on catastrophic commands only
|   |-- fallow_gate.py             #   PreToolUse(Bash): fallow audit gate on git commit/push (fail-open if CLI absent)
|   |-- todo_capture.py            #   PostToolUse(TodoWrite): mirror the plan into the durable board <project>/.atlas/.run/todos.json
|   |-- format_after_edit.py       #   PostToolUse(Edit/Write): format after edits
|   |-- docs_drift_watch.py        #   PostToolUse(Edit/Write/MultiEdit/NotebookEdit): inline docs-drift warning, debounced
|   |-- dispatch_tripwire.py       #   PostToolUse advisory + PreToolUse deny: curb inline drift; flag a verifier that wrote no findings.json row
|   |-- connector_credential_watch.py # PostToolUse(mcp__plugin_atlas_.* + known bare MCP prefixes): one warning on connector auth failure -- restart, do not sweep endpoints
|   |-- completion_gate.py         #   Stop: block premature "done" until the definition-of-done holds
|   |-- ingest_session.py          #   Stop/SubagentStop/SessionEnd/PreCompact: mirror transcript to the observability DB
|   |-- chronicle_facet.py         #   Stop: write one facets row + mirror signals into friction_events
|   |-- memory_capture.py          #   Stop/SubagentStop: persist lessons to ~/.atlas/memory/
|   |-- nudge.py                   #   Stop only: self-improvement nudge (throttled)
|   |-- docs_drift.py              #   not a hook; shared find_root/docs_drift/git_changed_paths used by completion_gate.py and docs_drift_watch.py
|   `-- validate-readonly-query.sh #   not auto-loaded; DB-audit subagents wire it during read-only audits
|-- scripts/                       # atlas_doctor.py (repair; also wired via hooks.json --hook as the 15th auto-loaded hook, SessionStart), atlas_db.py (observability), atlas_todo.py (durable todo board), lint_docs_names.py (date-first naming lint for dated docs/.atlas records; gate condition (l)), atlas_context_optimizer.py
|                                  # (disable unused skills/agents), atlas_curator.py, atlas_memory.py,
|                                  # asset_audit.py, discover_capabilities.py, build_hub.py, install_hooks.py
|-- references/                    # plugin-wide references every skill and agent may load
|   |-- operating-contract.md      #   the research -> document -> implement -> verify -> report loop
|   |-- connector-config-flow.md   #   how a vendor connector gets configured
|   `-- connector-tool-disclosure.md
|-- output-styles/
|   `-- atlas-orchestrator.md      # force-for-plugin: true - auto-applies whenever atlas is enabled
|-- agents/                        # 12 subagents (atlas:<role>), auto-registered
|   |-- explorer.md                #   read-only codebase mapping (never fork)
|   |-- implementer.md             #   bounded, verified code edits
|   |-- verifier.md                #   adversarial confirm/refute with runtime-parity requirement (never fork)
|   |-- db-prober.md               #   read-only schema/RLS/index inspection
|   |-- schema-inventory.md        #   PostgreSQL catalog inventory
|   |-- rls-privilege-audit.md     #   read-only RLS/grants/privilege audit
|   |-- naming-glossary-audit.md   #   table/column name audit against project glossary
|   |-- ui-runtime-tester.md       #   live browser/runtime behavior
|   |-- planner.md                 #   multi-stage decomposition + stage maps (fork)
|   |-- docs-curator.md            #   maintains the docs/ single source of truth (fork)
|   |-- docs-auditor.md            #   audits docs/ for drift against code
|   `-- completeness-critic.md     #   "what did we miss" gap pass before done (fork)
`-- skills/                        # the 47 skills, one directory each (SKILL.md + references/)
```

## Getting started

Install the plugin (place this directory under your plugins root, or install from
the marketplace). On the next session the boot hook activates the runtime
automatically. Then run `atlas-setup` once per project: it scaffolds
`docs/`, installs claude-mem and context-mode if you approve, recommends
the capabilities your stack needs, and tells you what to run next.

## Hooks

The hooks auto-load from `hooks/hooks.json` when the plugin is installed - no
manual step. Each is stdlib-only and fails open on internal errors (exit 0).
Two hooks may deny a tool call on purpose: `dispatch_tripwire` (orchestration
invariants) and `fallow_gate` (fallow audit `verdict: fail` on git commit/push).

| Hook | Event | Purpose |
| --- | --- | --- |
| `session_boot.py` | `SessionStart` | Activate the runtime, report dependency state, surface relevant lessons, carry the todo board over, and repair the durable `docs/` tree (creates any missing scaffolder-owned subfolder; only when `docs/` already exists, so a project that never asked for one is never scaffolded behind the user's back -- it gets a one-line notice instead; `ATLAS_DOCS_REPAIR=off`) |
| `atlas_doctor.py --hook` | `SessionStart` | Rollback guard: warn loudly if the installed plugin was downgraded, the marketplace points at a fork, or hooks/assets are missing (warn-only, always exits 0) |
| `prompt_optimizer.py` | `UserPromptSubmit` | Optional trigger-gated prompt rewrite; also arm-early classifier that flags substantive engineering prompts as orchestration runs (`ATLAS_ENGINE_ARM=off`) |
| `bash_advisor.py` | `PreToolUse` (Bash) | Advisory only: warns on catastrophic patterns (`rm -rf /`, `mkfs`, `dd` to a disk, fork bomb). Never denies |
| `fallow_gate.py` | `PreToolUse` (Bash) | Fallow agent gate: on `git commit`/`git push`, runs `fallow audit --format json --quiet --explain --gate-marker agent` and denies when `verdict` is `fail`. Fail-open if the fallow CLI is missing (`ATLAS_FALLOW=off`, `FALLOW_GATE_MIN_VERSION`). Docs: `skills/atlas-orchestrate/references/fallow-tools.md` |
| `dispatch_tripwire.py` | `PostToolUse` + `PreToolUse` | Flag orchestration sessions, count inline ops, advise at the threshold; deny tier blocks at 6 unsanctioned inline ops (the orchestrator's own docs//.atlas/ writes are excluded, since the completion gate requires them at closeout) or any non-docs edit in an orchestration run (`ATLAS_TRIPWIRE=off`, `ATLAS_TRIPWIRE_HARD=off`). Denies an `atlas:*` dispatch that omits the code-nav TOOLS block, omits the bounding dispatch spec from `subagent-kit.md` (`GOAL:`, `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`, `STOP CONDITIONS:`), or bundles more than one `GOAL:` into a single subagent -- an unbounded or multi-task dispatch is how one agent ends up running for an hour instead of a wave of small ones. Also denies, unconditionally and ahead of the kill switch, any nested `Agent`/`Task` dispatch whose `transcript_path` is a `subagents/` transcript: a subagent must never dispatch another subagent. Also brackets every `*verifier*` dispatch: snapshots the `findings.json` entry count on `PreToolUse` and, if the verifier returns without adding a row, tells the orchestrator to write the verdict with `scripts/atlas_finding.py` rather than re-dispatching |
| `todo_capture.py` | `PostToolUse` (TodoWrite) | Mirror every `TodoWrite` plan into the durable board `<project>/.atlas/.run/todos.json` (`ATLAS_TODO=off` disables) so the dashboard Work tab, parallel subagents, and the completion gate's drain fallback all read the session's real progress; keeps existing claims on matching content |
| `format_after_edit.py` | `PostToolUse` (Edit/Write) | Run the repo's formatter after edits |
| `docs_drift_watch.py` | `PostToolUse` (Edit/Write/MultiEdit/NotebookEdit) | Inline backstop for `completion_gate.py` condition (f): warns the moment a non-docs edit ships without a `docs/CHANGELOG.md` entry, instead of waiting for Stop. Debounced per session_id (first drifting edit, then every 5th; resets when the CHANGELOG reappears in the diff or a new/missing session_id arrives); silent with no `docs/`, `ATLAS_GATE=off`, or on a `docs/`/`.atlas/` path. The backing `git diff` is cached for 2s (`time.monotonic`) to keep the common-path cost low |
| `completion_gate.py` | `Stop` | Block a premature "done" until the definition-of-done holds: evidence artifact and independent verifier (only once this run shipped non-docs code), verifier coverage, a drained todo list, and -- condition (k) -- a todo list that was made at all, since an absent list has zero open items and used to satisfy the drain check trivially. Condition (f) requires `docs/CHANGELOG.md` specifically: any single `docs/` path used to clear it, so an unrelated doc edit kept the gate quiet while the CHANGELOG, ROADMAP and README rotted. Condition (l) requires every dated record the run touched (plan, spec, lesson, decision, audit, finding) to be named `<YYYY-MM-DD>-<slug>`, run-scoped via `scripts/lint_docs_names.py` so historical names never wedge a run (orchestrating sessions only; `ATLAS_GATE=off`). Silent on pass -- speaks only when it blocks |
| `memory_capture.py` | `Stop` | Persist session lessons to `~/.atlas/memory/`, silently. Not bound to `SubagentStop`: per-dispatch capture filed the same lesson once per subagent scope (`agent-<hex>`, `.run`), and the parent `Stop` already resolves subagent sessions. Refuses those scopes outright, never captures tool-error tallies (they live in atlas_db; as recall lines they buried every real lesson), and truncates on a word boundary |
| `connector_credential_watch.py` | `PostToolUse` (`mcp__plugin_atlas_.*`, plus bare `mcp__cipp.*` / `mcp__connectwise.*` / `mcp__falcon-mcp__.*` / `mcp__plaid__.*` / `mcp__gcloud__.*`) | A running MCP server caches credentials at startup, so a rotated secret never reaches it and every endpoint fails identically. On the first 401/403 (or a 400 naming the token) from a matched connector tool, inject one instruction: restart the server, do not retry other endpoints. Once per server per session, advisory only (`ATLAS_CONNECTOR_WATCH=off`). Plugin-scoped tool names look like `mcp__plugin_atlas_<server>__<tool>`. |
| `nudge.py` | `Stop` only | Self-improvement: prompt to capture a lesson and check docs drift (throttled). Silent when memory_capture already wrote this turn -- a success announcement on Stop is additionalContext, which costs a whole extra model turn to say nothing. Not bound to `SubagentStop` -- landing there injected its prompt into a dispatched subagent's context right before it composed its final response, so the subagent answered the nudge instead of returning its deliverable |
| `ingest_session.py` | `Stop`, `SubagentStop`, `SessionEnd`, `PreCompact` | Mirror the session transcript into the observability DB for atlas-audit self mode (`ATLAS_INGEST=off`) |
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

## Local dashboard (multi-session)

Open `http://127.0.0.1:7421/` once. All concurrent terminals share it; switch via Project/Session controls. Beyond run visibility it is where behavior is altered: the Work tab reads and drives the durable todo board `<project>/.atlas/.run/todos.json` (counts, add/claim/complete/reopen; manual items never block the completion gate) and shows the shared memory snapshot from `~/.atlas/memory/`, and the Agents tab edits same-name overrides under `<project>/.claude/agents/` (frontmatter required; Reset restores the plugin source).

## Local dashboard API

For a browser UI (or any local client) that needs live visibility into runs, savings proxies, connector configuration, the todo board, and agent overrides:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_dashboard.py" serve --port 7421
```

Loopback-only JSON API. `/api/todo`, `/api/agents`, and `/api/memory` sit beside the run and connector endpoints. See `skills/atlas-orchestrate/references/dashboard-api.md`.

## Self-improvement

Four hooks close the loop the fleet used to leave to manual runs:

- `memory_capture.py` persists durable lessons per project to `~/.atlas/memory/`.
- `scripts/atlas_context_optimizer.py` disables unused skills/agents
  (`disable-model-invocation: true`) based on real usage in the observability DB.
- `scripts/atlas_curator.py` handles skill lifecycle (stale/archive/pin).

atlas-audit's self mode reads the same observability DB to report run health
(verifier coverage, inline ops, parallel waves) and recommend fixes.

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
