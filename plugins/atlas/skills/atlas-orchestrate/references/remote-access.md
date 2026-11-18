# Remote access to the colony (tailnet-only)

The colony UI is the vendored herdr-web-ui (Bun, `127.0.0.1:7317` when that port is free, otherwise a fallback port
17317/27317/37317/47317 recorded in `$ATLAS_HOME/colony/port`; `colony/herdr-web-ui`). It exposes live
terminals, so **reaching it is remote code execution on this Mac as your user.** Authentication is
mandatory, never optional, and the only supported remote path is Tailscale `serve`.

## Contents

- What the tailnet URL opens
- Model
- Auth order
- How atlas verifies auth
- Commands
- Taking 7317 from an upstream herdr-web-ui

## What the tailnet URL opens

The tailnet URL (`atlas_remote.py url`) lands on the **Atlas dashboard**, not on the bare herdr app. Path of a
request: browser -> `tailscale serve :8443` -> herdr-web-ui Bun server. After herdr-web-ui's own auth (below)
accepts the request, a plain browser navigation of `/` is answered `302 /atlas/#/herd`
(`server/atlas-landing.ts`), and `/atlas/**` is proxied to the loopback dashboard (`server/atlas-gateway.ts`,
`ATLAS_DASHBOARD_URL`, default `http://127.0.0.1:7421`). The gateway authenticates to the dashboard with the token
it reads from the owner-only file `dashboard-<port>.token` under `$ATLAS_HOME` (or `~/.atlas`), so the web UI must run
as the dashboard's owner with the same `ATLAS_HOME`; it no longer fetches `GET /` for it. The Command Center's Colony page frames the herdr app as
`/?chrome=full` and the Fleet inspector frames a pane as `/?chrome=pane&pane=<id>&machine=local`; open
`https://<node>.<tailnet>.ts.net:8443/?chrome=full` to get the herdr UI on its own (a top-level `chrome=full` visit shows
the normal herdr UI; the legacy `?embed=1` is rewritten to `chrome=pane`/`chrome=full`). An
unauthenticated request is never redirected: it gets the normal pairing/token flow. `ATLAS_LANDING=off` turns the
redirect off (the herdr app is then served at `/`). A dashboard that is down answers
`502 atlas_dashboard_unreachable` under `/atlas/`.

## Model

1. **Loopback bind.** herdr-web-ui listens on `127.0.0.1` only (port 7317, or the fallback port). The atlas dashboard
   (`127.0.0.1:7421`) stays loopback and is reachable from the tailnet only through the `/atlas/**`
   gateway behind herdr-web-ui's auth; nothing atlas-owned listens on a LAN address.
2. **`tailscale serve`, tailnet-only HTTPS.** `tailscale serve` terminates TLS on the node and
   proxies to loopback. Only devices in your tailnet can connect. Default public name:
   `https://<node>.<tailnet>.ts.net:8443` (`ATLAS_REMOTE_PORT`, clamped 1024-65535, never 443).
3. **Funnel is unsupported.** `tailscale funnel` publishes to the public internet. Atlas never
   runs it, `plan`/`apply` never emit it, `apply` refuses a port that has funnel enabled, and
   `status` prints `WARN` for any funnel entry. Remove one with `tailscale funnel reset`.
4. **Other mappings are not ours.** The existing `:443 -> 127.0.0.1:18790` mapping is unrelated.
   Atlas only ever writes or removes its own port, and refuses to overwrite a different target
   there without `--replace`.

## Auth order (herdr-web-ui `server/access.ts`, `decideAccess`)

First match wins:

1. **token**: the shared token matched (cookie/bearer) -> full, role `drive`. The token is
   `HERDR_WEB_TOKEN` when an operator set it, otherwise the per-install 0600 `local-token` file
   the server creates (state dir `HERDR_WEB_STATE_DIR`, else `$ATLAS_HOME/colony/state/app`, else
   `~/.config/herdr-web-ui`; `scripts/plugin.ts` reads the same file).
2. **paired device**: valid device cookie -> full, device's role.
3. **token_required**: an **operator-configured** token (`HERDR_WEB_TOKEN`) is set but not
   presented -> refused. This precedes the login check so a forged `Tailscale-User-Login` header
   cannot bypass an operator's token. The generated `local-token` does not count here: it stands
   in for "this PC" only, so it never blocks the owner login.
4. **owner login**: loopback + `Tailscale-User-Login` equals this PC's own Tailscale login (or
   `HERDR_WEB_TAILSCALE_OWNER`) -> full via `tailscale`, no token needed; any other login ->
   `other_user`.
5. **bare loopback**: a direct loopback request with no proxy headers is `token_required`
   (it needs the `local-token` file) unless the host opts out with `HERDR_WEB_TRUST_LOCAL=1`,
   which makes it `via: local` (open). Another local user can open a loopback port, so "from
   this PC" is not an identity.
6. **pairing_required**: a proxied request with no usable identity (tagged node, no login header,
   or a gated/funnel request) is refused until the device is paired.

Because bare loopback is gated, a plain `/api/health` is still **useless as a tailnet check**:
`atlas_remote.py` probes as a proxied, anonymous peer instead (below). `/api/health`,
`/api/auth` and `/api/devices/pair` stay reachable without a token so a client can discover
the gate (`server/auth.ts` `requiresAuth`).

Known limit: the Command Center frames the herdr app with a bare URL (`scripts/dashboard_ui/js/fleet.js`
`consoleUrl`/`paneUrl`), so a browser with no herdr cookie sees the herdr token prompt inside the
frame once per browser, until the token is entered (the cookie is host-scoped, `SameSite=Strict`).
Putting the token in the frame URL would leak it, so it is not done. Not yet checked in a live browser.

## How atlas verifies auth

`atlas_remote.py` probes `GET /api/health?scope=bridge` with `X-Forwarded-For` and no login
header, i.e. exactly what an anonymous tailnet peer looks like to `decideAccess`.

- `auth.required=true` (e.g. `pairing_required`): gate holds, `apply` may proceed.
- `auth.required=false`: any tailnet peer would get in. `apply` refuses (no token, no owner
  identity, no paired-device policy). Fix by setting `HERDR_WEB_TOKEN` or pairing a device.
- herdr-web-ui unreachable or probe failed: `apply` refuses (fail closed).

`status` also reports the direct `/api/health` auth (`required/via/role`) and `/api/access`
(Tailscale state, DNS name, serving URL). The direct calls send the local token as a bearer
(`HERDR_WEB_TOKEN`, else the `local-token` file), because a bare loopback request is refused
without it; the proxied probe never carries a token. `herdr_web_ui.auth.token_source` names
where the token came from (`HERDR_WEB_TOKEN`, a file path, or why none was found), never the
token itself.

## Commands

```
python3 plugins/atlas/scripts/atlas_remote.py status            # JSON: tailscale, serve, funnel (+WARN), web-ui auth
python3 plugins/atlas/scripts/atlas_remote.py plan              # prints the exact commands, runs nothing
python3 plugins/atlas/scripts/atlas_remote.py apply --yes       # run the serve command (add --replace to overwrite a foreign mapping on our port)
python3 plugins/atlas/scripts/atlas_remote.py disable --yes     # remove only our https port mapping
python3 plugins/atlas/scripts/atlas_remote.py url               # https://<node>.<tailnet>.ts.net:8443
```

The exact tailscale commands (what `plan` prints; the target is the colony URL as `atlas_herdr` resolves it, so
`7317` below becomes the fallback port when the vendored build runs on one):

```
tailscale serve --bg --https=8443 http://127.0.0.1:7317
tailscale serve --https=8443 off
```

Env read by `atlas_remote.py`: `ATLAS_REMOTE_PORT` (default 8443, clamped 1024-65535, never 443) and `HERDR_WEB_URL`
(loopback `http://127.0.0.1:<port>` only; anything else is rejected; overrides the colony URL). Read by `atlas_remote.py` and the web UI: `HERDR_WEB_TOKEN`, `HERDR_WEB_STATE_DIR` (where `local-token` lives). Read by the web UI, not
by `atlas_remote.py`: `HERDR_WEB_TRUST_LOCAL` (`1` lets a bare loopback request in without the token), `ATLAS_DASHBOARD_URL` (where `/atlas/**` proxies; loopback
`http://` host with a port, default `http://127.0.0.1:7421`) and `ATLAS_LANDING` (`off` disables the `/` redirect).

Exit codes: `0` ok, `1` tailscale command failed or post-check mismatch, `2` refused / usage
(missing `--yes`, foreign mapping, funnel on port, open auth, non-loopback URL), `3` tailscale
missing or not logged in.

`apply` and `disable` change externally reachable network state: both require `--yes` and
re-read `tailscale serve status --json` afterwards to confirm the result.

## Taking 7317 from an upstream herdr-web-ui

If a user-run upstream herdr-web-ui holds 7317 the vendored build (and so the `/atlas/**` gateway and the `/` redirect) runs on a
fallback port and `atlas_herdr.py status` prints a `takeover` list. Run the steps in this order (disabling first makes the
`stop` action fail with `plugin_disabled` and leaves the server running):

1. `herdr plugin action invoke stop --plugin devswha.herdr-web-ui` (while the plugin is still enabled)
2. `herdr plugin disable devswha.herdr-web-ui`
3. `rm -f ~/.atlas/colony/port` (`$ATLAS_HOME/colony/port`)
4. `python3 plugins/atlas/scripts/atlas_herdr.py ensure`
5. `python3 plugins/atlas/scripts/atlas_remote.py apply --yes --replace` (re-point the `:8443` mapping)

Verified 2026-10-07 after this sequence: the vendored build was the sole 7317 listener, `/atlas/api/health` returned the
dashboard JSON locally and over the tailnet `:8443` URL, `/` redirected to `/atlas/#/herd`, and a forwarded request without
credentials got `pairing_required`.
