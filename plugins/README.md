# Plugins

This directory holds the three plugins published from this repository through the `tech-tools` marketplace (`.claude-plugin/marketplace.json` at the repo root), plus the shared authoring assets they draw on. Maintainers: see [CONTRIBUTING.md](../CONTRIBUTING.md) for the scope rule on editing plugin source.

## Plugins

| Plugin | License | What it is |
|--------|---------|------------|
| `atlas` | Apache-2.0 | The multi-agent coding architect: skills, named subagents and hooks that plan work, delegate it, and block "done" until there is evidence. See `plugins/atlas/README.md`. |
| `armada` | Apache-2.0 | An optional organization layer for atlas. Setup runs as four skills in order: `armada` (status and router), `armada-brand` (branding, run first), `armada-department` (activate one of 11 departments), `armada-connect` (vendor connectors). Behind them sit 11 department agents, 156 department skills, and the 13 vendor MCP connectors. Install alongside atlas only for organization use. See `plugins/armada/README.md`. |
| `programmer` | MIT (plugin code) | Code review and principles advice based on The Pragmatic Programmer (20th Anniversary Edition): a 10-dimension audit skill with file:line evidence, a 6-lens code-review skill backed by 6 reviewer agents, principle-advisor skills, and an 89-concept glossary written for citation. No hooks are registered. See `plugins/programmer/README.md` and its `LICENSE` for the terms on the glossary content. |

## Shared assets

- `_standards/` - shared authoring standards used across atlas and armada content.
- `_templates/` - shared templates for generating new skills, agents and docs.

## Install

Add the marketplace and install the plugins you need:

```bash
claude plugin marketplace add w159/tech-tools
claude plugin install atlas@tech-tools
```

Replace `atlas` with `armada` or `programmer` for the others.

## Credentials

All 13 vendor connectors live in `armada`, not `atlas`. The armada manifest (`plugins/armada/.claude-plugin/plugin.json`) declares 57 per-vendor `userConfig` credential keys, and `plugins/armada/.mcp.json` launches the servers bundled under `plugins/armada/mcp/`. Each connector stays off until its credentials are set.

The vendors are CrowdStrike Falcon, Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne, PAN-OS, Paylocity, SonicWall, ThreatLocker and Vanta. MCP tools are named `mcp__plugin_armada_<vendor>__*`. Set credentials with `/plugin config` on `armada`. The loaders also fall back to values saved under `atlas`, and `~/.config/atlas/atlas.env` still works. `atlas` keeps only the `atlas_mod_sound` key, and its dashboard reads connector state from the armada plugin installed beside it, so install atlas and armada together if you use connectors. For which keys each department connector needs, see `plugins/armada/skills/armada/references/connector-provisioning.md`.
