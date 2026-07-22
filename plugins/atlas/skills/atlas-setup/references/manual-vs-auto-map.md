# Manual vs Auto Map

The full inventory of the 22 atlas skills. This is the routing table
atlas-setup uses to tell the user what just came online.

## Trigger model

There are exactly TWO manual skills in the atlas plugin (atlas and
atlas-setup). Every other skill auto-triggers from its `description` +
`when_to_use`.

- **Manual** = `disable-model-invocation: true`. The model cannot start
  it. The user must invoke it explicitly (slash command or direct call).
- **Auto** = the model may start it when the task matches the description.

| # | Skill | Mode | One-line trigger |
|---|---|---|---|
| 1 | atlas | MANUAL | Boot the workspace: verify claude-mem/context-mode, scan the project, recommend tooling (confirm first), wire hooks, seed the docs/ SSOT |
| 2 | atlas-setup | MANUAL | Onboard (scaffold docs/, recommend), install tooling, set up connectors, repair a broken install |
| 3 | atlas-orchestrate | auto | Orchestrate any multi-step build/fix/audit/refactor through subagents with verification |
| 4 | atlas-audit | auto | Code/security audit (OWASP, SOLID, dead code, drift), architecture map and dedup, or atlas self-telemetry |
| 5 | atlas-loop | auto | Match a recurring or iterative task to a reusable loop and instantiate it |
| 6 | atlas-ux-test | auto | UX test swarm, full UI/UX test pass, persona testing, pre-release frontend sweep |
| 7 | atlas-component | auto | Build one reusable component that survives latency, cancellation, partial failure |
| 8 | atlas-db-audit | auto | Read-only database audit: schema, reconciliation, privileges, naming |
| 9 | atlas-debug | auto | Chase down and fix a reproducible bug with root-cause evidence |
| 10 | atlas-feature | auto | Build a full-stack feature (UI + API + data) with verified evidence |
| 11 | atlas-frontend | auto | Build or refactor UI on shadcn/ui + Tailwind + Radix with every state verified |
| 12 | atlas-gitignore | auto | Generate a zero-trust deny-by-default .gitignore for a named stack |
| 13 | atlas-handoff | auto | Produce a dense session handoff so a fresh session resumes with zero re-discovery |
| 14 | atlas-harden | auto | Write an idempotent CHECK/SET/VERIFY remediation script for RMM/MDM |
| 15 | atlas-launch | auto | Launch a remediation session preloaded with a finding from the latest audit hub |
| 16 | atlas-prompt | auto | Rewrite a vague coding request into a structured, environment-aware prompt |
| 17 | atlas-readme | auto | Generate an onboarding-grade README.md by inspecting the actual repo |
| 18 | atlas-refactor | auto | Reorganize structure, naming, and layout without changing observable behavior |
| 19 | atlas-validate | auto | Audit a Claude Code plugin for structure, manifest validity, content quality |
| 20 | atlas-wiki | auto | Generate and refresh docs/wiki/ diagrams from architecture docs via the graphify skill |

## Count check

- Atlas skills: 20 (2 manual, 18 auto)
- Manual skills: atlas, atlas-setup

## Armada (separate plugin)

Org deployment moved to the separate `armada` plugin: 11 department
agents and 156 department skills (Data, Design, Engineering, Finance,
HR, IT Operations, Microsoft 365, Product, Productivity, Security,
Support). Install it alongside atlas only for org use; when installed,
its skills are all auto and route through the department agents in
`plugins/armada/agents/`.

## What atlas-setup reports on first run

After scaffolding, atlas-setup tells the user:

1. That atlas and atlas-setup are the two manual skills and how to invoke them.
2. That the other 18 skills are auto-trigger and will start when the task
   matches their descriptions.
3. Whether the armada plugin is installed, and that org deployment lives
   there if the user needs it.
