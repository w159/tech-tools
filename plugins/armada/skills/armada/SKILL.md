---
name: armada
description: 'Organizational deployment status and router for the atlas fleet. Reports what is configured (branding, active departments, connectors) and routes to the skill that fixes what is missing. Setup itself lives in armada-brand (branding, run first), armada-department (activate a department), and armada-connect (vendor connectors).'
when_to_use: checking an org's atlas deployment state, or finding the right armada setup command
allowed-tools: Read, Glob, Grep, Bash
argument-hint: '[blank for status]'
---

# armada - the organizational fleet

Armada is the organizational layer over atlas. Branding and departments are set
up here so that every coding agent working in this repo carries the org's
identity, policies, and toolset.

Armada does not orchestrate coding work. That is `atlas-orchestrate`.

## This skill only reports and routes

Setup happens in three skills, in this order:

| Order | Skill | Does |
|---|---|---|
| 1 | `/armada:armada-brand` | org name, voice, colors, commit style -> `.atlas/org-config.yaml` |
| 2 | `/armada:armada-department` | activate a department -> `.atlas/departments/<dept>.yaml` + its agent |
| 3 | `/armada:armada-connect` | vendor MCP connectors for a department |

Do not run a guided setup from this skill and do not ask the user which of the
three they want. Scan, report, and name the next command. They run it.

## The scan

Run these in one pass and build the report from the results. Everything below
is detected, never asked:

```bash
cat .atlas/org-config.yaml 2>/dev/null
ls .atlas/departments/*.yaml 2>/dev/null
ls "${CLAUDE_PLUGIN_ROOT}/agents"
ls "${CLAUDE_PLUGIN_ROOT}/skills/armada/departments"
```

Report, compactly:

1. **Branding** - configured (org name, voice) or missing.
2. **Departments** - a row per active department: name, owning agent, count of
   skills and commands it carries, connector state. Then one line naming how
   many of the 11 are available but not activated.
3. **Connectors** - live in session (`mcp__plugin_atlas_<vendor>__*` tools
   present) versus recorded but not loaded versus not provisioned.
4. **Next** - exactly one recommended command, chosen by the first gap in the
   order above.

Install nothing. Write nothing. Changing state is the other three skills' job.

## The org config

`.atlas/org-config.yaml` is the single source of truth for organizational
identity. Full schema:
`${CLAUDE_PLUGIN_ROOT}/skills/armada/references/org-config-schema.md`.

- **org / branding**: name, logo, voice and tone, colors, commit style
- **policies**: compliance frameworks (SOC 2, HIPAA, ISO 27001), coding and
  documentation standards, approval workflows
- **departments.active**: which of the 11 departments this org runs
- **connectors.provisioned**: which vendors are set up, and for which department.
  Credentials are never stored here; they live on the atlas plugin's userConfig.

## The 11 departments

| Department | Covers | Agent | Connectors |
|---|---|---|---|
| it-operations | MSP IT ops: RMM, PSA, networking, backup | armada-it-ops | NinjaOne, ConnectWise, Auvik, Spanning |
| security | GRC, SIEM, EDR, awareness training | armada-security | Vanta, KnowBe4, ThreatLocker, Blumira |
| microsoft-365 | M365 administration and identity | armada-m365 | CIPP |
| hr | HR and payroll operations | armada-hr | Paylocity |
| finance | Finance and revenue ops | armada-finance | PandaDoc, Pax8 |
| engineering | Software engineering, code review, incident response | armada-engineering | none |
| data | Data exploration, SQL, visualization, dashboards | armada-data | none |
| design | UX, accessibility, design systems | armada-design | none |
| product | Product management, roadmaps, research | armada-product | none |
| support | Customer support, ticket triage, KB | armada-support | none |
| productivity | Memory, tasks, search, PDF, brand voice | armada-productivity | none |

Routing table: `${CLAUDE_PLUGIN_ROOT}/skills/armada/references/role-routing.md`.
Department config fields:
`${CLAUDE_PLUGIN_ROOT}/skills/armada/references/department-schema.md`.

## How the departments actually get used

Each active department has an agent (`armada-<slug>`, in
`${CLAUDE_PLUGIN_ROOT}/agents/`) that carries the org's branding and policies.
Its skills and commands live in the plugin tree under
`skills/armada/departments/<dept>/` and are the agent's reference library, read
on demand. They are not slash commands in your project, and activating a
department copies nothing into it - the department yaml is the activation
record.

To do department work: `Agent(subagent_type: "armada:armada-design", ...)`, or
just describe the task and let the routing table pick the agent.

## Branding and policy enforcement

Branding is loaded into the department agent before work begins, so output is
branded from the start rather than rewritten after. It governs docs, code
comments, commit messages, and report templates.

Policies work the same way: with compliance frameworks configured, agents cite
the applicable framework, flag compliance-sensitive actions (data access,
security changes, financial entries) for approval per the org's workflows, and
produce the required artifacts (change logs, approval tickets, evidence) as
part of the work.

## First move

Run the scan. Print the status table and the single next command. Stop there.
