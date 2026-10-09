# Connector Authoring Pattern

How a vendor MCP connector is structured inside the atlas plugin, and how
atlas-setup reasons about it. Read this alongside `vendors.md` (the per-vendor
table) when guiding setup.

## Ownership rule

Every connector lives inside the atlas plugin's **flat** `mcp/` tree:

```
plugins/atlas/
  .claude-plugin/
    plugin.json          # declares all connector userConfig keys (defaults to "")
  .mcp.json              # launches every connector server (plugin root)
  mcp/
    _env/
      load.mjs           # Node env preloader (ATLAS_ENV_FILE + CFG_* → canonical env)
      load.py            # Python twin for Falcon
    auvik/server.mjs
    blumira/server.mjs
    cipp/server.mjs
    connectwise/server.mjs
    spanning/server.mjs
    knowbe4/server.mjs
    ninjaone/server.mjs
    paylocity/server.mjs
    threatlocker/server.mjs
    vanta/server.mjs
    falcon/              # vendored Python project (pyproject.toml + falcon_mcp/)
  skills/atlas-setup/
    references/vendors.md
    references/connectors.md
    references/connector-authoring.md
```

Do **not** author new connectors under department folders (`mcp/hr/`,
`mcp/security/`, …) or as loose `.mcpb` files in those folders — that layout is
obsolete.

## Inert-by-default mechanism

Every `userConfig` key in `plugin.json` defaults to the empty string. Node
connectors start over stdio and expose at least a `*_status` / `cw_status` tool;
with required keys empty, domain tools return MISSING_CREDENTIALS / NOT
CONFIGURED (ConnectWise/Blumira additionally shrink the tool list until configured).

**Falcon:** boots inert without credentials (diagnostic tools + `falcon_status`
only) and expands to the full catalog after successful auth. Match that pattern
for any new Python connectors.

## The four fields the connectors mode reads per connector

For each connector, `vendors.md` carries these columns. The connectors mode reads
them directly, never from memory:

1. **owning plugin** — always `atlas` for the bundled connectors.
2. **required_to_enable** — the `userConfig` keys that must be non-empty.
3. **optional** — keys that may stay blank (typically `*_base_url` / region).
4. **entry point** — `mcp/<name>/server.mjs` or `mcp/falcon/` for Python.

## Status detection (no-args scan)

1. Resolve the atlas plugin as the owning plugin from `vendors.md`.
2. Read effective credentials (pluginConfigs / `.env` / dashboard marks).
3. Mark ENABLED if every `required_to_enable` key is non-empty, else DISABLED.
4. When a `*_status` tool exists, prefer calling it after reload for runtime proof.

## Guided enable flow

1. Open `vendors.md`, find the connector row.
2. Tell the user the required keys, optional keys, defaults, and entry path.
3. Point at dashboard Credentials or `/plugin config` on the **atlas** plugin.
4. Re-read effective config to confirm; never ask the user to paste secret values.

## What the connectors mode never does

- Never invent credential values.
- Never direct credentials at a domain plugin's config.
- Never echo credential values back.
- Never collect more keys than the chosen connector needs.
- Never push the user to fill an optional base-url key.
- Never implement connector changes under install/cache paths.

## Seed manifest

Use `templates/connector-manifest.seed.json` as the starting shape when you
need to document a new connector's required/optional keys. One seed per vendor
type; replace every `<placeholder>` with the vendor's real values.

After adding a connector: update `.mcp.json`, `plugin.json` userConfig, copy or
vendor the server under `mcp/<name>/`, extend `vendors.md` / `connectors.md`,
and ensure `test_connectors_wiring.py` still passes.
