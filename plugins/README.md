# atlas plugins

> **Scope rule (read first):** `atlas` and `armada` are products developed in this
> repo. A request about them means edit their source under `plugins/atlas/` or
> `plugins/armada/` - never install, set up, or run them in this workspace. Full
> rule: `AGENTS.md` Section 0 and `docs/plugin-development-scope.md`.

This directory holds the two plugins published from this repo, plus the shared authoring assets they draw on.

## Plugins

| Plugin | What it is |
|--------|------------|
| `atlas` | The multi-agent coding architect plugin: self-configuring, drives verification-gated work via subagents and hooks. |
| `armada` | The org deployment layer split out of atlas: 11 department agents plus their department skills, for organizations that want atlas's capabilities wired with department-specific branding/policy/compliance context. Install alongside atlas only for org use. |

## Shared assets

- `_standards/` - shared authoring standards used across atlas/armada content.
- `_templates/` - shared templates for generating new skills/agents/docs.

## Install and usage

Both plugins are published from the `w159/atlas` repository through the marketplace defined in `.claude-plugin/marketplace.json` at the repo root (version 3.0.0). That marketplace lists exactly `atlas` and `armada`. Add the marketplace in Claude Code with the `/plugin` command, then install the plugin(s) you need.

Kimi Code CLI users can browse the same catalog from the repo root with `/plugins marketplace .kimi-plugin/marketplace.json`, which lists the same two plugins. You can also install a single plugin directly with `/plugins install ./plugins/<name>` (from the repo root). Remote GitHub subpath installs are not supported by Kimi Code CLI's current installer, so distribution requires a local clone or per-plugin zip artifacts.

## Credentials

All connector credentials live on `atlas`, not `armada`: `atlas`'s manifest (`plugins/atlas/.claude-plugin/plugin.json`) declares the `mcpServers` entry (`plugins/atlas/.mcp.json`) and the full `userConfig` block of per-vendor credential keys (Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4, NinjaOne, Paylocity, ThreatLocker, Vanta). `armada`'s own manifest (`plugins/armada/.claude-plugin/plugin.json`) declares neither `userConfig` nor `mcpServers` - see `plugins/armada/skills/armada/references/connector-provisioning.md` for which `userConfig` keys each department connector needs and how they're set via `/plugin config` on `atlas`.
