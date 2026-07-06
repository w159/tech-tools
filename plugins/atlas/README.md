# atlas

A self-configuring Claude Code plugin that turns any coding agent into a disciplined
multi-agent architect. One token, `atlas`, runs the whole thing: type `/atlas` to
boot and configure a project, then drive work through the `/atlas-*` launchers and
the `atlas:<role>` subagent squad. A SessionStart hook loads the runtime
automatically every session, and a self-improvement nudge makes the agent better in
a codebase the more it is used.

## What ships

| Piece | What it is |
| --- | --- |
| `/atlas` architect | Boots and configures the workspace: verifies/installs claude-mem and context-mode (recommend then confirm), scans the stack and recommends skills/plugins/MCP to install, confirms hooks are wired, writes project config, and seeds the docs/ single source of truth. |
| SessionStart boot | A fast, crash-proof hook that activates the runtime every session: injects the operating contract and atlas-engine methodology, reports dependency state, and surfaces relevant past lessons. Never blocks a session. |
| atlas-engine skill | The orchestrator playbook: decompose a task, route every code edit to a subagent, demand execution evidence, verify with a second agent, keep docs/ as the single source of truth, and protect the context window. Triggers on whole-codebase build/fix/audit/refactor/investigate work. |
| atlas-architect skill | The methodology behind `/atlas` and the boot hook: dependencies, capability discovery, hooks, config, docs seed. |
| atlas-cartographer skill | Produce an evidence-grounded architecture map of any codebase, identify structural duplicates, and write a `docs/architecture/boundaries.md` that a fresh agent can load instead of re-discovering the layout. |
| atlas-sextant skill | Measure run health from the SQLite observability DB and propose metric-backed improvements (baseline -> target). Three lenses: run metrics (wall-clock, inline-ops, dispatches, parallel waves, context, recall, verifier coverage), asset/context-cost audit, and session forensics over the indexed transcripts (used-vs-idle tools/skills/MCP/agents, context-tool health, repeated requests, behavioral issues). The Stop/SubagentStop nudge hook points here. |
| atlas-orbit skill | Pick and instantiate the best-fit reusable loop for any recurring or iterative task (loop-until-dry, fan-out-adversarial-verify, red-green-tdd, doc-reconcile, incident-triage, and more). |
| atlas-harbor skill | Guided cross-plugin setup for the 10 vendor MCP connectors (NinjaOne, Auvik, CIPP, ConnectWise, Spanning, KnowBe4, Vanta, ThreatLocker, Paylocity, Blumira), which live in their owning domain plugins (it-operations, security-compliance, microsoft-365, hr-payroll) - atlas ships none of them itself. Detects installed domain plugins, shows enabled/disabled state, and directs credential setup to the owning plugin's `/plugin config`. |
| atlas-expedition skill | App-discovering UX swarm: auto-finds routes and form fields in any running web app, then runs the full cartographer -> persona -> fuzzer -> oracle -> reporter pipeline with no hardcoded paths. |
| atlas-survey skill | Comprehensive quality, security, and OWASP audit swarm: discovery-first scan of the full codebase, severity-graded findings, coverage report, and an actionable remediation plan. |
| Command library | Seventeen verification-gated `/atlas-*` launchers, each injecting the operating contract and driving a specific task through the squad. Includes `/atlas-launch`, which opens a remediation session from an audit hub, and `/atlas-doctor`, which diagnoses and repairs the plugin installation itself. |
| Subagent squad | Eighteen `atlas:<role>` subagents, including a five-agent browser-driven UI/UX test swarm. |
| Capability discovery | A read-only scanner plus a maintained catalog that recommend the skills/plugins/MCP a project needs, with exact install commands. |

## Layout

```
atlas/
|-- .claude-plugin/plugin.json     # manifest (name: atlas, v2.4.0)
|-- hooks/                         # 8 auto-loaded hooks + validate-readonly-query.sh guard + doctor rollback guard
|   |-- hooks.json                 #   wires every hook below
|   |-- session_boot.py            #   SessionStart: activate runtime, surface lessons
|   |-- prompt_optimizer.py        #   UserPromptSubmit: optional local-model rewrite
|   |-- bash_advisor.py            #   PreToolUse(Bash): advisory only, warns on catastrophic commands (never denies)
|   |-- validate-readonly-query.sh #   per DB-audit subagent: block writes in read-only audits
|   |-- format_after_edit.py       #   PostToolUse(Edit/Write): format after edits
|   |-- dispatch_tripwire.py       #   PostToolUse: count inline ops, flag orchestrator drift
|   |-- completion_gate.py         #   Stop: block premature "done" (opt-in via ATLAS_GATE)
|   |-- ingest_session.py          #   Stop/SubagentStop/SessionEnd/PreCompact: mirror transcript to DB
|   `-- nudge.py                   #   Stop/SubagentStop: self-improvement nudge (throttled)
|-- scripts/
|   |-- discover_capabilities.py   #   read-only stack scan -> ranked recommendations
|   |-- atlas_doctor.py            #   installation health check + auto-repair (/atlas-doctor, SessionStart guard)
|   `-- install_hooks.py           #   fallback wiring for non-plugin installs
|-- agents/                        # 18 subagents (atlas:<role>), auto-registered
|   |-- explorer.md                #   read-only codebase mapping
|   |-- implementer.md             #   bounded, verified code edits
|   |-- verifier.md                #   adversarial confirm/refute
|   |-- db-prober.md               #   read-only schema/RLS/index inspection
|   |-- schema-inventory.md        #   PostgreSQL catalog inventory (tables, columns, indexes)
|   |-- rls-privilege-audit.md     #   read-only RLS/grants/privilege audit
|   |-- naming-glossary-audit.md   #   table/column name audit against project glossary
|   |-- api-usage-map.md           #   map every DB object the API references
|   |-- ui-runtime-tester.md       #   live browser/runtime behavior
|   |-- planner.md                 #   multi-stage decomposition + stage maps
|   |-- docs-curator.md            #   maintains the docs/ single source of truth
|   |-- docs-auditor.md            #   audits docs/ for drift against code
|   |-- completeness-critic.md     #   "what did we miss" gap pass before done
|   |-- ux-cartographer.md         #   UX swarm: discover routes/fields + save contract
|   |-- ux-persona.md              #   UX swarm: enroll, enter data, walk UI, file findings
|   |-- ux-fuzzer.md               #   UX swarm: boundary/fuzz the discovered inputs
|   |-- ux-accuracy-oracle.md      #   UX swarm: independent recompute of client numbers
|   `-- ux-reporter.md             #   UX swarm: synthesis + three hard gates + deliverables
|-- commands/                      # 18 commands (/atlas + 17 launchers)
|   |-- atlas.md                   #   the architect: boot + configure the workspace
|   |-- atlas-prompt.md            #   prompt optimizer
|   |-- atlas-feature.md           #   full-stack feature build
|   |-- atlas-frontend.md          #   design-system UI build/refactor
|   |-- atlas-component.md         #   latency/cancellation-resilient component
|   |-- atlas-debug.md             #   reproduce, root-cause, fix, verify
|   |-- atlas-refactor.md          #   behavior-frozen restructuring
|   |-- atlas-readme.md            #   evidence-grounded README generator
|   |-- atlas-gitignore.md         #   zero-trust allowlist .gitignore
|   |-- atlas-handoff.md           #   session handoff / state preservation
|   |-- atlas-db-audit.md          #   read-only parallel DB audit + remediation plan
|   |-- atlas-grafana.md           #   Grafana SQL panel / dashboard builder
|   |-- atlas-m365.md              #   M365/Entra/Graph/Intune identity task
|   |-- atlas-vendor-assessment.md #   evidence-based vendor security assessment
|   |-- atlas-harden.md            #   idempotent CHECK/SET/VERIFY hardening script
|   |-- atlas-doctor.md            #   diagnose/repair the atlas installation itself
|   `-- atlas-validate.md          #   validation-gated plugin/skill review (reports, no auto-fix)
`-- skills/
    |-- atlas-engine/              # SKILL.md + references/ (incl. operating-contract.md, capability-catalog.md)
    |-- atlas-architect/           # SKILL.md - the boot/discovery methodology
    |-- atlas-cartographer/        # SKILL.md - architecture map + structural dedup -> docs/architecture/boundaries.md
    |-- atlas-sextant/             # SKILL.md - SQLite observability DB: measurable self-improvement
    |-- atlas-orbit/               # SKILL.md - recurring/iterative task loop library (12+ loops)
    |-- atlas-harbor/              # SKILL.md - guided cross-plugin vendor connector setup (10 connectors, owned by domain plugins)
    |-- atlas-expedition/          # SKILL.md - app-discovering UX swarm (no hardcoded paths)
    `-- atlas-survey/              # SKILL.md - comprehensive quality/security/OWASP audit swarm
```

## Getting started

Install the plugin (place this directory under your plugins root, or install from the
marketplace). On the next session the boot hook activates the runtime automatically.
Then run `/atlas` once per project to complete setup: it installs claude-mem and
context-mode if you approve, recommends the capabilities your stack needs, and writes
`.claude/atlas.local.md`.

```
/atlas                 # boot + configure this project (recommend then confirm)
/atlas-feature ...     # build a full-stack feature with evidence
```

## Commands

Every launcher injects the shared operating contract, then runs its task through the
squad with explicit verification gates. Invoke with `/<name>`; pass the inputs or let
the command ask once for anything missing.

| Command | Use it to |
| --- | --- |
| `/atlas` | Boot and configure the workspace: dependencies, capability discovery, hooks, config, docs seed. `/atlas menu` lists every atlas skill/launcher grouped by intent (and `/atlas menu <need>` recommends the best-fit one). |
| `/atlas-feature` | Build a full-stack feature across UI, API, and data with curl + read-back evidence |
| `/atlas-frontend` | Build or refactor UI on one design system (shadcn/ui + Tailwind + Radix), all four states |
| `/atlas-component` | Build a reusable component resilient to latency, cancellation, and partial failure |
| `/atlas-debug` | Reproduce a failing behavior, name the root cause, fix in place, prove the symptom is gone |
| `/atlas-refactor` | Restructure code with behavior frozen and proven unchanged, step by step |
| `/atlas-readme` | Generate an onboarding README grounded in the actual repo, every claim traceable |
| `/atlas-gitignore` | Generate a zero-trust deny-by-default `.gitignore` for a named stack |
| `/atlas-handoff` | Produce a high-density session handoff so a fresh session resumes with zero re-discovery |
| `/atlas-launch` | Open a remediation session pre-loaded with a finding's handoff from the latest audit hub (no args lists the actionable findings) |
| `/atlas-db-audit` | Run a strictly read-only parallel DB audit and hand back a remediation plan to approve |
| `/atlas-grafana` | Build or fix a Grafana SQL panel for any datasource and dialect |
| `/atlas-m365` | Deliver a Microsoft 365 / Entra / Graph / Intune config with least-privilege scopes and read-back |
| `/atlas-vendor-assessment` | Assess a vendor against a control framework you name, strictly from provided evidence |
| `/atlas-harden` | Write an idempotent CHECK/SET/VERIFY endpoint hardening script for RMM/MDM deployment |
| `/atlas-prompt` | Rewrite a vague request into a structured, environment-aware, verification-gated prompt |
| `/atlas-validate` | Run plugin-dev:plugin-validator and plugin-dev:skill-reviewer over a target plugin; reports findings without auto-fixing |
| `/atlas-doctor` | Diagnose the atlas installation itself (marketplace source, version rollback, orphaned cache, hooks, assets) and auto-repair with `--fix` |

## Hooks

The hooks auto-load from `hooks/hooks.json` when the plugin is installed - no
manual step. Each is stdlib-only and fails safe: any internal error exits 0, so a hook
can never block a session.

| Hook | Event | Purpose |
| --- | --- | --- |
| `session_boot.py` | `SessionStart` | Activate the runtime, report dependency state, surface relevant lessons |
| `atlas_doctor.py --hook` | `SessionStart` | Rollback guard: warn loudly if the installed plugin was downgraded, the marketplace points at a fork, or hooks/assets are missing (warn-only, always exits 0) |
| `prompt_optimizer.py` | `UserPromptSubmit` | Optional local-model prompt rewrite (trigger-gated; augments, never replaces) |
| `bash_advisor.py` | `PreToolUse` (Bash) | Advisory only: warns on catastrophic, near-irreversible patterns (`rm -rf /`, `mkfs`, `dd` to a disk, fork bomb). Never denies or forces an ask; the normal permission flow is preserved |
| `validate-readonly-query.sh` | `PreToolUse` (Bash), per DB-audit subagent | Block writes/DDL/grants during read-only audits (wired by the audit agents, not the global session) |
| `format_after_edit.py` | `PostToolUse` (Edit/Write) | Run the formatter after edits |
| `dispatch_tripwire.py` | `PostToolUse` | Auto-flag the session orchestrating on orchestration-skill invocation or `atlas:*` dispatch; count inline ops since the last dispatch and flag orchestrator drift (advisory; `ATLAS_TRIPWIRE=off`) |
| `completion_gate.py` | `Stop` | Block a premature "done" until all six definition-of-done conditions hold: evidence/, verified finding, CHANGELOG, ROADMAP, root README, and no code-changed-but-docs-didn't drift (orchestrating sessions only; `ATLAS_GATE=off`) |
| `ingest_session.py` | `Stop`, `SubagentStop`, `SessionEnd`, `PreCompact` | Mirror the session transcript into the observability DB for the sextant session-forensics lens (`ATLAS_INGEST=off`) |
| `nudge.py` | `Stop`, `SubagentStop` | Self-improvement: prompt to capture a lesson and check docs drift (throttled) |

For installs outside a plugin (a copied skill or bare agent), `scripts/install_hooks.py`
wires the hooks into settings manually. The optional ollama-backed optimizer is
configured with `ATLAS_OPTIMIZE_CMD`, `ATLAS_OPTIMIZER_MODEL`, and `ATLAS_OLLAMA_URL`
(see `skills/atlas-engine/references/hooks-automation.md`); it is not required.

## Dependencies

Atlas integrates two companions and recommends installing them on first `/atlas`:
- claude-mem - cross-session memory that backs the self-improvement layer.
- context-mode - large-output sandbox that keeps raw bytes out of the context window.

It also recommends a docs resolver (context7) and a symbol/LSP server (serena) when the
stack calls for them. Atlas degrades gracefully and uses only the tools present in the
session.

## License

Apache-2.0 . (c) w159
