# Connector Authoring Pattern

How a vendor MCP connector is structured inside the atlas plugin, and how
atlas-setup reasons about it. Read this alongside `vendors.md` (the per-vendor
table) when guiding setup.

## Ownership rule

Every connector lives inside the atlas plugin's `mcp/` tree:

```
plugins/atlas/
  .claude-plugin/
    plugin.json          # declares all connector userConfig keys (defaults to "")
    .mcp.json            # launches every connector server
  mcp/
    hr/
      paylocity.mcpb
      launch.sh
      extract.sh
    it-operations/
      auvik.mcpb
      connectwise.mcpb
      ninjaone.mcpb
      spanning.mcpb
      launch.sh
      extract.sh
    microsoft-365/
      cipp.mcpb
      launch.sh
      extract.sh
    security/
      blumira.mcpb
      knowbe4.mcpb
      threatlocker.mcpb
      vanta.mcpb
      launch.sh
      extract.sh
  skills/atlas-setup/
    references/vendors.md    # per-vendor table
    references/connectors.md # setup workflow
```

## Inert-by-default mechanism

Every `userConfig` key in `plugin.json` defaults to the empty string. The
connector's server entry in `.mcp.json` runs a credential check on startup;
with any required key empty, that check fails and the server never loads. So
"installed but not configured" is indistinguishable from "absent" to the
runtime - no MCP server, no tools. Filling the required keys on the atlas
plugin via `/plugin config` is the single act that enables the connector.

## The four fields the connectors mode reads per connector

For each connector, `vendors.md` carries these columns. The connectors mode reads
them directly, never from memory:

1. **owning plugin** - always `atlas` for the bundled connectors.
2. **required_to_enable** - the `userConfig` keys that must be non-empty.
3. **optional** - keys that may stay blank (typically `*_base_url`).
4. **bundle path** - where the `.mcpb` bundle and launch scripts live.

## Status detection (no-args scan)

To report a connector's status, the connectors mode:

1. Resolve the atlas plugin as the owning plugin from `vendors.md`.
2. Read the atlas plugin's effective merged `userConfig` values.
3. Mark ENABLED if every `required_to_enable` key is non-empty, else DISABLED.

## Guided enable flow

1. Open `vendors.md`, find the connector row.
2. Tell the user the required keys, the optional keys, the base-url/region
   defaults, and the bundle path - nothing else.
3. Point the user at `/plugin config` on the **atlas plugin**.
4. Re-read the effective config to confirm; never ask the user to paste the
   values back into chat.

## What the connectors mode never does

- Never invent credential values.
- Never direct credentials at a domain plugin's config.
- Never echo credential values back.
- Never collect more keys than the chosen connector needs.
- Never push the user to fill an optional base-url key.

## Seed manifest

Use `templates/connector-manifest.seed.json` as the starting shape when you
need to document a new connector's required/optional keys. One seed per vendor
type; replace every `<placeholder>` with the vendor's real values.
