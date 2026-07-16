# Atlas connectors setup guide

Atlas bundles ten vendor MCP connectors inside the atlas plugin itself:

| Department folder | Connectors |
| --- | --- |
| `mcp/hr/` | paylocity |
| `mcp/it-operations/` | auvik, connectwise, ninjaone, spanning |
| `mcp/microsoft-365/` | cipp |
| `mcp/security/` | blumira, knowbe4, threatlocker, vanta |

The atlas plugin declares all connector `userConfig` credential keys in its own
`.claude-plugin/plugin.json` and launches each connector from its own
`.mcp.json` at the plugin root. They ship INERT: every `userConfig` key defaults to
`""`, so with no credentials each server fails its own credential check and
never loads. Filling a vendor's required keys on the **atlas plugin** is what
enables it.

**Elicitation:** when the user has not named a vendor, ask ONE multiSelect
AskUserQuestion listing the connectors with their current enabled/disabled state
(detected, not guessed) so they pick what to turn on. Credentials themselves are
collected via `/plugin config` on the **atlas plugin** per the vendor table -
never through free-text chat, and never echoed back.

The full per-vendor table (keys, defaults, where to get each credential, bundle
path, owning plugin) lives in `vendors.md` next to this file. Read it before
guiding any setup.

## The ten connectors

auvik, blumira, cipp, connectwise, spanning, knowbe4, ninjaone, paylocity,
threatlocker, vanta. The bundle folder and userConfig keys are listed in
`vendors.md`.

## No-args behavior: status scan

When invoked with no specific vendor, report which connectors are set up vs not.

1. Read the atlas plugin's effective merged `userConfig` values (the merged
   plugin config).
2. For each of the ten connectors, mark ENABLED if all of its required keys
   (see `vendors.md`, "Required to enable") are non-empty, otherwise DISABLED.
3. Print a compact table: connector | enabled/disabled. Then say which
   connectors are fully ready and which need credentials set via `/plugin config`
   on the atlas plugin.

## Guided enable (a vendor was named, or the user picks one)

Work one connector at a time.

1. Open `vendors.md` and find the connector's row. Tell the user EXACTLY what
   that connector needs and nothing else:
   - the `userConfig` keys on the atlas plugin, flagged required vs optional;
   - where to get each credential (the "Where to get credentials" column and
     the bundle path);
   - the base-url / region default, and that the optional `*_base_url` key can
     be left blank to use it.
2. Tell the user to set those keys via `/plugin config` on the **atlas plugin**.
   Required keys must be non-empty; optional keys, including every base URL, may
   stay blank.
3. Confirm: restate which keys were set on the atlas plugin, and note that the
   connector loads on next use of the atlas plugin's MCP server. If required keys
   are still empty, the server fails its own credential check and stays inert.

## Guardrails

- Never invent credential values. Collect them from the operator.
- Only collect the keys a chosen connector actually needs; do not over-ask.
- Leaving an optional base-url key blank is correct and expected; do not push
  the user to set it.
- Always direct credentials at the **atlas plugin's** `/plugin config`. Atlas now
  owns every connector.

## Supporting files

- `vendors.md` (next to this file) - the per-vendor table: owning plugin,
  required/optional keys, where-to-get-credentials, bundle path.
- `references/connector-authoring.md` - the connector ownership pattern: how a
  vendor MCP connector is structured inside the atlas plugin, the inert-by-default
  mechanism, and the four fields the connectors mode reads per connector.
- `templates/connector-manifest.seed.json` - seed for a connector manifest
  (one per vendor type). Replace every placeholder with the vendor's real
  values.
