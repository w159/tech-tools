# Department Schema

The 11 atlas departments, their domains, owning agents, and the fields every
department config carries. This is the canonical list armada uses for
onboarding and routing. See `role-routing.md` for the full skills/agents
mapping per department.

## The 11 departments

| Department dir | Display name | Domain | Owning agent | Vendor connectors |
|---|---|---|---|---|
| it-operations | IT Operations | MSP IT ops: RMM, PSA, networking, backup | armada:it-ops | NinjaOne, ConnectWise, Auvik, Spanning |
| security | Security and Compliance | GRC, SIEM, EDR, awareness | armada:security | Vanta, KnowBe4, ThreatLocker, Blumira |
| microsoft-365 | Microsoft 365 | M365 administration and identity | armada:m365 | CIPP |
| hr | HR and Payroll | HR and payroll operations | armada:hr | Paylocity |
| finance | Finance and Revenue Ops | Finance, proposals, licensing, invoicing | armada:finance | PandaDoc, Pax8 |
| engineering | Engineering | Software engineering, code review, incidents | armada:engineering | (none) |
| data | Data | Data exploration, SQL, visualization, dashboards | armada:data | (none) |
| design | Design | UX, accessibility, design systems | armada:design | (none) |
| product | Product | Product management, roadmaps, research | armada:product | (none) |
| support | Support | Customer support, ticket triage, KB | armada:support | (none) |
| productivity | Productivity | Memory, tasks, search, PDF, brand voice | armada:productivity | (none) |

## Department config fields

Each department has a config file at `.atlas/departments/<department>.yaml`
(activated by armada during onboarding). The seed is
`templates/department-onboarding.seed.yaml`.

| Field | Type | Required | Description |
|---|---|---|---|
| department | string | yes | The department dir, one of the 11 above |
| display_name | string | yes | Human-readable department name |
| owning_agent | string | yes | The armada agent slug, e.g. `armada:it-ops` |
| active | bool | yes | Whether this department is live for the org |
| skills | list | yes | Skill dirs exposed under this department |
| commands | list | yes | Command names exposed under this department |
| connectors | list | no | Vendor connectors provisioned for this department |
| connectors[].vendor | string | yes | Vendor dir, e.g. `ninjaone` |
| connectors[].status | string | yes | `disabled` or `enabled` |
| connectors[].required_keys | list | yes | userConfig keys required to enable (mirror vendors.md) |
| branding | map | no | Department-level branding overrides (inherit org if empty) |
| policies | map | no | Department-level policy overrides (inherit org if empty) |
| routing.notes | string | no | Department-specific routing guidance |

## Onboarding flow

1. Pick the department dir from the 11 above.
2. Copy `templates/department-onboarding.seed.yaml` to
   `.atlas/departments/<department>.yaml`.
3. Fill the skills and commands lists from the department's `departments/<dir>/`
   tree (skills/ and commands/ subdirs).
4. If the department has a vendor connector, add it under `connectors` and
   guide the user to provision credentials on the owning domain plugin via
   `/plugin config` (see `connector-provisioning.md`).
5. Set `active: true`.
6. Reload the department agent so it picks up the new config.

## Connector credentials are never in the department config

The `connectors` block records which connectors are provisioned; it does not
hold credentials. Credentials live in the owning domain plugin's `userConfig`,
set via `/plugin config`. This matches the org-config rule and the hermes
ownership rule.