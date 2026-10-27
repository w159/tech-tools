# Changelog

## 2.0.0 - 2026-10-27

### BREAKING

- armada now ships the 13 vendor MCP connectors that atlas shipped through 15.x: auvik, blumira, cipp, connectwise, falcon, knowbe4, ninjaone, panos, paylocity, sonicwall, spanning, threatlocker, vanta. Files: `plugins/armada/.mcp.json` and `plugins/armada/mcp/`, plus the shared `mcp/_env` loaders.
- Tool names change from `mcp__plugin_atlas_<svc>__*` to `mcp__plugin_armada_<svc>__*`. Update permission allow and deny rules.
- The 57 connector `userConfig` keys now live in armada `plugin.json`. Credentials saved under `atlas@tech-tools` are still read as a fallback; new saves go under armada. `~/.config/atlas/atlas.env` still works.
- Install with `/plugin install armada@tech-tools` and restart. Steps: [README.md](README.md#upgrading-connectors-moved-from-atlas-to-armada).

### Changed

- Env loaders read `armada@` saved options first, then `atlas@`.
- `connector_credential_watch` remains an atlas hook and fires only when both atlas and armada are installed.
- The atlas dashboard and control plane resolve armada through `scripts/armada_root.py` (atlas 16.0.0).

## 1.1.1

- Department layer split out of atlas: 4 setup skills, 11 department agents, 156 department skills. See the repository history for earlier changes.
