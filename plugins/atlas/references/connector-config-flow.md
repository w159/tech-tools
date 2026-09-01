# Connector configuration flow (verified)

This is the authoritative path for enabling atlas vendor MCP connectors after
dashboard 5.17.1 credential UX fixes. It replaces tribal knowledge about
"where secrets live" and documents what end-to-end tests actually proved.

## Mental model

Connectors ship **inert**. Each MCP server starts, but authenticated vendor
tools stay gated until required credentials resolve.

Three layers participate:

1. **Claude plugin `userConfig`** — declared in
   `plugins/atlas/.claude-plugin/plugin.json`, values under
   `~/.claude/settings.json` → `pluginConfigs["atlas@tech-tools"].options`.
   Non-sensitive fields (usernames, regions, base URLs) usually remain here in
   plaintext. Sensitive fields may be moved by Claude Code into OS secure
   storage and then disappear from `settings.json`.
2. **Plugin `.env` files** — read by `plugins/atlas/mcp/_env/load.mjs` via
   `ATLAS_ENV_FILE=${CLAUDE_PLUGIN_ROOT}/.env`, with `CFG_*` passthrough into
   canonical env names. Dashboard dual-writes here so stdio servers and the UI
   can detect "set" even when Claude strips secrets from settings.
3. **Dashboard set-markers** — `~/.atlas/credential_marks.json` stores only
   key names + timestamps after a successful dashboard save (never secret
   values). Used so the UI can keep showing **set** after secure-storage moves.

Detection order for "is this key set?":

`pluginConfigs options` → any plugin `.env` candidate path → dashboard marks.

## Operator flow (preferred)

### A. Dashboard UI (http://127.0.0.1:7421/)

1. SessionStart runs `atlas_dashboard.py ensure` (or run it manually).
2. Open the shared dashboard once.
3. Click **Credentials** (header) or **Settings / credentials**.
4. Expand a connector card. Fields show **set** / **not set** and source
   (`pluginConfigs`, `env`, or `dashboard_mark`).
5. Type values. Drafts are kept while you type; auto-refresh does **not** wipe
   inputs.
6. Click **Save &lt;connector&gt;**.
7. UI marks fields **set** without echoing secrets.
8. **Reload Claude Code / start a new session** so MCP child processes re-read
   env + userConfig.

Save payload:

```http
POST /api/connectors/env
Content-Type: application/json

{"updates":{"auvik_api_key":"…","auvik_username":"…"}}
```

Effects:

- merges into `pluginConfigs["atlas@tech-tools"].options`
- dual-writes `AUVIK_API_KEY=…` style keys into **this plugin root's** `.env`
  (`${CLAUDE_PLUGIN_ROOT}/.env` / `plugins/atlas/.env` in source)
- writes set-markers under `~/.atlas/credential_marks.json`
- never returns secret values on subsequent GETs

### B. Claude `/plugin config` (still valid)

`/plugin config` on **atlas@tech-tools** remains a first-class path. Use it when
you prefer Claude's native form. After changing config there:

1. Optionally re-save once in the dashboard (or write `.env`) if you want the
   dashboard "set" badges and stdio `.env` path populated.
2. Reload the session.

### C. Manual `.env`

Create `${CLAUDE_PLUGIN_ROOT}/.env` (in this marketplace repo: `plugins/atlas/.env`):

```bash
AUVIK_USERNAME=…
AUVIK_API_KEY=…
AUVIK_REGION=us6
```

`load.mjs` maps these through `CFG_*` from `.mcp.json`. Reload Claude Code after
edits.

## Runtime wiring

`.mcp.json` launches each server roughly as:

```bash
node --import "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.mjs" \
  "${CLAUDE_PLUGIN_ROOT}/mcp/<vendor>/server.mjs"
```

Python connectors (falcon) are vendored as source rather than a bundle, so uv
resolves their pinned lockfile and `load.py` applies the same env precedence:

```bash
uv run --project "${CLAUDE_PLUGIN_ROOT}/mcp/falcon" \
  python "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.py" falcon_mcp.server
```

Env template example (Auvik):

- `ATLAS_ENV_FILE=${CLAUDE_PLUGIN_ROOT}/.env`
- `CFG_AUVIK_USERNAME=${user_config.auvik_username}`
- `CFG_AUVIK_API_KEY=${user_config.auvik_api_key}`
- `CFG_AUVIK_REGION=${user_config.auvik_region}`

`load.mjs`:

1. loads `ATLAS_ENV_FILE` into `process.env` (non-destructive for already-set keys
   depending on implementation details — prefer consistent values across sources)
2. copies each `CFG_NAME` into `NAME` when the canonical name is empty
3. expands `${VAR}` placeholders

## Verification checklist

For each connector:

1. **Initialize** over stdio JSON-RPC (`initialize` + `notifications/initialized`).
2. **List tools** (`tools/list`) — expect at least a `*_status` tool; some
   connectors expand tool count only after credentials resolve (ConnectWise /
   Blumira progressive disclosure pattern).
3. **Call status** (`tools/call` on `*_status`) with no arguments.
4. Interpret status honestly:
   - missing credentials → actionable `MISSING_CREDENTIALS` / NOT CONFIGURED
   - credentials present but vendor rejects → HTTP/auth error (e.g. 401)
   - credentials present and vendor accepts → ok/verified

Dashboard-side checks:

- `GET /api/health` → canonical `~/.atlas/atlas.db`
- `GET /api/connectors` or `/api/status` → 10 connectors, set/missing only
- `POST /api/connectors/env` rejects unknown keys
- Settings UI contains draft guards (`settingsDirty`) and save buttons

## End-to-end results (this workspace)

Test harness: stdio MCP client feeding env from
`pluginConfigs["atlas@tech-tools"].options` + plugin `.env` (no secret logging).
Date: 2026-08-28.

| Connector | Init | Tools listed | Creds fully resolved | Status tool | Status outcome |
| --- | --- | --- | --- | --- | --- |
| auvik | ok | 39 | yes | `auvik_status` | credentials present; vendor API **401** (key/region rejected or stale) |
| blumira | ok | 2 | no | `blumira_status` | MISSING_CREDENTIALS (progressive shell) |
| cipp | ok | 43 | no | `cipp_status` | MISSING_CREDENTIALS |
| connectwise | ok | 2 | no (public/private keys missing) | `cw_status` | configured=false; needs keys + restart |
| spanning | ok | 14 | no (token missing) | `spanning_status` | MISSING_CREDENTIALS |
| knowbe4 | ok | (listed) | no (api key missing) | `knowbe4_status` | MISSING_CREDENTIALS |
| ninjaone | ok | (listed) | no (client secret missing) | `ninjaone_status` | MISSING_CREDENTIALS |
| paylocity | ok | (listed) | no | `paylocity_status` | NOT CONFIGURED |
| threatlocker | ok | (listed) | no | `threatlocker_status` | NOT CONFIGURED |
| vanta | ok | (listed) | no | `vanta_status` | NOT CONFIGURED |

Dashboard API (same session):

- health ok, DB pinned to `~/.atlas/atlas.db`
- 10 connectors exposed
- unknown key POST rejected
- Auvik UI configured_hint true (`username`/`region` via pluginConfigs, `api_key` via env)
- unit tests `test_atlas_dashboard.py` green (5/5)

### Interpretation

- **Transport + packaging are healthy** for all ten connectors (init + tool list).
- **Credential completeness is partial** in this operator profile: only Auvik has
  all required keys present locally; Auvik still fails vendor auth (401), which
  is a credential validity issue, not an MCP wiring issue.
- **Progressive disclosure works**: Blumira/ConnectWise stay at a tiny tool
  surface without secrets; others may still list broader catalogs while status
  reports missing creds (vendor-specific).

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Field clears while typing | old dashboard without draft guard | hard-refresh UI; ensure daemon script has `settingsDirty` |
| Always "not set" but connector works in Claude | secret only in OS secure storage / Claude runtime | re-save once in dashboard or write `.env`; reload session |
| Status 401/403 with creds present | wrong key, wrong region/base URL, revoked token | rotate vendor credential; confirm region |
| Status MISSING_CREDENTIALS | required userConfig empty in all layers | save via dashboard or `/plugin config` |
| Tools still missing after save | MCP child started before save | fully reload Claude Code |
| Dashboard shows wrong DB / empty metrics | stale daemon on temp `ATLAS_DB` | `atlas_dashboard.py stop && ensure` |

## Security rules

- Never log or render secret values in the dashboard JSON API.
- Allowlist keys from plugin `userConfig` + `.env.example` only.
- Prefer set-markers over reading secrets back from disk for UI badges.
- Loopback bind only (`127.0.0.1:7421`).

## Related files

- UI/daemon: `plugins/atlas/scripts/atlas_dashboard.py`
- Env preloader: `plugins/atlas/mcp/_env/load.mjs`
- MCP launch map: `plugins/atlas/.mcp.json`
- userConfig schema: `plugins/atlas/.claude-plugin/plugin.json`
- Setup skill guide: `skills/atlas-setup/references/connectors.md`
- Per-vendor key table: `skills/atlas-setup/references/vendors.md`
- Dashboard API notes: `skills/atlas-orchestrate/references/dashboard-api.md`
