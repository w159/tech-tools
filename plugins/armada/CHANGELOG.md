# Changelog

## Unreleased

- The 13 vendor MCP connectors moved here from the atlas plugin: CrowdStrike
  Falcon, Auvik, Blumira, CIPP, ConnectWise Manage, Kaseya Spanning, KnowBe4,
  NinjaOne, PAN-OS, Paylocity, SonicWall, ThreatLocker, and Vanta. The servers
  now live under `plugins/armada/mcp/` and are launched from
  `plugins/armada/.mcp.json`.
- MCP tool names changed from `mcp__plugin_atlas_<vendor>__*` to
  `mcp__plugin_armada_<vendor>__*`. Update any permission rules or hook matchers
  that use the old prefix.
- The 57 connector `userConfig` keys moved from the atlas plugin manifest to the
  armada manifest, with the same key names. Atlas keeps only `atlas_mod_sound`.
  Enter credentials with `/plugin config` on armada.
- Fallback: the connector env loaders still read credential values saved under
  the atlas plugin, and `~/.config/atlas/atlas.env` keeps working, so existing
  setups do not need to re-enter keys.
- Install atlas and armada together. The atlas dashboard reads connector state
  from the armada plugin installed beside it.
