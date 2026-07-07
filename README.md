# tech-tools

A Claude Code plugin marketplace and monorepo: twelve domain-cluster plugins covering
MSP IT operations, security and compliance, Microsoft 365, HR/payroll, finance,
engineering, design, data, customer support, product management, and productivity,
plus the `atlas` multi-agent coding architect. Each vendor connector is bundled into
the business domain plugin it serves rather than shipped standalone (`.claude-plugin/marketplace.json:4`).

## Install

Plugins are published from the `w159/tech-tools` repository through the marketplace
manifest at `.claude-plugin/marketplace.json`. In Claude Code, add the marketplace with
the `/plugin` command, then install the plugins you need, for example `it-operations`,
`security-compliance`, or `microsoft-365` (`plugins/README.md:24`).

Kimi Code CLI users can browse the same catalog from the repo root with
`/plugins marketplace .kimi-plugin/marketplace.json`, then install the plugins you need.
A single plugin can also be installed directly with `/plugins install ./plugins/<name>`
run from the repo root. Kimi Code CLI's current installer does not support remote GitHub
subpath installs, so distributing from this monorepo requires a local clone or per-plugin
zip artifacts (`plugins/README.md:26`).

Vendor-backed plugins (`it-operations`, `security-compliance`, `microsoft-365`,
`hr-payroll`, `finance`) need API credentials for their connectors. Credential keys live
in `.env.template` at the repo root; copy it to `.env` and fill in the values for the
vendors you use. Skill-only plugins (`engineering`, `data`, `design`,
`product-management`, `customer-support`, `productivity`, `atlas`) run without external
credentials (`plugins/README.md:28`).

## Plugin catalog

| Plugin | What it does | Key vendors |
|--------|--------------|-------------|
| `atlas` | Self-configuring multi-agent coding architect: research-to-verify methodology, a subagent squad, automation hooks, and verification-gated `/atlas-*` launcher commands. | none |
| `it-operations` | MSP IT operations across RMM, PSA, networking, and backup, plus change management, risk, and vendor-management skills. | NinjaOne, ConnectWise Manage, Auvik, Kaseya Spanning |
| `security-compliance` | Security and compliance operations: audit readiness, evidence-gap tracking, risk heatmaps, approval triage. | Vanta, KnowBe4, ThreatLocker, Blumira |
| `microsoft-365` | Microsoft 365 administration and identity: users, mailboxes, Teams, OneDrive, licensing, security posture, multi-tenant management. | CIPP, Microsoft Graph / Entra |
| `hr-payroll` | HR and payroll operations: roster snapshots, new-hire flow, pay-rate and deduction/tax audits, plus compensation and people-analytics skills. | Paylocity |
| `finance` | Finance and revenue operations: proposals, contracts, licensing, invoicing, financial close, reconciliation, variance, SOX audit. | PandaDoc, Pax8 |
| `engineering` | Code review, system design, incident response, testing strategy, tech-debt management, Cowork plugin authoring. | none |
| `data` | Explore datasets, write SQL, validate data quality, build visualizations, generate interactive dashboards. | none |
| `design` | Accessibility review, design critique, design-system management, UX copy, user-research synthesis. | none |
| `product-management` | Feature specs, roadmap planning, user-research synthesis, stakeholder updates, competitive landscape. | none |
| `customer-support` | Ticket triage, response drafting, question research, escalation management, knowledge-base articles. | none |
| `productivity` | Memory and task tracking, enterprise search, PDF viewing/form-filling/signing, brand-voice enforcement, nudge reminders. | none |

Source: `.claude-plugin/marketplace.json:10-237` and `plugins/README.md:7-20`.

## atlas

`atlas` is the multi-agent coding architect in this repo. Typing `/atlas` boots and
configures a project: it verifies or installs claude-mem and context-mode, scans the
stack to recommend skills, plugins, and MCP connectors, confirms hooks are wired, and
seeds `docs/` as the single source of truth. From there, work runs through the
`/atlas-*` command launchers and the `atlas:<role>` subagent squad under an
evidence-before-done operating contract. Atlas ships no vendor MCP connectors itself;
the ten vendor connectors live in the four domain plugins listed below, and the
`atlas-harbor` skill guides setup across them. See `plugins/atlas/README.md` for the
full skill, agent, and hook inventory.

## Vendor MCP connectors

Ten vendor connectors are single-sourced into the domain plugin that owns them
(`plugins/README.md:10-13`, `plugins/atlas/README.md:21`):

- `it-operations`: NinjaOne, ConnectWise Manage, Auvik, Kaseya Spanning
- `security-compliance`: Vanta, KnowBe4, ThreatLocker, Blumira
- `microsoft-365`: CIPP
- `hr-payroll`: Paylocity

The underlying server implementations live under `mcp_servers/<vendor>-mcp/`, with
supporting Node client libraries under `mcp_node/node-<vendor>/` where a server needs one.

## docs/ is the single source of truth

`docs/CHANGELOG.md` is the newest-first record of every shipped change, and
`docs/ROADMAP.md` tracks backlog and in-progress items. `docs/audits/` holds per-audit
evidence folders (for example `docs/audits/atlas-harden-2026-07-07/`) with orientation
notes, decisions, and stage reports for changes that went through the atlas audit
process. `docs/AGENTS.md` and the root `AGENTS.md` define the propagation rules that
keep MCP servers, Node libraries, plugins, and this README in sync whenever a vendor
tool changes.

## Repository layout

```
tech-tools/
|-- .claude-plugin/        # marketplace.json - the Claude Code plugin marketplace manifest
|-- .kimi-plugin/          # marketplace.json - the Kimi Code CLI marketplace manifest
|-- plugins/               # one directory per domain-cluster plugin (see catalog above)
|-- mcp_servers/           # MCP server implementations, one directory per vendor
|-- mcp_node/              # Node client libraries the MCP servers depend on
|-- skills/                # standalone skills not tied to a single plugin
|-- docs/                  # CHANGELOG, ROADMAP, audits, vendor and framework references
|-- img/                   # repo imagery
|-- AGENTS.md              # canonical agent operating rules for this repo
|-- CONTRIBUTING.md        # layout and contribution guide
`-- .env.template          # credential key template for vendor-backed plugins
```
