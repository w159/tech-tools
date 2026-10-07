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
`ATLAS_DASHBOARD_URL`, default `http://127.0.0.1:7421`). The Command Center's Colony page frames the herdr app as
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

1. **token**: shared `HERDR_WEB_TOKEN` matched (cookie/bearer) -> full, role `drive`.
2. **paired device**: valid device cookie -> full, device's role.
3. **token_required**: a token is configured but not presented -> refused. This precedes the
   login check so a forged `Tailscale-User-Login` header cannot bypass a token.
4. **owner login**: loopback + `Tailscale-User-Login` equals this PC's own Tailscale login (or
   `HERDR_WEB_TAILSCALE_OWNER`) -> full via `tailscale`; any other login -> `other_user`.
5. **pairing_required**: a proxied request with no usable identity (tagged node, no login header,
   or a gated/funnel request) is refused until the device is paired.

A direct loopback request with no proxy headers is always `via: local` (open) so the local UI
keeps working. That makes a plain `/api/health` **useless as a tailnet check**.

## How atlas verifies auth

`atlas_remote.py` probes `GET /api/health?scope=bridge` with `X-Forwarded-For` and no login
header, i.e. exactly what an anonymous tailnet peer looks like to `decideAccess`.

- `auth.required=true` (e.g. `pairing_required`): gate holds, `apply` may proceed.
- `auth.required=false`: any tailnet peer would get in. `apply` refuses (no token, no owner
  identity, no paired-device policy). Fix by setting `HERDR_WEB_TOKEN` or pairing a device.
- herdr-web-ui unreachable or probe failed: `apply` refuses (fail closed).

`status` also reports the direct `/api/health` auth (`required/via/role`) and `/api/access`
(Tailscale state, DNS name, serving URL).

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
(loopback `http://127.0.0.1:<port>` only; anything else is rejected; overrides the colony URL). Read by the web UI, not
by `atlas_remote.py`: `HERDR_WEB_TOKEN` (shared token), `ATLAS_DASHBOARD_URL` (where `/atlas/**` proxies; loopback
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
