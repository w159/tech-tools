# atlas plugins

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

- `_standards/` - shared authoring standards used across atlas/armada content.
- `_templates/` - shared templates for generating new skills/agents/docs.

## Install and usage

All three plugins are published from the `w159/tech-tools` repository through the `tech-tools` marketplace defined in `.claude-plugin/marketplace.json` at the repo root (version 3.5.0). That marketplace lists `atlas`, `armada`, and `programmer`. Add the marketplace in Claude Code with the `/plugin` command, then install the plugin(s) you need.

## Credentials

All 13 vendor connectors live in `armada`, not `atlas`: `armada`'s manifest (`plugins/armada/.claude-plugin/plugin.json`) declares the 57 per-vendor `userConfig` credential keys, and `plugins/armada/.mcp.json` launches the servers bundled under `plugins/armada/mcp/`. The vendors are CrowdStrike Falcon, Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne, PAN-OS, Paylocity, SonicWall, ThreatLocker, and Vanta. MCP tools are named `mcp__plugin_armada_<vendor>__*`. Set credentials with `/plugin config` on `armada` (same key names as before). The loaders also fall back to values saved under `atlas`, and `~/.config/atlas/atlas.env` still works. `atlas` keeps only the `atlas_mod_sound` key, and its dashboard reads connector state from the armada plugin installed beside it, so install atlas and armada together. See `plugins/armada/skills/armada/references/connector-provisioning.md` for which keys each department connector needs.
