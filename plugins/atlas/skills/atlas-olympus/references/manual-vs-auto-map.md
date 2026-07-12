# Manual vs Auto Map

The full inventory of all 184 atlas skills. This is the routing table
atlas-olympus uses to tell the user what just came online.

## Trigger model

There are exactly TWO manual skills in the entire atlas plugin. Every
other skill auto-triggers from its `description` + `when_to_use`.

- **Manual** = `disable-model-invocation: true`. The model cannot start
  it. The user must invoke it explicitly (slash command or direct call).
- **Auto** = the model may start it when the task matches the description.

| # | Skill | Mode | One-line trigger |
|---|---|---|---|
| 1 | atlas-olympus | MANUAL | First-run onboarding: scaffold .atlas/docs/, enforce mastery framework, wire graphify, report what is online |
| 2 | atlas-doctor | MANUAL | Repair a broken atlas install: marketplace, rollbacks, hooks/agents/skills |
| 3 | atlas-metis | auto | Orchestrate any multi-step build/fix/audit/refactor through subagents with verification |
| 4 | atlas-hephaestus | auto | Boot and configure a project so the full atlas runtime is active |
| 5 | atlas-ariadne | auto | Map a codebase into feature-grouped flowcharts and find architectural duplication |
| 6 | atlas-athena | auto | Comprehensive code-quality and security audit (OWASP, SOLID, DRY, dead code, drift) |
| 7 | atlas-argus | auto | Measure run health, audit context/asset waste, mine session transcripts |
| 8 | atlas-chronos | auto | Match a recurring or iterative task to a reusable loop and instantiate it |
| 9 | atlas-hermes | auto | Guided setup for the ten vendor MCP connectors across owning domain plugins |
| 10 | atlas-odysseus | auto | UX test swarm, full UI/UX test pass, persona testing, pre-release frontend sweep |
| 11 | atlas-nestor | auto | Interactive skill-stacking concierge: compose skills into an ordered stack |
| 12 | atlas-armada | auto | Org deployment: provision roles, departments, branding, compliance, connectors |
| 13 | atlas-component | auto | Build one reusable component that survives latency, cancellation, partial failure |
| 14 | atlas-db-audit | auto | Read-only database audit: schema, reconciliation, privileges, naming |
| 15 | atlas-debug | auto | Chase down and fix a reproducible bug with root-cause evidence |
| 16 | atlas-feature | auto | Build a full-stack feature (UI + API + data) with verified evidence |
| 17 | atlas-frontend | auto | Build or refactor UI on shadcn/ui + Tailwind + Radix with every state verified |
| 18 | atlas-gitignore | auto | Generate a zero-trust deny-by-default .gitignore for a named stack |
| 19 | atlas-handoff | auto | Produce a dense session handoff so a fresh session resumes with zero re-discovery |
| 20 | atlas-harden | auto | Write an idempotent CHECK/SET/VERIFY remediation script for RMM/MDM |
| 21 | atlas-launch | auto | Launch a remediation session preloaded with a finding from the latest audit hub |
| 22 | atlas-m365 | auto | Deliver a production-ready M365/Entra/Graph/Intune/Exchange config with read-back |
| 23 | atlas-prompt | auto | Rewrite a vague coding request into a structured, environment-aware prompt |
| 24 | atlas-readme | auto | Generate an onboarding-grade README.md by inspecting the actual repo |
| 25 | atlas-refactor | auto | Reorganize structure, naming, and layout without changing observable behavior |
| 26 | atlas-validate | auto | Audit a Claude Code plugin for structure, manifest validity, content quality |
| 27 | atlas-vendor-assessment | auto | Evidence-based vendor security assessment against a named framework |
| 28 | atlas-wiki | auto | Generate and refresh .atlas/docs/wiki/ diagrams from architecture docs via the graphify skill |

## Armada fleet (156 skills across 11 departments)

All armada skills are AUTO. They route through atlas-armada and the
department agents. Each department is an agent in `plugins/atlas/agents/`.

### 1. Data (7 skills)

data-context-extractor, data-exploration, data-validation,
data-visualization, interactive-dashboard-builder, sql-queries,
statistical-analysis

### 2. Design (8 skills)

accessibility-review, codebase-organization, design-handoff,
design-system-management, readme-generation, ui-design-system,
user-research, ux-writing

### 3. Engineering (16 skills)

code-quality-sweep, code-review, cowork-plugin-customizer,
create-cowork-plugin, dead-code-cleanup, documentation,
incident-response, observability, sentry-api-patterns,
sentry-error-investigation, sentry-issue-triage,
sentry-release-health, sentry-seer-root-cause, system-design,
tech-debt, testing-strategy

### 4. Finance (17 skills)

audit-support, close-management, financial-statements,
journal-entry-prep, pandadoc-api-patterns, pandadoc-documents,
pandadoc-proposals, pandadoc-recipients, pandadoc-templates,
pax8-api-patterns, pax8-companies, pax8-invoices, pax8-orders,
pax8-products, pax8-subscriptions, reconciliation, variance-analysis

### 5. HR (10 skills)

compensation-benchmarking, employee-handbook, interview-prep,
org-planning, paylocity-deduction-and-tax-overview,
paylocity-new-hire-flow, paylocity-pay-rate-audit,
paylocity-roster-snapshot, people-analytics, recruiting-pipeline

### 6. IT Operations (27 skills)

change-management, compliance-tracking, process-optimization,
resource-planning, risk-assessment, vendor-management, auvik-alerts,
auvik-api-patterns, auvik-devices, auvik-networks, ninjaone-alerts,
ninjaone-api-patterns, ninjaone-devices, ninjaone-organizations,
ninjaone-tickets, psa-api-patterns, psa-companies, psa-contacts,
psa-product-catalog, psa-projects, psa-tickets, psa-time-entries,
spanning-api-patterns, spanning-audit-forensics,
spanning-backup-health-sweep, spanning-license-utilization,
spanning-restore-orchestrator

### 7. Microsoft 365 (19 skills)

api-patterns, calendar, cipp-alerts, cipp-groups, cipp-licenses,
cipp-mailboxes, cipp-ops, cipp-security, cipp-standards,
cipp-tenants, cipp-users, files, graph-connection, graph-querying,
licensing, mailboxes, security, teams, users

### 8. Product (14 skills)

asana-api-patterns, asana-my-tasks-triage, asana-portfolio-rollup,
asana-sprint-planning, asana-stakeholder-update,
asana-standup-generator, competitive-brief, metrics-review,
product-brainstorming, roadmap-update, sprint-planning,
stakeholder-update, synthesize-research, write-spec

### 9. Productivity (9 skills)

brand-discover-brand, brand-guideline-generation,
brand-voice-enforcement, memory-management, pdf-view,
search-knowledge-synthesis, search-source-management,
search-strategy, task-management

### 10. Security (24 skills)

approval-queue-triage, audit-forensics, blumira-agents,
blumira-api-patterns, blumira-findings, blumira-msp,
blumira-resolutions, blumira-users, evidence-gap-hunter,
framework-audit-readiness, knowbe4-api-patterns, knowbe4-phishing,
knowbe4-reporting, knowbe4-training, knowbe4-users, risk-heatmap,
threatlocker-api-patterns, threatlocker-approval-requests,
threatlocker-audit-log, threatlocker-computer-groups,
threatlocker-computers, threatlocker-organizations,
vanta-vendor-risk-rollup, vanta-vulnerability-triage

### 11. Support (5 skills)

customer-research, escalation, knowledge-management,
response-drafting, ticket-triage

## Count check

- Top-level skills: 28 (2 manual, 26 auto)
- Armada skills: 156 (all auto)
- Total: 184
- Manual skills: 2 (atlas-olympus, atlas-doctor)

## What olympus reports on first run

After scaffolding, olympus tells the user:

1. Which 2 skills are manual (olympus itself and doctor) and how to invoke
   them.
2. That the other 26 top-level skills are auto-trigger and will start when
   the task matches their descriptions.
3. That the 156 armada skills are available behind atlas-armada and route
   through the 11 department agents.

This table is the source of that report.