# Atlas Subagent Roster

Authoritative list of subagents shipped in `plugins/atlas/agents/`. 18 agents total as of v2.2.1.
Source: `plugins/atlas/agents/*.md` (each file's `name:` and `description:` frontmatter fields).

---

## How to Run Agents

Atlas skills invoke these agents via the Claude Code `Agent` tool with `subagent_type` set to
the agent's canonical name (e.g. `atlas:explorer`). The orchestrating skill or the user's atlas
session dispatches them; agents never invoke each other directly.

---

## Orchestrator vs. Worker Sessions

Every session is one of two kinds:

- **Orchestrator**: the main session that holds the user's task, dispatches subagents, synthesizes
  results, and keeps lean context by delegating heavy reads and writes to workers. The `atlas`
  session started by the user is always an orchestrator. Orchestrators track dispatches and
  verifier coverage in the `runs` and `metrics` tables of the observability DB.

- **Worker**: a leaf subagent session spawned by the orchestrator to do one bounded piece of work
  (exploration, implementation, verification, a DB audit query, etc.). Workers have narrow context,
  do not dispatch further, and report findings back to the orchestrator. A single orchestrator run
  may open dozens of worker sessions.

The observability DB (`~/.atlas/atlas.db`) records every session's transcript in the `session_logs`,
`messages`, and `tool_calls` mirror tables (added in v2.2.1). Run-health aggregates in atlas-sextant
Trends currently include all sessions; v2.2.3 will add a `run_kind` tag so orchestrator and worker
sessions can be reported separately, preventing short worker sessions from skewing wall-clock or
context averages.

---

## Core Pipeline Agents

These five agents form the standard orchestrator dispatch pattern:
explorer -> planner -> implementer -> verifier -> completeness-critic.

| Agent | One-line role |
|---|---|
| **atlas:explorer** | Read-only codebase explorer: maps features, modules, and call paths; returns a compact structural map with file:line references; never file dumps. |
| **atlas:planner** | Multi-stage decomposition specialist: turns a task into a numbered stage map where each stage has exactly one failable check; flags concurrent stages and marks unverifiable output explicitly. |
| **atlas:implementer** | Focused implementer: makes ONE bounded, well-specified change correctly with a minimal diff, documentation-checked, then runs the project's own gate (lint/typecheck/test/build) and reports the result with evidence. Does not refactor opportunistically or expand scope. |
| **atlas:verifier** | Adversarial verifier: independently confirms or refutes a claimed finding or fix in a fresh context by re-reading the cited lines, re-running the test, or re-querying the data. Defaults to skeptical. Never fixes; only verifies and returns a verdict with evidence. |
| **atlas:completeness-critic** | Pre-done completeness auditor: hunts for unverified claims, unread sources, unexercised paths, and unsatisfied requirements from the original ask; returns a prioritized gap list and refutes "done" if any load-bearing gap remains. Never fixes; only finds and reports. |

Source: `plugins/atlas/agents/explorer.md`, `planner.md`, `implementer.md`, `verifier.md`,
`completeness-critic.md`.

---

## Documentation Agents

| Agent | One-line role |
|---|---|
| **atlas:docs-curator** | Post-ship docs maintainer: updates `docs/` as the single source of truth after a change lands (CHANGELOG, ROADMAP, AGENTS.md, and affected subfolders), citing file:line evidence for every entry it writes. |
| **atlas:docs-auditor** | Skeptical docs drift auditor: independently checks `docs/` against the actual code and state and returns a per-area verdict (current / stale / missing) with file:line evidence. Never writes; only judges. |

Source: `plugins/atlas/agents/docs-curator.md`, `docs-auditor.md`.

---

## Database Audit Agents

Five read-only agents for structured database audits. Strictly no writes, no migrations, no DDL.

| Agent | One-line role |
|---|---|
| **atlas:db-prober** | Read-only DB inspector: queries schema, RLS policies, GRANTs for the runtime role, indexes, constraints, defaults, and EXPLAIN plans; proposes but never applies changes. |
| **atlas:schema-inventory** | PostgreSQL catalog inventory: enumerates tables, columns, types, constraints, indexes, and RLS flags from the live database for the schema half of a DB audit. |
| **atlas:api-usage-map** | Code-usage scanner: maps every database object (table, column, ORM model) the API references and where, for the code-usage half of a database audit. |
| **atlas:naming-glossary-audit** | Nomenclature auditor: checks PostgreSQL table and column names against a project glossary; focused on user_* to client_* transition or similar rename passes. |
| **atlas:rls-privilege-audit** | RLS security auditor: checks row-level security policies, table grants, and roles against least privilege for the security half of a DB audit in regulated environments. |

Source: `plugins/atlas/agents/db-prober.md`, `schema-inventory.md`, `api-usage-map.md`,
`naming-glossary-audit.md`, `rls-privilege-audit.md`.

---

## UX and Frontend Agents

Six agents for the UX test swarm launched by `atlas-expedition`. Phase order:
cartographer -> persona + fuzzer + accuracy-oracle (parallel) -> reporter.
The `ui-runtime-tester` is a general-purpose browser validation agent used outside the swarm as well.

| Agent | One-line role |
|---|---|
| **atlas:ui-runtime-tester** | Live browser validator: starts the web app and validates observed behavior (render, clean console, network calls, loading/empty/error/success states) via the Claude_Preview MCP or webapp-testing skill; captures screenshots, console, and network as evidence. Does not edit code. |
| **atlas:ux-cartographer** | Phase 0 coverage cartographer: maps routes and form fields from a live app and captures the real client save/read-back contract; returns coverage matrices and a contract snapshot. Discovers from the live app; never edits source. |
| **atlas:ux-persona** | End-user persona: lives one realistic user journey through a real browser (sign up, enter data, walk routes, exercise every state) and returns discovered bugs, user stories, persona feedback, and feature requests grounded in screenshots. Never edits app source. |
| **atlas:ux-fuzzer** | Boundary and input fuzzer: pushes every discovered input to its edges in a real browser to find validation gaps (silent bad-acceptance, crashes, wrong messages, unescaped echo); returns findings with screenshot, console, and network evidence plus Nielsen severity. Never edits target source. |
| **atlas:ux-accuracy-oracle** | Numeric accuracy verifier: independently recomputes every client-facing number the app displays (totals, balances, scores, projections) and diffs it against the rendered value; returns per-number verdicts with displayed value, recompute, inputs, and pass/fail. Writes verification worksheets only; never edits source. |
| **atlas:ux-reporter** | Swarm synthesis and gate reporter: closes a UX test run by consuming artifacts from the persona/fuzzer/oracle agents, enforcing the three hard gates, computing a completion rate, and emitting a RELEASE-READY / NEEDS-WORK / INCOMPLETE verdict. Writes new report files only; never edits the target app. |

Source: `plugins/atlas/agents/ui-runtime-tester.md`, `ux-cartographer.md`, `ux-persona.md`,
`ux-fuzzer.md`, `ux-accuracy-oracle.md`, `ux-reporter.md`.

---

## Agent Constraints

All 18 agents share three standing constraints regardless of the task:

1. **Never fix what you are auditing.** Auditor, verifier, critic, oracle, and prober agents
   return findings only. They do not carry Write, Edit, or MultiEdit permissions.
2. **Cite file:line for every claim.** A finding without a location is not actionable and will be
   rejected by the completeness-critic.
3. **Fail fast, report back.** If a required input is missing (a path that does not exist, a DB
   credential that is absent, a route that does not render), the agent reports the blocker rather
   than guessing.
