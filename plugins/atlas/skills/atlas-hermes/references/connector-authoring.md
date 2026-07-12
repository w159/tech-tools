# Connector Authoring Pattern

How a vendor MCP connector is structured inside its owning domain plugin, and
how atlas-hermes reasons about it without owning it. Read this alongside
`vendors.md` (the per-vendor table) when guiding setup.

## Ownership rule

Atlas ships zero connectors. Every connector lives in its owning domain
plugin's `.claude-plugin/` tree:

```
<domain-plugin>/
  .claude-plugin/
    plugin.json          # declares userConfig keys (defaults to "")
    .mcp.json            # launches the connector server
  skills/<vendor>-*/
    SKILL.md             # vendor-specific skill
  agents/<vendor>-*.md   # optional vendor-specific agent
  docs/vendors/<vendor-dir>/
    *.md                 # where-to-get-credentials docs
```

## Inert-by-default mechanism

Every `userConfig` key in `plugin.json` defaults to the empty string. The
connector's server entry in `.mcp.json` runs a credential check on startup;
with any required key empty, that check fails and the server never loads. So
"installed but not configured" is indistinguishable from "absent" to the
runtime - no MCP server, no tools. Filling the required keys on the owning
plugin is the single act that enables the connector.

## The four fields hermes reads per connector

For each connector, `vendors.md` carries these columns. Hermes reads them
directly, never from memory:

1. **owning plugin** - which domain plugin to install/configure.
2. **required_to_enable** - the `userConfig` keys that must be non-empty.
3. **optional** - keys that may stay blank (typically `*_base_url`).
4. **docs path** - where to find the where-to-get-credentials doc.

## Status detection (no-args scan)

To report a connector's status, hermes:

1. Resolve the owning domain plugin from `vendors.md`.
2. Check `~/.claude/plugins/installed_plugins.json` for that plugin.
3. If installed, read the plugin's effective merged `userConfig` values.
4. Mark ENABLED if every `required_to_enable` key is non-empty, else DISABLED.
5. If the owning plugin is not installed, mark NOT INSTALLED and skip the
   enabled check.

## Guided enable flow

1. Open `vendors.md`, find the connector row.
2. Tell the user the owning plugin, the required keys, the optional keys, and
   the docs path - nothing else.
3. Point the user at `/plugin config` on the owning domain plugin.
4. Re-read the effective config to confirm; never ask the user to paste the
   values back into chat.

## What hermes never does

- Never invent credential values.
- Never direct credentials at atlas's own plugin config.
- Never echo credential values back.
- Never collect more keys than the chosen connector needs.
- Never push the user to fill an optional base-url key.

## Seed manifest

Use `templates/connector-manifest.seed.json` as the starting shape when you
need to document a new connector's required/optional keys. One seed per vendor
type; replace every `<placeholder>` with the vendor's real values.