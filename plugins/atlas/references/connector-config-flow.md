# Connector configuration flow (verified)

This is the authoritative path for enabling atlas vendor MCP connectors after
dashboard 5.17.1 credential UX fixes. It replaces tribal knowledge about
"where secrets live" and documents what end-to-end tests actually proved.

## Mental model

Connectors ship **inert**. Each MCP server starts, but authenticated vendor
tools stay gated until required credentials resolve.

Four layers participate:

1. **Claude plugin `userConfig`** — declared in
   `plugins/atlas/.claude-plugin/plugin.json`, values under
   `~/.claude/settings.json` → `pluginConfigs["atlas@tech-tools"].options`.
   Non-sensitive fields (usernames, regions, base URLs) usually remain here in
   plaintext. Sensitive fields may be moved by Claude Code into OS secure
   storage and then disappear from `settings.json`. **This layer only takes
   effect in harnesses that resolve plugin `userConfig`/`${user_config.*}`
   substitution before spawning the server.** **[INFERENCE, not directly
   observed 2026-09-28]:** at least one harness likely does not, which
   would leave every `CFG_*` var as a literal unexpanded
   `${user_config.*}` string for the loader's own unexpanded-value guard
   to correctly refuse to promote - this is consistent with, but not
   proven by, an observed `MISSING_CREDENTIALS` result for every vendor
   except shell-exported Falcon in that harness (no command actually read
   the env a spawned server received).
2. **Plugin `.env` files** — read by `plugins/atlas/mcp/_env/load.mjs` via
   `ATLAS_ENV_FILE=${CLAUDE_PLUGIN_ROOT}/.env`, with `CFG_*` passthrough into
   canonical env names. Dashboard dual-writes here so stdio servers and the UI
   can detect "set" even when Claude strips secrets from settings. **For a
   cache-installed plugin this file does not exist until something writes
   it** - a fresh install has no `${CLAUDE_PLUGIN_ROOT}/.env`.
3. **Per-user default file** (added 2026-09-28) — both loaders also check
   `~/.config/atlas/atlas.env` (KEY=VALUE, recommended `chmod 600`) as a
   baseline loaded *before* `ATLAS_ENV_FILE`, so credentials are available
   even when layers 1 and 2 don't apply (harness doesn't resolve
   `userConfig`, and/or the plugin-root `.env` doesn't exist). `ATLAS_ENV_FILE`
   still loads second and overrides matching keys when explicitly set and
   present.
4. **Dashboard set-markers** — `~/.atlas/credential_marks.json` stores only
   key names + timestamps after a successful dashboard save (never secret
   values). Used so the UI can keep showing **set** after secure-storage moves.

Detection order for "is this key set?" **as shown by the dashboard UI**:
`pluginConfigs options` → any plugin `.env` candidate path → dashboard marks.
The per-user default file (layer 3) is read by the server-side loaders at
process start; it is not one of the paths the dashboard UI itself probes,
so a key can be live for a running server via that file while the
dashboard still shows it as **not set**.

## Operator flow (preferred)

### A. Dashboard (http://127.0.0.1:7421/)

The v2 Workboard (static UI under `scripts/dashboard_ui/`) has a **Settings**
page that lists every connector with its configured hint, an enable switch
(`/api/mcp/toggle`), a **Test** button (`/api/connectors/test`) and a
per-connector **credential form**. Secret fields are `type="password"` inputs
that are never pre-filled and never echoed back (the page shows only `set` /
`missing` plus the source); only the fields you change are sent, through
`POST /api/connectors/env`, and an unsaved-draft guard asks before you reload,
close the tab or leave Settings. The same API stays callable directly, and
`/plugin config` or a `.env` still work.

1. SessionStart runs `atlas_dashboard.py ensure` (or run it manually).
2. Open the shared dashboard once; the page carries the per-daemon token.
3. Settings -> Connectors shows `configured` or `needs credentials` per
   connector and the settings file path.
4. Enter the secrets in the connector's credential form and press **Save** (the
   page sends the token for you). To script it instead, post the payload below:
   every mutation must send `Content-Type: application/json` and the
   `X-Atlas-Token` header (the value of `<meta name="atlas-token">` in the
   served page); a stale token returns `401 bad_token`.
5. `GET /api/connectors` reports set / not set and source (`pluginConfigs`,
   `env`, or `dashboard_mark`) without echoing secrets.
6. **Reload Claude Code / start a new session** so MCP child processes re-read
   env + userConfig.

Save payload:

```http
POST /api/connectors/env
Content-Type: application/json
X-Atlas-Token: <value of <meta name="atlas-token"> in the served page>

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

1. Optionally re-save once via `POST /api/connectors/env` (or write `.env`) if you
   want the dashboard "set" badges and stdio `.env` path populated.
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

`load.mjs` (and its Python twin `load.py`):

1. loads `~/.config/atlas/atlas.env` (per-user default, added 2026-09-28) as a
   baseline, then `ATLAS_ENV_FILE` on top, overriding matching keys - a blank
   `KEY=` line in either file never overwrites an already-set value
2. copies each `CFG_NAME` into `NAME` when the canonical name is unset
3. refuses to promote a `CFG_NAME` whose value is still the literal
   unexpanded `${user_config.*}` placeholder string - it does not expand
   placeholders itself; expansion (if any) is the launching harness's job
   before the child process starts

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
- `GET /api/connectors` or `/api/status` → **12** connectors (one per `mcpServers`
  entry in `.mcp.json`, including panos), set/missing only
- `POST /api/connectors/env` rejects unknown keys
- `GET /api/v2/prefs` and `GET /api/v2/projects` answer, and `GET /` serves the
  Workboard shell with `<meta name="atlas-token">` filled in

## End-to-end results (this workspace)

Test harness: stdio MCP client with `CLAUDE_PLUGIN_ROOT=plugins/atlas`, env from
plugin `.env` + CFG passthrough (no secret logging).
Dates: 2026-08-28 (ten Node connectors) and **2026-09-02** (re-verify including Falcon).
**Historical record:** the matrix below is the 2026-09-02 run (11 connectors,
before panos was added); it is not the current count. Current count: twelve.

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

Dashboard API (2026-09-02, historical, before panos was added):

- `GET /api/connectors` → **11** connectors (includes falcon) [historical; now 12 with panos]
- health ok, DB `~/.atlas/atlas.db`
- After `python3 plugins/atlas/scripts/atlas_dashboard.py ensure`, health `script`
  must be this repo's `plugins/atlas/scripts/atlas_dashboard.py` (not a cache path).

### Interpretation

- **Transport + packaging are healthy** for all **twelve** connectors declared in
  `.mcp.json` (auvik, blumira, cipp, connectwise, falcon, knowbe4, ninjaone,
  panos, paylocity, spanning, threatlocker, vanta). The 2026-09-02 matrix above
  exercised eleven of them (init + tool list from repo source); panos is
  declared in `.mcp.json` and listed by `GET /api/connectors` but is not in
  that dated matrix.
- **Status standard met for all twelve:** each exposes `*_status` or `cw_status`.
  Falcon boots **inert** without credentials (4 diagnostic tools including
  `falcon_status` → `MISSING_CREDENTIALS`) and expands only after auth succeeds.
- **Progressive disclosure works** for Blumira/ConnectWise; other Node connectors
  list broader catalogs while status reports missing creds.
- **Dashboard:** run `python3 plugins/atlas/scripts/atlas_dashboard.py ensure` from
  this repo so health `script` points at source, not an install/cache copy.
  Verified 2026-09-02 (historical): 11 connectors; source script path.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Credential form Save fails or the connector shows no credential fields in the v2 UI | the page was opened before the daemon restarted (stale token, `401 bad_token`), or the connector declares no credential fields | reload the dashboard and retry the Settings credential form; otherwise `/plugin config`, a plugin `.env`, or `POST /api/connectors/env` / `/api/connectors/import` |
| Always "not set" but connector works in Claude | secret only in OS secure storage / Claude runtime | re-save once via `POST /api/connectors/env` or write `.env`; reload session |
| Status 401/403 with creds present | wrong key, wrong region/base URL, revoked token | rotate vendor credential; confirm region |
| Status MISSING_CREDENTIALS | required userConfig empty in all layers | save via `POST /api/connectors/env`, `/plugin config`, or a plugin `.env` |
| Tools still missing after save | MCP child started before save | fully reload Claude Code |
| Dashboard shows wrong DB / empty metrics | stale daemon on temp `ATLAS_DB` | `atlas_dashboard.py stop && ensure` |
| `401 bad_token` on a credential POST | page or client predates the daemon (the token is regenerated each daemon start) | reload the dashboard page; direct callers must send the `X-Atlas-Token` from the served `<meta name="atlas-token">` |
| `415` / `403 bad_origin` / `403 bad_host` | missing `Content-Type: application/json`, foreign `Origin`, or a Host other than `127.0.0.1:<port>` / `localhost:<port>` | call the API from the dashboard page, with the JSON header, on the dashboard's own host |

## Security rules

- Never log or render secret values in the dashboard JSON API.
- Allowlist keys from plugin `userConfig` + `.env.example` only.
- Prefer set-markers over reading secrets back from disk for UI badges.
- Loopback bind only (`127.0.0.1:7421`). Every route also passes the Host,
  Content-Type, Origin and `X-Atlas-Token` guard (see `dashboard-api.md`).

## Related files

- UI/daemon: `plugins/atlas/scripts/atlas_dashboard.py`
- Env preloader: `plugins/atlas/mcp/_env/load.mjs`
- MCP launch map: `plugins/atlas/.mcp.json`
- userConfig schema: `plugins/atlas/.claude-plugin/plugin.json`
- Setup skill guide: `skills/atlas-setup/references/connectors.md`
- Per-vendor key table: `skills/atlas-setup/references/vendors.md`
- Dashboard API notes: `skills/atlas-orchestrate/references/dashboard-api.md`
