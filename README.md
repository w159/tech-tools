# atlas

Atlas is a self-configuring Claude Code plugin that turns any coding agent into a
disciplined multi-agent architect. Run `/atlas` once to onboard a project, then
drive work through the 21 auto-trigger skills and the `atlas:<role>` subagent
squad. A `SessionStart` hook loads the runtime every session, and four
self-improvement hooks (memory capture, auto-skill, nudge, session ingest) make
the agent better the more it is used in a codebase
(`plugins/atlas/SKILL.md:10`,
`plugins/atlas/README.md:3-9`,
`plugins/atlas/hooks/hooks.json:1-7`).

The marketplace is published from this repo at
`.claude-plugin/marketplace.json` (Claude Code, name `atlas`, version 3.0.0,
`.claude-plugin/marketplace.json:1-3`) and at
`.kimi-plugin/marketplace.json` (Kimi Code CLI, version 2,
`.kimi-plugin/marketplace.json:1-2`). The Claude Code manifest currently ships
two plugins: `atlas` and the optional `armada` org-deployment plugin
(`.claude-plugin/marketplace.json:18,28`). The Kimi manifest ships a
different catalog: 12 plugins total, `atlas` plus 11 legacy domain clusters
(it-operations, security-compliance, microsoft-365, hr-payroll, finance,
engineering, data, design, customer-support, product-management, productivity)
and no `armada` entry
(`.kimi-plugin/marketplace.json:4-63`).

A separate `armada` plugin in this repo carries 11 department agents and 156
department skills for org deployment; install it alongside `atlas` only for org
use (`plugins/atlas/README.md:8-10`,
`plugins/atlas/.claude-plugin/plugin.json:3`).

## Quickstart

1. Add this repo as a marketplace in Claude Code: open the marketplace
   `.claude-plugin/marketplace.json` via the `/plugin` command.
2. Install the `atlas` plugin from the marketplace (install `armada` too if
   you want the department skills).
3. In a project, type `/atlas` once. The `atlas-setup` skill scaffolds
   `.atlas/docs/`, verifies or installs `claude-mem` and `context-mode`, wires
   hooks, and recommends the next step
   (`plugins/atlas/SKILL.md:24-64`,
   `plugins/atlas/skills/atlas-setup/SKILL.md:78-111`).
4. For a coding task, type the name of the skill you want (for example
   `atlas-feature` to build a feature, `atlas-debug` to root-cause a bug,
   `atlas-audit` to run a code or architecture audit). The 20 non-setup skills
   auto-trigger from the `description` field; you can also name them
   directly (`plugins/atlas/skills/atlas-setup/SKILL.md:150-162`).

## Prerequisites

- Claude Code (Kimi Code CLI is also supported via the alternate marketplace
  manifest at `.kimi-plugin/marketplace.json`).
- Python 3, used by all 10 hooks and the `scripts/` tooling
  (`plugins/atlas/hooks/hooks.json:11,23,30,46,67,90,100,113,127`).
- `claude-mem` and `context-mode` are required companions. `atlas-setup`
  detects them and offers to install if missing; do not install silently
  (`plugins/atlas/SKILL.md:24-32`).
- No system-level package manager install is needed for `atlas` itself. The
  vendor MCP servers under `mcp_servers/` are not part of the active
  marketplace and require their own setup; see
  `.env.template` if you use any of them.

## Project structure

Top-level layout, one line each, every entry verified on disk:

- `.claude-plugin/marketplace.json` — Claude Code marketplace manifest, two
  plugins (`atlas`, `armada`).
- `.kimi-plugin/marketplace.json` — Kimi Code CLI marketplace manifest, 12
  plugins total (`atlas` plus 11 legacy domain clusters; no `armada` entry).
- `plugins/` — one directory per plugin. The Claude Code marketplace lists
  `plugins/atlas/` and `plugins/armada/`; the Kimi marketplace lists the
  11 legacy domain cluster folders plus `plugins/atlas/` under the same
  root (no `plugins/armada/` reference in the Kimi manifest).
- `plugins/atlas/` — the atlas plugin. 21 skills
  (`plugins/atlas/skills/`), 12 agents (`plugins/atlas/agents/`), 10
  hooks (`plugins/atlas/hooks/hooks.json`), one output style
  (`plugins/atlas/output-styles/atlas-orchestrator.md`), and
  `scripts/` for runtime tools (`atlas_doctor.py`, `atlas_db.py`,
  `atlas_context_optimizer.py`, and the rest, per
  `plugins/atlas/README.md:44-62`).
- `plugins/armada/` — 11 department agents, no skills directory of its own
  in the current manifest.
- `mcp_servers/` — 10 vendor MCP server implementations (Auvik, Blumira,
  CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne, Paylocity,
  ThreatLocker, Vanta) plus a `_shared/` cross-cutting helpers folder. Not
  wired into the current marketplace manifest.
- `mcp_node/` — 7 Node client libraries the MCP servers depend on.
- `skills/` — 13 standalone skills not tied to a single plugin
  (`graphify`, `webapp-testing`, `security-audit`, and others).
- `docs/` — single source of truth outside the plugin. `docs/CHANGELOG.md`
  is the newest-first shipped-change log; `docs/ROADMAP.md` is the backlog;
  `docs/AGENTS.md` defines propagation rules; `docs/audits/` holds
  per-audit evidence folders.
- `AGENTS.md` — canonical agent operating rules for this repo
  (definition of "tools", propagation checklist, base-URL defaults, quality
  bar, validation expectation, memory policy).
- `CONTRIBUTING.md` — contributor guide (layout, propagation rule, the
  iCloud-safe build flow, the test harness entry point, quality bar).
- `.env.template` — credential key template for the vendor-backed
  connectors under `mcp_servers/`.
- `.gitignore` — repo-level ignore patterns.
- `img/` — repo imagery.

## Configuration

Atlas itself needs no environment configuration. The four required pieces
are wired by the `SessionStart` hook: the plugin path, Python 3, and the
`claude-mem` and `context-mode` binaries on `PATH` (verified by
`atlas-setup` at first run, `plugins/atlas/SKILL.md:24-32`).

The vendor MCP servers under `mcp_servers/` are not in the active
marketplace but are kept in the repo. If you use one, copy the matching
keys from `.env.template` into a `.env` file at the repo root. The
template groups keys by vendor and marks optional base-URL keys with the
documented vendor default. Key groups present in `.env.template`:

- Auvik: `AUVIK_USERNAME`, `AUVIK_API_KEY`, `AUVIK_REGION` (region
  optional, defaults to `us1`).
- Blumira: `BLUMIRA_JWT_TOKEN` or the OAuth trio `BLUMIRA_CLIENT_ID` /
  `BLUMIRA_CLIENT_SECRET`; `BLUMIRA_BASE_URL` optional (default
  `https://api.blumira.com/public-api/v1`).
- CIPP: `CIPP_BASE_URL` (required) plus either `CIPP_API_KEY` or the
  OAuth trio `CIPP_TENANT_ID` / `CIPP_CLIENT_ID` / `CIPP_CLIENT_SECRET`.
- ConnectWise Manage: `CW_MANAGE_COMPANY_ID`, `CW_MANAGE_PUBLIC_KEY`,
  `CW_MANAGE_PRIVATE_KEY`, `CW_MANAGE_CLIENT_ID`; `CW_MANAGE_BASE_URL`
  optional (NA cloud default
  `https://api-na.myconnectwise.net`).
- KnowBe4: `KNOWBE4_API_KEY`; `KNOWBE4_REGION` optional.
- NinjaOne: `NINJAONE_CLIENT_ID`, `NINJAONE_CLIENT_SECRET`; region, auth
  mode, and base URL optional.
- ThreatLocker: `THREATLOCKER_API_KEY`, optional
  `THREATLOCKER_ORGANIZATION_ID` and `THREATLOCKER_BASE_URL`.
- Vanta: `VANTA_CLIENT_ID`, `VANTA_CLIENT_SECRET`; `VANTA_BASE_URL`
  optional.
- Paylocity: `PAYLOCITY_CLIENT_ID`, `PAYLOCITY_CLIENT_SECRET`,
  `PAYLOCITY_COMPANY_ID`; `PAYLOCITY_BASE_URL` and `PAYLOCITY_SANDBOX`
  optional.
- Kaseya Spanning: `SPANNING_ADMIN_EMAIL`, `SPANNING_API_TOKEN`;
  `SPANNING_PLATFORM` and `SPANNING_API_URL` optional.
- Pax8: `PAX8_MCP_TOKEN` only (hosted server, no base URL).
- PandaDoc: `PANDADOC_API_KEY` only (hosted server, no base URL).

The full template, including the inline comments naming each vendor
default, is at `.env.template:1-137`.

## Operations

### Run

The atlas plugin has no long-running process of its own. The hooks in
`plugins/atlas/hooks/hooks.json` auto-load when the plugin is installed; no
manual step is needed for the common case
(`plugins/atlas/README.md:30-32`). If atlas is installed outside a plugin
(bare skill files), run
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py"` to wire the
hooks into Claude Code settings
(`plugins/atlas/SKILL.md:50-52`).

### Test

`plugins/atlas/hooks/` ships five test scripts alongside the hooks they
cover:

- `test_completion_gate.py`
- `test_dispatch_tripwire.py`
- `test_nudge.py`
- `test_prompt_classifier.py`
- `test_session_boot_db.py`

`plugins/atlas/scripts/` ships nine test scripts for the runtime tools:

- `test_asset_audit.py`
- `test_atlas_context_optimizer.py`
- `test_atlas_curator.py`
- `test_atlas_db.py`
- `test_atlas_doctor.py`
- `test_atlas_memory.py`
- `test_build_hub.py`
- `test_session_ingest.py`
- `test_skill_factory.py`

Run any of them with `python3 <path>` from the repo root. Atlas also
ships a session-ingest health probe at
`plugins/atlas/hooks/validate-readonly-query.sh` (not auto-loaded; the
DB-audit subagents wire it during read-only audits,
`plugins/atlas/README.md:21`).

A repo-level test harness entry point (`test-mcp-tools.mjs`) is
referenced from `CONTRIBUTING.md` and `.env.template:8-12` but is not
present in the current tree. The vendor MCP servers under `mcp_servers/`
do not declare a build step in any checked-in manifest at the time of
this README; this section is left as `[verify]` because the build path
for the MCP layer is not stated in any file that exists on disk today.

### Verify a plugin

The `atlas-validate` skill audits a Claude Code plugin for structure,
manifest validity, and content quality with file:line findings and
pass/fail per check, without auto-fixing
(`plugins/atlas/skills/atlas-validate/SKILL.md:1-12`).

### Repair

If atlas itself looks broken (subagents not launching, plugin acting
like an older version, marketplace pointing at a stale fork), run the
repair mode:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --fix
```

The doctor script is the same one `atlas-setup` runs in repair mode
(`plugins/atlas/skills/atlas-setup/SKILL.md:30-32`). The hook variant
`python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --hook` runs at
every `SessionStart` as a rollback guard
(`plugins/atlas/hooks/hooks.json:16-19`).

### Troubleshooting

- **Subagents not launching** — run `atlas-setup` with `repair --fix`;
  the doctor will reinstall the marketplace wiring and check the asset
  counts.
- **Plugin acts like an older version** — same path; the doctor
  compares the installed version to the marketplace version and warns
  on a downgrade or a fork (`plugins/atlas/README.md:33-36`).
- **Hooks not firing** — verify with `cat hooks/hooks.json`; the file
  is auto-loaded by a plugin install. Outside a plugin install, run
  `scripts/install_hooks.py`.
- **Self-improvement not running** — verify the four required scripts
  exist (`atlas_memory.py`, `skill_factory.py`, `atlas_curator.py`,
  `atlas_context_optimizer.py`) and that `~/.atlas/memory/` and
  `~/.atlas/skills/` are writable
  (`plugins/atlas/skills/atlas-setup/SKILL.md:97-115`).
- **Stale wiki diagrams** — `architecture/` is newer than
  `wiki/diagrams/`; run `atlas-wiki` or invoke `graphify` directly
  (`plugins/atlas/skills/atlas-setup/SKILL.md:163-172`).

## The atlas fleet

The numbers below are verified by listing the directories on disk.

### 21 skills (`plugins/atlas/skills/`)

One manual skill (`atlas-setup`, `disable-model-invocation: true`) plus
20 auto-trigger skills. Each row's purpose is the first sentence of the
skill's `description` field.

| Skill | Mode | Purpose |
|---|---|---|
| `atlas-setup` | manual | Lifecycle: onboard, install, connectors, repair. |
| `atlas-orchestrate` | auto | Multi-step work via subagents with runtime-parity verification. |
| `atlas-audit` | auto | Code, architecture, and self audit; uses Workflow. |
| `atlas-loop` | auto | Match a recurring task to a curated loop library. |
| `atlas-ux-test` | auto | UX swarm: cartographer, persona, fuzzer, oracle, reporter. |
| `atlas-component` | auto | Reusable component for latency, cancellation, partial failure. |
| `atlas-db-audit` | auto | Read-only database audit via parallel subagents. |
| `atlas-debug` | auto | Root-cause a reproducible bug with evidence. |
| `atlas-feature` | auto | End-to-end feature implementation with verified evidence. |
| `atlas-frontend` | auto | Build or refactor screens on a single design system. |
| `atlas-gitignore` | auto | Zero-trust, deny-by-default `.gitignore` for a named stack. |
| `atlas-handoff` | auto | Dense session handoff for a fresh session to resume. |
| `atlas-harden` | auto | Idempotent endpoint remediation script (CHECK/SET/VERIFY). |
| `atlas-launch` | auto | Launch a remediation session preloaded with an audit finding. |
| `atlas-m365` | auto | M365 / Entra / Intune / Graph change with read-back evidence. |
| `atlas-prompt` | auto | Rewrite a vague request into a structured prompt. |
| `atlas-readme` | auto | Onboarding-grade `README.md` from a real repo inspection. |
| `atlas-refactor` | auto | Refactor with behavior preserved and before/after evidence. |
| `atlas-validate` | auto | Validate a Claude Code plugin is done, no auto-fix. |
| `atlas-vendor-assessment` | auto | Evidence-based vendor assessment against a named framework. |
| `atlas-wiki` | auto | Refresh `.atlas/docs/wiki/` from `.atlas/docs/architecture/`. |

Sources: `plugins/atlas/README.md:13-26`,
`plugins/atlas/skills/atlas-setup/SKILL.md:150-162`, and the
`description` field in each `SKILL.md`.

### 12 agents (`plugins/atlas/agents/`)

`atlas:explorer`, `atlas:implementer`, `atlas:verifier`, `atlas:db-prober`,
`atlas:schema-inventory`, `atlas:rls-privilege-audit`,
`atlas:naming-glossary-audit`, `atlas:ui-runtime-tester`, `atlas:planner`,
`atlas:docs-curator`, `atlas:docs-auditor`, `atlas:completeness-critic`
(`plugins/atlas/README.md:48-62`).

### 10 hooks (`plugins/atlas/hooks/hooks.json`)

`session_boot.py` and `atlas_doctor.py --hook` on `SessionStart`;
`prompt_optimizer.py` on `UserPromptSubmit`; `bash_advisor.py` and
`dispatch_tripwire.py` on `PreToolUse`; `format_after_edit.py` and
`dispatch_tripwire.py` on `PostToolUse`; `completion_gate.py`,
`ingest_session.py`, `memory_capture.py`, `auto_skill.py`, and
`nudge.py` on `Stop`; `ingest_session.py`, `memory_capture.py`, and
`nudge.py` on `SubagentStop`; `ingest_session.py` on `SessionEnd` and
`PreCompact` (`plugins/atlas/hooks/hooks.json:1-130`,
`plugins/atlas/README.md:34-47`).

### Output style

`atlas-orchestrator` is shipped at
`plugins/atlas/output-styles/atlas-orchestrator.md` with
`force-for-plugin: true`, so it auto-applies whenever the atlas plugin
is enabled (`plugins/atlas/README.md:49-51`).

## Self-improvement

Four hooks close the loop the fleet used to leave to manual runs
(`plugins/atlas/README.md:110-115`):

- `hooks/memory_capture.py` persists session lessons to
  `~/.atlas/memory/`.
- `hooks/auto_skill.py` mines finished sessions and drafts new skills
  at `~/.atlas/skills/`.
- `scripts/atlas_context_optimizer.py` disables unused skills and
  agents based on real usage in the observability DB. The optimizer
  alone can cut the 21-skill + 12-agent cost that every API call
  incurs by 40% or more
  (`plugins/atlas/skills/atlas-setup/SKILL.md:104-114`).
- `scripts/atlas_curator.py` handles skill lifecycle
  (stale, archive, pin).

The observability DB is implemented in `scripts/atlas_db.py`; the
`atlas-audit` self mode reads the same DB to report run health
(`plugins/atlas/README.md:61-62`).

## External dependencies

The atlas plugin itself has no third-party library dependencies; all
hooks are stdlib Python and fail safe (any internal error exits 0, so a
hook never blocks a session, `plugins/atlas/README.md:77-78`). The
two required runtime companions are external Claude Code plugins:

- `claude-mem` — backs the self-improvement layer
  (`plugins/atlas/SKILL.md:28-32`).
- `context-mode` — protects the context window on large-output work
  (same).

The vendor MCP servers under `mcp_servers/` depend on the official
APIs of Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning,
KnowBe4, NinjaOne, Paylocity, ThreatLocker, and Vanta. Vendor docs and
base-URL defaults are captured per-key in `.env.template`.

## License

Apache-2.0
(`plugins/atlas/.claude-plugin/plugin.json:9`).
