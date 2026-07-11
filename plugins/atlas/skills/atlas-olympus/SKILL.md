---
name: atlas-olympus
description: The home of the twelve gods -- the entry point that scaffolds the .atlas/ workspace, migrates the SSOT from .atlas/docs/ to .atlas/docs/, activates the skill fleet, and recommends what to run next. Use on first run to set up a project, on subsequent runs to get recommendations for improvements, or when you want atlas to analyze your workspace and tell you what to do. Triggers on project setup, workspace initialization, SSOT migration, skill recommendation, and 'what should I run' questions.
when_to_use: project setup, workspace initialization, SSOT migration, skill recommendation, and 'what should I run' questions
---


# atlas-olympus - the home of the twelve gods

Olympus is the mountain home of the twelve gods. In atlas, the twelve gods are
the skills: atlas-metis, atlas-hephaestus, atlas-ariadne, atlas-athena,
atlas-argus, atlas-chronos, atlas-hermes, atlas-odysseus, atlas-nestor,
atlas-armada, atlas-olympus (this skill), and the twelfth seat reserved for the
next skill the fleet needs. Olympus sets up the scaffolding that lets every
other skill operate, organizes the workspace, and acts as the orchestration
layer that activates the fleet.

## What Olympus does

Olympus has four responsibilities, each available on every invocation:

1. **Scaffold** -- examine the project workspace and set up the `.atlas/`
   directory structure that every atlas skill, hook, and agent reads from and
   writes to.
2. **Migrate the SSOT** -- move the single source of truth from `.atlas/docs/` to
   `.atlas/docs/` so all atlas artifacts live under one dedicated path.
3. **Recommend** -- analyze the workspace state and give clear, concise
   recommendations on what to run next and why.
4. **Activate** -- kick off any skill the user chooses, or let the user describe
   their goal and Olympus routes them to the right skill automatically.

## The .atlas/ directory

Olympus creates and maintains this structure at the project root:

```
.atlas/
  docs/                     # the single source of truth (migrated from .atlas/docs/)
    CHANGELOG.md             # append-only, newest-first; everything done/changed
    ROADMAP.md               # everything still to be done; backlog with status
    AGENTS.md                # how the project works: architecture, conventions, commands
    evidence/                # permanent execution-evidence captures
    architecture/             # system design, component maps, ADRs
    reference_files/          # external/vendor doc snippets
    audits/                   # audit reports (security/quality/performance)
    features/                 # per-feature specs-as-built
    lessons/                  # durable lessons learned, gotchas, postmortems
    wiki/                     # onboarding, how-to, operational runbooks
    specs/                    # requirements and specifications
    plans/                    # implementation plans, numbered stage maps
    .run/                     # EPHEMERAL, GITIGNORED run state
      STATE.md                #   live: current wave, open subagents, next wave
      findings.json           #   per-finding verdicts
      work-log.md             #   resumability log
  org-config.yaml             # org branding, policies, departments (atlas-armada)
  olympus-state.json          # workspace analysis state and recommendations
```

Everything under `.atlas/docs/` is committed except `.atlas/docs/.run/` which
is ephemeral and gitignored. The `.atlas/` directory itself is committed --
it is the project's atlas workspace, not a cache.

## First run: scaffolding

When Olympus runs and `.atlas/` does not exist, it scaffolds the workspace:

1. **Detect roots** -- find the project root (nearest `.git` ancestor) and any
   codebase roots (subdirectories with their own manifest).
2. **Create `.atlas/`** -- make the directory structure above.
3. **Migrate `.atlas/docs/`** -- if a `.atlas/docs/` directory already exists at the project
   root, move its contents into `.atlas/docs/`, preserving all files. If
   `.atlas/docs/` does not exist, seed the SSOT scaffold (CHANGELOG, ROADMAP, AGENTS
   with the detected stack).
4. **Write `.atlas/org-config.yaml`** -- if atlas-armada is available, offer
   guided org setup. If the user declines, create a minimal default config.
5. **Update `.gitignore`** -- ensure `.atlas/docs/.run/` is ignored but
   `.atlas/` and its durable contents are tracked.
6. **Run discovery** -- scan the stack and recommend which skills/plugins/MCP
   to install (delegates to atlas-hephaestus).
7. **Confirm hooks** -- verify all atlas hooks are wired.
8. **Report** -- present the scaffolded state and the first recommendation.

If `.atlas/` already exists, Olympus skips scaffolding and goes to
recommendations.

## Subsequent runs: recommendations

When Olympus runs and `.atlas/` already exists, it analyzes the workspace and
gives recommendations. This is the "what should I run next" mode.

The analysis checks:

1. **Stack signals** -- what languages, frameworks, and tools the project uses.
2. **docs/ health** -- is CHANGELOG current? Is ROADMAP stale? Are there
   features without specs? Are there lessons to capture?
3. **Audit gaps** -- has atlas-athena (security/quality audit) ever run? When?
4. **Architecture state** -- has atlas-ariadne (architecture map) ever mapped
   this codebase? Is the map stale (code changed since the map was made)?
5. **Observability** -- what do the atlas-argus metrics say about recent runs?
   Are there dimensions that are regressing?
6. **Org deployment** -- is atlas-armada configured? Are departments active?
   Are connectors provisioned?
7. **UX coverage** -- has atlas-odysseus (UX swarm) ever tested the app?
8. **Test coverage** -- are there coverage gaps? Has the test suite been run
   recently?
9. **Tech debt** -- are there open issues, stale branches, or known debt?

Olympus presents the top 3-5 recommendations as a numbered list, each with:

- The recommended skill to run
- A one-sentence reason why
- A confidence level (high/medium/low)
- The exact command to invoke

See `references/recommendation-engine.md` for the full analysis matrix.

## Activation: kick off a skill

The user can:

1. **Pick a recommendation** -- "run #2" activates the second recommendation.
2. **Name a goal** -- "I want to audit my security" and Olympus routes to
   atlas-athena.
3. **Name a skill** -- "run atlas-ariadne" and Olympus activates it.
4. **Ask for a menu** -- "what can you do?" and Olympus lists all twelve skills
   with a one-line description and when to use each.
5. **Describe a task** -- "I need to fix a bug in the auth flow" and Olympus
   routes to atlas-metis (the orchestrator) with the task.

When the user describes a task and Olympus is confident which skill handles it,
Olympus activates that skill directly. When Olympus is not sure, it presents a
menu of the candidate skills and asks the user to pick.

See `references/skill-routing.md` for the full task-to-skill mapping.

## Elicitation

When invoked with no arguments, Olympus runs the recommendation analysis and
presents results. It does not ask the user what they want -- it tells them what
it recommends and lets them pick.

When invoked with a task description, Olympus routes to the best skill. If
routing is ambiguous (two skills could handle it), Olympus presents the
candidates as an AskUserQuestion (one round, recommendation first).

When invoked with "menu" or "what can you do", Olympus lists all twelve skills.

## The twelve gods

| # | Skill | Mythology | When to use |
|---|---|---|---|
| 1 | atlas-metis | Metis (wisdom) | Orchestrate any multi-step build/fix/audit/refactor |
| 2 | atlas-hephaestus | Hephaestus (the forge) | Boot and configure a project for atlas |
| 3 | atlas-ariadne | Ariadne (the thread) | Map codebase architecture, find duplication |
| 4 | atlas-athena | Athena (defense) | Security and quality audit |
| 5 | atlas-argus | Argus (all-seeing) | Measure run health, audit context cost, mine sessions |
| 6 | atlas-chronos | Chronos (cycles) | Recurring/iterative task loops |
| 7 | atlas-hermes | Hermes (messenger) | Vendor MCP connector setup |
| 8 | atlas-odysseus | Odysseus (voyager) | UX test swarm on any web app |
| 9 | atlas-nestor | Nestor (assembler) | Compose skills into a stack |
| 10 | atlas-armada | The fleet | Org deployment: roles, branding, compliance |
| 11 | atlas-olympus | Mount Olympus | This skill: scaffold, recommend, activate |
| 12 | (reserved) | -- | The next skill the fleet needs |

## No-args behavior

Invoked with no arguments, Olympus runs the recommendation analysis and
presents the top 3-5 recommendations. It does not install or change anything
without the user picking a recommendation or naming a task.

## First move

Check for `.atlas/`. If it does not exist, scaffold. If it exists, analyze and
recommend. Either way, end with a clear, actionable next step.