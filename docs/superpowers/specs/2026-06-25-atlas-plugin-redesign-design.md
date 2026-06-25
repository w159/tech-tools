# Atlas Plugin Redesign - Design

Date: 2026-06-25
Status: Approved. Commit to `main` on completion (user-authorized).
Scope: `plugins/atlas/` skill architecture, hooks, agents, commands, manifest, README,
plus a global SQLite observability database.

## Problem

The atlas plugin's stated purpose is **context engineering**: drive work through
subagents so the main Claude Code session keeps a clean context, avoiding the bloat,
quality degradation, and hallucination that come from doing everything inline. In
practice it fails this goal in four ways:

1. **Parallelism is advice, not mechanism.** `atlas-engine` is 170 lines of "you MUST
   delegate / fan out / never do it yourself" plus a rationalization table. It is
   exhortative. A real session ran ~6 hours inline because nothing *forced* the model
   to dispatch. Heavy prose about parallelism does not produce parallelism.
2. **Overlap.** `atlas-architect`'s "Architect Mode" duplicates `atlas-engine`'s
   standing-consent orchestration. `atlas-operating-contract` (12 lines) only `cat`s a
   reference file already owned by the engine. Self-improvement exists in three places
   (the skill, `references/self-improving.md`, the `nudge.py` hook). The UX swarm
   exists in three places (the skill, `references/ux-test-swarm.md`, the `ux-*` agents).
3. **Skills demand details instead of discovering them.** `atlas-uxt-swarm` hardcodes
   `first-responders-dev.firebaseapp.com` and a specific API contract - it assumes the
   app rather than discovering it. The plugin has no autonomous architecture-mapping
   capability (the user relies on the external `pathfinder` skill, which discovers its
   own scope).
4. **Self-improvement measures nothing.** `atlas-self-improving` only journals
   qualitative lessons. It has no notion of measuring atlas's own run health, so it
   cannot identify metric-backed improvements.

## Goals

- Make subagent fan-out **mechanical and hard to skip**, not aspirational.
- Eliminate skill overlap; one home per concept.
- Make skills **discovery-first**: they scope themselves, requiring near-zero detail
  from the user.
- Add an autonomous architecture-mapping skill (pathfinder, atlas-native).
- Add a comprehensive code-audit swarm (quality, OWASP/security, principles, dedup).
- Redesign self-improvement around **measurement of atlas's own behavior**.
- Enforce an atlas naming convention across all skills.

## Naming convention (load-bearing)

Every skill is `atlas-<one atlas-themed word>`: exactly one dash, no second/internal
dash, the themed word drawn from maps / navigation / cartography / exploration.
Two-dash names are non-conformant.

| Current / planned | Final name | Fate | Theme logic |
|---|---|---|---|
| `atlas-engine` | `atlas-engine` | keep, rewrite | the engine room / core |
| `atlas-architect` | `atlas-architect` | keep, trim | already conformant + on-theme |
| pathfinder (new) | `atlas-cartographer` | new | maps the terrain |
| `atlas-self-improving` | `atlas-sextant` | rename, rewrite | measures your own position |
| `atlas-loop` | `atlas-orbit` | rename | a recurring cycle |
| `atlas-connectors` | `atlas-harbor` | rename | where external vendors dock |
| `atlas-uxt-swarm` | `atlas-expedition` | rename, de-hardcode | a crew journeying the live app |
| code-audit swarm (new) | `atlas-survey` | new | comprehensive survey of the terrain |
| `atlas-operating-contract` | (deleted) | delete | dead `cat` wrapper |

`atlas-engine` and `atlas-architect` keep their names deliberately: both are already
one-dash and on-theme, and `atlas-engine` is referenced by every agent, command, hook,
and reference file - renaming it is high-blast-radius churn for no thematic gain.

Final skill count: **8** (was 7). The two new swarms are distinct capabilities, not
overlap; the renames are 1:1.

## The forcing function (core of the fix)

Two layers, because interactive drift and large-task structure are different failures.

### Layer 1 - `dispatch_tripwire.py` hook (mechanical nudge)

A new `PostToolUse` hook on `Read|Grep|Glob|Edit|Write|Bash`, joining the existing
seven (stdlib-only, fail-open, exits 0 on any internal error).

- Maintains a per-session counter of **inline investigative/edit ops in the main
  session** (it must detect that it is NOT inside a subagent; if that cannot be
  determined reliably, it degrades to advisory and never blocks).
- Resets the counter to 0 whenever an `Agent`/`Task` dispatch occurs.
- Trips when the counter crosses a threshold (default 4 read-class ops) **or** on any
  inline `Edit`/`Write` to a path that is not an orchestration artifact
  (`docs/.run/`, `docs/plans/`, `docs/evidence/`, the durable `docs/` tree).
- On trip, injects `additionalContext`: a hard STOP that names the count and says the
  next investigative/edit step goes to a subagent. Editing target code inline gets the
  strongest message (the engine's law: the orchestrator never edits target code).
- Logs each tool-call/dispatch event to the **global SQLite observability DB** (see
  "Observability database" below) via the shared `scripts/atlas_db.py` module - the
  single source of truth `atlas-sextant` reads. No JSON SSOT.
- Thresholds are configurable via env (e.g. `ATLAS_TRIPWIRE=off`, a numeric override),
  consistent with the existing `ATLAS_GATE` pattern.

### Layer 2 - Workflow-default in `atlas-engine`

Replace the 170-line sermon with a short **mechanical decision gate** at the top of the
loop:

> If the task is `>1 stage` OR `>1 surface` OR whole-repo: author a Workflow script (or
> dispatch a parallel wave in ONE message). Never proceed inline. This is a checklist,
> not a judgment call.

Ship a canned Workflow template in `references/` (explore -> plan -> implement ->
verify, using `parallel()`/`pipeline()` and the atlas squad agents) that the engine
fills in. The rationalization table shrinks to a pointer; the procedure carries the
weight.

## Observability database (`atlas.db`)

The quantitative SSOT for all self-improvement and monitoring. One global SQLite file
that every project feeds - "running the engine in a project brings it into the
database."

- **Location.** `~/.atlas/atlas.db` by default, overridable via `ATLAS_DB`. Single
  global file (not per-project) so observability is comprehensive across every codebase
  atlas touches.
- **Built when the engine runs.** The `session_boot.py` hook (which already activates
  the runtime on `SessionStart`) calls `atlas_db.init()` -> `CREATE TABLE IF NOT
  EXISTS`, then `register_project(root)` and `start_run(...)`. Idempotent; safe on every
  session. If the DB cannot be opened, hooks degrade to advisory and never block
  (fail-open, consistent with the rest).
- **Owner module.** `scripts/atlas_db.py` (stdlib `sqlite3` only) is the single home for
  the schema and all helpers: `init`, `register_project`, `start_run`, `log_event`,
  `log_dispatch`, `finalize_run`, `run_metrics`, `record_improvement`, `trends`. Hooks
  and `atlas-sextant` import it; the schema is defined once.
- **Concurrency.** WAL mode + `busy_timeout` (~5s) + short-lived connections handle
  multiple concurrent Claude Code sessions writing at a low rate. Writes are small and
  append-mostly.
- **Schema (initial).**
  - `projects(id, root_path UNIQUE, name, stack, first_seen, last_seen)`
  - `runs(id, project_id, session_id, started_at, ended_at, wall_clock_s, task_summary, model)`
  - `events(id, run_id, ts, tool, context 'main'|'subagent', is_inline_op, path)`
  - `dispatches(id, run_id, ts, agent_type, model, wave_id)`
  - `metrics(run_id PK, inline_ops, dispatches, parallel_waves, in_flight_peak, est_context_tokens, recall_hits, recall_misses, verifier_coverage)`
  - `improvements(id, run_id, ts, dimension, baseline, target, note)`
- **Writers.** `session_boot.py` (init + register + start_run), `dispatch_tripwire.py`
  (log_event / log_dispatch, increment inline-op counters), `completion_gate.py` or a
  `Stop` path (finalize_run). **Reader/writer:** `atlas-sextant` (run_metrics, trends,
  record_improvement).
- **Privacy/footprint.** Stores paths, tool names, counts, timestamps - no file
  contents, no code, no secrets. Lives outside any repo (`~/.atlas/`), so it is never
  committed.

## Skill-by-skill design

### atlas-engine (rewrite)
- Add the Layer-2 decision gate as the literal first move.
- Absorb the orchestration-posture prose currently duplicated in `atlas-architect`'s
  "Architect Mode" (engine becomes the single owner of "how to orchestrate").
- Reference the new tripwire hook in the automation section.
- Update its references index and squad list for the renamed skills + the two new
  swarms.
- Trim the rationalization/red-flag prose now that the hook + decision gate enforce
  mechanically.

### atlas-architect (trim)
- Keep stages 1-6 (deps -> discover -> hooks -> config -> docs seed -> report).
- **Delete the "Architect Mode" section** (engine owns orchestration posture).
- Update its capability catalog / install recommendations to list the renamed skills
  and the two new swarms.

### atlas-cartographer (new - structure)
Pathfinder's proven structure, atlas-native and zero-arg:
- Runs as a Workflow: one `atlas:explorer` per feature in parallel (phase 1) -> two
  duplication-hunters (within-feature, cross-feature) in parallel (phase 2) ->
  orchestrator synthesizes the unified proposal (phase 3) -> handoff prompts (phase 4).
- Phase 0 discovers feature boundaries itself; **no details required from the user**.
- Every diagram node and duplication claim cites `file:line`; uncited reports are
  rejected and redeployed.
- Artifacts land in `docs/audits/atlas-cartographer-<date>/` (SSOT), not a loose
  repo-root dir; handoff prompts target `atlas-engine`.
- **Owns architectural/structural duplication and unification.**

### atlas-survey (new - quality / security / risk)
Comprehensive static code-audit swarm, run as a Workflow:
1. **Graph.** Run the `graphify` skill -> knowledge graph (communities, god nodes,
   high-centrality hot spots). Read `docs/*` SSOT for intended behavior.
2. **Targeted fan-out.** One reviewer per dimension, aimed at the hottest nodes:
   correctness/bugs, OWASP + security, SOLID/DRY/KISS + best practices, risk hotspots,
   dead code, test-coverage gaps, code-vs-docs drift. Composes existing assets
   (`security-review`, `codeql`, `quality-playbook`) atlas-natively rather than
   reinventing.
3. **Adversarial verify.** Every finding confirmed by an independent verifier (engine
   law 5) before it counts.
4. **Synthesize.** Prioritized findings with `file:line` + severity ->
   `docs/audits/atlas-survey-<date>/`; handoff prompts to `atlas-engine`.
- **Owns quality/security/risk findings, including local code-smell duplication.** Its
  dedup dimension *defers structural dedup to the cartographer pattern* so the two never
  re-audit the same concern.

### atlas-expedition (rename + de-hardcode)
`atlas-uxt-swarm` generalized to any web app:
- Phase 0 **discovers the app**: reads the repo to find the dev URL, API base, and the
  real save/read-back contract from `frontend/src` - replacing the baked-in
  first-responders constants. If discovery cannot determine a value, it asks for that
  one value only.
- All downstream phases (personas, scripted data entry, browser walk, fuzz, calc
  oracle, three hard gates) consume the discovered contract.
- The `ux-*` agents and `references/ux-test-swarm.md` are de-hardcoded to match; the
  engine reference and this skill stay in sync (one home for the runbook).
- **Owns runtime/dynamic behavior** (live browser, real journeys, numeric accuracy) -
  no static-analysis overlap with survey.

### atlas-sextant (rename + rewrite - measurable meta, SQLite-backed)
- **Single source of truth is the global SQLite observability DB**, not files. Reads it
  via `scripts/atlas_db.py`.
- At `Stop`, emits two blocks for the current run:
  - **RUN METRICS:** wall-clock, inline-ops, dispatches, parallel waves, in-flight
    peak, est. context tokens (inline vs subagent), recall hits/misses (did it check
    memory before re-deriving), verifier coverage (shipping changes with an independent
    verifier / total).
  - **MEASURABLE IMPROVEMENTS** to atlas's own behavior (routing, thresholds, skills,
    hooks), each with an explicit `baseline -> target` number, persisted to the
    `improvements` table.
- Because the DB spans every run and project, no-arg `atlas-sextant` also reports
  **cross-run / cross-project trends** (is parallelism improving? which project drifts
  inline most?) - the observability surface the user asked for.
- Keeps claude-mem lesson capture as the narrative layer; the DB is the quantitative
  layer. Every improvement carries a measurement.
- The `nudge.py` hook points here (already does); update its references.

### atlas-orbit (rename)
- `atlas-loop` renamed; content unchanged except internal references and the engine's
  pointer to it.

### atlas-harbor (rename)
- `atlas-connectors` renamed; content unchanged except internal references and the
  architect's pointer to it. Vendor table (`vendors.md`) unaffected.

### atlas-operating-contract (delete)
- Commands `cat` `skills/atlas-engine/references/operating-contract.md` directly, not
  the skill - confirmed by grep. Deleting the skill breaks nothing. The reference file
  stays.

## Consolidation summary (overlap kills)
- Architect Mode prose -> removed from architect, owned by engine.
- `atlas-operating-contract` skill -> deleted (file retained).
- Self-improvement: skill (`atlas-sextant`) is the single home. `references/
  self-improving.md`'s separate `~/self-improving/` tiered file-memory system is **cut**
  (item E resolved) and replaced by the global SQLite observability DB as the
  quantitative SSOT, with claude-mem as the narrative layer. Three homes collapse to
  one DB + one narrative store.
- UX swarm: one runbook shared by `atlas-expedition` + the engine reference + `ux-*`
  agents, all de-hardcoded together.

## Cross-layer propagation (per repo CLAUDE.md)

Renames and deletions must land consistently across every layer or they are bugs:
- skill dirs + `SKILL.md` frontmatter `name:`
- `atlas-engine/SKILL.md` references index + squad list
- `atlas-architect` capability catalog / install recommendations
- `references/capability-routing.md`, `references/capability-catalog.md`
- commands that reference renamed skills
- hooks that reference skills (`session_boot.py`, `nudge.py`)
- `.claude-plugin/plugin.json` (skill list, keywords, description, version bump)
- `README.md` tables + counts
- `marketplace.json` description/keywords if affected
- `discover_capabilities.py` if it names skills
- `scripts/atlas_db.py` (new), wired into `session_boot.py`, `dispatch_tripwire.py`,
  the `Stop` path, and `atlas-sextant`
- `hooks/hooks.json` (register `dispatch_tripwire.py`)

## Out of scope (this redesign)
- The 16 `atlas-*` commands beyond updating references to renamed/removed skills.
- The 10 MCP vendor connectors (and `atlas-harbor`'s vendor table content).
- Agent renames: agents already use the `atlas:` namespace; not renamed unless asked.

## Risks
- **Tripwire false positives** in subagent context or on legitimate small inline
  orchestration work. Mitigation: advisory-degrade when subagent-detection is
  uncertain; env opt-out; tune threshold.
- **Rename blast radius.** Mitigation: grep every reference per the propagation list;
  run `node test-mcp-tools.mjs` and a skill-name lint after; verify `git check-ignore`
  unaffected.
- **Workflow-default friction** on genuinely small tasks. Mitigation: the decision gate
  only triggers on `>1 stage / >1 surface / whole-repo`; single-surface trivial tasks
  stay inline.

## Verification (Definition of Done for the redesign itself)
- All 8 skills conform to the naming rule (single dash); a lint proves it.
- `atlas-operating-contract` deleted; no dangling references (grep clean).
- Tripwire hook present, loads via `hooks.json`, fails open (tested with a forced
  error), logs events to `atlas.db`.
- `atlas.db` is created on first engine run (`CREATE TABLE IF NOT EXISTS`), the project
  is registered, and a run row is opened/closed; a missing/locked DB degrades to
  advisory without blocking. Stores no code/secrets and lives outside any repo.
- `atlas-cartographer` and `atlas-survey` exist, run zero-arg, fan out via Workflow,
  reject uncited findings.
- `atlas-expedition` contains no `first-responders` literals (grep clean) and discovers
  the contract.
- `atlas-sextant` reads `atlas.db` and emits RUN METRICS + MEASURABLE IMPROVEMENTS with
  baseline->target numbers, plus a cross-run/cross-project trend on no-arg invocation.
- `README.md`, `plugin.json`, capability catalog, and routing all reflect the final 8.
- `node test-mcp-tools.mjs` passes (no tool-count regression).
