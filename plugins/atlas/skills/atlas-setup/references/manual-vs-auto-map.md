# Manual vs Auto Map

The full inventory of the 21 atlas skills. This is the routing table
atlas-setup uses to tell the user what just came online.

## Trigger model

There is exactly ONE manual skill in the atlas plugin. Every other skill
auto-triggers from its `description` + `when_to_use`.

- **Manual** = `disable-model-invocation: true`. The model cannot start
  it. The user must invoke it explicitly (slash command or direct call).
- **Auto** = the model may start it when the task matches the description.

| # | Skill | Mode | One-line trigger |
|---|---|---|---|
| 1 | atlas-setup | MANUAL | Onboard (scaffold docs/, recommend), install tooling, set up connectors, repair a broken install |
| 2 | atlas-orchestrate | auto | Orchestrate any multi-step build/fix/audit/refactor through subagents with verification |
| 3 | atlas-audit | auto | Code/security audit (OWASP, SOLID, dead code, drift), architecture map and dedup, or atlas self-telemetry |
| 4 | atlas-loop | auto | Match a recurring or iterative task to a reusable loop and instantiate it |
| 5 | atlas-ux-test | auto | UX test swarm, full UI/UX test pass, persona testing, pre-release frontend sweep |
| 6 | atlas-component | auto | Build one reusable component that survives latency, cancellation, partial failure |
| 7 | atlas-db-audit | auto | Read-only database audit: schema, reconciliation, privileges, naming |
| 8 | atlas-debug | auto | Chase down and fix a reproducible bug with root-cause evidence |
| 9 | atlas-feature | auto | Build a full-stack feature (UI + API + data) with verified evidence |
| 10 | atlas-frontend | auto | Build or refactor UI on shadcn/ui + Tailwind + Radix with every state verified |
| 11 | atlas-gitignore | auto | Generate a zero-trust deny-by-default .gitignore for a named stack |
| 12 | atlas-handoff | auto | Produce a dense session handoff so a fresh session resumes with zero re-discovery |
| 13 | atlas-harden | auto | Write an idempotent CHECK/SET/VERIFY remediation script for RMM/MDM |
| 14 | atlas-launch | auto | Launch a remediation session preloaded with a finding from the latest audit hub |
| 15 | atlas-m365 | auto | Deliver a production-ready M365/Entra/Graph/Intune/Exchange config with read-back |
| 16 | atlas-prompt | auto | Rewrite a vague coding request into a structured, environment-aware prompt |
| 17 | atlas-readme | auto | Generate an onboarding-grade README.md by inspecting the actual repo |
| 18 | atlas-refactor | auto | Reorganize structure, naming, and layout without changing observable behavior |
| 19 | atlas-validate | auto | Audit a Claude Code plugin for structure, manifest validity, content quality |
| 20 | atlas-vendor-assessment | auto | Evidence-based vendor security assessment against a named framework |
| 21 | atlas-wiki | auto | Generate and refresh docs/wiki/ diagrams from architecture docs via the graphify skill |

## Count check

- Atlas skills: 21 (1 manual, 20 auto)
- Manual skill: atlas-setup

## Armada (separate plugin)

Org deployment moved to the separate `armada` plugin: 11 department
agents and 156 department skills (Data, Design, Engineering, Finance,
HR, IT Operations, Microsoft 365, Product, Productivity, Security,
Support). Install it alongside atlas only for org use; when installed,
its skills are all auto and route through the department agents in
`plugins/armada/agents/`.

## What atlas-setup reports on first run

After scaffolding, atlas-setup tells the user:

1. That atlas-setup itself is the one manual skill and how to invoke it.
2. That the other 20 skills are auto-trigger and will start when the task
   matches their descriptions.
3. Whether the armada plugin is installed, and that org deployment lives
   there if the user needs it.
