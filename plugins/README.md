# Plugins

> **Scope rule (read first):** `atlas` and `armada` are products developed in this
> repo. A request about them means edit their source under `plugins/atlas/` or
> `plugins/armada/` - never install, set up, or run them in this workspace. Full
> rule: `AGENTS.md` Section 0 and `docs/architecture/plugin-development-scope.md`.

This directory holds the three plugins published from this repo, plus the shared authoring assets they draw on.

## Plugins

| Plugin | What it is |
|--------|------------|
| `atlas` | The multi-agent coding architect plugin: self-configuring, drives verification-gated work via subagents and hooks. |
| `armada` | The org deployment layer split out of atlas. Setup runs as four invocable skills in order: `armada` (status and router), `armada-brand` (branding, first), `armada-department` (activate one of 11 departments), `armada-connect` (vendor connectors). Behind them sit 11 department agents plus their department skills, for organizations that want atlas's capabilities wired with department-specific branding/policy/compliance context. Install alongside atlas only for org use. See `plugins/armada/README.md`. |
| `programmer` | The Pragmatic Programmer (20th Anniversary Edition) turned into an active codebase auditor and coding-time advisor: a 10-dimension audit skill with file:line evidence, a principle-surfacing nudge hook while you work, and an 89-concept glossary repackaged for citation. |

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
