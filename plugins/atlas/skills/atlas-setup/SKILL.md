---
name: atlas-setup
description: 'MANUAL skill covering the full atlas lifecycle outside of task work: onboard (scaffold the .atlas/docs/ SSOT, inventory skills, recommend what to run next), install (verify and wire claude-mem, context-mode, hooks, project config), connectors (guided vendor MCP connector setup across domain plugins), and repair (fix a broken atlas install: marketplace, rollbacks, hooks, assets). Run with no args for onboarding plus recommendations; run with --fix to auto-repair.'
when_to_use: first run to bring atlas online, workspace setup, SSOT scaffolding, tooling install, vendor connector setup, what to run next, or a broken atlas install (subagents not launching, plugin acting like an older version)
disable-model-invocation: true
user-invocable: true
argument-hint: "[onboard | install | connectors | repair [--fix] | task description | 'menu']"
allowed-tools: Read, Glob, Grep, Bash(python3:*), Write(.atlas/docs/**)
---

# atlas-setup - onboarding, install, connectors, repair

The one manual skill in the fleet. The user invokes it explicitly; it never
auto-triggers. Every other atlas skill auto-triggers from its description.

It has four modes. Pick by argument, or infer from the ask:

| Mode | When | Reference |
|---|---|---|
| onboard (default) | First run, `.atlas/docs/` missing, or "what should I run next" | this file |
| install | Tooling not wired: claude-mem, context-mode, hooks, project config | `references/install.md` |
| connectors | Vendor MCP connector setup (Auvik, CIPP, NinjaOne, ...) | `references/connectors.md` |
| repair | Atlas itself is broken: subagents not launching, stale version, missing hooks | `references/repair.md` |

Mode routing rules:

- No args and no `.atlas/docs/` -> onboard.
- No args and `.atlas/docs/` exists -> recommendations (below).
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

## The .atlas/docs/ SSOT

Onboarding scaffolds this structure at the project root:

```
.atlas/docs/
  CHANGELOG.md            append-only, newest-first
  ROADMAP.md              backlog with status
  AGENTS.md               architecture, conventions, commands
  evidence/               permanent execution-evidence captures
  architecture/           system design, maps, ADRs (atlas-audit)
  reference_files/        external/vendor doc snippets
  audits/                 audit reports (atlas-audit)
  features/               per-feature specs-as-built
  lessons/                durable lessons, gotchas, postmortems
  wiki/                   onboarding, how-to, runbooks, diagrams (graphify)
  specs/                  requirements and specifications
  plans/                  implementation plans, stage maps
  .run/                   EPHEMERAL, GITIGNORED run state
```

Everything under `.atlas/docs/` is committed except `.run/`. The scaffold
is created by a deterministic, idempotent script, never inline prose:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>/.atlas/docs

## First run: onboarding

When `.atlas/docs/` does not exist:

1. **Detect roots** - find the project root (nearest `.git` ancestor) and
   any codebase roots (subdirectories with their own manifest).
2. **Scaffold the SSOT** - run `scripts/scaffold_docs.py`.
3. **Wire graphify** - record the wiki producer pipeline (architecture/
   in, wiki/diagrams/ out) per `references/graphify-wiring.md`.
4. **Update .gitignore** - ensure `.atlas/docs/.run/` is ignored but the
   durable tree is tracked.
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
   This is the single most impactful action for reducing token cost — atlas
   loads 21 skills + 12 agents into every API call; disabling unused ones
   can cut that by 40%+.
8. **Recommend** - run the recommendation analysis and present the top
   3-5 next steps.

If `.atlas/docs/` already exists, skip scaffolding and go straight to
recommendations.

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

    .atlas/docs/architecture/  -->  .atlas/docs/wiki/diagrams/

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

Check for `.atlas/docs/`. Missing: scaffold, wire graphify, inventory,
recommend. Present: analyze and recommend. If anything about the install
itself looks broken, switch to repair mode (`references/repair.md`).
