---
name: atlas-setup
description: 'MANUAL skill covering the full atlas lifecycle outside of task work: onboard (scaffold the docs/ SSOT plus .atlas/ internal state, inventory skills, recommend what to run next), install (verify and wire claude-mem, context-mode, hooks, project config), connectors (guided vendor MCP connector setup across domain plugins), and repair (fix a broken atlas install: marketplace, rollbacks, hooks, assets). Run with no args for onboarding plus recommendations; run with --fix to auto-repair.'
when_to_use: first run to bring atlas online, workspace setup, SSOT scaffolding, tooling install, vendor connector setup, what to run next, or a broken atlas install (subagents not launching, plugin acting like an older version)
disable-model-invocation: true
user-invocable: true
argument-hint: "[onboard | install | connectors | repair [--fix] | task description | 'menu']"
allowed-tools: Read, Glob, Grep, Bash(python3:*), Write(docs/**), Write(.atlas/evidence/**), Write(docs/audits/**)
---

# atlas-setup - onboarding, install, connectors, repair

The one manual skill in the fleet. The user invokes it explicitly; it never
auto-triggers. Every other atlas skill auto-triggers from its description.

atlas-setup configures, fixes, and organizes any project it runs in. First run
scaffolds the SSOT from nothing; every later run checks the same structure and
repairs whatever is partial, missing, or drifted. The scaffold step is
idempotent, so running it again on an already-onboarded project is safe and is
the correct way to fix a broken or partial structure - not just a first-run
action. Structural writes (root entry files, the `docs/` base tree, and the
durable `.atlas/**` subfolders) go through this script under
`Bash(python3:*)`, not through the frontmatter's narrower direct `Write`
grants, which cover `docs/**` content edits and `.atlas/evidence/**`
captures made outside the scaffolder.

It has four modes. Pick by argument, or infer from the ask:

| Mode | When | Reference |
|---|---|---|
| onboard (default) | First run, `docs/` missing, or "what should I run next" | this file |
| install | Tooling not wired: claude-mem, context-mode, hooks, project config | `references/install.md` |
| connectors | Vendor MCP connector setup (Auvik, CIPP, NinjaOne, ...) | `references/connectors.md` |
| repair | Atlas itself is broken: subagents not launching, stale version, missing hooks | `references/repair.md` |

Mode routing rules:

- No args -> always run `python3 scripts/scaffold_docs.py <repo-root>` first.
  It is idempotent: create-if-missing on a fresh project, gap-repair on a
  partial or drifted one, no-op on an already-correct one. This is the
  mechanism that fixes a partial, missing, or drifted `.atlas/` or `docs/`
  tree on every run, not just the first.
- No `docs/` before that call -> continue with the rest of onboard (below).
- `docs/` already existed -> the scaffold call above already repaired it;
  go straight to recommendations (below) instead of repeating onboard steps
  3-8.
- Anything that smells like a broken install (subagents do not launch, the
  plugin acts like an older version, marketplace points at a stale fork)
  -> repair. Auto-repair with `--fix` runs
  `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --fix`.
- To build, fix, audit, or refactor code: this is NOT the skill. Route to
  atlas-orchestrate or the specific task skill.

## The mastery framework standard

Every atlas skill follows the Skills Mastery Framework. The full
standard is in `references/mastery-framework.md`. The summary:

- **L1 (metadata, ~100 tokens)** - `name` and `description` are always
  loaded for routing. `description` is the only signal the model uses to
  auto-trigger.
- **L2 (SKILL.md body, <5k tokens)** - the operating manual, loaded on
  trigger. Hard limit: 500 lines.
- **L3 (bundled files, on demand)** - `references/`, `scripts/`,
  `templates/` loaded only when L2 directs. One level deep. No chains.

Key rule: `triggers:` is NOT a real Claude Code field. Auto-trigger comes
ONLY from `description` + `when_to_use`. Never use `triggers:`.

## The docs/ SSOT (plus .atlas/ internal state)

The full canonical structure is defined once, authoritatively, in the
docs-ssot.md single source of truth (maintained in the atlas-orchestrate and
atlas-loop skills). Onboarding scaffolds root entry files
plus two trees at the project root: project documentation lives under
`docs/`; atlas's own self-improvement state lives under `.atlas/` directly.
`.atlas/` never contains a `docs/` subdirectory or project-wiki content
(architecture, plans, specs, features).

```
README.md, AGENTS.md, CLAUDE.md   root entry points: human onboarding, agent
                                   orientation, Claude-Code operating rules

docs/
  CHANGELOG.md            append-only, newest-first, completed + verified work
  ROADMAP.md              backlog with status (planned/in-progress/blocked/deferred)
  AGENTS.md               deep orienting doc; optional, root AGENTS.md is the minimum
  architecture/           system design, maps, ADRs source material (atlas-audit)
  decisions/              project ADRs (architecture decision records)
  plans/                  implementation plans, one per task
  specs/                  requirements and specifications
  features/               per-feature specs-as-built
  lessons/                durable lessons, gotchas, postmortems
  wiki/                   rendered graphify diagrams + understand-anything wiki
  api/                    PROJECT-ADAPTIVE: only when an API is detected
                           (OpenAPI file, routes/controllers dir, web framework)

.atlas/
  evidence/               permanent execution-evidence captures
  findings/               dated learning ledger (<date>-<slug>.md + INDEX.md)
  audits/                 atlas-internal audit records
  decisions/              atlas's own dated operating decisions (tooling
                           activation, structure repairs) - see install.md
  archive/                retired/superseded state
  understand-anything/    knowledge-graph working data (published to docs/wiki/)
  graphify/               diagram working data (published to docs/wiki/)
  self-improvement/       skill-gen/disable decisions, context-optimizer output
  memory/                 persistent cross-session memory
  nudge/                  inline-op thresholds, dispatch coaching signals
  CLAUDE.md               orientation: what .atlas/ is, ephemeral vs durable
  AGENTS.md               same orientation for non-Claude agents
  .run/                   EPHEMERAL, GITIGNORED run state (except
                           .run/findings.json, which is durable)
```

Subfolders under `docs/` are project-adaptive: a project with no HTTP API
has no `docs/api/`; a project with one does. `docs/standards/`,
`docs/glossary.md`, and `docs/reference/` are created on demand by the
curator, not by the scaffold. `.atlas/findings/` is the dated, durable
learning ledger agents consult before non-trivial work; `.atlas/decisions/`
is where atlas's own dated operating decisions land, including the
tooling-activation record install mode writes (`references/install.md`).

Everything shown above except `.atlas/.run/`
(minus its durable `findings.json`) is committed, behind a zero-trust,
deny-by-default `.gitignore` that allowlists the durable trees and
re-excludes secrets last (see `atlas-gitignore`). The scaffold is created by
a deterministic, idempotent script, never inline prose:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>

Idempotent means safe to re-run on every invocation: it creates only what
is missing and never overwrites a non-empty file, so running it against a
project that already has a partial or drifted structure repairs the gaps
without disturbing what is already correct. A leftover `.atlas/docs/` from
before this split is not migrated automatically; the script refuses (exit
1) until its unique content is moved into `docs/` and the legacy directory
deleted.

## First run: onboarding

When `docs/` does not exist:

1. **Detect roots** - find the project root (nearest `.git` ancestor), any
   codebase roots (subdirectories with their own manifest), and whether the
   project exposes an API (OpenAPI file, routes/controllers dir, web
   framework) so the project-adaptive `docs/api/` scaffolds only when it fits.
2. **Scaffold the SSOT** - run `scripts/scaffold_docs.py`. It creates the
   root entry files, the full `docs/` base tree, and the full `.atlas/` tree
   shown above (project-adaptive `docs/api/` only when Step 1 detected an
   API). It is idempotent: re-running it against a partial or drifted
   structure fills in exactly what is missing and leaves everything else
   untouched, which is how atlas-setup fixes and organizes a project on
   every later run, not only the first.
3. **Wire graphify** - record the wiki producer pipeline (architecture/
   in, wiki/diagrams/ out) per `references/graphify-wiring.md`.
4. **Update .gitignore** - write or repair a zero-trust, deny-by-default
   `.gitignore` (see `atlas-gitignore`): allowlist the full `docs/` and
   `.atlas/` durable trees, ensure `.atlas/.run/` stays ignored except its
   durable `findings.json`, and re-exclude secrets last.
5. **Inventory skills** - read `references/manual-vs-auto-map.md` and
   report which skills just came online.
6. **Run the freshness gate** - wiki fresh, stale, missing, or N/A per
   `references/graphify-wiring.md`.
7. **Deploy self-improvement** - verify the atlas self-improvement system
   is deployed and functional:
   - `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_memory.py` exists and `~/.atlas/memory/` is writable
   - `${CLAUDE_PLUGIN_ROOT}/scripts/skill_factory.py` exists and `~/.atlas/skills/` is writable
   - `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_curator.py` exists
   - `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py` exists
   - `hooks/memory_capture.py` and `hooks/auto_skill.py` are wired in hooks.json
   Run the context optimizer to disable unused skills/agents:
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_context_optimizer.py" optimize --dry-run`
   Present the savings estimate to the user and confirm before applying.
   This is the single most impactful action for reducing token cost - atlas
   loads 21 skills + 12 agents into every API call; disabling unused ones
   can cut that by 40%+.
8. **Recommend** - run the recommendation analysis and present the top
   3-5 next steps.

Every no-args run executes step 2 (`scripts/scaffold_docs.py`) first,
whether or not `docs/` already exists - that call is what repairs a
partial, missing, or drifted structure before anything else happens. If
`docs/` did not exist, continue through the rest of onboarding (steps 3-8)
below. If `docs/` already existed, the scaffold call already repaired it;
skip straight to recommendations (below) instead of repeating steps 3-8.

## Subsequent runs: recommendations

The "what should I run next" mode. The analysis checks, in priority order:

1. **Setup gaps** - hooks wired? claude-mem installed? context-mode
   installed? If missing, run install mode.
2. **Self-improvement deployed?** - atlas_memory, skill_factory,
   atlas_curator, atlas_context_optimizer scripts present? Memory at
   `~/.atlas/memory/` writable? Auto-skills at `~/.atlas/skills/`?
   Run `atlas_context_optimizer.py status` and if >15 skills are enabled,
   recommend running the optimizer.
3. **Security audit overdue** - has atlas-audit ever run? Is it stale?
4. **Architecture map missing or stale** - has atlas-audit mapped this
   codebase? Is the map older than the last code change?
5. **Run health regressing** - self-telemetry metrics (verifier_coverage,
   inline_ops, unpaired dispatches) trending the wrong way? See
   `${CLAUDE_SKILL_DIR}/references/self-telemetry.md`.
6. **UX coverage gap** - is there a frontend atlas-ux-test has not tested?
7. **Docs drift** - does AGENTS.md match the stack? Is CHANGELOG current?
8. **Recurring task identified** - repeated prompts atlas-loop could
   automate.
9. **Tech debt accumulation** - TODO/FIXME markers, stale branches.
10. **Connector not provisioned** - vendor signals present but the
    connector not configured (connectors mode).

See `references/recommendation-engine.md` for the full analysis matrix.
Present the top 3-5 recommendations as a numbered list, each with the
recommended skill, a one-sentence reason, a confidence level, and the
exact command to invoke.

## Activation: kick off a skill

The user can pick a recommendation ("run #2"), name a goal ("audit my
security" -> atlas-audit), name a skill, ask for a menu, or describe a
task. When routing is ambiguous, present the candidates as one
AskUserQuestion, recommendation first. See `references/skill-routing.md`
for the full task-to-skill mapping.

## The skill inventory (21 skills)

- **1 manual skill** - atlas-setup (this skill).
- **20 auto-trigger skills** - atlas-orchestrate, atlas-audit,
  atlas-loop, atlas-ux-test, and the 16 task skills (atlas-component,
  atlas-db-audit, atlas-debug, atlas-feature, atlas-frontend,
  atlas-gitignore, atlas-handoff, atlas-harden, atlas-launch,
  atlas-m365, atlas-prompt, atlas-readme, atlas-refactor,
  atlas-validate, atlas-vendor-assessment, atlas-wiki).

Org deployment (11 departments, 156 department skills) now lives in the
separate `armada` plugin; install it only for org use.

## The wiki pipeline (graphify wiring)

    docs/architecture/  -->  docs/wiki/diagrams/

graphify lives at the repo root (`skills/graphify/SKILL.md`), not inside
the atlas plugin. atlas-audit populates `architecture/`; graphify renders
it into `wiki/diagrams/`. If `architecture/` is newer than
`wiki/diagrams/`, the wiki is stale: recommend a graphify refresh. See
`references/graphify-wiring.md`.

## No-args behavior

No arguments: run the recommendation analysis and present the top 3-5.
Install or change nothing without the user picking a recommendation or
naming a task. "menu": list the full inventory from
`references/manual-vs-auto-map.md`. A task description: route to the best
skill, asking one question if ambiguous.

## First move

Always run `scripts/scaffold_docs.py` first - it creates the tree from
nothing or repairs a partial/drifted one, and is a no-op when everything is
already correct. If `docs/` did not exist before that call: continue with
wire graphify, inventory, recommend. If it already existed: analyze and
recommend. If anything about the install itself looks broken, switch to
repair mode (`references/repair.md`).
