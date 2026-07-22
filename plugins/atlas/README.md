# atlas

A self-configuring Claude Code plugin that turns any coding agent into a disciplined
multi-agent architect. Run `atlas-setup` once to onboard a project, then drive work
through the auto-triggering skills and the `atlas:<role>` subagent squad. A
SessionStart hook loads the runtime automatically every session, and the
self-improvement hooks (memory capture, auto-skill, nudge, session ingest) make the
agent better in a codebase the more it is used.

Org deployment (11 departments, 156 department skills) lives in the separate
`armada` plugin in this repo; install it alongside atlas only for org use.

## The skill fleet (22 skills, plainly named)

Two manual skills, twenty auto-trigger skills. Auto-trigger comes from each
skill's `description` + `when_to_use`; the manual skills have
`disable-model-invocation: true`.

| Skill | Mode | What it does |
| --- | --- | --- |
| atlas | MANUAL | Boot the workspace: verify claude-mem and context-mode, scan the project, recommend tooling (confirm first), wire hooks, seed the docs/ SSOT |
| atlas-setup | MANUAL | The lifecycle skill: onboard (scaffold `docs/`, inventory, recommend what to run next), install (claude-mem, context-mode, hooks, config), connectors (vendor MCP setup), repair (`--fix` runs `scripts/atlas_doctor.py`) |
| atlas-orchestrate | auto | The engine: decompose a task, route every code edit to a subagent, demand execution evidence, verify with an independent agent (runtime evidence included), keep `docs/` the single source of truth |
| atlas-audit | auto | Three audit modes: code (quality/security/OWASP swarm), architecture (feature map + duplication + unify proposal), self (atlas run health, context/asset waste, session forensics from the observability DB) |
| atlas-loop | auto | Match a recurring or iterative task to a curated loop-library entry (loop-until-dry, fan-out-adversarial-verify, red-green-tdd, and more) and instantiate it |
| atlas-ux-test | auto | App-discovering UX swarm: auto-finds routes and forms in a running web app, then runs cartographer -> persona -> fuzzer -> oracle -> reporter |
| 14 task skills | auto | atlas-component, atlas-db-audit, atlas-debug, atlas-feature, atlas-frontend, atlas-gitignore, atlas-handoff, atlas-harden, atlas-launch, atlas-prompt, atlas-readme, atlas-refactor, atlas-validate, atlas-wiki |

## Layout

```
atlas/
|-- .claude-plugin/plugin.json     # manifest (name: atlas, v5.1.1)
|-- hooks/                         # 11 auto-loaded hooks (hooks.json wires them all; atlas_doctor.py lives in scripts/, wired as the 11th)
|   |-- session_boot.py            #   SessionStart: activate runtime, surface lessons
|   |-- prompt_optimizer.py        #   UserPromptSubmit: optional rewrite + orchestration arm-early classifier
|   |-- bash_advisor.py            #   PreToolUse(Bash): advisory warning on catastrophic commands only
|   |-- format_after_edit.py       #   PostToolUse(Edit/Write): format after edits
|   |-- dispatch_tripwire.py       #   PostToolUse advisory + PreToolUse deny: curb inline drift in orchestration runs
|   |-- completion_gate.py         #   Stop: block premature "done" until the definition-of-done holds
|   |-- memory_capture.py          #   Stop/SubagentStop: persist lessons to ~/.atlas/memory/
|   |-- auto_skill.py              #   Stop: create new skills from session transcripts at ~/.claude/skills/
|   |-- nudge.py                   #   Stop/SubagentStop: self-improvement nudge (throttled)
|   |-- ingest_session.py          #   Stop/SubagentStop/SessionEnd/PreCompact: mirror transcript to the observability DB
|   `-- validate-readonly-query.sh #   not auto-loaded; DB-audit subagents wire it during read-only audits
|-- scripts/                       # atlas_doctor.py (repair; also wired via hooks.json --hook as the 11th auto-loaded hook, SessionStart), atlas_db.py (observability), atlas_context_optimizer.py
|                                  # (disable unused skills/agents), atlas_curator.py, atlas_memory.py, skill_factory.py,
|                                  # asset_audit.py, discover_capabilities.py, build_hub.py, install_hooks.py + tests
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
`-- skills/                        # the 22 skills, one directory each (SKILL.md + references/)
```

## Getting started

Install the plugin (place this directory under your plugins root, or install from
the marketplace). On the next session the boot hook activates the runtime
automatically. Then run `atlas-setup` once per project: it scaffolds
`docs/`, installs claude-mem and context-mode if you approve, recommends
the capabilities your stack needs, and tells you what to run next.

## Hooks

The hooks auto-load from `hooks/hooks.json` when the plugin is installed - no
manual step. Each is stdlib-only and fails safe: any internal error exits 0, so a
hook can never block a session.

| Hook | Event | Purpose |
| --- | --- | --- |
| `session_boot.py` | `SessionStart` | Activate the runtime, report dependency state, surface relevant lessons |
| `atlas_doctor.py --hook` | `SessionStart` | Rollback guard: warn loudly if the installed plugin was downgraded, the marketplace points at a fork, or hooks/assets are missing (warn-only, always exits 0) |
| `prompt_optimizer.py` | `UserPromptSubmit` | Optional trigger-gated prompt rewrite; also arm-early classifier that flags substantive engineering prompts as orchestration runs (`ATLAS_ENGINE_ARM=off`) |
| `bash_advisor.py` | `PreToolUse` (Bash) | Advisory only: warns on catastrophic patterns (`rm -rf /`, `mkfs`, `dd` to a disk, fork bomb). Never denies |
| `dispatch_tripwire.py` | `PostToolUse` + `PreToolUse` | Flag orchestration sessions, count inline ops, advise at the threshold; deny tier blocks at 8 inline ops or non-docs edits in orchestration runs (`ATLAS_TRIPWIRE=off`, `ATLAS_TRIPWIRE_HARD=off`) |
| `format_after_edit.py` | `PostToolUse` (Edit/Write) | Run the repo's formatter after edits |
| `completion_gate.py` | `Stop` | Block a premature "done" until the definition-of-done holds: evidence artifact, independent verifier, current docs, verifier coverage (orchestrating sessions only; `ATLAS_GATE=off`) |
| `memory_capture.py` | `Stop`, `SubagentStop` | Persist session lessons to `~/.atlas/memory/` |
| `auto_skill.py` | `Stop` | Create new skills from session transcripts at `~/.claude/skills/` |
| `nudge.py` | `Stop`, `SubagentStop` | Self-improvement: prompt to capture a lesson and check docs drift (throttled) |
| `ingest_session.py` | `Stop`, `SubagentStop`, `SessionEnd`, `PreCompact` | Mirror the session transcript into the observability DB for atlas-audit self mode (`ATLAS_INGEST=off`) |

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

## Self-improvement

Four hooks close the loop the fleet used to leave to manual runs:

- `memory_capture.py` persists durable lessons per project to `~/.atlas/memory/`.
- `auto_skill.py` mines finished sessions and drafts new skills at `~/.claude/skills/`.
- `scripts/atlas_context_optimizer.py` disables unused skills/agents
  (`disable-model-invocation: true`) based on real usage in the observability DB.
- `scripts/atlas_curator.py` handles skill lifecycle (stale/archive/pin).

atlas-audit's self mode reads the same observability DB to report run health
(verifier coverage, inline ops, parallel waves) and recommend fixes.

## Dependencies

Atlas integrates two companions and recommends installing them during setup:
- claude-mem - cross-session memory that backs the self-improvement layer.
- context-mode - large-output sandbox that keeps raw bytes out of the context window.

It also recommends a docs resolver (context7) and a symbol/LSP server (serena) when
the stack calls for them. Atlas degrades gracefully and uses only the tools present
in the session.

## License

Apache-2.0 . (c) w159
