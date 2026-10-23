# Atlas connectors setup guide

The armada plugin bundles **thirteen** vendor MCP connectors (atlas and armada
must be installed together; `plugins/armada/` paths below):

| Kind | Path | Connectors |
| --- | --- | --- |
| Node ESM bundles | `mcp/<name>/server.mjs` | auvik, blumira, cipp, connectwise, spanning, knowbe4, ninjaone, panos, paylocity, threatlocker, vanta, sonicwall |
| Python (uv project) | `mcp/falcon/` | falcon |

There is **no** department subdirectory layout (`mcp/hr/`, `mcp/security/`, ...) in
current source. Do not tell operators to look there.

The armada plugin declares all connector `userConfig` keys in
`.claude-plugin/plugin.json` and launches each connector from `.mcp.json`.
Node servers preload `mcp/_env/load.mjs`; Falcon preloads `mcp/_env/load.py`
via `uv run --project mcp/falcon`.

**Where to enter credentials (pick one):**

1. **Atlas dashboard** (preferred) - Command Center -> **Credentials**.
2. **Claude `/plugin config`** on **armada@tech-tools** (values saved under atlas
   and `~/.config/atlas/atlas.env` are still read as a fallback).
3. **Manual plugin `.env`** - loaded by the env preloaders.

After any of the above: **reload Claude Code**. Full verified flow + E2E matrix:
`../../references/connector-config-flow.md`.

**Elicitation:** when the user has not named a vendor, ask ONE multiSelect of the
thirteen connectors with enabled/disabled state (detected, not guessed). Never
collect secrets in free-text chat.

Per-vendor keys: `vendors.md` next to this file.

## The thirteen connectors

auvik, blumira, cipp, connectwise, falcon, spanning, knowbe4, ninjaone, panos,
paylocity, sonicwall, threatlocker, vanta.

Falcon needs `uv` on PATH; the other twelve (including panos and sonicwall) need Node.

## No-args behavior: status scan

1. Read effective armada credentials (pluginConfigs / `.env` / dashboard marks).
2. Mark each of the thirteen ENABLED iff required keys in `vendors.md` are non-empty.
3. Prefer `*_status` tools for runtime confirmation (including `falcon_status`).
   Unconfigured Falcon stays inert with a 4-tool diagnostic surface.

## Guided enable

1. Open `vendors.md` for keys, defaults, entry path, and where to get credentials.
2. Collect via dashboard or `/plugin config` on **armada** only.
3. Restate key **names** only. Require reload.
4. Distinguish missing creds vs vendor auth failure via status tools / E2E matrix.

## Guardrails

- Never invent credentials; never echo secret values.
- Only collect keys the chosen connector needs.
- Optional base-url blank is correct.
- Always target the **armada** plugin for connector credentials.
- Develop and verify from this repo's `plugins/atlas/` and `plugins/armada/` - never the install cache.

## Supporting files

- `../../references/connector-config-flow.md`
- `../../references/connector-tool-disclosure.md`
- `vendors.md`
- `references/connector-authoring.md`
- `templates/connector-manifest.seed.json`
