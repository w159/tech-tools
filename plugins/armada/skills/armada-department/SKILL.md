---
name: armada-department
description: 'Activate a department for this org: write .atlas/departments/<dept>.yaml, mark it active in the org config, and light up its department agent and skill library. Covers the 11 armada departments (it-operations, security, microsoft-365, hr, finance, engineering, data, design, product, support, productivity). Run with no argument to list departments and their state.'
when_to_use: onboarding a department or role, listing which departments are active, or deactivating one
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, AskUserQuestion
paths: [".atlas/departments/", ".atlas/org-config.yaml"]
argument-hint: '[department name | blank to list | "off <department>"]'
---

Department: $ARGUMENTS

## No argument: list, do not interrogate

With no argument, print the table below with a real state column and stop. Do
not ask what the user wants. Derive state from disk:

- active if `.atlas/departments/<dept>.yaml` exists with `active: true`
- available otherwise

```bash
ls .atlas/departments/*.yaml 2>/dev/null
ls "${CLAUDE_PLUGIN_ROOT}/skills/armada/departments"
```

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

Close the listing with the one-line next action: `/armada:armada-department
<name>` to activate one.

## Branding comes first

Before writing any department config, check `.atlas/org-config.yaml` for a
`branding:` block. If it is missing, say so in one line and run
`armada-brand` first: a department activated without branding produces generic
output, which is the thing armada exists to prevent. Do not silently continue.

## Activating a department

1. **Resolve the name.** Match the argument against the 11 department dirs,
   accepting the obvious aliases (`it`/`itops` to `it-operations`, `m365`/`o365`
   to `microsoft-365`, `sec` to `security`, `eng`/`dev` to `engineering`,
   `ux`/`ui` to `design`, `cs`/`helpdesk` to `support`, `people` to `hr`).
   Ambiguous match: ask once with the candidates, then proceed.

2. **Read the real contents.** Do not guess what the department carries:
   ```bash
   D="${CLAUDE_PLUGIN_ROOT}/skills/armada/departments/<dept>"
   ls "$D/skills"; ls "$D/commands"; cat "$D/department-config.json"
   test -f "$D/.mcp.json" && grep -o '"[a-z0-9-]*": {' "$D/.mcp.json"
   ```

3. **Write `.atlas/departments/<dept>.yaml`,** seeded from
   `${CLAUDE_PLUGIN_ROOT}/skills/armada/templates/department-onboarding.seed.yaml`.
   Fill every `<placeholder>` from step 2 - the `skills:` and `commands:` lists
   mirror the actual directory listings, never an invented set.

   ```yaml
   department: design
   display_name: "Design"
   owning_agent: "armada-design"
   active: true
   skills: [accessibility-review, design-handoff, ...]   # from ls skills/
   commands: [critique, design-system, handoff, ...]     # from ls commands/
   connectors: []                                        # from .mcp.json, status: disabled
   # branding: and policies: omitted - inherit from org-config.yaml
   ```

4. **Mark it active** in `.atlas/org-config.yaml` under `departments.active`,
   appending without disturbing any other key.

5. **Do not copy files into the project.** Department skills and commands stay
   in the plugin tree and are read by the department agent as its reference
   library. The yaml is the activation record; there is one copy of the content
   and it never drifts.

## Deactivating

`off <department>`: set `active: false` in the department yaml and remove the
entry from `departments.active`. Leave the file in place so its connector state
survives; say plainly that the file was kept.

## Verify before you report

1. `cat .atlas/departments/<dept>.yaml` - show the written file.
2. It parses:
   `python3 -c "import yaml;d=yaml.safe_load(open('.atlas/departments/<dept>.yaml'));print(d['department'],d['active'],len(d['skills']),'skills')"`
3. The owning agent file exists:
   `ls "${CLAUDE_PLUGIN_ROOT}/agents/<owning_agent>.md"`
4. Every name in `skills:` and `commands:` resolves to a real path under the
   department dir. Any that does not is a defect in the yaml, not a note.

## Report

Department activated, path written, the agent to invoke
(`Agent(subagent_type: "armada:<agent>")`), the count of skills and commands it
now carries, and - only if the department has connectors - one line:
`Connectors pending: /armada:armada-connect <department>`.
