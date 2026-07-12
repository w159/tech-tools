# Role Routing

Maps the org's roles and departments to the atlas skills, agents, and vendor
connectors each department uses.

## Department routing table

| Department | Skills available | Agents | Vendor connectors |
|---|---|---|---|
| it-operations | change-management, compliance-tracking, process-optimization, resource-planning, risk-assessment, vendor-management, auvik-*, ninjaone-*, psa-*, spanning-* | armada:it-ops | NinjaOne, ConnectWise, Auvik, Spanning |
| security | approval-queue-triage, audit-forensics, blumira-*, evidence-gap-hunter, framework-audit-readiness, knowbe4-*, risk-heatmap, threatlocker-*, vanta-* | armada:security | Vanta, KnowBe4, ThreatLocker, Blumira |
| microsoft-365 | api-patterns, calendar, cipp-*, graph-*, licensing, mailboxes, security, teams, users, files | armada:m365 | CIPP |
| hr | compensation-benchmarking, employee-handbook, interview-prep, org-planning, paylocity-*, people-analytics, recruiting-pipeline | armada:hr | Paylocity |
| finance | audit-support, close-management, financial-statements, journal-entry-prep, pandadoc-*, pax8-*, reconciliation, variance-analysis | armada:finance | PandaDoc, Pax8 |
| engineering | code-quality-sweep, code-review, cowork-plugin-*, create-cowork-plugin, dead-code-cleanup, documentation, incident-response, observability, sentry-*, system-design, tech-debt, testing-strategy | armada:engineering | (none) |
| data | data-context-extractor, data-exploration, data-validation, data-visualization, interactive-dashboard-builder, sql-queries, statistical-analysis | armada:data | (none) |
| design | accessibility-review, codebase-organization, design-handoff, design-system-management, readme-generation, ui-design-system, user-research, ux-writing | armada:design | (none) |
| product | asana-*, competitive-brief, metrics-review, product-brainstorming, roadmap-update, sprint-planning, stakeholder-update, synthesize-research, write-spec | armada:product | (none) |
| support | customer-research, escalation, knowledge-management, response-drafting, ticket-triage | armada:support | (none) |
| productivity | brand-*, memory-management, pdf-view, search-*, task-management | armada:productivity | (none) |

## Routing logic

When a user's task matches a department's domain, armada routes to that
department's agent and skills:

1. **Detect the user's role** from the org config or ask if ambiguous
2. **Match the task** to the department whose domain covers it
3. **Load the department agent** with org branding and policy context
4. **Route the user** to the department's skills and commands
5. **If a connector is needed**, check if it is provisioned; if not, guide
   setup via connector-provisioning.md

## Role detection

Armada detects the user's role from:
1. The org config's `departments.active` list (if only one is active, use it)
2. The user's explicit statement ("I work in HR", "I need security audit tools")
3. The task's domain signals (ticket triage -> support, OWASP audit -> security,
   payroll audit -> hr, etc.)

If the role is ambiguous after all detection paths, ask ONE AskUserQuestion
with the active departments as options.

## Cross-department work

When a task spans departments (e.g. a security change that requires IT ops
deployment), armada:
1. Identifies the primary department (the one that owns the action)
2. Notifies the secondary department's agent for context
3. The primary department agent leads; the secondary provides input
4. Both agents operate under the org's branding and policies