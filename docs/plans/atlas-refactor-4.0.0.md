# Master Plan: Atlas 4.0.0 -- Marketplace Consolidation & Skill Renaming

> Note (2026-07-12): this plan is historical and pre-dates the v5.0.0 split.
> The Claude Code marketplace now lists 2 plugins (`atlas`, `armada`); the
> 12-plugin catalog is gone. See `docs/CHANGELOG.md` 2026-07-12 README rewrite
> follow-up entry for the current state.

Source: User directive 2026-07-11. Rename marketplace from tech-tools to atlas,
consolidate all 11 non-atlas plugins into atlas-armada, rename all atlas skills
with Greek mythology etymology, and eliminate the cartographer/survey/sextant
naming overlap.

## 1. Skill Rename Map

| Current name | New name | Mythology figure | Domain signal |
|---|---|---|---|
| atlas-metis | atlas-metis | Metis (Titaness of wisdom, counsel) | The strategist/orchestrator |
| atlas-hephaestus | atlas-hephaestus | Hephaestus (god of the forge) | The builder/configurator |
| atlas-ariadne | atlas-ariadne | Ariadne (the thread through the Labyrinth) | Maps paths through complex codebases |
| atlas-athena | atlas-athena | Athena (goddess of strategic defense) | Security and quality audit/defense |
| atlas-argus | atlas-argus | Argus Panoptes (hundred-eyed all-seeing giant) | Observability, metrics, session forensics |
| atlas-chronos | atlas-chronos | Chronos (personification of time/cycles) | Recurring/iterative loops |
| atlas-hermes | atlas-hermes | Hermes (messenger god, commerce/exchange) | Vendor MCP connector setup |
| atlas-odysseus | atlas-odysseus | Odysseus (the great voyager) | UX test swarm expedition |
| atlas-nestor | atlas-nestor | Nestor (wisest counselor, assembler of forces) | Skill-stack composer/concierge |
| (new) | atlas-armada | The Greek fleet; organized for a mission | Org roles, departments, branding, compliance |

### Overlap resolution

The three confusingly-named skills now have names from completely different
mythological domains:

- **Ariadne** -- navigation through complexity (was cartographer)
- **Athena** -- defense and strategic assessment (was survey)
- **Argus** -- all-seeing observation and measurement (was sextant)

No surface-level confusion is possible. Each name's mythology immediately
signals its function.

## 2. Plugin Consolidation

### Current state: 12 plugins

atlas, it-operations, security-compliance, microsoft-365, hr-payroll,
finance, engineering, data, design, product-management, customer-support,
productivity

### Target state: 1 plugin

atlas (the only plugin in the marketplace)

### What happens to each non-atlas plugin

All 11 non-atlas plugins consolidate into the atlas plugin under a new
**atlas-armada** skill with associated department/role agents. The content
moves as follows:

| Source plugin | Destination under atlas-armada | Content moved |
|---|---|---|
| it-operations | armada/departments/it-operations/ | 27 commands, 8 agents, 28 skills, 4 connectors |
| security-compliance | armada/departments/security/ | 18 commands, 7 agents, 24 skills, 4 connectors |
| microsoft-365 | armada/departments/microsoft-365/ | 10 commands, 6 agents, 19 skills, 1 connector |
| hr-payroll | armada/departments/hr/ | 8 commands, 1 agent, 12 skills, 1 connector |
| finance | armada/departments/finance/ | 14 commands, 4 agents, 20 skills, 2 connectors |
| engineering | armada/departments/engineering/ | 8 commands, 1 agent, 16 skills |
| data | armada/departments/data/ | 6 commands, 7 skills |
| design | armada/departments/design/ | 9 commands, 8 skills |
| product-management | armada/departments/product/ | 6 commands, 1 agent, 14 skills |
| customer-support | armada/departments/support/ | 5 commands, 5 skills |
| productivity | armada/departments/productivity/ | 12 commands, 5 agents, 9 skills |

### MCP server infrastructure

The mcp_servers/, mcp_node/, and mcp_servers/_shared/ directories stay in
place. They are the underlying implementation; only the plugin layer
consolidates. The .mcpb bundles currently in each plugin's mcp/ directory
move under the atlas plugin's mcp/ directory, organized by vendor.

### atlas-armada structure

```
plugins/atlas/skills/atlas-armada/
  SKILL.md                         # Org setup, role routing, compliance
  references/
    org-config-schema.md            # Branding, policies, compliance schema
    role-routing.md                 # Department -> skills/agents/connectors map
    connector-provisioning.md        # Vendor MCP per-department activation
  departments/
    it-operations/
      department.md                 # Role definition, policies, connectors
      skills/                       # All it-operations skills
      commands/                     # All it-operations commands
      agents/                       # All it-operations agents
    security/
      ...
    microsoft-365/
      ...
    hr/
      ...
    finance/
      ...
    engineering/
      ...
    data/
      ...
    design/
      ...
    product/
      ...
    support/
      ...
    productivity/
      ...
```

### atlas-armada agents

One agent per department, carrying that department's org context, policies,
and branding:

```
plugins/atlas/agents/
  armada-it-ops.md
  armada-security.md
  armada-m365.md
  armada-hr.md
  armada-finance.md
  armada-engineering.md
  armada-data.md
  armada-design.md
  armada-product.md
  armada-support.md
  armada-productivity.md
```

### atlas-armada SKILL.md scope

The armada skill handles:

1. **Org config loading** -- reads org branding (name, logo, voice, colors),
   policies, and compliance requirements from a config file
2. **Role/department routing** -- maps the user's role to the right skills,
   agents, and connectors for their department
3. **Branding enforcement** -- ensures docs, code comments, and outputs
   created by coding agents carry org branding
4. **Policy compliance** -- ensures end users follow org policies and
   procedures, guiding them correctly
5. **Connector provisioning** -- activates the right vendor MCP connectors
   per department, with org credentials
6. **Onboarding** -- when a new org deploys the plugin, armada sets up all
   roles and departments from the org config

## 3. Marketplace Rename

| File | Change |
|---|---|
| .claude-plugin/marketplace.json | name: "tech-tools" -> "atlas"; description updated; only atlas plugin listed |
| .kimi-plugin/marketplace.json | only atlas plugin listed |
| README.md | Full rewrite: "atlas" marketplace, single plugin |
| plugins/README.md | Full rewrite: single atlas plugin |
| CONTRIBUTING.md | Updated: single plugin, atlas marketplace |
| AGENTS.md | Updated: remove "tech-tools" references, update plugin list |
| docs/AGENTS.md | Updated: agent roster adds armada agents |
| .env.template | Stays: all vendor credentials still needed |
| .kimi-plugin/import-plan.json | Updated if still relevant |
| .kimi-plugin/import-report.json | Updated if still relevant |

### GitHub repo rename

The user will need to rename the GitHub repo from w159/tech-tools to
w159/atlas (or similar). The plugin.json `repository` and `homepage` URLs
need updating. This is a manual step outside this plan.

## 4. Execution Phases

### Phase 1: Skill renames (no consolidation yet)

Rename all 9 atlas skill directories and update all internal references.
This is the highest-risk, highest-blast-radius change and must be done
first so the skill names are stable before content moves.

Files touched:
- plugins/atlas/skills/ -- 9 directory renames
- plugins/atlas/skills/*/SKILL.md -- 9 frontmatter name updates
- plugins/atlas/skills/*/references/ -- ~25 reference files with cross-refs
- plugins/atlas/commands/*.md -- 18 command files referencing skill names
- plugins/atlas/hooks/*.py -- 15 hooks referencing skill names
- plugins/atlas/scripts/*.py -- 13 scripts referencing skill names
- plugins/atlas/agents/*.md -- 12 agent files referencing skill names
- plugins/atlas/output-styles/atlas-orchestrator.md -- references
- plugins/atlas/README.md -- skill table
- plugins/atlas/.claude-plugin/plugin.json -- keywords, description
- plugins/atlas/.kimi-plugin/plugin.json -- same
- .claude-plugin/marketplace.json -- atlas plugin description/keywords
- .kimi-plugin/marketplace.json -- same
- docs/CHANGELOG.md -- this change entry
- docs/ROADMAP.md -- this change entry
- docs/AGENTS.md -- agent roster references
- docs/standards/README.md -- if it references skill names
- docs/plans/*.md -- historical references (leave as-is, they are dated)
- docs/audits/ -- historical (leave as-is)
- docs/evidence/ -- historical (leave as-is)
- README.md -- atlas section
- plugins/README.md -- atlas row
- skills/SKILLS_AUDIT_2026-06-12.md -- historical (leave as-is)

Cross-reference map (skill name -> everywhere it appears):

atlas-metis -> referenced in: all 8 other skills, 18 commands, hooks.json,
  session_boot.py, prompt_optimizer.py, dispatch_tripwire.py,
  completion_gate.py, nudge.py, ingest_session.py, atlas_db.py,
  atlas_doctor.py, discover_capabilities.py, install_hooks.py,
  build_hub.py, lint_skill_names.py, output-styles/atlas-orchestrator.md,
  README.md, plugin.json keywords, marketplace.json keywords,
  docs/AGENTS.md, capability-catalog.md, capability-routing.md,
  operating-contract.md, subagent-kit.md

atlas-hephaestus -> referenced in: atlas-metis (squad list), atlas-nestor,
  README.md, plugin.json keywords, marketplace.json keywords,
  session_boot.py, discover_capabilities.py, capability-catalog.md,
  capability-routing.md

atlas-ariadne -> referenced in: atlas-metis (squad list), atlas-nestor,
  atlas-athena (boundary section), README.md, plugin.json keywords,
  marketplace.json keywords, capability-catalog.md, capability-routing.md

atlas-athena -> referenced in: atlas-metis (squad list), atlas-nestor,
  atlas-ariadne (boundary section), README.md, plugin.json keywords,
  marketplace.json keywords, capability-catalog.md, capability-routing.md

atlas-argus -> referenced in: atlas-metis (squad list, nudge section),
  atlas-nestor, README.md, plugin.json keywords, marketplace.json keywords,
  nudge.py, capability-catalog.md, capability-routing.md

atlas-chronos -> referenced in: atlas-metis (mechanisms section, squad list),
  atlas-nestor, README.md, plugin.json keywords, marketplace.json keywords,
  capability-catalog.md, capability-routing.md

atlas-hermes -> referenced in: atlas-metis (squad list), atlas-nestor,
  atlas-hephaestus, README.md, plugin.json keywords, marketplace.json keywords,
  capability-catalog.md, capability-routing.md

atlas-odysseus -> referenced in: atlas-metis (squad list), atlas-nestor,
  README.md, plugin.json keywords, marketplace.json keywords,
  capability-catalog.md, capability-routing.md

atlas-nestor -> referenced in: README.md, plugin.json keywords,
  marketplace.json keywords, capability-catalog.md

### Phase 2: Create atlas-armada skill and agents

Write the new atlas-armada SKILL.md, references/, and department agent files.
This is additive -- no existing content changes.

Files created:
- plugins/atlas/skills/atlas-armada/SKILL.md
- plugins/atlas/skills/atlas-armada/references/org-config-schema.md
- plugins/atlas/skills/atlas-armada/references/role-routing.md
- plugins/atlas/skills/atlas-armada/references/connector-provisioning.md
- plugins/atlas/agents/armada-*.md (11 department agents)

### Phase 3: Consolidate non-atlas plugins into atlas-armada

Move all content from the 11 non-atlas plugin directories into the atlas
plugin under atlas-armada's department structure. This is the largest phase
by file count.

For each source plugin:
1. Create armada/departments/<dept>/ directory
2. Move skills/ -> departments/<dept>/skills/
3. Move commands/ -> departments/<dept>/commands/
4. Move agents/ -> merge into departments/<dept>/agents/ (rename to armada-*)
5. Move .mcp.json connectors -> departments/<dept>/connectors/
6. Move mcp/*.mcpb -> atlas/mcp/ (organized by vendor)
7. Move CONNECTORS.md -> departments/<dept>/CONNECTORS.md
8. Move README.md -> departments/<dept>/README.md
9. Update all internal cross-references in moved files
10. Delete the now-empty source plugin directory

### Phase 4: Update marketplace, README, AGENTS, docs

- .claude-plugin/marketplace.json: single atlas plugin entry
- .kimi-plugin/marketplace.json: single atlas plugin entry
- README.md: full rewrite for atlas marketplace
- plugins/README.md: full rewrite for single plugin
- CONTRIBUTING.md: update for single plugin
- AGENTS.md: update for consolidated structure
- docs/AGENTS.md: add armada agents to roster
- docs/CHANGELOG.md: add 4.0.0 entry
- docs/ROADMAP.md: add 4.0.0 entry
- plugins/atlas/README.md: update skill table, add armada
- plugins/atlas/.claude-plugin/plugin.json: version 4.0.0, keywords, description
- plugins/atlas/.kimi-plugin/plugin.json: same
- .env.template: stays as-is (all vendor creds still needed)

### Phase 5: Verification

- All skill directories exist with new names
- All SKILL.md frontmatter `name:` fields match new names
- All cross-references updated (grep for old names returns zero hits in
  non-historical files)
- Marketplace JSON is valid and lists only atlas
- Plugin.json is valid and version 4.0.0
- No empty plugin directories remain
- atlas-armada SKILL.md is complete and references all departments
- All 11 department agents exist
- .env.template unchanged
- docs/CHANGELOG.md and docs/ROADMAP.md updated

## 5. What stays unchanged

- mcp_servers/ -- all 10 MCP server implementations stay
- mcp_node/ -- all 7 Node client libraries stay
- mcp_servers/_shared/ -- shared utilities stay
- .env.template -- all vendor credentials still needed
- skills/ (standalone skills at repo root) -- these are repo-root skills,
  not plugin skills; they stay unless the user says otherwise
- docs/audits/, docs/evidence/, docs/plans/ (historical) -- dated artifacts,
  left as-is
- docs/standards/ -- reference standards, stay
- plugins/_standards/ -- quality checklists, stay
- plugins/_templates/ -- plugin/skill templates, stay
- test-mcp-tools.mjs -- test harness, stays (probes still target vendors)

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Broken cross-references after rename | Phase 1 is renames only; grep audit before Phase 2 |
| Lost content during consolidation | git mv preserves history; verify file counts before/after each plugin |
| Marketplaces with stale plugin lists | Phase 4 rewrites both marketplace.json files atomically |
| Existing users with installed plugins | Migration path: old plugins stop receiving updates; atlas 4.0.0 is the upgrade |
| MCP connector bundles orphaned | .mcpb files move to atlas/mcp/, extract.sh paths updated |

## 7. Version

Current: 3.2.0
Target: 4.0.0

Major version bump because:
- Skill names change (breaking)
- Plugin structure changes (breaking)
- Marketplace name changes (breaking)
- Plugin list changes from 12 to 1 (breaking)

## 8. Execution approach

Per AGENTS.md section 5, this wide-blast-radius change should use parallel
implementers followed by chained skeptical validators. The phases are
sequential (each depends on the prior), but within each phase, independent
file groups can be dispatched in parallel.

Suggested delegation:
- Phase 1: 3 parallel implementers (skills+references / commands+hooks /
  scripts+agents+docs), then 2 validators
- Phase 2: 1 implementer (armada is greenfield), then 1 validator
- Phase 3: 3 parallel implementers (4 plugins each), then 2 validators
- Phase 4: 1 implementer (all manifest/docs updates), then 2 validators
- Phase 5: 1 validator (full audit)