# tech-tools plugins

This directory holds the plugin collection for the `tech-tools` monorepo. Each plugin is a domain cluster that bundles the vendor connectors and skills for one business area, from MSP IT operations and security/compliance to Microsoft 365, HR/payroll, finance, and the engineering and productivity surfaces. The `atlas` plugin is the multi-agent coding meta-agent that drives verification-gated work across the repo. Every plugin listed below exists as a directory under `plugins/`.

## Available plugins

| Plugin | What it does | Key vendors |
|--------|--------------|-------------|
| `atlas` | Self-configuring multi-agent coding architect: research to verify methodology, a subagent squad, automation hooks, and verification-gated `/atlas-*` launcher commands. | (no external vendor connectors) |
| `it-operations` | MSP IT operations across RMM, PSA, networking, and backup, plus change management, risk, and vendor-management skills. | NinjaOne, ConnectWise Manage (PSA), Auvik, Kaseya Spanning |
| `security-compliance` | Security and compliance operations: audit readiness, evidence-gap tracking, risk heatmaps, and approval triage. | Vanta, KnowBe4, ThreatLocker, Blumira |
| `microsoft-365` | Microsoft 365 administration and identity: users, mailboxes, Teams, OneDrive, licensing, security posture, and multi-tenant management. | CIPP, Microsoft Graph / Entra |
| `hr-payroll` | HR and payroll operations: roster snapshots, new-hire flow, pay-rate and deduction/tax audits, plus compensation, recruiting, and people-analytics skills. | Paylocity |
| `finance` | Finance and revenue operations: proposals and contracts, licensing and invoicing, plus financial-close, reconciliation, variance, and SOX audit skills. | PandaDoc, Pax8 |
| `engineering` | Software engineering skills: code review, system design, incident response, testing strategy, and tech-debt management. | (no external vendor connectors) |
| `data` | Data work: explore datasets, write SQL, validate data quality, build visualizations, and generate interactive dashboards. | (no external vendor connectors) |
| `design` | Design and UX work: accessibility review, design critique, design-system management, UX copy, and user-research synthesis. | (no external vendor connectors) |
| `product-management` | Product management: feature specs, roadmap planning, user-research synthesis, stakeholder updates, and competitive landscape. | (no external vendor connectors) |
| `customer-support` | Support operations: triage tickets, draft responses, research questions, manage escalations, and build knowledge-base articles. | (no external vendor connectors) |
| `productivity` | Workplace productivity utilities: memory and task tracking, enterprise search and knowledge synthesis, PDF viewing/form-filling/signing, brand-voice enforcement, and nudge reminders. | (no external vendor connectors) |

## Install and usage

These plugins are published from the `w159/tech-tools` repository through the marketplace defined in `.claude-plugin/marketplace.json` at the repo root. Add the marketplace in Claude Code with the `/plugin` command, then install the plugins you need (for example `it-operations`, `security-compliance`, or `microsoft-365`).

Kimi Code CLI users can browse the custom marketplace with `/plugins marketplace https://raw.githubusercontent.com/w159/tech-tools/main/.kimi-plugin/marketplace.json` (or pass the local path `.kimi-plugin/marketplace.json` when running from the repo root), then install the plugins you need. You can also install a single plugin directly with `/plugins install https://github.com/w159/tech-tools/tree/main/plugins/<name>`.

Vendor-backed plugins (`it-operations`, `security-compliance`, `microsoft-365`, `hr-payroll`, `finance`) need API credentials for their connectors. The credential keys live in `.env.template` at the repo root; copy it to `.env` and fill in the values for the vendors you use. Base URL keys are optional for vendors that ship a documented default. Skill-only plugins (`engineering`, `data`, `design`, `product-management`, `customer-support`, `productivity`, `atlas`) run without external credentials.
