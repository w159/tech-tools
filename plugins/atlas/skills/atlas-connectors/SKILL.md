---
name: atlas-connectors
description: 'Guided setup for the ten vendor MCP connectors bundled with atlas (Auvik, Blumira, CIPP, ConnectWise Manage, Spanning, KnowBe4, NinjaOne, Paylocity, ThreatLocker, Vanta). Use to see which connectors are enabled vs disabled, enable one by collecting only the credentials it needs, and make its bundle available for extract-on-demand. All connectors ship inert; this is how an operator turns one on.'
---

# Atlas connectors setup

Atlas bundles ten vendor MCP connectors. They ship INERT: in
`.claude-plugin/plugin.json` every `userConfig` key defaults to `""`, so with no
credentials each server fails its own credential check and never loads. No
conditional logic gates them; empty config is the off switch. Filling a vendor's
required keys is what enables it.

Atlas does NOT bundle the vendor `.mcpb` archives. Each bundle is located and
extracted on demand the first time its connector is used. The full per-vendor
table (keys, defaults, where to get each credential, doc paths) lives in
`vendors.md` next to this file. Read it before guiding any setup.

## The ten connectors

auvik, blumira, cipp, connectwise-manage, spanning, knowbe4, ninjaone,
paylocity, threatlocker, vanta. The connector's svc dir and `.mcpb` basename are
listed in `vendors.md`.

## No-args behavior: status scan

When invoked with no specific vendor, report which connectors are set up vs not.
A connector is ENABLED when its required `userConfig` keys (see `vendors.md`,
"Required to enable") are all non-empty in the user's plugin config, AND its
bundle is reachable for extraction.

1. Read `${CLAUDE_PLUGIN_ROOT}/../../.claude-plugin/plugin.json` (or the effective
   merged plugin config) and inspect the `userConfig` values the user has set.
2. For each of the ten connectors, mark ENABLED if its required keys are non-empty,
   otherwise DISABLED.
3. For each, also check whether a bundle is reachable in the extract-on-demand
   search order (see `vendors.md`): `${CLAUDE_PLUGIN_DATA}/mcp/<svc>.mcpb`, then
   `${ATLAS_MCP_SOURCE_DIR}/<svc>.mcpb`, then
   `<repo>/mcp_servers/<svc>/<svc>.mcpb`. Mark the bundle as AVAILABLE or MISSING.
4. Print a compact table: connector | enabled/disabled | bundle available/missing.
   Then say which connectors are fully ready, which have creds but a missing
   bundle, and which are off.

## Guided enable (a vendor was named, or the user picks one)

Work one connector at a time.

1. Open `vendors.md` and find the connector's row. Tell the user EXACTLY what
   that connector needs and nothing else:
   - the `userConfig` keys, flagged required vs optional;
   - where to get each credential (the "Where to get credentials" column and the
     `docs/vendors/<dir>/` path);
   - the base-url / region default, and that the optional `*_base_url` key can be
     left blank to use it.
2. Tell the user to set those keys in the atlas plugin config (the plugin's
   `userConfig`). Required keys must be non-empty; optional keys, including every
   base URL, may stay blank.
3. Make the bundle available for extract-on-demand. Give the exact command from
   `vendors.md`, e.g. copy the bundle into the plugin data dir:

   ```
   mkdir -p "${CLAUDE_PLUGIN_DATA}/mcp"
   cp /path/to/tech-tools/mcp_servers/<svc>/<svc>.mcpb "${CLAUDE_PLUGIN_DATA}/mcp/"
   ```

   or set `ATLAS_MCP_SOURCE_DIR` to a directory of bundles. Use the svc-dir
   bundle name (e.g. `auvik-mcp.mcpb`, `kaseya-spanning-backup-mcp.mcpb`).
4. Confirm: restate which keys were set, confirm the bundle is now reachable, and
   note that the connector loads on next use. The launcher extracts on first use;
   if a bundle is still missing it exits with a clear "declared but not set up"
   message pointing back at this skill, and never crashes.

## Guardrails

- Never invent credential values. Collect them from the operator.
- Only collect the keys a chosen connector actually needs; do not over-ask.
- Leaving an optional base-url key blank is correct and expected; do not push the
  user to set it.
- Never copy a `.mcpb` into the atlas plugin folder itself. Bundles live in the
  plugin DATA dir, an external source dir, or the source checkout.
