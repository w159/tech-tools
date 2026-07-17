# atlas

Atlas is a self-configuring Claude Code plugin that turns any coding agent into a
disciplined multi-agent architect. Run `/atlas` once to onboard a project, then
drive work through the 20 auto-trigger skills and the `atlas:<role>` subagent
squad. A `SessionStart` hook loads the runtime every session, and four
self-improvement hooks (memory capture, auto-skill, nudge, session ingest) make
the agent better the more it is used in a codebase
(`plugins/atlas/skills/atlas/SKILL.md:10`,
`plugins/atlas/README.md:3-9`,
`plugins/atlas/hooks/hooks.json:1-7`).

The marketplace is published from this repo at
`.claude-plugin/marketplace.json` (Claude Code, name `atlas`, version 3.0.0,
`.claude-plugin/marketplace.json:1-3`) and at
`.kimi-plugin/marketplace.json` (Kimi Code CLI, version 2,
`.kimi-plugin/marketplace.json:1-2`). The Claude Code manifest currently ships
two plugins: `atlas` and the optional `armada` org-deployment plugin
(`.claude-plugin/marketplace.json:18,28`). The Kimi manifest ships the
same two plugins (`atlas`, `armada`) from `.kimi-plugin/marketplace.json`.

**Two separate version counters, not a typo:** the marketplace wrapper
above (`3.0.0`) versions the catalog file itself; the `atlas` plugin it
lists versions independently at `5.1.1`
(`plugins/atlas/.claude-plugin/plugin.json:3`). Both numbers moved in the
same commit (`ad7313c`: marketplace `2.0.0` -> `3.0.0`, plugin -> `5.0.0`)
but on unrelated scales, so every `v5.x` reference later in this README
is the plugin version, never the marketplace version.

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
   `docs/` (plus `.atlas/` internal state), verifies or installs `claude-mem`
   and `context-mode`, wires hooks, and recommends the next step
   (`plugins/atlas/skills/atlas/SKILL.md:24-64`,
   `plugins/atlas/skills/atlas-setup/SKILL.md:78-111`).
4. For a coding task, type the name of the skill you want (for example
   `atlas-feature` to build a feature, `atlas-debug` to root-cause a bug,
   `atlas-audit` to run a code or architecture audit). The 20 non-setup skills
   auto-trigger from the `description` field; you can also name them
   directly (`plugins/atlas/skills/atlas-setup/SKILL.md:150-162`).

## Prerequisites

- Claude Code (Kimi Code CLI is also supported via the alternate marketplace
  manifest at `.kimi-plugin/marketplace.json`).
- Python 3, used by all 11 hooks and the `scripts/` tooling
  (`plugins/atlas/hooks/hooks.json`).
- `claude-mem` and `context-mode` are required companions. `atlas-setup`
  detects them and offers to install if missing; do not install silently
  (`plugins/atlas/skills/atlas/SKILL.md:24-32`).
- No system-level package manager install is needed for `atlas` itself. The
  vendor MCP servers under `mcp_servers/` are not part of the active
  marketplace and require their own setup; see
  `.env.template` if you use any of them.

## Project structure

Top-level layout, one line each, every entry verified on disk:

- `.claude-plugin/marketplace.json` — Claude Code marketplace manifest, two
  plugins (`atlas`, `armada`).
- `.kimi-plugin/marketplace.json` — Kimi Code CLI marketplace manifest, the
  same two plugins (`atlas`, `armada`).
- `plugins/` — one directory per plugin (`atlas`, `armada`), plus the shared
  `_standards/` and `_templates/` authoring libraries.
- `plugins/atlas/` — the atlas plugin. 22 skills
  (`plugins/atlas/skills/`), 12 agents (`plugins/atlas/agents/`), 11
  hooks (`plugins/atlas/hooks/hooks.json`), one output style
  (`plugins/atlas/output-styles/atlas-orchestrator.md`), and
  `scripts/` for runtime tools (`atlas_doctor.py`, `atlas_db.py`,
  `atlas_context_optimizer.py`, and the rest, per
  `plugins/atlas/README.md:44-62`).
- `plugins/armada/` — 11 department agents plus the `armada` skill tree
  (156 department skills under `plugins/armada/skills/`).
- `mcp_servers/` — 10 vendor MCP server implementations (Auvik, Blumira,
  CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne, Paylocity,
  ThreatLocker, Vanta) plus a `_shared/` cross-cutting helpers folder. Not
  wired into the current marketplace manifest.
- `mcp_node/` — 7 Node client libraries the MCP servers depend on.
- `skills/` — 13 standalone skills not tied to a single plugin
  (`graphify`, `webapp-testing`, `security-audit`, and others).
- `docs/` — the sole project-documentation single source of truth:
  `docs/CHANGELOG.md`, `docs/ROADMAP.md`, and `docs/AGENTS.md` cover both
  the wider repo (multi-tool integration notes for aider, cline, codex,
  cursor, gemini-cli, github-copilot) and the atlas plugin itself (see
  "Architecture & design principles" below), plus `docs/architecture/`,
  `docs/features/`, `docs/specs/`, `docs/plans/`, `docs/reference_files/`,
  `docs/lessons/`, `docs/wiki/`, and `docs/audits/`. `.atlas/` never
  contains a `docs/` subdirectory: it holds only atlas's own internal
  state (`.atlas/evidence/`, `.atlas/audits/`, ephemeral `.atlas/.run/`).
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
`atlas-setup` at first run, `plugins/atlas/skills/atlas/SKILL.md:24-32`).

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
(`plugins/atlas/skills/atlas/SKILL.md:50-52`).

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
  `~/.claude/skills/` are writable
  (`plugins/atlas/skills/atlas-setup/SKILL.md:97-115`).
- **Stale wiki diagrams** — `architecture/` is newer than
  `wiki/diagrams/`; run `atlas-wiki` or invoke `graphify` directly
  (`plugins/atlas/skills/atlas-setup/SKILL.md:163-172`).

## The atlas fleet

The numbers below are verified by listing the directories on disk
(v5.0.0, `ad7313c`, consolidated from 27 skills in v4.x).

### 22 skills (`plugins/atlas/skills/`)

| Skill | Path | Description | When to Use |
|-------|------|-------------|------------|
| **atlas** | `skills/atlas/SKILL.md:1-10` | Architect menu: boot and configure the workspace (deps, discover, hooks, config); manual entry point | Type `/atlas` to configure a project or reach the routing menu |
| **atlas-audit** | `skills/atlas-audit/SKILL.md:1-10` | Audits: CODE (quality/security discovery), ARCHITECTURE (duplication), SELF (run health/transcript forensics) | Comprehensive code/security audit, architecture mapping, atlas health measurement |
| **atlas-component** | `skills/atlas-component/SKILL.md:1-8` | Build reusable component (progress modal, upload, job panel) handling latency/cancellation/partial failure | Create/modify latency-resistant, multi-state component |
| **atlas-db-audit** | `skills/atlas-db-audit/SKILL.md:1-9` | Read-only: inventory schema, reconcile vs code, check privileges & naming via parallel subagents | Pre-change DB audit: schema, privileges, glossary alignment |
| **atlas-debug** | `skills/atlas-debug/SKILL.md:1-7` | Root-cause fix for reproducible bug/exception/trace with evidence, not symptom patch | Reproducible bug or exception needs root cause, not workaround |
| **atlas-feature** | `skills/atlas-feature/SKILL.md:1-8` | End-to-end feature (UI+API+data); dispatches atlas squad in parallel, closes with verifier | Full-stack feature implementation with acceptance criteria |
| **atlas-frontend** | `skills/atlas-frontend/SKILL.md:1-8` | Build/refactor screens/flows/components on single design system (shadcn+Tailwind+Radix), all states handled | Screens/flows with every state (loading/empty/error/success) rendered |
| **atlas-gitignore** | `skills/atlas-gitignore/SKILL.md:1-8` | Zero-trust, deny-by-default .gitignore; allowlist intended paths, re-exclude secrets last | Start or harden repo with deny-by-default allowlist |
| **atlas-handoff** | `skills/atlas-handoff/SKILL.md:1-8` | Dense session handoff (zero re-discovery) at checkpoint/break/hand-off | Produce session memory before context fills or session ends |
| **atlas-harden** | `skills/atlas-harden/SKILL.md:1-10` | Idempotent endpoint remediation (CHECK/SET/VERIFY) for RMM/MDM, proves compliant or changed | Write remediation script: idempotent, safe to run repeatedly |
| **atlas-launch** | `skills/atlas-launch/SKILL.md:1-8` | Launch remediation session preloaded from latest audit hub finding; no args lists findings | Remediation from audit hub; list findings with no args |
| **atlas-loop** | `skills/atlas-loop/SKILL.md:1-13` | Match recurring task to curated loop-library; instantiate and dispatch on correct cadence | Run something repeatedly, poll for status, iterate until condition met |
| **atlas-m365** | `skills/atlas-m365/SKILL.md:1-9` | Microsoft 365/Entra/Graph/Intune change with verified read-back proving new tenant state applied | Change M365 tenant state with proof it applied |
| **atlas-orchestrate** | `skills/atlas-orchestrate/SKILL.md:1-31` | Orchestrate multi-step/multi-surface/whole-codebase tasks via subagents with real execution & verification; keeps docs/ SSOT | Whole-repo work, cross-layer bugs, audits; NOT for first install (use atlas-setup) |
| **atlas-prompt** | `skills/atlas-prompt/SKILL.md:1-12` | Optimize vague coding request into structured, unambiguous prompt for agents; asks up to 3 Qs if scope ambiguous | Sharpen vague request into executable agent prompt |
| **atlas-readme** | `skills/atlas-readme/SKILL.md:1-10` | Onboarding-grade README by inspecting repo; every claim traced to real file | Repo has no README or README is stale |
| **atlas-refactor** | `skills/atlas-refactor/SKILL.md:1-9` | Refactor/rename/restructure without changing behavior; behavior preserved with before/after evidence | Code works but messy/hard-to-navigate; preserve behavior |
| **atlas-setup** | `skills/atlas-setup/SKILL.md:1-24` | Manual skill: onboard (docs/ SSOT), install (tooling), connectors (vendor MCP), repair (broken install). Run with no args or `--fix` | First run, workspace setup, tooling install, vendor connectors, repair broken atlas |
| **atlas-ux-test** | `skills/atlas-ux-test/SKILL.md:1-18` | UX test swarm: persona generation, scripted data entry, real-browser walks, fuzzing; independent calc oracle; gates on CLIENT surface correctness | Full UI/UX test pass, persona testing, pre-release sweep; re-test after fixes |
| **atlas-validate** | `skills/atlas-validate/SKILL.md:1-8` | Validate Claude Code plugin: structure, manifest, content quality with file:line findings (no auto-fix) | Audit plugin before shipping: structure & manifest validity |
| **atlas-vendor-assessment** | `skills/atlas-vendor-assessment/SKILL.md:1-11` | Evidence-based security assessment against named framework; each finding cites provided evidence (SOC 2, whitepaper, DPA, terms) | Output may reach auditor; findings must cite evidence |
| **atlas-wiki** | `skills/atlas-wiki/SKILL.md:1-13` | Generate/refresh docs/wiki/ diagrams from docs/architecture/ via graphify; keeps wiki fresh | Wiki stale/missing; architecture changed; before completion gate |

**Skill tooling notes:**

- All skills use **context: fork** or standard tool sets (Read, Glob, Grep, Bash, Edit, MultiEdit).
- Only `atlas` and `atlas-setup` set `disable-model-invocation: true` (require explicit user invocation, not auto-triggered); the other 20 skills auto-trigger.

### 12 agents (`plugins/atlas/agents/`)

Read-only specialists unless noted otherwise.

| Agent | Role | Model | Color | Tool Restrictions |
|-------|------|-------|-------|-------------------|
| **completeness-critic** | Pre-done auditor: hunts unverified claims, unread sources, unexercised paths; refutes "done" on load-bearing gap | sonnet | red | Read-only (no Write/Edit/MultiEdit) |
| **db-prober** | Read-only DB prober: schema, RLS, GRANTs, EXPLAIN plans; proposals only, no writes/migrations | sonnet | yellow | Read-only |
| **docs-auditor** | Docs-drift auditor: CHANGELOG/ROADMAP/architecture/AGENTS.md vs real code; verdict + file:line evidence | sonnet | yellow | Read-only |
| **docs-curator** | Post-ship docs maintainer: updates docs/ as SSOT; CHANGELOG, ROADMAP, AGENTS.md with file:line evidence | sonnet | yellow | Write only (`docs/**`, `.atlas/audits/**`) |
| **explorer** | Read-only codebase mapper: features, modules, call paths; compact map with file:line refs | haiku | cyan | Read-only |
| **implementer** | Focused implementer: ONE bounded change as minimal diff; runs project gate; never expands scope | sonnet | green | Read, Edit, MultiEdit, Write |
| **naming-glossary-audit** | PostgreSQL nomenclature auditor: table/column names vs project glossary; user_* to client_* transition | sonnet | — | Read, Grep, Glob, Bash, Write (no Edit/MultiEdit) |
| **planner** | Multi-stage decomposition: numbered stage map, one failable check per stage, concurrent flags, proven vs assumed | sonnet | blue | Read-only |
| **rls-privilege-audit** | PostgreSQL security auditor: RLS policies, table grants, roles vs least-privilege in regulated environments | sonnet | — | Bash, Write (no Edit/MultiEdit) |
| **schema-inventory** | PostgreSQL catalog inventory: tables, columns, types, constraints, indexes, RLS flags from live DB | sonnet | — | Bash, Write (no Edit/MultiEdit) |
| **ui-runtime-tester** | Live frontend tester: observes REAL browser behavior (Claude_Preview/webapp-testing) — render, console, network, states | sonnet | magenta | Read-only (no Edit/Write) |
| **verifier** | Adversarial verifier: independently confirms/REFUTES claimed findings in fresh context; re-runs tests, re-queries data, re-reads diffs | sonnet | red | Read-only (no Edit/Write) |

**Agent doctrine:**

- All agents are **fresh subagents** (not forks) — inherit zero context, so prompts must be self-contained.
- **Verification agents** (`completeness-critic`, `verifier`) exist solely to adversarially check other agents' claims.
- **db-prober, schema-inventory, rls-privilege-audit** are read-only audit specialists for pre-change safety gates.
- **docs-curator** is sole owner of `docs/` drift post-ship.

### Hooks (`plugins/atlas/hooks/hooks.json`)

9 event types, 14 hook handlers total.

| Event | Hook Handlers | Purpose | Evidence/Verification |
|-------|---------------|---------|----------------------|
| **SessionStart** | `session_boot.py`, `atlas_doctor.py --hook` | Initialize session context; verify doctor rollback guard | Runs every session; `atlas_doctor` verifies hook install integrity |
| **UserPromptSubmit** | `prompt_optimizer.py` | Optimize prompts for environment awareness before execution | Applies structured context (file paths, tool availability) |
| **PreToolUse** (Bash) | `bash_advisor.py` | Pre-flight check: dangerous patterns, cwd mismatches, unsafe git ops | Flags risky bash before execution |
| **PreToolUse** (Edit/Write/Bash/etc.) | `dispatch_tripwire.py` | Enforce subagent dispatch gate: parallelizable work routes to subagents, not inline | Blocks inline work when parallel dispatch is indicated |
| **PostToolUse** (Edit/Write/MultiEdit) | `format_after_edit.py` | Auto-format: ruff, prettier, black, isort per detected language | Maintains code style hygiene after edits |
| **PostToolUse** (Read/Grep/Bash/etc.) | `dispatch_tripwire.py` (retrigger) | Re-check dispatch logic post-tool for data-dependent routing | Catches context-expensive patterns after large reads |
| **Stop** (session end) | `completion_gate.py` → `ingest_session.py` → `memory_capture.py` → `auto_skill.py` → `nudge.py` | **Evidence gate** (`completion_gate.py`): blocks unverified "done" claims; ingest/capture: mines session for learnings; auto_skill: suggests next skill; nudge: flags missing checks | `completion_gate.py:17` requires runtime parity for user-facing changes; verifier pass or observed live behavior |
| **SubagentStop** | `ingest_session.py`, `memory_capture.py`, `nudge.py` | Capture subagent learnings and offer next-step nudges | Compresses subagent transcript into session memory |
| **SessionEnd** | `ingest_session.py` | Final ingest before session archive | Seeds claude-mem and `docs/` with session findings |
| **PreCompact** | `ingest_session.py` | Pre-compression ingest for knowledge graph updates | Captures context-window-protection events |

**Completion gate (critical):** `plugins/atlas/hooks/completion_gate.py`

- **Blocks unverified claims:** tests for "done", "fixed", "should work", "working", predictive hedges; requires evidence.
- **Runtime parity gate (v5.0.0):** user-facing changes must pass `atlas:ui-runtime-tester` OR show observed live behavior; in-memory SQLite suites do not count.
- **Durable inputs:** if code cannot run (test failures, env missing), the gate says so explicitly; it never accepts "should work".

### Output style

`atlas-orchestrator` is shipped at
`plugins/atlas/output-styles/atlas-orchestrator.md` with
`force-for-plugin: true`, so it auto-applies whenever the atlas plugin
is enabled (`plugins/atlas/README.md:49-51`).

## Architecture & design principles

Meta docs about the atlas plugin itself live under `docs/`
(verified 2026-07-14, docs-consolidation pass) — the same `docs/` scaffold
`atlas-setup` creates when `/atlas` is run against any project, here run
against this repo's own plugin code (dogfooding). `docs/` is the one and
only project-documentation SSOT described under "Project structure" above;
there is no separate `.atlas/docs/` tree. `.atlas/` holds only atlas's own
internal run state (`.atlas/evidence/`, `.atlas/audits/`, `.atlas/.run/`).

### Single source of truth for atlas itself (`docs/`)

- **AGENTS.md** (`plugins/atlas/AGENTS.md` + `docs/AGENTS.md`): agent roster, stack, commands, conventions.
- **CHANGELOG.md** (`docs/CHANGELOG.md`): every ship and forensics entry with file:line evidence; template enforced.
- **ROADMAP.md** (`docs/ROADMAP.md`): backlog, blocked, in-progress, live action items.
- **architecture/README.md**: ADR (Architecture Decision Record) template and folder structure.
- **All entries cite evidence:** file:line, command run + output, or artifact path — no unverified claims persist.

### Key design laws (v5.0.0, enforced by hooks)

1. **Evidence-before-done gate** (`completion_gate.py:17`)
   - User-facing changes: `atlas:ui-runtime-tester` PASS or observed live behavior (required).
   - Schema changes: migration parity with backend schema (required).
   - In-memory SQLite suites do NOT count as evidence.
   - Unverified "done", "fixed", "should work" blocked at the Stop hook.
2. **Law 2: worktree isolation** (`dispatch_tripwire.py`)
   - Multi-writer waves (2+ agents writing): each writer gets `isolation: "worktree"` or serial dispatch.
   - Exception: it is NOT valid to claim "they touch different files" to skip isolation.
3. **Dispatch doctrine: fork vs fresh**
   - **Fresh subagents (standard):** agents start with zero context; prompts must be self-contained.
   - **Fork subagents (rare):** used for independent verification; inherit the parent's context and tools.
   - **Standing consent orchestration:** `atlas-orchestrate` has standing consent to fan out parallelizable work without re-asking.
4. **No mythology, collapsed fleet**
   - v4.x: 27 skills (`atlas-metis`, `atlas-chronos`, `atlas-odysseus`, `atlas-athena`, `atlas-ariadne`, `atlas-argus`, `atlas-olympus`, `atlas-hephaestus`, `atlas-hermes`, `atlas-doctor`, `atlas-nestor`) → v5.0.0: 21 consolidated skills.
   - Renamed: `atlas-metis` → **atlas-orchestrate**, `atlas-chronos` → **atlas-loop**, `atlas-odysseus` → **atlas-ux-test**.
   - Merged: (`atlas-athena` + `atlas-ariadne` + `atlas-argus`) → **atlas-audit**; (`atlas-olympus` + `atlas-hephaestus` + `atlas-hermes` + `atlas-doctor`) → **atlas-setup**; `atlas-nestor` deleted (routing overhead over a smaller fleet).
   - Armada split: 11 department agents and the 3.0 MB tree moved to a separate plugin (`plugins/armada`, v1.0.0).
5. **Verification as guard** (`agents/verifier.md`)
   - `atlas:verifier` independently confirms/refutes every claimed finding in a fresh context.
   - Re-runs tests, re-queries data, re-reads diffs; never fixes, only judges.
   - Required on every shipping change per the dispatch-coverage-counts logic in `scripts/atlas_db.py`.

### Testing & quality gates

| Suite | Tests | Coverage | Errors |
|---|---|---|---|
| Hooks (`python3 -m unittest discover -s plugins/atlas/hooks`) | 365 | 98% line | 0 (Pyright) |
| Scripts (`python3 -m unittest discover -s plugins/atlas/scripts`) | 502 | 99% | 0 |
| **Total** | **867** | 85%+ across lines/functions/branches/statements | `ruff check plugins/atlas/hooks plugins/atlas/scripts` → all checks passed |

### Stack & commands

| Aspect | Detail |
|--------|--------|
| Languages | Python 3 (hooks, scripts); Markdown (skills, agents) |
| Frameworks | None (stdlib only; runtime is the Claude Code plugin system) |
| Package manager | None (stdlib only); `pyright` via `npx` |
| Test runner | `unittest` (`python3 -m unittest discover`) |
| Lint | `ruff` |
| Typecheck | `pyright` (0 errors, 0 warnings) |
| Build | None (interpreted) |
| Run | `/atlas:<skill-name>` or the Skill tool from Claude Code |

## Self-improvement

Four hooks close the loop the fleet used to leave to manual runs
(`plugins/atlas/README.md:110-115`):

- `hooks/memory_capture.py` persists session lessons to
  `~/.atlas/memory/`.
- `hooks/auto_skill.py` mines finished sessions and drafts new skills
  at `~/.claude/skills/`.
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
  (`plugins/atlas/skills/atlas/SKILL.md:28-32`).
- `context-mode` — protects the context window on large-output work
  (same).

The vendor MCP servers under `mcp_servers/` depend on the official
APIs of Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning,
KnowBe4, NinjaOne, Paylocity, ThreatLocker, and Vanta. Vendor docs and
base-URL defaults are captured per-key in `.env.template`.

## License

Apache-2.0
(`plugins/atlas/.claude-plugin/plugin.json:9`).
