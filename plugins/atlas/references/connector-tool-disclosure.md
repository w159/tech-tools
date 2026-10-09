# Connector tool disclosure

## Current behavior (do not break) — measured 2026-10-07

Every connector is credential-gated: with no credentials it lists only its meta
tools, and `<vendor>_status` names the exact env vars to set. After credentials
are configured and the server restarts, the full surface registers. The counts
below are asserted by `node test-mcp-tools.mjs` (the `--no-creds` pass checks the
first two columns, the placeholder pass checks the floor) and by
`scripts/test_connectors_wiring.py` (this table against the harness).

<!-- connector-table:start -->
| Connector | Tools unconfigured | Configured floor | Meta tools listed without credentials |
|---|---|---|---|
| auvik | 2 | 39 | `auvik_navigate`, `auvik_status` |
| blumira | 2 | 31 | `blumira_navigate`, `blumira_status` (domain tools appear after `blumira_navigate`) |
| cipp | 1 | 43 | `cipp_status` |
| connectwise | 2 | 52 | `cw_status`, `cw_test_connection` |
| falcon | 4 | 145 | `falcon_status`, `falcon_check_connectivity`, `falcon_list_enabled_modules`, `falcon_list_enabled_tools` |
| knowbe4 | 2 | 30 | `knowbe4_navigate`, `knowbe4_status` |
| ninjaone | 5 | 45 | `ninjaone_status`, `ninjaone_navigate`, `ninjaone_auth_status`, `ninjaone_sign_in`, `ninjaone_sign_out` |
| panos | 2 | 60 | `panos_navigate`, `panos_status` |
| paylocity | 2 | 16 | `paylocity_navigate`, `paylocity_status` |
| spanning | 2 | 14 | `spanning_navigate`, `spanning_status` |
| threatlocker | 2 | 30 | `threatlocker_navigate`, `threatlocker_status` |
| vanta | 2 | 28 | `vanta_navigate`, `vanta_status` |
<!-- connector-table:end -->

An agent that expects a vendor tool before credentials are saved will not find
it: call `<vendor>_status` first and treat `NOT CONFIGURED` / `MISSING_CREDENTIALS`
as configure-and-restart, not as an endpoint sweep (enforced by
`connector_credential_watch`).

## What "configured" means

The dashboard decides per connector from `CONNECTOR_AUTH` in
`scripts/atlas_dashboard.py`, mirroring what each `*_status` names as required:
a secret alone is not enough (auvik also needs a username, vanta a client id, panos
a host, ...), and alternate setups count (blumira JWT only, cipp base URL + API key,
ninjaone `NINJAONE_AUTH_MODE=user`). "Test connector" starts the server exactly as
`.mcp.json` does, calls `<vendor>_status`, and reports `configured` from it.

## Environment precedence

`mcp/_env/load.mjs` / `load.py`: variables exported by the launching shell win;
then `ATLAS_ENV_FILE`; then `~/.config/atlas/atlas.env`; then `CFG_<NAME>`
(plugin userConfig) fills any gap. Missing and world-readable env files are
reported on stderr by name (never by value).

## Why not flip every Node connector to a different disclosure

Bundled `mcp/<name>/server.mjs` files are vendored ESM builds. Changing disclosure
requires source edits under `mcp_servers/*` **and** a rebuild/copy into
`plugins/atlas/mcp/`. Mass rebuilds are deliberate, not casual.

## Falcon behavior (atlas contract)

1. Missing `FALCON_CLIENT_ID` / `FALCON_CLIENT_SECRET` → inert boot (no crash).
2. Present but invalid credentials → inert boot with `falcon_status.state=AUTH_FAILED`.
3. Successful auth → full tool registration including `falcon_status` (`state=OK`).
4. Prefer `falcon_status` before any domain Falcon call. Do not treat
   `falcon_check_rtr_command_status` as a configuration probe.

## Known gap: status envelope

The 12 `*_status` tools return three different shapes (JSON with `ok`, JSON with
`configured`, prose). `auvik_status` returns `ok: true` with no credentials. A
shared `{connector, state, verified, missing[]}` envelope needs source changes
under `mcp_servers/_shared` and a bundle rebuild; until then the dashboard and
the harness match on the unconfigured markers each tool emits.
