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

Python connectors (falcon) are vendored as source rather than a single
`server.mjs`, so uv resolves their pinned lockfile and `load.py` applies the
same env precedence:

```bash
uv run --project "${CLAUDE_PLUGIN_ROOT}/mcp/falcon" \
  python "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.py" falcon_mcp.server
```

**Layout note:** connectors live in a **flat** tree `mcp/<name>/` (plus
`mcp/_env/`). Department folders such as `mcp/hr/` or `mcp/security/` are not
used in current source.

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
2. **List tools** (`tools/list`) — expect at least a `*_status` tool. Some
   connectors expand tool count only after credentials resolve (ConnectWise /
   Blumira progressive disclosure). Unconfigured **Falcon** stays inert with a
   4-tool diagnostic surface including `falcon_status`.
3. **Call status** (`tools/call` on `*_status`) with no arguments.
4. Interpret status honestly:
   - missing credentials → actionable `MISSING_CREDENTIALS` / NOT CONFIGURED
   - credentials present but vendor rejects → HTTP/auth error (e.g. 401)
   - credentials present and vendor accepts → ok/verified

Dashboard-side checks:

- `GET /api/health` → canonical `~/.atlas/atlas.db`
- `GET /api/connectors` or `/api/status` → **11** connectors, set/missing only
- `POST /api/connectors/env` rejects unknown keys
- Settings UI contains draft guards (`settingsDirty`) and save buttons

## End-to-end results (this workspace)

Test harness: stdio MCP client with `CLAUDE_PLUGIN_ROOT=plugins/atlas`, env from
plugin `.env` + CFG passthrough (no secret logging).
Dates: 2026-08-28 (ten Node connectors) and **2026-09-02** (re-verify including Falcon).

Wiring unit tests (`plugins/atlas/scripts/test_connectors_wiring.py`): **9/9 OK**.

| Connector | Init | Tools listed | Status tool | Status / notes (no secret values) |
| --- | --- | --- | --- | --- |
| auvik | ok | 39 | `auvik_status` | reports when username/api key missing; otherwise vendor call may 401 |
| blumira | ok | 2 | `blumira_status` | progressive shell; MISSING_CREDENTIALS without jwt or oauth pair |
| cipp | ok | 43 | `cipp_status` | MISSING_CREDENTIALS without base URL + token or oauth trio |
| connectwise | ok | 2 | `cw_status` | gated shell until company/public/private/client id set |
| spanning | ok | 14 | `spanning_status` | MISSING_CREDENTIALS without admin email + token |
| falcon | ok | **4** inert / **144+** when authenticated | `falcon_status` | inert without creds (`MISSING_CREDENTIALS`); full catalog only after auth |
| knowbe4 | ok | 30 | `knowbe4_status` | status tool present |
| ninjaone | ok | 45 | `ninjaone_status` | status tool present |
| paylocity | ok | 16 | `paylocity_status` | NOT CONFIGURED without client id/secret |
| threatlocker | ok | 19 | `threatlocker_status` | status tool present |
| vanta | ok | 28 | `vanta_status` | status tool present |

Dashboard API (2026-09-02):

- `GET /api/connectors` → **11** connectors (includes falcon)
- health ok, DB `~/.atlas/atlas.db`
- After `python3 plugins/atlas/scripts/atlas_dashboard.py ensure`, health `script`
  must be this repo's `plugins/atlas/scripts/atlas_dashboard.py` (not a cache path).

### Interpretation

- **Transport + packaging are healthy** for all **eleven** connectors declared in
  `.mcp.json` (init + tool list from repo source).
- **Status standard met for all eleven:** each exposes `*_status` or `cw_status`.
  Falcon boots **inert** without credentials (4 diagnostic tools including
  `falcon_status` → `MISSING_CREDENTIALS`) and expands only after auth succeeds.
- **Progressive disclosure works** for Blumira/ConnectWise; other Node connectors
  list broader catalogs while status reports missing creds.
- **Dashboard:** run `python3 plugins/atlas/scripts/atlas_dashboard.py ensure` from
  this repo so health `script` points at source, not an install/cache copy.
  Verified 2026-09-02: 11 connectors; source script path.

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
