# Manual vs Auto Map

The inventory of the 26 atlas skills. atlas-setup uses this table to tell the user what just came online.

## Trigger model

Two frontmatter flags decide who can start a skill:

- `user-invocable: false` hides the skill from the `/` menu. The model still starts it when the task matches the description (model-only).
- `disable-model-invocation: true` keeps the skill in the menu but the model never starts it (manual). The user invokes it by name.

Every other skill is both in the menu and model-invocable. Many skills carry several modes (for example atlas-orchestrate: autopilot, crew, loop). The first argument or the ask selects the mode, and each SKILL.md names its modes near the top.

## Menu skills (21)

| Skill | Trigger | Modes folded in |
|---|---|---|
| atlas-audit | auto | code, architecture, self, db-audit, plugin validate |
| atlas-brainstorm | auto | requirements, strategy, sweep (issue and feedback triage) |
| atlas-debug | auto | root-cause fix, optimize (single-experiment loop) |
| atlas-doctor | auto | self-improvement loop |
| atlas-frontend | auto | build, component, polish |
| atlas-handoff | auto | session handoff |
| atlas-orchestrate | auto | autopilot, crew, loop |
| atlas-plan | auto | plan, proof (review publish) |
| atlas-prompt | auto | prompt rewrite |
| atlas-prototype | auto | throwaway prototype |
| atlas-readme | auto | README generation |
| atlas-refactor | auto | refactor, diff-mode simplify |
| atlas-review | auto | persona review |
| atlas-run-watch | auto | job watch, PR CI watch, PR feedback resolution |
| atlas-security | auto | security triage |
| atlas-setup | MANUAL | onboard, install, repair, gitignore |
| atlas-ship | MANUAL | commit, push, PR |
| atlas-status | auto | status rollup, announce, pulse, live TUI |
| atlas-testing | auto | test planning, any language, Xcode simulator |
| atlas-ux-test | auto | persona swarm, dogfood (diff and smoke) |
| atlas-wiki | auto | docs/wiki diagrams |

## Model-only skills (5)

atlas-bakeoff, atlas-compound, atlas-explain, atlas-harden, atlas-worktree. Hidden from the menu; the model starts them when the task matches.

## Count check

- Atlas skills: 26 (2 manual, 5 model-only, 19 menu and auto)
- Manual skills: atlas-setup, atlas-ship

## Armada (separate plugin)

Org deployment moved to the separate `armada` plugin (department agents and department skills). Install it alongside atlas only for org use; when installed, its skills are all auto and route through the department agents in `plugins/armada/agents/`.

## What atlas-setup reports on first run

After scaffolding, atlas-setup tells the user:

1. That atlas-setup and atlas-ship are the two manual skills and that each is invoked by name.
2. That five more skills are model-only and the rest start when the task matches their descriptions.
3. Whether the armada plugin is installed, and that org deployment lives there if the user needs it.
