---
name: atlas-olympus
description: MANUAL onboarding skill and the first thing to run to bring atlas online. Enforces the Skills Mastery Framework across all atlas skills, scaffolds the .atlas/docs/ single source of truth, wires graphify to keep the wiki current, and reports which skills just came online. Use on first run to set up the atlas workspace, on subsequent runs to get ranked recommendations for what to run next, or when you want atlas to analyze your workspace and tell you what to do. The recovery path for a broken atlas install is atlas-doctor, not this skill.
when_to_use: first run to bring atlas online, workspace setup, SSOT scaffolding, what to run next, skill recommendation
disable-model-invocation: true
user-invocable: true
argument-hint: "[optional task description or 'menu']"
allowed-tools: Read, Glob, Grep, Bash(python3:*), Write(.atlas/docs/**)
---

# atlas-olympus - the manual onboarding layer

Atlas is named for the Greek god who holds up the world. Olympus is the
mountain home of the gods. In the atlas plugin, olympus is the MANUAL skill
the user runs first to bring atlas online. It is one of only two manual
skills in the fleet (the other is atlas-doctor). Every other skill
auto-triggers from its description.

Olympus has three jobs:

1. **Scaffold the SSOT** - create the `.atlas/docs/` single source of truth
   so every other skill has a durable place to read and write.
2. **Enforce the mastery framework** - make sure every atlas skill follows
   the Claude Code Skills Mastery Framework (progressive disclosure,
   strict frontmatter, deterministic scripts).
3. **Report what is online** - tell the user which skills just came online,
   which two are manual, and what to run next.

## What this skill is NOT

- It is NOT the recovery path. If atlas is broken (subagents do not
  launch, the plugin acts like an older version, hooks are missing), run
  `atlas-doctor`. Olympus scaffolds; doctor repairs.
- It is NOT an auto-trigger skill. The model cannot start it. The user
  must invoke it explicitly.
- It is NOT a task skill. To build, fix, audit, or refactor, use
  atlas-metis or the specific task skill. Olympus onboards and recommends.

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

See `references/mastery-framework.md` for every frontmatter field and when
to use each.

## The .atlas/docs/ SSOT

Olympus scaffolds this structure at the project root:

```
.atlas/docs/
  CHANGELOG.md            append-only, newest-first
  ROADMAP.md              backlog with status
  AGENTS.md               architecture, conventions, commands
  evidence/               permanent execution-evidence captures
  architecture/           system design, maps, ADRs (ariadne)
  reference_files/        external/vendor doc snippets
  audits/                 audit reports (athena)
  features/               per-feature specs-as-built
  lessons/                durable lessons, gotchas, postmortems
  wiki/                   onboarding, how-to, runbooks, diagrams (graphify)
  specs/                  requirements and specifications
  plans/                  implementation plans, stage maps
  .run/                   EPHEMERAL, GITIGNORED run state
```

Everything under `.atlas/docs/` is committed except `.run/`. The
`.atlas/docs/` directory is the single source of truth for the whole
plugin: every skill reads from and writes to it.

The scaffold is created by a deterministic script, not inline prose:

    python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>/.atlas/docs

The script is idempotent: it creates only what is missing and never
overwrites an existing non-empty file. It copies seed skeletons from
`templates/` so every folder carries a meaningful README, not an empty
dir.

## First run: onboarding

When olympus runs and `.atlas/docs/` does not exist, it brings atlas
online:

1. **Detect roots** - find the project root (nearest `.git` ancestor) and
   any codebase roots (subdirectories with their own manifest).
2. **Scaffold the SSOT** - run `scripts/scaffold_docs.py` to create the
   full `.atlas/docs/` tree from `templates/`.
3. **Wire graphify** - record the wiki producer pipeline (architecture/
   in, wiki/diagrams/ out) per `references/graphify-wiring.md`.
4. **Update .gitignore** - ensure `.atlas/docs/.run/` is ignored but the
   durable tree is tracked.
5. **Inventory skills** - read `references/manual-vs-auto-map.md` and
   report which skills just came online.
6. **Run the freshness gate** - check whether the wiki is fresh, stale,
   missing, or N/A per `references/graphify-wiring.md`.
7. **Recommend** - run the recommendation analysis and present the top
   3-5 next steps.
8. **Report** - present the scaffolded state, the skill inventory, and the
   first recommendation.

If `.atlas/docs/` already exists, olympus skips scaffolding and goes
straight to recommendations.

## Subsequent runs: recommendations

When olympus runs and `.atlas/docs/` already exists, it analyzes the
workspace and gives ranked recommendations. This is the "what should I
run next" mode.

The analysis checks (in priority order):

1. **Setup gaps** - hooks wired? claude-mem installed? context-mode
   installed? If missing, recommend atlas-hephaestus.
2. **Security audit overdue** - has atlas-athena ever run? Is it stale?
3. **Architecture map missing or stale** - has atlas-ariadne mapped this
   codebase? Is the map older than the last code change?
4. **Run health regressing** - atlas-argus metrics (verifier_coverage,
   inline_ops, unpaired dispatches) trending the wrong way?
5. **Org deployment not configured** - is atlas-armada set up? Are
   departments active?
6. **UX coverage gap** - is there a frontend atlas-odysseus has not
   tested?
7. **Docs drift** - does AGENTS.md match the stack? Is CHANGELOG current?
8. **Recurring task identified** - repeated prompts atlas-chronos could
   automate.
9. **Tech debt accumulation** - TODO/FIXME markers, stale branches.
10. **Connector not provisioned** - vendor signals present but atlas-hermes
    connector not configured.

See `references/recommendation-engine.md` for the full analysis matrix.

Olympus presents the top 3-5 recommendations as a numbered list, each with:
- The recommended skill
- A one-sentence reason
- A confidence level (high/medium/low)
- The exact command to invoke

## Activation: kick off a skill

The user can:

1. **Pick a recommendation** - "run #2" activates the second one.
2. **Name a goal** - "I want to audit my security" routes to atlas-athena.
3. **Name a skill** - "run atlas-ariadne" activates it.
4. **Ask for a menu** - "what can you do?" lists the skill inventory.
5. **Describe a task** - "I need to fix a bug in the auth flow" routes to
   the right skill.

When routing is ambiguous (two skills could handle it), olympus presents
the candidates as an AskUserQuestion (one round, recommendation first).

See `references/skill-routing.md` for the full task-to-skill mapping.

## The skill inventory (183 skills)

Olympus reports the full fleet on first run. The inventory has three
parts:

- **2 manual skills** - atlas-olympus (this skill) and atlas-doctor. The
  user invokes these explicitly. They do not auto-trigger.
- **25 auto-trigger top-level skills** - atlas-metis, atlas-hephaestus,
  atlas-ariadne, atlas-athena, atlas-argus, atlas-chronos, atlas-hermes,
  atlas-odysseus, atlas-nestor, atlas-armada, and the 16 task skills
  (atlas-component, atlas-db-audit, atlas-debug, atlas-feature,
  atlas-frontend, atlas-gitignore, atlas-handoff, atlas-harden,
  atlas-launch, atlas-m365, atlas-prompt, atlas-readme, atlas-refactor,
  atlas-validate, atlas-vendor-assessment).
- **156 auto-trigger armada skills** - grouped into 11 departments (Data,
  Design, Engineering, Finance, HR, IT Operations, Microsoft 365,
  Product, Productivity, Security, Support). These route through
  atlas-armada and the department agents.

See `references/manual-vs-auto-map.md` for the full table with every skill
named and its one-line trigger. That table is what olympus reads to tell
the user what just came online.

## The wiki pipeline (graphify wiring)

Olympus wires graphify as the wiki producer. The pipeline:

    .atlas/docs/architecture/  -->  .atlas/docs/wiki/diagrams/

graphify lives at the repo root (`skills/graphify/SKILL.md`), not inside
the atlas plugin. atlas-ariadne populates `architecture/`; graphify renders
it into `wiki/diagrams/` as HTML, JSON, and a plain-language report.

The completion gate runs a freshness check: if `architecture/` is newer
than `wiki/diagrams/`, the wiki is stale and olympus recommends a
graphify refresh. See `references/graphify-wiring.md` for the exact check
command and the gate behavior.

## Recovery: when atlas is broken

If the atlas plugin itself is broken (subagents do not launch, the
plugin acts like an older version, hooks are missing, marketplace points
at a stale fork), olympus is NOT the tool. Run atlas-doctor:

    /atlas-doctor --fix

atlas-doctor checks the marketplace source, version sync, rollback state,
install path, hooks, and assets, and auto-repairs what it can. Olympus
scaffolds the SSOT; doctor repairs the install. They are the only two
manual skills, by design: one sets up, one fixes.

## No-args behavior

Invoked with no arguments, olympus runs the recommendation analysis and
presents the top 3-5 recommendations. It does not install or change
anything without the user picking a recommendation or naming a task.

Invoked with "menu" or "what can you do", olympus lists the full skill
inventory from `references/manual-vs-auto-map.md`.

Invoked with a task description, olympus routes to the best skill. If
routing is ambiguous, it presents the candidates and asks the user to
pick.

## First move

Check for `.atlas/docs/`. If it does not exist, scaffold it with
`scripts/scaffold_docs.py`, wire graphify, inventory the skills, and
recommend. If it exists, analyze and recommend. Either way, end with a
clear, actionable next step and surface atlas-doctor as the recovery path
if anything about the install itself looks broken.