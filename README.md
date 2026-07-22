<div align="center">

<img src="img/project-logo-icon.png" alt="Atlas logo" width="120" />

# Atlas

**A self-configuring Claude Code plugin that turns any coding agent into a disciplined multi-agent architect.**

![Atlas README hero banner](img/readme-hero-banner.png)

</div>

Atlas installs a full operating contract on top of Claude Code: a research to
verify loop, a squad of role subagents, eleven event hooks, persistent memory,
and automatic skill creation. You run `/atlas` once to onboard a project, then
drive work through 20 plainly named skills. The agent stops guessing, starts
verifying, and gets measurably better the more you use it in a codebase.

- Plugin version `5.1.1` (`plugins/atlas/.claude-plugin/plugin.json:2`)
- Marketplace catalog version `3.1.0` (`.claude-plugin/marketplace.json:5`)
- 20 skills, 12 agents, 11 hooks, 10 optional connectors, 1 output style
- Two more plugins ship in the same marketplace: `armada` (org deployment)
  and `programmer` (a Pragmatic Programmer codebase auditor)

> Two version counters, not a typo. The marketplace wrapper (`3.1.0`) versions
> the catalog file. The `atlas` plugin it lists versions independently at
> `5.1.1`. Every `v5.x` reference below is the plugin version.

---

## Table of contents

1. [What Atlas changes](#what-atlas-changes)
2. [Install and quickstart](#install-and-quickstart)
3. [The operating contract](#the-operating-contract-research-to-verify)
4. [Architecture: how a task flows](#architecture-how-a-task-flows)
5. [Skills (20)](#skills-20)
6. [Agents (12)](#agents-12)
7. [Hooks (11)](#hooks-11)
8. [Scripts](#scripts)
9. [Connectors (10 MCP servers)](#connectors-10-mcp-servers)
10. [Other plugins in this marketplace](#other-plugins-in-this-marketplace)
11. [Output style](#output-style)
12. [Docs as the single source of truth](#docs-as-the-single-source-of-truth)
13. [Self-improvement](#self-improvement)
14. [Repository layout](#repository-layout)
15. [Prerequisites and configuration](#prerequisites-and-configuration)
16. [Repair, testing, troubleshooting](#repair-testing-troubleshooting)

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
| Repeated patterns | Re-solved every time | Turned into a new reusable skill from the session transcript (`plugins/atlas/hooks/auto_skill.py`). |
| Docs | Drift silently | Treated as the source of truth; the gate flags docs drift (`docs/`). |

---

## Install and quickstart

![Atlas plugin marketplace tile](img/plugin-marketplace-tile.png)

1. **Add the marketplace.** In Claude Code, run `/plugin` and add this repo's
   marketplace file, `.claude-plugin/marketplace.json` (catalog name `atlas`,
   version `3.1.0`, listing three plugins: `atlas`, `armada`, `programmer`).
   Kimi Code CLI is also supported through `.kimi-plugin/marketplace.json`.
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
architect skill and `atlas-setup`. The other 20 auto-trigger.

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

## Skills (20)

Skills are the entry points. Type the name or describe the work. Manual skills
are marked; everything else auto-triggers from its `description`. Sources:
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

## Hooks (11)

Hooks are the automation layer. They fire on Claude Code lifecycle events with
no action from you, and they are what actually change the agent's behavior
session to session. All are stdlib Python and fail safe: any internal error
exits 0, so a hook never blocks a session. Wiring:
`plugins/atlas/hooks/hooks.json`.

| Hook | Event | What it does when it fires |
|---|---|---|
| `session_boot.py` | SessionStart | Loads the atlas runtime: contract, memory, project state. Fast, idempotent, crash-proof. |
| `atlas_doctor.py` | SessionStart | Detects and repairs the plugin-rollback failure mode so a half-installed atlas self-heals. |
| `prompt_optimizer.py` | UserPromptSubmit | Rewrites your prompt through a local model before Claude sees it, sharpening the task. |
| `bash_advisor.py` | PreToolUse (Bash) | Advisory-only safety check that warns on risky commands, cwd mismatches, and unsafe git ops. |
| `dispatch_tripwire.py` | PreToolUse + PostToolUse | Counts inline operations and curbs drift back to doing work inline instead of delegating. |
| `format_after_edit.py` | PostToolUse | Auto-formats a file (ruff/prettier/black/isort) the moment Claude edits it, keeping the diff clean. |
| `completion_gate.py` | Stop | The definition-of-done gate: blocks a "done" claim until evidence and non-drifted docs exist. |
| `memory_capture.py` | Stop + SubagentStop | Saves durable facts from the session to `~/.atlas/memory/`. |
| `auto_skill.py` | Stop | Creates a new reusable skill from a worthy session transcript. |
| `nudge.py` | Stop + SubagentStop | Self-improvement nudge that reports what memory/skills were captured. |
| `ingest_session.py` | Stop, SubagentStop, SessionEnd, PreCompact | Mirrors the session transcript into the atlas observability DB for later audit. |

Worked example: you finish a bug fix and say "done." The `completion_gate.py`
Stop hook inspects the run, sees no command output backing the claim (and that
source changed but no `docs/` file did), and blocks with a message naming the
missing evidence. You run the test, paste the output, and the gate passes.

---

## Scripts

The `scripts/` directory holds the tooling the skills and hooks call. Each has a
focused job and a test file beside it. Sources: `plugins/atlas/scripts/`.

| Script | Purpose |
|---|---|
| `discover_capabilities.py` | Read-only discovery of installed skills, agents, and tools available to the session. |
| `atlas_db.py` | The observability store: a single global SQLite SSOT for coding-agent run health. |
| `session_ingest.py` | Mirror Claude Code session transcripts into the observability DB. |
| `atlas_doctor.py` | Detect and repair the plugin-rollback failure mode. |
| `atlas_memory.py` | Persistent, file-backed, char-bounded memory store. |
| `skill_factory.py` | Auto-create skills from session transcripts. |
| `atlas_curator.py` | Background lifecycle management for auto-created skills (stale, archive, pin). |
| `atlas_context_optimizer.py` | Disable unused skills/agents to cut token cost. |
| `asset_audit.py` | The context-cost lens of `atlas-audit`. |
| `build_hub.py` | Build the knowledge-graph hub for an audit run. |
| `install_hooks.py` | Install the automation hooks into a `settings.json` (gated). |
| `lint_skill_names.py` | Assert every skill dir starts with `atlas-` and uses a valid slug. |

Example: `atlas_context_optimizer.py` reads real usage from the observability DB
and disables skills and agents a project never touches, so a large plugin does
not tax every prompt's token budget.

---

## Connectors (10 MCP servers)

Atlas ships optional MCP connectors for MSP and IT operations, wired through
`plugins/atlas/.mcp.json` and configured with the `userConfig` fields in
`plugin.json`. Each stays disabled until you provide its credentials, so the
plugin is safe to install with no config.

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

Example: set `ninjaone_client_id` and `ninjaone_client_secret` in the plugin
config, and `atlas-harden` can pull device state from NinjaOne while it drafts
an idempotent remediation script. Server source lives under `mcp_servers/`
(one `*-mcp` project each, plus a `_shared/` helper folder).

---

## Other plugins in this marketplace

The marketplace catalog (`.claude-plugin/marketplace.json`) lists three
plugins. Only `atlas` is required; the other two are independent installs.

**`armada`** (`plugins/armada/`, v1.0.0) is the organizational deployment
layer split out of atlas: 11 department agents (data, design, engineering,
finance, HR, IT ops, M365, product, productivity, security, support) plus
156 department skills carrying org branding, policy, and compliance context.
Its own dispatch entry point is the `armada` skill
(`plugins/armada/skills/armada/SKILL.md`).

**`programmer`** (`plugins/programmer/`, v0.1.0) turns *The Pragmatic
Programmer* (20th Anniversary Edition) into an active codebase auditor and
coding-time advisor. It ships 2 skills, `tpp-audit` (a 10-dimension codebase
review with file:line evidence, `plugins/programmer/skills/tpp-audit/`) and
`tpp-principles` (surfaces 1-4 relevant book principles while you work,
`plugins/programmer/skills/tpp-principles/`), 1 per-dimension auditor agent
(`tpp-auditor`, `plugins/programmer/agents/tpp-auditor.md`), a
`UserPromptSubmit` nudge hook that points at the relevant concept file for
your prompt (`plugins/programmer/hooks/hooks.json`), and an 89-concept
glossary under `skills/tpp-principles/references/concepts/` for citation.

---

## Output style

`output-styles/atlas-orchestrator.md` ships with `force-for-plugin: true`, so it
auto-applies whenever atlas is enabled. It reshapes how the agent reports without
touching its engineering behavior. Every substantive reply opens with a status
header:

```text
ATLAS | <glyph> <phase> | <one-line state>
```

The glyph marks the current phase (research, theory, test, validate, implement,
verify, done, blocked), dispatches are named in one line, and no "done" claim is
allowed without evidence. This is the on-screen face of the operating contract.

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

- **Persistent memory** at `~/.atlas/memory/`, reloaded at every session boot
  (`hooks/memory_capture.py`).
- **Automatic skill creation** from session transcripts into `~/.claude/skills/`
  (`hooks/auto_skill.py`, `scripts/skill_factory.py`).
- **Skill lifecycle curation** that promotes, keeps, or retires auto-created
  skills (`scripts/atlas_curator.py`).
- **Context optimization** that disables unused skills and agents to cut cost
  (`scripts/atlas_context_optimizer.py`).
- **Observability DB** that mirrors transcripts so `atlas-audit`'s self mode can
  measure the agent's own run health (`scripts/atlas_db.py`).

Companion plugins `claude-mem` (memory) and `context-mode` (context protection)
are required; `atlas-setup` detects them and offers to install if missing.

---

## Repository layout

```text
atlas/
|- README.md                 # this file
|- img/                      # repo imagery (hero, headers, tiles)
|- .claude-plugin/           # marketplace.json catalog (name: atlas, 3.1.0)
|- plugins/
|  |- atlas/                 # the plugin (v5.1.1)
|  |  |- .claude-plugin/     # plugin.json manifest + userConfig
|  |  |- .mcp.json           # 10 connector server definitions
|  |  |- skills/             # 20 skills
|  |  |- agents/             # 12 role agents
|  |  |- hooks/              # 11 hooks + hooks.json + tests
|  |  |- scripts/            # tooling (db, memory, factory, curator, ...)
|  |  |- mcp/                # bundled .mcpb connector servers by domain
|  |  |- output-styles/      # atlas-orchestrator report style
|  |  |- references/         # supporting reference docs
|  |  \- CHANGELOG.md
|  |- armada/                # optional org-deployment plugin (11 departments)
|  |- programmer/            # optional Pragmatic Programmer auditor plugin
|  |- _standards/            # shared authoring standards
|  \- _templates/            # skill/agent templates
|- mcp_servers/              # connector source (10 *-mcp projects + _shared)
|- mcp_node/                 # Node client libraries the MCP servers depend on
|- skills/                   # standalone skills not tied to a single plugin
|- docs/                     # canonical documentation (SSOT)
|- AGENTS.md                 # shared source of truth for agents
\- CONTRIBUTING.md
```

---

## Prerequisites and configuration

- **Claude Code** (or Kimi Code CLI via `.kimi-plugin/marketplace.json`).
- **Python 3** for all 11 hooks and the `scripts/` tooling. No third-party
  libraries: hooks are stdlib only.
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

**Common issues.**

- *Hooks not firing*: confirm `plugins/atlas/hooks/hooks.json` is present; a
  plugin install auto-loads it. Outside a plugin, run `scripts/install_hooks.py`.
- *Plugin acts like an older version*: run `atlas-setup` repair; the doctor
  compares installed vs marketplace version and warns on a downgrade or fork.
- *Self-improvement not running*: confirm `atlas_memory.py`, `skill_factory.py`,
  `atlas_curator.py`, `atlas_context_optimizer.py` exist and that
  `~/.atlas/memory/` and `~/.claude/skills/` are writable.
- *Stale wiki diagrams*: run `atlas-wiki` or invoke `graphify` directly.

---

<div align="center">

Apache-2.0 licensed. Author: [w159](https://github.com/w159). Repository:
[github.com/w159/atlas](https://github.com/w159/atlas).

</div>
