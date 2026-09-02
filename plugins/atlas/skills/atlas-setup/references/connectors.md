# Atlas connectors setup guide

Atlas bundles **eleven** vendor MCP connectors inside the atlas plugin itself:

| Kind | Path | Connectors |
| --- | --- | --- |
| Node ESM bundles | `mcp/<name>/server.mjs` | auvik, blumira, cipp, connectwise, spanning, knowbe4, ninjaone, paylocity, threatlocker, vanta |
| Python (uv project) | `mcp/falcon/` | falcon |

There is **no** department subdirectory layout (`mcp/hr/`, `mcp/security/`, …) in
current source. Do not tell operators to look there.

The atlas plugin declares all connector `userConfig` keys in
`.claude-plugin/plugin.json` and launches each connector from `.mcp.json`.
Node servers preload `mcp/_env/load.mjs`; Falcon preloads `mcp/_env/load.py`
via `uv run --project mcp/falcon`.

**Where to enter credentials (pick one):**

1. **Atlas dashboard** (preferred) — Command Center → **Credentials**.
2. **Claude `/plugin config`** on **atlas@tech-tools**.
3. **Manual plugin `.env`** — loaded by the env preloaders.

After any of the above: **reload Claude Code**. Full verified flow + E2E matrix:
`../../references/connector-config-flow.md`.

**Elicitation:** when the user has not named a vendor, ask ONE multiSelect of the
eleven connectors with enabled/disabled state (detected, not guessed). Never
collect secrets in free-text chat.

Per-vendor keys: `vendors.md` next to this file.

## The eleven connectors

auvik, blumira, cipp, connectwise, falcon, spanning, knowbe4, ninjaone,
paylocity, threatlocker, vanta.

Falcon needs `uv` on PATH; the other ten need Node.

## No-args behavior: status scan

1. Read effective atlas credentials (pluginConfigs / `.env` / dashboard marks).
2. Mark each of the eleven ENABLED iff required keys in `vendors.md` are non-empty.
3. Prefer `*_status` tools for runtime confirmation (including `falcon_status`).
   Unconfigured Falcon stays inert with a 4-tool diagnostic surface.

## Guided enable

1. Open `vendors.md` for keys, defaults, entry path, and where to get credentials.
2. Collect via dashboard or `/plugin config` on **atlas** only.
3. Restate key **names** only. Require reload.
4. Distinguish missing creds vs vendor auth failure via status tools / E2E matrix.

## Guardrails

- Never invent credentials; never echo secret values.
- Only collect keys the chosen connector needs.
- Optional base-url blank is correct.
- Always target the **atlas** plugin.
- Develop and verify from this repo's `plugins/atlas/` — never the install cache.

## Supporting files

- `../../references/connector-config-flow.md`
- `../../references/connector-tool-disclosure.md`
- `vendors.md`
- `references/connector-authoring.md`
- `templates/connector-manifest.seed.json`
