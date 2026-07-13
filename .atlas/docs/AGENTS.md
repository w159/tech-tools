# AGENTS.md

How this project works: architecture, conventions, and the commands an agent
or developer needs to operate it. atlas-setup seeds this file after stack
detection; later atlas skills (atlas-audit, atlas-orchestrate) enrich it as
they discover the real stack.

## Stack

Populated after the v5.0.0 ship (commit ad7313c); verified 2026-07-13.
- Language(s): Python 3 (plugins/atlas/hooks, plugins/atlas/scripts)
- Framework(s): none; code is standard library only, runtime is the Claude Code plugin and skill markdown system
- Package manager: none (standard library only); npx used only to run pyright
- Test runner: unittest, via `python3 -m unittest discover`

## Architecture

Verified 2026-07-13 against the shipped tree.
- Entry points: `plugins/atlas/{hooks,scripts,skills,agents,mcp}` (hook handlers, CLI scripts, 21 skills, 12 agents, 4 MCP servers)
- Boundaries: `atlas` plugin (codebase facing, 12 agents in plugins/atlas/agents/) versus `armada` plugin (11 department agents in plugins/armada/agents/); the split landed in v5.0.0
- Key modules: 21 skills under `plugins/atlas/skills/`, 12 agents under `plugins/atlas/agents/`, hook handlers under `plugins/atlas/hooks/`, CLI scripts under `plugins/atlas/scripts/`, MCP servers under `plugins/atlas/mcp/`

## Conventions

- The single source of truth lives under `.atlas/docs/`.
- Every claim cites file:line.
- Every completion carries its evidence in the same message.
- The `.atlas/docs/.run/` directory is ephemeral and gitignored.

## Commands

Verified 2026-07-13. Run from repo root.
- Build: none (no compile step; Python is interpreted)
- Test: `python3 -m unittest discover -s plugins/atlas/hooks` (423 tests, OK as of 2026-07-13) and `python3 -m unittest discover -s plugins/atlas/scripts` (510 tests, OK)
- Lint: `ruff check plugins/atlas/hooks plugins/atlas/scripts` (All checks passed)
- Typecheck: `npx pyright plugins/atlas/hooks plugins/atlas/scripts` (0 errors, 0 warnings, 0 informations)
- Run: load the `atlas` plugin in Claude Code; invoke skills with `/atlas:<skill-name>` or the Skill tool

## Agent Roster

### Atlas Squad (codebase-facing)

| Agent | Role |
|---|---|
| explorer | Read-only codebase explorer; maps features, modules, call paths |
| implementer | Focused implementer; makes one bounded change as a minimal diff |
| verifier | Adversarial verifier; independently confirms or refutes a claimed finding |
| db-prober | Read-only database prober; inspects schema, RLS, grants, EXPLAIN plans |
| schema-inventory | PostgreSQL catalog inventory; enumerates tables, columns, types, constraints, indexes, and RLS flags from the live database for the schema half of a DB audit |
| naming-glossary-audit | Nomenclature auditor; checks PostgreSQL table and column names against a project glossary, focused on user_* to client_* transition or similar rename passes |
| rls-privilege-audit | RLS security auditor; checks row-level security policies, table grants, and roles against least privilege for the security half of a DB audit in regulated environments |
| ui-runtime-tester | Live frontend runtime tester; validates observed browser behavior |
| planner | Multi-stage decomposition specialist; numbered stage maps |
| docs-curator | Post-ship docs maintainer; updates docs/ as the source of truth |
| docs-auditor | Docs-drift auditor; compares docs/ against real code |
| completeness-critic | Pre-done completeness auditor; hunts unverified claims and gaps |

### Armada Department (org operations)

| Agent | Department |
|---|---|
| armada-data | Data: datasets, SQL, dashboards, data quality |
| armada-design | Design: accessibility, design-system, UX copy, user research |
| armada-engineering | Engineering: code review, system design, incident response |
| armada-finance | Finance: proposals, contracts, invoicing, close, SOX audit |
| armada-hr | HR: roster, new-hire, pay audits, recruiting, handbook |
| armada-it-ops | IT Operations: RMM, PSA, network monitoring, backup |
| armada-m365 | Microsoft 365: users, mailboxes, Teams, licensing, CIPP |
| armada-product | Product: specs, roadmap, user research, sprint planning |
| armada-productivity | Productivity: memory, task tracking, enterprise search, nudge |
| armada-security | Security and Compliance: GRC, awareness, zero-trust, SIEM |
| armada-support | Customer Support: ticket triage, response drafting, KB articles |