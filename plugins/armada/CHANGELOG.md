# Changelog

## Unreleased

- Fixed: the Falcon unit suite is hermetic (dummy credentials via an autouse fixture) and counts `falcon_status` as the always-on meta tool; the NinjaOne bundle was rebuilt from source (the PAN-OS bundle already matched a fresh build).
- Fixed: PAN-OS `panos_commit` with `partial: true` and `panos_commit_all` now
  send `action=partial` / `action=all` on the commit request (node-panos
  `commit()` previously dropped it). The panos bundle was rebuilt.
- Docs: the microsoft-365 department README now lists the CIPP connector's `cipp_*` userConfig keys instead of `MICROSOFT_*` variables for the removed Softeria server.
- Connector READMEs and tests were updated for the move, including a regression test for the PAN-OS commit action.
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
