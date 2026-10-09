# armada

The organizational layer over `atlas`. Set up your org's branding once, activate
the departments you actually run, and every coding agent working in the repo
carries the org's identity, policies, and toolset.

Install alongside `atlas`. Single-project engineering work does not need it.

## Setup, in order

Four skills, each invocable on its own. Branding first, department second.

| | Command | Writes | Does |
|---|---|---|---|
| 1 | `/armada:armada-brand` | `.atlas/org-config.yaml` | Org name, voice and tone, colors, commit style, doc template. Detects from the repo (package.json, README, tailwind config, git log) and asks at most one question about what it could not detect. |
| 2 | `/armada:armada-department <name>` | `.atlas/departments/<name>.yaml` | Activates one of the 11 departments and its agent. Run with no argument to list departments and their state. |
| 3 | `/armada:armada-connect <vendor>` | `.atlas/departments/<name>.yaml` | Vendor MCP connectors: what is live, what is missing credentials, the exact `/plugin config` keys to fix it. |
| - | `/armada:armada` | nothing | Read-only status scan: what is configured, what is missing, the single next command. |

`/armada:armada` never runs a setup interview. It scans and routes.

## The 11 departments

| Department | Covers | Agent | Connectors |
|---|---|---|---|
| it-operations | MSP IT ops: RMM, PSA, networking, backup | `armada-it-ops` | NinjaOne, ConnectWise, Auvik, Spanning |
| security | GRC, SIEM, EDR, awareness training | `armada-security` | Vanta, KnowBe4, ThreatLocker, Blumira |
| microsoft-365 | M365 administration and identity | `armada-m365` | CIPP |
| hr | HR and payroll operations | `armada-hr` | Paylocity |
| finance | Finance and revenue ops | `armada-finance` | PandaDoc, Pax8 |
| engineering | Software engineering, code review, incident response | `armada-engineering` | none |
| data | Data exploration, SQL, visualization, dashboards | `armada-data` | none |
| design | UX, accessibility, design systems | `armada-design` | none |
| product | Product management, roadmaps, research | `armada-product` | none |
| support | Customer support, ticket triage, KB | `armada-support` | none |
| productivity | Memory, tasks, search, PDF, brand voice | `armada-productivity` | none |

## How department content is used

Activating a department copies nothing into your project. The department's
skills and commands stay in the plugin tree at
`skills/armada/departments/<dept>/` and are the reference library its agent
reads on demand; `.atlas/departments/<dept>.yaml` is the activation record. One
copy of the content, so it cannot drift from the plugin.

Those department files are **not** slash commands in your project. To do
department work, invoke the agent: `Agent(subagent_type: "armada:armada-design")`,
or describe the task and let `references/role-routing.md` pick the agent.

## Credentials

Armada declares no `userConfig` and no `mcpServers`. Every vendor credential
lives on the `atlas` plugin, set through `/plugin config` on atlas. The
per-vendor key list is in
`skills/armada/references/connector-provisioning.md`. Armada never accepts a
credential typed into chat and never writes one into `.atlas/`.

## Layout

```
plugins/armada/
  skills/armada/            status + router (read-only)
  skills/armada-brand/      step 1
  skills/armada-department/ step 2
  skills/armada-connect/    step 3
  agents/                   11 department agents
  skills/armada/departments/<dept>/   per-department skill + command library
  skills/armada/references/ org-config schema, department schema, role routing,
                            connector provisioning
  skills/armada/templates/  department-onboarding.seed.yaml
  tests/test_armada_contract.py
```

Only `skills/<name>/SKILL.md` and `agents/` are discovered by Claude Code.
Anything nested deeper is reference material, by design. The contract test
enforces that the four setup skills stay at the discoverable level:

```
python3 plugins/armada/tests/test_armada_contract.py
```
