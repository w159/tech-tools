<div align="center">

<img src="img/project-logo-icon.png" alt="Atlas logo" width="120" />

# Atlas

**A self-configuring Claude Code plugin that turns any coding agent into a disciplined multi-agent architect.**

![Atlas README hero banner](img/readme-hero-banner.png)

</div>

Atlas installs a full operating contract on top of Claude Code (and, partially,
omp): a research to verify loop, a squad of role subagents that work as a
colony off one shared board, sixteen hook programs, persistent memory, and a
self-improvement loop. You run `/atlas` once to onboard a project, then drive
work through 47 plainly named skills. The agent stops guessing, starts
verifying, and gets measurably better the more you use it in a codebase.

- Plugin version `8.6.0` (`plugins/atlas/.claude-plugin/plugin.json:3`)
- Marketplace catalog version `4.4.0` (`.claude-plugin/marketplace.json:5`)
- 47 skills, 12 agents, 16 hook programs (20 event bindings), 23 scripts,
  12 optional connectors, 1 output style, 1 omp extension package
- Two more plugins ship in the same marketplace: `armada` (org deployment,
  v1.1.1) and `programmer` (a Pragmatic Programmer codebase auditor, v0.2.1)

> Two version counters, not a typo. The marketplace wrapper (`4.4.0`) versions
> the catalog file. The `atlas` plugin it lists versions independently at
> `8.6.0`. Every `v8.x` reference below is the plugin version.

Latest release, 8.6.0 (2026-10-01), is **omp runtime parity**: the output style,
a hook bridge, the claude-mem recall gate and ponytail-before-commit mandates,
an exploration-shell deny, lean-ctx shell routing, a shell-edit delegation
gate, an advisor board gate, and a worker output-token cap
(`ATLAS_WORKER_MAX_TOKENS`, default 32000) now run in omp as well as Claude
Code. Colony orchestration (shared board, notes channel, native omp agents)
landed in 8.4.0. omp parity is **partial**: see
[omp parity and open gaps](#omp-parity-and-open-gaps).

---

## Table of contents

1. [What Atlas changes](#what-atlas-changes)
2. [Install and quickstart](#install-and-quickstart)
3. [The operating contract](#the-operating-contract-research-to-verify)
4. [Architecture: how a task flows](#architecture-how-a-task-flows)
5. [Skills (47)](#skills-47)
6. [Agents (12)](#agents-12)
7. [Hooks (16 programs)](#hooks-16-programs)
8. [Scripts (23)](#scripts-23)
9. [Connectors (12 MCP servers)](#connectors-12-mcp-servers)
10. [CRUD at a glance](#crud-at-a-glance)
11. [Other plugins in this marketplace](#other-plugins-in-this-marketplace)
12. [Output style](#output-style)
13. [omp parity and open gaps](#omp-parity-and-open-gaps)
14. [Docs as the single source of truth](#docs-as-the-single-source-of-truth)
15. [Self-improvement](#self-improvement)
16. [Repository layout](#repository-layout)
17. [Prerequisites and configuration](#prerequisites-and-configuration)
18. [Repair, testing, troubleshooting](#repair-testing-troubleshooting)

---

## What Atlas changes

![Atlas command center](img/command-center-hero.png)

A stock coding agent reads a few files, writes a change, and tells you it "should
work." Atlas replaces that with an evidence-first workflow. The table below is
the practical before and after once the plugin is installed.

| Behavior | Stock coding agent | With Atlas installed |
|---|---|---|
| Claiming done | "This should fix it." | Blocked by the completion gate until a command and its real output are shown (`plugins/atlas/hooks/completion_gate.py`). |
| Big tasks | One long inline session | Decomposed into stages, each dispatched to a role subagent with one failable check (`atlas-orchestrate`, `atlas:planner`). |
| Verifying a fix | The same context that wrote it | A fresh, adversarial `atlas:verifier` re-checks against real evidence (`plugins/atlas/agents/verifier.md`). |
| Your prompt | Sent as typed | Optimized by a local model first, so the agent gets a sharper task (`plugins/atlas/hooks/prompt_optimizer.py`). |
| Memory | Forgotten at session end | Durable facts saved to `~/.atlas/memory/` and reloaded at boot (`plugins/atlas/hooks/memory_capture.py`). |
| Repeated mistakes | Re-made every session | Mined from session telemetry into findings you accept or skip, then re-measured against a baseline (`atlas-doctor`, `plugins/atlas/scripts/atlas_doctor.py --mine`). No hook writes a skill or slash command. |
| Docs | Drift silently | Treated as the source of truth; the gate flags docs drift (`docs/`). |

---

## Install and quickstart

![Atlas plugin marketplace tile](img/plugin-marketplace-tile.png)

1. **Add the marketplace.** In Claude Code, run `/plugin` and add this repo's
   marketplace file, `.claude-plugin/marketplace.json` (catalog name `tech-tools`,
   version `4.4.0`, listing three plugins: `atlas`, `armada`, `programmer`).
2. **Install the plugin.** Install `atlas` from the marketplace. Two optional
   plugins live in the same catalog: `armada` for the 11-department org
   toolset (`plugins/armada/`), and `programmer` for a Pragmatic Programmer
   codebase auditor (`plugins/programmer/`, see below). Neither is required
   for `atlas` to work.
3. **Onboard a project.** In your repo, type `/atlas` once. The `atlas-setup`
   skill scaffolds `docs/` (plus internal `.atlas/` state), verifies or offers
   to install `claude-mem` and `context-mode`, wires the hooks, and recommends
   the next step (`plugins/atlas/skills/atlas-setup/SKILL.md`).
4. **Do work by naming a skill.** For a task, type the skill (for example
   `atlas-feature`, `atlas-debug`, `atlas-audit`) or just describe the work in
   plain language. Every non-setup skill auto-triggers from its `description`.

```text
/atlas                         # onboard / repair this project
atlas-feature add CSV export   # build a feature end to end, with verification
atlas-debug login returns 500  # root-cause a bug, not patch the symptom
atlas-audit                    # code + security audit as a parallel workflow
```

Two skills are manual by design (`disable-model-invocation: true`): the `atlas`
architect skill and `atlas-setup`. The other 45 auto-trigger.

---

## The operating contract: research to verify

Atlas runs every non-trivial task through a fixed loop. Skipping a stage is the
most common failure mode, so the contract makes each stage explicit and the
completion gate refuses to close until evidence exists.

```text
research  ->  theory  ->  test  ->  validate  ->  implement  ->  verify  ->  done
   |            |          |           |             |            |          |
 map the     form a     define a    check the     minimal     fresh, in-  evidence
 ground      hypothesis failing     plan vs       diff        dependent   shown:
 (explorer)  / approach  check      reality                   re-check    cmd+output
```

The rule that ties it together: **never say done, fixed, or working without the
exact command and its actual output, a `file:line`, a query result, or a diff.**
The completion gate hook enforces this at the Stop event.

---

## Architecture: how a task flows

![Atlas architecture](img/architecture-section-header.png)

The orchestrator plans and delegates; it does not do broad inline work itself.
Two dispatch modes are doctrine, not preference:

- **Fork (shares context)** for planning and curation: `atlas:planner`,
  `atlas:completeness-critic`, `atlas:docs-curator`.
- **Fresh (isolated, no inherited assumptions)** for independent checks:
  `atlas:verifier`, `atlas:explorer`.

Independent verification is never skipped. A claimed fix is not done until a
fresh `atlas:verifier` has re-checked it against real evidence. When two or more
subagents write in parallel, each gets an isolated git worktree; "they touch
different files" is not accepted as a reason to skip isolation
(`plugins/atlas/hooks/dispatch_tripwire.py`).

```text
             you: "atlas-feature add CSV export"
                            |
                   atlas-orchestrate
                            |
        +-------------------+-------------------+
        |                   |                   |
  atlas:explorer      atlas:planner       atlas:implementer   (parallel where independent)
  (map call path)     (stage map)         (minimal diff + gate)
        |                   |                   |
        +-------------------+-------------------+
                            |
                     atlas:verifier  (fresh context, adversarial)
                            |
                completion gate: evidence or blocked
                            |
                    atlas:docs-curator  (docs/ stays SSOT)
```

---

## Skills (47)

Skills are the entry points. Type the name or describe the work. Manual skills
are marked; everything else auto-triggers from its `description`. Forty-seven
skill directories ship, each with a `SKILL.md`; the first 20 rows below are the
original task skills, followed by grouped rows for the 27 skills ported from the
Compound Engineering plugin onto atlas's own control plane (atlas keeps its own
orchestrator, agents, `docs/` + `.atlas/` SSOT, findings ledger, and
explicit-push-consent policy as the authority). Sources:
`plugins/atlas/skills/`.

| Skill | Trigger example | What it does |
|---|---|---|
| `atlas` | `/atlas` (manual) | The architect bootstrap: verify claude-mem/context-mode, scan the project, recommend tooling, wire hooks, seed the `docs/` SSOT. |
| `atlas-setup` | `/atlas-setup` (manual) | Onboard, install tooling, wire connectors, and repair a broken install (`--fix`). |
| `atlas-orchestrate` | "orchestrate this refactor across UI + API + DB" | The engine: decompose, dispatch subagents, verify, keep docs the source of truth. |
| `atlas-feature` | "implement a feature that spans UI, API, and data" | Ship a feature end to end with a parallel squad and a final independent verifier. |
| `atlas-debug` | "login returns 500, find the real cause" | Root-cause a reproducible bug with evidence, not a symptom patch. |
| `atlas-refactor` | "clean up this module without changing behavior" | Restructure with before/after evidence that behavior is preserved. |
| `atlas-audit` | `atlas-audit` | Whole-codebase code + security audit (or architecture map, or atlas self-telemetry) as a verified workflow. |
| `atlas-doctor` | "have atlas self-improve" | Interactive self-improvement loop: mine cross-session findings, ask the user apply/skip/modify per finding, apply what's accepted, and measure the result. |
| `atlas-frontend` | "build this dashboard page" | Screens/flows on one design system with every state (loading/empty/error/success) rendered. |
| `atlas-component` | "add a reusable upload component" | Build one latency-resistant component that handles cancellation and partial failure. |
| `atlas-ux-test` | "test this flow in a browser" | UX runtime swarm: personas, scripted entry, real-browser walks, an independent oracle. |
| `atlas-db-audit` | "audit the database before we ship" | Read-only schema inventory, code reconciliation, and privilege/naming checks. |
| `atlas-gitignore` | "harden the .gitignore for this stack" | Generate a zero-trust, deny-by-default `.gitignore` with secrets re-excluded last. |
| `atlas-handoff` | "hand off this session" | Dense handoff so a fresh session resumes with zero re-discovery. |
| `atlas-harden` | "write a remediation script for RMM" | Idempotent CHECK/SET/VERIFY remediation script that proves compliant vs changed. |
| `atlas-launch` | `atlas-launch` | Launch a remediation session preloaded with a finding from the latest audit hub. |
| `atlas-loop` | "keep running this until it passes" | Match a recurring/iterative task to a reusable loop and instantiate it on the right cadence. |
| `atlas-prompt` | "turn this vague request into a real prompt" | Rewrite a vague ask into a structured, environment-aware prompt; asks up to 3 questions first. |
| `atlas-readme` | "the README is stale" | Generate an onboarding-grade README, every claim traced to a real file. |
| `atlas-validate` | "validate this plugin is done" | Audit a plugin's structure, manifest, and content with pass/fail per check. |
| `atlas-wiki` | "refresh the wiki diagrams" | Regenerate `docs/wiki/` diagrams from `docs/architecture/` via graphify. |
| `atlas-brainstorm` | "brainstorm what this should do" | WHAT-stage requirements elicitation; writes a requirements-only `docs/plans/<date>-<slug>-brainstorm.md`. |
| `atlas-plan` | "plan this implementation" | HOW-stage plan with stable `U<N>` units, a Verification Contract, and a mandatory `atlas:completeness-critic` review; hands off to `atlas-orchestrate`. |
| `atlas-simplify` | "simplify this diff" | Bounded post-implementation pass over a fresh diff with three read-only reviewers, behavior-preserving apply, full gate re-run. |
| `atlas-review` | "review this PR" | Risk-selected multi-persona diff/PR review with typed findings; report-only by default. |
| `atlas-compound` | "capture the lesson" | Durable learning capture into `docs/lessons/`, behind a solved-verified-non-obvious gate. |
| `atlas-autopilot` | "run this end to end" | Consent-gated pipeline: brainstorm/plan, work, simplify, review, compound, local commit, then a hard stop before any push/PR. |
| `atlas-strategy`, `atlas-pulse`, `atlas-sweep` | "refresh the product strategy" | Product strategy anchor; time-windowed telemetry pulse; feedback-source ingestion into a rolling triage doc. |
| `atlas-bakeoff`, `atlas-pov`, `atlas-explain` | "compare these two designs" | Competing-approach selection; evidence-floored independent opinion; evidence-backed explanation of existing behavior. |
| `atlas-prototype`, `atlas-optimize`, `atlas-feedback-analysis` | "prototype before we decide" | Throwaway demonstrate-then-decide prototypes; measurement-first optimization; raw feedback into quoted findings. |
| `atlas-commit`, `atlas-ship`, `atlas-babysit-pr`, `atlas-resolve-pr-feedback` | "commit this" | Local-only commit; commit+push+PR behind a confirmation gate; bounded CI-repair loop; review-thread triage and fix (replies never auto-posted). |
| `atlas-polish`, `atlas-dogfood`, `atlas-test-xcode`, `atlas-test-browser` | "polish this UI" | Live UX polish; diff-scoped autonomous browser QA; iOS Simulator runtime; diff-scoped browser smoke check. |
| `atlas-proof`, `atlas-promote`, `atlas-worktree` | "publish this doc for review" | Publish/annotate/collect review workflow; post-ship announcement drafts (never auto-posted); host-portable `git worktree` isolation. |

---

## Agents (12)

Agents are the subagents the orchestrator dispatches. You rarely call them
directly; you see them named in the dispatch line. Read-only agents cannot edit
your code. Sources: `plugins/atlas/agents/`.

| Agent | Mode | Role and example |
|---|---|---|
| `atlas:explorer` | read-only, fresh | Maps a feature or call path. "map the auth call path" returns a `file:line` map, not a file dump. |
| `atlas:planner` | fork | Turns a task into a numbered stage map, each stage with one failable check; flags concurrent stages. |
| `atlas:implementer` | writes | Makes ONE bounded change as a minimal diff, checks docs, runs the project gate (lint/typecheck/test/build), reports with evidence. |
| `atlas:verifier` | read-only, fresh | Adversarially confirms or REFUTES a claimed fix in a clean context. Never fixes. |
| `atlas:completeness-critic` | fork, read-only | Hunts unverified claims and unexercised paths before "done"; refutes done on a load-bearing gap. |
| `atlas:docs-curator` | writes docs only | Post-ship maintainer of `docs/`, CHANGELOG, ROADMAP, `.gitignore`. Never edits source. |
| `atlas:docs-auditor` | read-only | Drift auditor: compares `docs/` against real code, returns current/stale/missing per area. |
| `atlas:db-prober` | read-only | Inspects SQL schema, RLS policies, GRANTs, indexes, EXPLAIN plans. Proposes, never writes. |
| `atlas:schema-inventory` | read-only | Enumerates tables, columns, types, constraints, indexes from the live DB. |
| `atlas:rls-privilege-audit` | read-only | PostgreSQL RLS, grants, and roles checked against least privilege. |
| `atlas:naming-glossary-audit` | read-only | Audits table/column names against a project glossary. |
| `atlas:ui-runtime-tester` | read-only | Starts a web app and validates observed behavior in a real browser (render, console, network, states). |

---

## Hooks (16 programs)

Hooks are the automation layer. They fire on Claude Code lifecycle events with
no action from you, and they are what actually change the agent's behavior
session to session. All are stdlib Python. Most fail open: an internal error
exits 0, so a hook does not block a session. The deliberate exceptions fail
closed or deny on purpose: `dispatch_tripwire.py` (cannot verify the inline-op
count, or a nested subagent dispatch), `completion_gate.py` (a checked
condition fails), and `fallow_gate.py` (the fallow CLI returns `verdict: fail`
on a git commit/push; fail-open if the CLI is absent). Wiring:
`plugins/atlas/hooks/hooks.json`: 16 distinct hook programs across 20 event
bindings (`atlas_doctor.py --hook` lives in `scripts/`; `docs_drift.py` and
`validate-readonly-query.sh` are helpers, not bound).

| Hook | Event | What it does when it fires |
|---|---|---|
| `session_boot.py` | SessionStart | Loads the atlas runtime: contract, memory, todo-board carry-over, tool-routing blurb, and a "Recall first" line when claude-mem is enabled. Repairs a missing `docs/` subfolder only if `docs/` already exists. |
| `atlas_doctor.py --hook` | SessionStart | Rollback guard: warns if the installed plugin was downgraded, the marketplace points at a fork, or hooks/assets are missing. Warn-only. |
| `prompt_optimizer.py` | UserPromptSubmit | Optional trigger-gated prompt rewrite through a local model; also arms orchestration early for substantive engineering prompts (`ATLAS_ENGINE_ARM=off`). |
| `recall_gate.py` | PreToolUse (all tools) | claude-mem recall gate: the first main-thread call that is not a claude-mem call (or `TodoWrite`) is denied on every attempt until a real claude-mem call happens, naming the search tool. Armed only when claude-mem is enabled (`ATLAS_MANDATES=off`). |
| `bash_advisor.py` | PreToolUse (Bash) | Advisory only: warns on catastrophic commands, and nudges a ponytail-review of the staged diff once per session before `git commit`. Never denies. |
| `fallow_gate.py` | PreToolUse (Bash) | On `git commit`/`git push`, runs `fallow audit` and denies on `verdict: fail`. Fail-open if the CLI is missing (`ATLAS_FALLOW=off`). |
| `dispatch_tripwire.py` | PreToolUse + PostToolUse | Denies native `Grep`/`Glob` toward lean-ctx when it is reachable, nudges `Read`/`Bash`, counts inline operations and denies past the armed threshold, and gates `atlas:*` dispatches (tools list, `name`, no `model` override, no nested dispatch). `ATLAS_TRIPWIRE_HARD=off` lifts the denies. |
| `todo_capture.py` | PostToolUse (TodoWrite) | Mirrors every `TodoWrite` plan into the durable board `<project>/.atlas/.run/todos.json` (`ATLAS_TODO=off`). |
| `format_after_edit.py` | PostToolUse (Edit/Write) | Auto-formats a file (ruff/prettier/black/isort) the moment Claude edits it, keeping the diff clean. |
| `docs_drift_watch.py` | PostToolUse (Edit/Write) | Inline backstop for the gate's docs condition: warns when non-docs code changes without a `docs/CHANGELOG.md` entry. Debounced per session. |
| `connector_credential_watch.py` | PostToolUse (connector MCP tools) | On the first 401/403 from a matched connector (atlas plugin tools, `falcon-mcp`, `cipp`, `connectwise`, `plaid`, `gcloud`), tells the session to restart the server instead of sweeping endpoints (`ATLAS_CONNECTOR_WATCH=off`). |
| `completion_gate.py` | Stop | The definition-of-done gate, thirteen conditions (a)-(m): blocks a "done" claim until evidence, an independent verifier, a drained todo list, and non-drifted docs exist. Condition (m) requires at least one `Task`/`Agent` dispatch when main-thread code shipped outside `docs/`. `ATLAS_GATE=off` disables it. |
| `ingest_session.py` | Stop, SubagentStop, SessionEnd, PreCompact | Mirrors the session transcript into the atlas observability DB for later audit (`ATLAS_INGEST=off`). |
| `chronicle_facet.py` | Stop | Writes one deterministic `facets` row per session and mirrors signals into `friction_events`. |
| `memory_capture.py` | Stop | Saves durable lessons to `~/.atlas/memory/`, silently. Not bound to SubagentStop. |
| `nudge.py` | Stop | Throttled self-improvement nudge; silent when memory capture already wrote this turn. |

Worked example: you finish a bug fix and say "done." The `completion_gate.py`
Stop hook inspects the run, sees no command output backing the claim (and that
source changed but no `docs/` file did), and blocks with a message naming the
missing evidence. You run the test, paste the output, and the gate passes.

---

## Scripts (23)

The `scripts/` directory holds the tooling the skills, hooks, and dashboard
call: 23 non-test scripts, each with a `test_*.py` beside it where it carries
logic. Sources: `plugins/atlas/scripts/`.

| Script | Purpose |
|---|---|
| `discover_capabilities.py` | Read-only discovery of installed skills, agents, and tools available to the session. |
| `atlas_db.py` | The observability store: a single global SQLite SSOT for coding-agent run health. |
| `session_ingest.py` | Mirror Claude Code and omp session transcripts into the observability DB (omp workers ingest as sidechains of the lead). |
| `atlas_doctor.py` | Rollback repair (`--fix`, `--hook`) and the self-improvement miners (`--mine`, `--list-findings`, `--set-status`, `--baseline`, `--remeasure`). |
| `atlas_memory.py` | Persistent, file-backed, char-bounded memory store under `~/.atlas/memory/` (`snapshot`/`list`/`add`/`remove`/`usage`). |
| `atlas_curator.py` | Lifecycle management for skill assets (`run`/`status`/`pin`/`unpin`/`restore`). |
| `atlas_context_optimizer.py` | Disable unused skills/agents to cut token cost. |
| `atlas_todo.py` | The durable todo board and per-worker notes channel: `list`, `set`, `add`, `claim`, `complete`, `status`, `remove`, `carry`, `counts`, `note`, `notes`. |
| `atlas_finding.py` | Append one verdict row to `.atlas/.run/findings.json`; the verifier's write path, since it cannot use Write/Edit. |
| `atlas_dashboard.py` | The local multi-session dashboard and its JSON API (`status`, `serve`, `ensure`, `stop`, `url`). |
| `atlas_control.py` | Dashboard control plane: behavior knobs, ecosystem inventory, connector operations. Writes only to allowlisted `settings.json`, `~/.claude.json`, and plugin `.env` locations. |
| `atlas_mux.py` | Opt-in tmux colony mode (`ATLAS_MUX=tmux`): spawn, status, and kill headless `claude -p` / `omp -p` workers. |
| `atlas_packs.py` | Resolve the Compound Packs declared in `.claude/atlas.local.md` into pack roots. |
| `atlas_hook_guard.py` | Shared Stop-hook loop guard. |
| `sweep_state.py` | Deterministic single-writer engine for the `atlas-sweep` state file. |
| `tool_routing.py` | Stack signals and the compact tool-routing boot lines. |
| `turn_scoring.py` | Optional model-scored quality judgments of assistant replies (TypeSafe / Jev). |
| `typesafe_client.py` | Stdlib-only client for the TypeSafe System One API. |
| `asset_audit.py` | The context-cost lens of `atlas-audit`. |
| `build_hub.py` | Build the knowledge-graph hub for an audit run. |
| `install_hooks.py` | Install the automation hooks into a `settings.json` (gated). |
| `lint_skill_names.py` | Assert every skill dir starts with `atlas-` and uses a valid slug. |
| `lint_docs_names.py` | Docs conformance check and fix: date-first names for dated docs and `.atlas` records. |

Example: `atlas_context_optimizer.py` reads real usage from the observability DB
and disables skills and agents a project never touches, so a large plugin does
not tax every prompt's token budget.

---

## Connectors (12 MCP servers)

Atlas ships optional MCP connectors for MSP and IT operations, wired through
`plugins/atlas/.mcp.json` and configured with the `userConfig` fields in
`plugin.json` (51 keys). Each stays disabled until you provide its credentials,
so the plugin is safe to install with no config. Twelve servers are declared:
eleven Node bundles (`plugins/atlas/mcp/<name>/server.mjs`) plus the Python
`falcon` server (CrowdStrike, launched with `uv run --project`). All twelve take
their credentials from `userConfig` (`CFG_*` variables).

| Connector | Domain | Enable by setting |
|---|---|---|
| Auvik | Network monitoring | `auvik_username`, `auvik_api_key` |
| ConnectWise Manage | PSA / ticketing | `cw_manage_company_id`, `cw_manage_public_key`, `cw_manage_private_key` |
| NinjaOne | RMM | `ninjaone_client_id`, `ninjaone_client_secret` |
| Kaseya Spanning | Backup | `spanning_admin_email`, `spanning_api_token` |
| CIPP | Microsoft 365 multi-tenant | `cipp_base_url` (+ API key or OAuth trio) |
| Blumira | SIEM / detection | `blumira_jwt_token` or `blumira_client_id` + secret |
| KnowBe4 | Security awareness | `knowbe4_api_key` |
| ThreatLocker | Zero-trust endpoint | `threatlocker_api_key` |
| Vanta | GRC / compliance | `vanta_client_id`, `vanta_client_secret` |
| Paylocity | HR / payroll | `paylocity_client_id`, `paylocity_client_secret`, `paylocity_company_id` |
| PAN-OS | Palo Alto firewall / Panorama | `panos_host`, `panos_api_key` |
| CrowdStrike Falcon | Endpoint / threat intel | `falcon_client_id`, `falcon_client_secret` (+ `falcon_base_url`, `falcon_member_cid`) |

Example: set `ninjaone_client_id` and `ninjaone_client_secret` in the plugin
config, and `atlas-harden` can pull device state from NinjaOne while it drafts
an idempotent remediation script. Node connector source lives under
`mcp_servers/` (eleven vendor `*-mcp` projects, a `_shared/` helper folder, and
`mcp-gateway`, a separate Entra-ID remote gateway that is not declared in
`.mcp.json`); `falcon` is vendored at `plugins/atlas/mcp/falcon`.

---

## CRUD at a glance

How each Atlas surface is **C**reated, **R**ead, **U**pdated, and **D**eleted in
the current implementation. "Plugin source" means a file under `plugins/atlas/`
that you edit in this repo; "runtime state" means data atlas writes while it
runs. Nothing in atlas writes a skill, agent, or slash command for you.

| Surface | Create | Read | Update | Delete |
|---|---|---|---|---|
| **Skills** (47) | Add `plugins/atlas/skills/atlas-<slug>/SKILL.md`; `lint_skill_names.py` enforces the `atlas-` prefix. No hook or script generates one. | Auto-trigger from `description`; manual skills (`atlas`, `atlas-setup`) by name. | Edit `SKILL.md` or its `references/`. `atlas_context_optimizer.py` sets `disable-model-invocation: true` on skills a project never uses. | Delete the directory. `atlas_curator.py` (`status`/`pin`/`unpin`/`restore`) only archives legacy `created_by: atlas-auto` skills under `~/.claude/skills/`; it never deletes and never touches the plugin's skills. |
| **Agents** (12) | Add `plugins/atlas/agents/<role>.md`; auto-registered as `atlas:<role>`. | Dispatched by name via `task`/`Agent`; listed in the dashboard Agents tab. | Edit the `.md`, then regenerate the omp copies with `bun plugins/atlas/omp/gen-agents.ts`. Per project: the dashboard saves a same-name override under `<project>/.claude/agents/`. | Delete the file and regenerate; dashboard **Reset** removes a project override and restores the plugin source. |
| **Hooks** (16 programs) | Add `hooks/<name>.py` and bind it in `hooks/hooks.json`. Outside a plugin install: `scripts/install_hooks.py`. | Auto-loaded from `hooks.json` at session start. | Edit the program or its `hooks.json` binding. Kill switches are env vars (`ATLAS_GATE`, `ATLAS_TRIPWIRE_HARD`, `ATLAS_MANDATES`, ...); the dashboard Behavior tab writes an allowlisted subset (for example `ATLAS_GATE`, `ATLAS_TRIPWIRE_HARD`, `ATLAS_INGEST`, `ATLAS_FALLOW`) into `~/.claude/settings.json` `env`. | Remove the binding and the file. |
| **Scripts** (23) | Add `scripts/<name>.py` with a `test_<name>.py` beside it. | Run as CLIs through `${CLAUDE_PLUGIN_ROOT}/scripts/...`; each prints JSON or text. | Edit in place. | Delete the file and every caller. |
| **Connectors** (12) | Declare in `.mcp.json`, add its `userConfig` keys in `plugin.json`, ship the bundle under `plugins/atlas/mcp/`. Users add their own via the dashboard (`/api/mcp/add`). | `<vendor>_status` tool; dashboard Ecosystem tab; `node test-mcp-tools.mjs --list`. | Set credentials in `userConfig`, the dashboard (`/api/connectors/env`), or a `.env` import. Must pass `node test-mcp-tools.mjs` before it is done. | Dashboard `/api/mcp/remove` for user-added servers; `/api/mcp/toggle` disables one. A bundled connector stays disabled until credentials exist. |
| **Colony board / todos** | `TodoWrite` (`todo_capture.py`) or omp `todo` mirrors the lead's plan; `atlas_todo.py add`/`set`; dashboard **add**. | `atlas_todo.py list`/`counts`; dashboard Work tab; the completion gate's drain check. Board file: `<project>/.atlas/.run/todos.json`. | `claim`, `complete --evidence`, reopen (`set`/dashboard); `note --owner` appends worker notes to `.atlas/.run/board/<owner>.jsonl`. | `atlas_todo.py remove`; an unparseable board is moved to `todos.json.corrupt-<ns>`, never silently emptied. A linked worktree resolves to the main repo's board. |
| **Findings** (two stores) | Verdicts: `atlas_finding.py --id --status --title --evidence` appends to `<project>/.atlas/.run/findings.json` (the verifier's write path; statuses `verified`/`rejected`/`needs-evidence`/`open`). Mined findings: `atlas_doctor.py --mine` upserts rows into `~/.atlas/atlas.db`. | Verdicts: the completion gate's condition (b). Mined: `atlas_doctor.py --list-findings [--status]`, dashboard Findings tab (`/api/findings`). | Mined findings move through `atlas_doctor.py --set-status <id> open\|accepted\|rejected\|applied\|verified\|regressed`. | Neither store is deleted by a command; status changes close them. `--purge` only trims telemetry tables to a row cap. |
| **Output style** (1) | `output-styles/atlas-orchestrator.md`, `force-for-plugin: true`. | Applied automatically whenever atlas is enabled; omp gets it via `omp/style.ts`. | Edit the `.md`; drift tests fail if the omp copy diverges or a new Claude tool name lacks a mapping in `contracts/tool-names.json`. | Remove the file; `ATLAS_STYLE=off` disables it in omp. |
| **omp extension** | Load the package directory: `omp --extension <abs>/plugins/atlas/omp` or add it under `extensions:` in `~/.omp/agent/config.yml`. | Handlers run on omp events; `omp/README.md` lists each rule. | Edit `omp/*.ts` (run `bun test plugins/atlas/omp`); shared rules live in `contracts/*.json`, read by Python and TypeScript alike. | Remove the `extensions:` entry. Kill switches: `ATLAS_GATE`, `ATLAS_TRIPWIRE_HARD`, `ATLAS_HOOK_BRIDGE`, `ATLAS_LEAN_SHELL`, `ATLAS_ADVISOR_GATE`, `ATLAS_STYLE`, `ATLAS_MANDATES` (env vars, set in your shell or omp config). |
| **Dashboard** | `atlas_dashboard.py serve --port 7421` (or `ensure`). | `http://127.0.0.1:7421/` (tabs: overview, live, work, agents, findings, behavior, ecosystem, settings); `/api/status`, `/api/runs`, `/api/sessions`, `/api/findings`, `/api/todo`, `/api/agents`, `/api/memory`. | Work tab drives the board (add/claim/complete/reopen/remove); Agents tab saves or resets overrides; Behavior, Ecosystem, and Settings write allowlisted `settings.json`, `~/.claude.json`, and `.env` keys. | `atlas_dashboard.py stop`. It binds loopback only unless `--allow-remote`. |
| **Self-improvement / doctor** | `atlas_doctor.py --mine` runs the miners (turn quality, colony adherence, ...); the `atlas-doctor` skill walks you through each finding. | `--list-findings`; `atlas-audit` self mode over the observability DB (`~/.atlas/atlas.db`). | Accept, skip, or modify per finding; `--baseline` then `--remeasure` proves the fix moved the metric. | `--purge` (with `--purge-cap`) trims telemetry tables to a row cap; `--fix` repairs a rolled-back install. |
| **Memory** | `memory_capture.py` at Stop adds lessons through `atlas_memory` to `~/.atlas/memory/MEMORY.md` and `PROJECT.md`; `atlas_memory.py add`. | Frozen snapshot injected at `session_boot.py`; `atlas_memory.py list`/`snapshot`/`usage`; dashboard `/api/memory`. | `add` is append-only; mid-session writes land on disk now and appear in the next session's snapshot. `ATLAS_MEMORY_CAPTURE=off` stops capture. | `atlas_memory.py remove` (exact substring match). |

---

## Other plugins in this marketplace

The marketplace catalog (`.claude-plugin/marketplace.json`) lists three
plugins. Only `atlas` is required; the other two are independent installs.

**`armada`** (`plugins/armada/`, v1.1.1) is the organizational deployment
layer split out of atlas: 11 department agents (data, design, engineering,
finance, HR, IT ops, M365, product, productivity, security, support), 4
invocable setup skills (`armada`, `armada-brand`, `armada-department`,
`armada-connect`), and 156 department skills carrying org branding, policy, and
compliance context. Its own dispatch entry point is the `armada` skill
(`plugins/armada/skills/armada/SKILL.md`).

**`programmer`** (`plugins/programmer/`, v0.2.1) turns *The Pragmatic
Programmer* (20th Anniversary Edition) into an active codebase auditor and
coding-time advisor. It ships 4 skills: `code-review` (multi-lens review of a
target or diff), `code-principles` (surfaces relevant book principles while you
work), `tpp-audit` (a 10-dimension codebase review with file:line evidence,
`plugins/programmer/skills/tpp-audit/`), and `tpp-principles` (1-4 relevant
principles per prompt, `plugins/programmer/skills/tpp-principles/`); 1
per-dimension auditor agent (`tpp-auditor`,
`plugins/programmer/agents/tpp-auditor.md`); a `UserPromptSubmit` nudge hook
that points at the relevant concept file for your prompt
(`plugins/programmer/hooks/hooks.json`); and an 89-concept glossary under
`skills/tpp-principles/references/concepts/` for citation.

---

## Output style

`output-styles/atlas-orchestrator.md` ships with `force-for-plugin: true` and
`keep-coding-instructions: true`, so it auto-applies whenever atlas is enabled
and leaves Claude Code's own coding behavior intact. It reshapes how the agent
reports, not how it engineers. It reaches the main conversation and forks, never
a fresh subagent, so anything a subagent must obey goes into its dispatch
prompt. Every substantive reply opens with a status header:

```text
ATLAS | <glyph> <phase> | <one-line state>
```

The glyph marks the current phase (research, theory, test, validate, implement,
verify, done, blocked), dispatches are named in one line, and no "done" claim is
allowed without evidence. This is the on-screen face of the operating contract.
In omp, `omp/style.ts` appends the same file, with Claude tool names translated
through `contracts/tool-names.json`, to the main session's system prompt
(`ATLAS_STYLE=off` disables it).

---

## omp parity and open gaps

Atlas also runs inside omp through the
extension package at `plugins/atlas/omp/`. **Parity is partial.** The rules are
defined once in `plugins/atlas/contracts/` (`native-tools.json`,
`mandates.json`, `tool-names.json`, `hook-bridge.json`) and read by both the
Python hooks and the TypeScript modules, with the same shared test cases in
both suites. Load it by directory:

```bash
omp --extension /absolute/path/to/tech-tools/plugins/atlas/omp
```

What runs in omp today (8.6.0): native `grep`/`glob` routed to lean-ctx and
`read`/`bash` nudged; exploration-only shell commands denied toward the `ctx_*`
tool; every `bash` routed through `lean-ctx -c`; the claude-mem recall gate and
ponytail-before-commit nudge; a delegation gate that also counts code written
through the shell; the output style; a hook bridge that runs the six bridgeable
Claude hooks (session boot, prompt optimizer, bash advisor, fallow gate,
format-after-edit, docs-drift watch) from `hooks.json`; an advisor board gate
(at most 3 blocks); a worker output-token cap (`ATLAS_WORKER_MAX_TOKENS`,
default 32000); the `todo`-to-board mirror; and 12 generated native agents with
per-tier `thinkingLevel` and model-role fallbacks.

Open gaps, from `docs/atlas-harness-parity.md` ("Remaining gaps" and the
delegation-policy note):

- **Completion-gate conditions (a)-(l), memory capture, the nudge, and
  chronicle** are not ported: they parse Claude Code transcript JSONL.
  `session_ingest.py` now ingests omp sessions, so they can move onto the
  ingested rows; not done in 8.6.0.
- **`dispatch_tripwire.py`'s inline-op thresholds, dispatch-spec checks, and
  production-edit deny** are still Claude-only.
- **Connector credential watch** does not work in omp: omp's MCP name mint
  drops the server/tool separator (a harness limit).
- **The output style** still carries Claude-only sentences about `TodoWrite`
  gating (`CLAUDE_CODE_ENABLE_TODO_TOOLS`); a contract test pins them for Claude
  Code.
- **Delegation policy is an open decision.** Both harnesses accept "the lead
  edits code inline, then dispatches a verifier" because the mandate is "at
  least one dispatch"; requiring workers to write code would change behavior for
  every small fix.
- **Marketplace installs do not surface `omp/agents/`**; load the package
  directory as above to get the colony workers. On the machine the parity doc
  was measured on, omp's agent registry also pointed at a removed install path,
  so `atlas:*` agents were not dispatchable until atlas was reinstalled there.
- Claude Code has no per-subagent thinking setting; subagents inherit the
  session's, so worker cost there is controlled by each agent's `model:` and
  `effort:` frontmatter.

---

## Docs as the single source of truth

![Atlas docs and wiki](img/docs-wiki-header.png)

Atlas treats `docs/` as canonical. `atlas-setup` scaffolds it, `atlas:docs-curator`
maintains it after every ship (CHANGELOG, ROADMAP, architecture), `atlas:docs-auditor`
flags drift, and `atlas-wiki` regenerates the `docs/wiki/` diagrams from
`docs/architecture/`. The completion gate refuses to close when source changed
but docs did not, so documentation cannot silently fall behind the code.
`.atlas/` holds only atlas's own internal run state (`.atlas/evidence/`,
`.atlas/audits/`, ephemeral `.atlas/.run/`); it never contains a `docs/` tree.

---

## Self-improvement

The plugin gets better the more it is used in a codebase:

- **Persistent memory** at `~/.atlas/memory/`, captured at Stop and reloaded at
  every session boot (`hooks/memory_capture.py`, `scripts/atlas_memory.py`).
- **No automatic skill creation.** Removed in 5.5.0: nothing atlas runs may write
  a SKILL.md, an agent, or a slash command. Lessons land in memory, findings,
  and docs.
- **Findings you decide on.** `atlas_doctor.py --mine` turns session telemetry
  (turn quality, colony adherence, ...) into findings; the `atlas-doctor` skill
  asks per finding, applies what you accept, and `--baseline`/`--remeasure`
  prove the fix moved the metric.
- **Legacy skill curation** that archives stale `created_by: atlas-auto` skills,
  never deleting (`scripts/atlas_curator.py`).
- **Context optimization** that disables unused skills and agents to cut cost
  (`scripts/atlas_context_optimizer.py`).
- **Observability DB** that mirrors transcripts so `atlas-audit`'s self mode can
  measure the agent's own run health (`scripts/atlas_db.py`).
- **Optional turn scoring** with `TYPESAFE_API_KEY` set: recent replies are sent
  to TypeSafe for scoring (`ATLAS_TYPESAFE_SCORING=off` disables it).

Companion plugins `claude-mem` (memory) and `context-mode` (context protection)
are required; `atlas-setup` detects them and offers to install if missing.

---

## Repository layout

```text
atlas/
|- README.md                 # this file
|- img/                      # repo imagery (hero, headers, tiles)
|- .claude-plugin/           # marketplace.json catalog (name: tech-tools, 4.4.0)
|- plugins/
|  |- atlas/                 # the plugin (v8.6.0)
|  |  |- .claude-plugin/     # plugin.json manifest + userConfig (51 keys)
|  |  |- .mcp.json           # 12 connector server definitions
|  |  |- package.json        # omp.extensions entry for marketplace installs
|  |  |- skills/             # 47 skills
|  |  |- agents/             # 12 role agents
|  |  |- hooks/              # 16 hook programs + helpers + hooks.json + tests
|  |  |- scripts/            # 23 tools (db, memory, board, dashboard, doctor, ...) + tests
|  |  |- contracts/          # shared rules read by Python hooks and omp modules
|  |  |- omp/                # omp extension package (+ generated agents/)
|  |  |- mcp/                # bundled connector servers (11 Node + falcon)
|  |  |- output-styles/      # atlas-orchestrator report style
|  |  |- references/         # supporting reference docs
|  |  \- CHANGELOG.md
|  |- armada/                # optional org-deployment plugin (v1.1.1)
|  |- programmer/            # optional Pragmatic Programmer auditor plugin (v0.2.1)
|  |- _standards/            # shared authoring standards
|  \- _templates/            # skill/agent templates
|- mcp_servers/              # connector source (11 vendor *-mcp projects + _shared + mcp-gateway)
|- mcp_node/                 # Node client libraries the MCP servers depend on
|- skills/                   # 13 standalone skills not tied to a single plugin
|- docs/                     # canonical documentation (SSOT)
|- test-mcp-tools.mjs        # connector boot gate
|- AGENTS.md                 # shared source of truth for agents
\- CONTRIBUTING.md
```

---

## Prerequisites and configuration

- **Python 3** for all 16 hook programs and the `scripts/` tooling. No
  third-party libraries: hooks are stdlib only. **Bun** is needed only to run
  the omp tests or regenerate omp agents; **uv** only for the `falcon` connector.
- **claude-mem** and **context-mode** companion plugins (required;
  `atlas-setup` offers to install them).
- **Connector credentials** are optional. Set them in the plugin's `userConfig`
  (see `plugins/atlas/.claude-plugin/plugin.json`), or, for the standalone
  servers under `mcp_servers/`, copy the matching keys from `.env.template` into
  a `.env` file at the repo root. Every connector stays disabled until its
  credentials are present. Nothing is committed; secrets live only in your local
  config.

The `armada` plugin adds 11 department agents for org deployment and is separate;
install it only for organizational use. The `programmer` plugin is a standalone
codebase auditor with no dependency on `atlas` or `armada`; install it if you
want Pragmatic Programmer principle audits.

---

## Repair, testing, troubleshooting

**Repair.** If atlas looks broken (subagents not launching, plugin acting like an
older version, marketplace pointing at a stale fork), run the doctor:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --fix
```

The same script runs at every `SessionStart` in `--hook` mode as a rollback
guard. Outside a plugin install (bare skill files), wire the hooks with
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py"`.

**Testing.** Hooks and scripts ship unit tests beside them. Run them from the
repo root:

```bash
python3 -m unittest discover -s plugins/atlas/hooks
python3 -m unittest discover -s plugins/atlas/scripts
```

Lint with `ruff check plugins/atlas/hooks plugins/atlas/scripts`; typecheck with
`pyright` (config at `pyrightconfig.json`).

**Connector boot gate.** Any change to a bundled MCP connector must pass the boot
harness at the repo root before it is done (`AGENTS.md:95` makes it a mandatory
propagation check):

```bash
node test-mcp-tools.mjs          # probe every connector
node test-mcp-tools.mjs panos    # probe one connector
node test-mcp-tools.mjs --list   # print the known connector names
```

It launches each connector exactly as `plugins/atlas/.mcp.json` declares it - the
eleven Node connectors as `plugins/atlas/mcp/<name>/server.mjs` over MCP stdio,
`falcon` through its `uv run --project plugins/atlas/mcp/falcon ...` entry - with
placeholder credentials in a from-scratch child environment, so it needs no real
credentials and cannot reach a live vendor appliance. Four checks per connector:

- **BOOT** - the bundle answers `initialize` and `tools/list`.
- **FLOOR** - the tool count has not regressed below the baseline recorded in the
  file (observed values, not targets; update the floor in the same commit as an
  intentional tool-surface change).
- **AGREEMENT** - a tool whose description starts `DESTRUCTIVE:` or
  `VISIBLE-TO-OTHERS:` carries `readOnlyHint: false`, and no tool omits
  `readOnlyHint`. Clients gate unattended execution on the annotation, never on
  the prose. See `docs/standards/connector-safety-signals.md` for the contract.
- **SHAPE** - every tool has a non-empty description and an object `inputSchema`.

It also refuses to check only the surface a cold `tools/list` happens to show, since
a tool the harness never lists is a tool whose safety signals were never checked:

- A connector with a `<vendor>_navigate` domain step is walked domain by domain
  and the results unioned (`blumira`, `knowbe4`, and `ninjaone` are walked; in the
  latest run each already listed every tool cold).
- `falcon` registers its domain modules only after an OAuth token exchange, so the
  probe points `FALCON_BASE_URL` at a loopback socket that answers
  `POST /oauth2/token` and nothing else, and fails if the stub is asked for any
  other route. 145 tools checked.
- Each run prints a COVERAGE block. The latest run (this README update) read
  12/12 connectors, 533 tools fully enumerated, but exited **1**: `blumira`
  listed 31 tools against a recorded floor of 32 (`[blumira] tool-count
  regression`), so the bundle under `plugins/atlas/mcp/blumira` or the baseline in
  `test-mcp-tools.mjs` is out of step and needs a deliberate fix. The other 11
  connectors passed. `GATED` and `SKIP` verdicts still exist for a surface that
  genuinely cannot be enumerated - a missing `uv` or venv for falcon reports a
  named SKIP with the command that fixes it - but nothing uses them today.

**Common issues.**

- *Hooks not firing*: confirm `plugins/atlas/hooks/hooks.json` is present; a
  plugin install auto-loads it. Outside a plugin, run `scripts/install_hooks.py`.
- *Plugin acts like an older version*: run `atlas-setup` repair; the doctor
  compares installed vs marketplace version and warns on a downgrade or fork.
- *Self-improvement not running*: confirm `atlas_memory.py`, `atlas_curator.py`,
  and `atlas_context_optimizer.py` exist and that `~/.atlas/memory/` is writable.
- *Stale wiki diagrams*: run `atlas-wiki` or invoke `graphify` directly.

---

<div align="center">

Apache-2.0 licensed. Author: [w159](https://github.com/w159). Repository:
[github.com/w159/tech-tools](https://github.com/w159/tech-tools).

</div>
