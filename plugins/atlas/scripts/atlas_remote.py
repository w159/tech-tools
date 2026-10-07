#!/usr/bin/env python3
"""Tailnet-only remote access for the colony (herdr-web-ui behind `tailscale serve`).

Verbs: status | plan | apply --yes [--replace] | disable --yes | url.
Never uses funnel. Never touches any serve mapping except the one atlas port
(ATLAS_REMOTE_PORT, default 8443, clamped 1024-65535, never 443).

Exit codes: 0 ok, 1 failed (tailscale/serve error), 2 usage / refused (missing
--yes, foreign mapping, open auth, bad URL), 3 tailscale unavailable / not logged in.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

DEFAULT_WEB_URL = "http://127.0.0.1:7317"
DEFAULT_PORT = 8443
HTTP_TIMEOUT = 3
TS_TIMEOUT = 15
# Present on every request tailscale serve proxies; makes herdr-web-ui evaluate the
# proxied (tailnet) path instead of its "direct loopback is local" shortcut.
PROXY_PROBE_HEADERS = {"X-Forwarded-For": "100.64.0.1"}

EXIT_OK, EXIT_FAIL, EXIT_REFUSED, EXIT_NO_TS = 0, 1, 2, 3


class RemoteError(Exception):
    def __init__(self, message: str, code: int = EXIT_REFUSED):
        super().__init__(message)
        self.code = code


# --------------------------------------------------------------------- config


def remote_port() -> int:
    try:
        port = int(os.environ.get("ATLAS_REMOTE_PORT", DEFAULT_PORT))
    except ValueError:
        port = DEFAULT_PORT
    port = max(1024, min(65535, port))
    return (
        DEFAULT_PORT if port == 443 else port
    )  # unreachable after clamp; belt and braces


def default_web_url() -> str:
    """The colony's URL as atlas_herdr resolves it: the vendored build's port ($ATLAS_HOME/colony/port, or the
    fallback it would start on when an upstream herdr-web-ui holds 7317), else http://127.0.0.1:7317."""
    try:
        import atlas_herdr  # sibling module; one definition of where the colony lives

        atlas_herdr._refresh_url()
        return atlas_herdr._where()[1]
    except Exception:
        return DEFAULT_WEB_URL


def web_url() -> str:
    """HERDR_WEB_URL override, loopback only: it becomes a serve proxy target and a probe target."""
    raw = os.environ.get("HERDR_WEB_URL", "").strip().rstrip("/") or default_web_url()
    parts = urlsplit(raw)
    if (
        parts.scheme != "http"
        or parts.hostname not in ("127.0.0.1", "localhost", "::1")
        or not parts.port
    ):
        raise RemoteError(
            f"HERDR_WEB_URL must be http://127.0.0.1:<port> (loopback only), got {raw!r}"
        )
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    return f"http://{host}:{parts.port}"


def serve_cmd(port: int, target: str) -> list[str]:
    return ["tailscale", "serve", "--bg", f"--https={port}", target]


def off_cmd(port: int) -> list[str]:
    return ["tailscale", "serve", f"--https={port}", "off"]


# ------------------------------------------------------------------ tailscale


def _ts(*args: str) -> str:
    exe = shutil.which("tailscale")
    if not exe:
        raise RemoteError(
            "tailscale not found on PATH; install it from https://tailscale.com/download",
            EXIT_NO_TS,
        )
    try:
        proc = subprocess.run(
            [exe, *args], capture_output=True, text=True, timeout=TS_TIMEOUT
        )
    except subprocess.TimeoutExpired as exc:
        raise RemoteError(
            f"`tailscale {' '.join(args)}` timed out after {TS_TIMEOUT}s", EXIT_FAIL
        ) from exc
    if proc.returncode != 0:
        raise RemoteError(
            f"`tailscale {' '.join(args)}` failed: {(proc.stderr or proc.stdout).strip()}",
            EXIT_FAIL,
        )
    return proc.stdout


def _ts_json(*args: str) -> dict:
    out = _ts(*args).strip()
    if not out:
        return {}
    try:
        data = json.loads(out)
    except json.JSONDecodeError as exc:
        raise RemoteError(
            f"`tailscale {' '.join(args)}` returned non-JSON: {exc}", EXIT_FAIL
        ) from exc
    return data if isinstance(data, dict) else {}


def tailscale_state() -> dict:
    """Installed / logged-in / DNS name / IPs from `tailscale status --json`."""
    if not shutil.which("tailscale"):
        return {"installed": False, "logged_in": False, "dns_name": None, "ips": []}
    st = _ts_json("status", "--json")
    me = st.get("Self") or {}
    dns = (me.get("DNSName") or "").rstrip(".") or None
    return {
        "installed": True,
        "backend_state": st.get("BackendState"),
        "logged_in": st.get("BackendState") == "Running" and bool(dns),
        "dns_name": dns,
        "ips": list(me.get("TailscaleIPs") or st.get("TailscaleIPs") or []),
        "tailnet": (st.get("CurrentTailnet") or {}).get("Name"),
    }


def serve_entries() -> tuple[list[dict], list[dict]]:
    """Normalise `tailscale serve status --json` -> (serve entries, funnel entries).

    Real shape (tailscale 1.102): {"TCP": {"443": {"HTTPS": true}}, "Web": {"host:443":
    {"Handlers": {"/": {"Proxy": "http://127.0.0.1:18790"}}}}, "AllowFunnel": {"host:443": true}}.
    """
    cfg = _ts_json("serve", "status", "--json")
    funnel_hosts = {k for k, v in (cfg.get("AllowFunnel") or {}).items() if v}
    entries, funnels = [], []
    for hostport, web in (cfg.get("Web") or {}).items():
        host, _, port = hostport.rpartition(":")
        for path, handler in ((web or {}).get("Handlers") or {}).items():
            entries.append(
                {
                    "host": host,
                    "port": int(port) if port.isdigit() else None,
                    "path": path,
                    "target": handler.get("Proxy")
                    or handler.get("Path")
                    or handler.get("Text"),
                    "funnel": hostport in funnel_hosts,
                }
            )
    for hostport in funnel_hosts:
        host, _, port = hostport.rpartition(":")
        funnels.append({"host": host, "port": int(port) if port.isdigit() else None})
    # TCP-forward entries with no Web handler (e.g. `serve --tcp`) still occupy the port
    web_ports = {e["port"] for e in entries}
    for port, spec in (cfg.get("TCP") or {}).items():
        if (
            port.isdigit()
            and int(port) not in web_ports
            and not (spec or {}).get("HTTPS")
        ):
            entries.append(
                {
                    "host": None,
                    "port": int(port),
                    "path": None,
                    "target": (spec or {}).get("TCPForward"),
                    "funnel": False,
                }
            )
    return entries, funnels


def _norm(url: str | None) -> str:
    return (url or "").rstrip("/").replace("localhost", "127.0.0.1")


def mapping_on(port: int, entries: list[dict]) -> list[dict]:
    return [e for e in entries if e["port"] == port]


# ------------------------------------------------------------------ herdr-web-ui


def _get(url: str, headers: dict | None = None) -> dict:
    if not url.startswith("http://"):  # only ever the validated loopback base
        return {"_error": f"refusing non-http url {url!r}"}
    req = urllib.request.Request(url, headers=headers or {})  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {"_error": str(getattr(exc, "reason", exc))}


def web_state(base: str) -> dict:
    """Direct /api/health + /api/access, plus an anonymous *proxied* probe.

    A direct loopback request is always "local" (auth.required=false) in herdr-web-ui, so it
    says nothing about the tailnet. The proxied probe sends X-Forwarded-For with no
    Tailscale-User-Login: required=true means strangers are refused (owner login / pairing /
    token needed); required=false means the tailnet path is open.
    """
    health = _get(f"{base}/api/health")
    access = _get(f"{base}/api/access")
    probe = _get(f"{base}/api/health?scope=bridge", PROXY_PROBE_HEADERS)
    up = "_error" not in health
    direct = health.get("auth") or {}
    proxied = probe.get("auth") or {}
    ts = access.get("tailscale") or {}
    return {
        "url": base,
        "up": up,
        "error": health.get("_error"),
        "herdr": health.get("herdr"),
        "auth": {
            "required": direct.get("required"),
            "via": direct.get("via"),
            "role": direct.get("role"),
        },
        "access": None if "_error" in access else access,
        "tailnet_probe": {
            "required": proxied.get("required"),
            "reason": proxied.get("reason"),
            "authenticated": proxied.get("authenticated"),
        }
        if "_error" not in probe
        else None,
        # an owner login is only usable when tailscale serve is running and names this machine
        "owner_identity": ts.get("state") == "running" and bool(ts.get("dns_name")),
    }


def auth_gate_ok(web: dict) -> tuple[bool, str]:
    """True when an anonymous tailnet request would be refused."""
    if not web["up"]:
        return (
            False,
            f"herdr-web-ui is not reachable at {web['url']} ({web['error']}); start it first (atlas_herdr.py ensure)",
        )
    probe = web["tailnet_probe"]
    if probe is None:
        return (
            False,
            "cannot verify the tailnet auth gate (proxied health probe failed)",
        )
    if probe["required"]:
        return (
            True,
            f"anonymous tailnet requests are refused ({probe['reason'] or 'auth required'})",
        )
    # auth.required=false for an anonymous proxied request: no token, no owner identity, no paired devices
    return False, (
        "herdr-web-ui would let any tailnet peer in (auth.required=false, no Tailscale owner identity, "
        "no paired-device policy). Set HERDR_WEB_TOKEN or pair a device, then retry"
    )


# ---------------------------------------------------------------------- verbs


def cmd_status(_a) -> int:
    ts = tailscale_state()
    port = remote_port()
    out: dict = {
        "port": port,
        "tailscale": ts,
        "serve": [],
        "funnel": [],
        "warnings": [],
    }
    if ts["installed"]:
        try:
            out["serve"], out["funnel"] = serve_entries()
        except RemoteError as exc:
            out["warnings"].append(str(exc))
    try:
        out["herdr_web_ui"] = web_state(web_url())
    except RemoteError as exc:
        out["herdr_web_ui"] = {"error": str(exc)}
    for f in out["funnel"]:
        out["warnings"].append(
            f"WARN: funnel is enabled on {f['host']}:{f['port']} (public internet). "
            "Atlas never enables funnel; turn it off with `tailscale funnel reset`."
        )
    if ts["dns_name"]:
        out["url"] = f"https://{ts['dns_name']}:{port}"
        mine = mapping_on(port, out["serve"])
        out["managed_mapping"] = mine[0] if mine else None
    print(json.dumps(out, indent=2))
    return EXIT_OK if ts["logged_in"] else EXIT_NO_TS


def cmd_plan(_a) -> int:
    port, target = remote_port(), web_url()
    print(
        "# tailnet-only HTTPS (never funnel). Review, then run via `atlas_remote.py apply --yes`:"
    )
    print(" ".join(serve_cmd(port, target)))
    if target != DEFAULT_WEB_URL:
        print(
            f"# target is the colony on {target}, not 7317 (an upstream herdr-web-ui holds it). If https:{port} "
            f"already maps elsewhere (e.g. to 7317), re-pointing it needs `atlas_remote.py apply --yes --replace`."
        )
    print("# to remove (only this port):")
    print(" ".join(off_cmd(port)))
    return EXIT_OK


def _need_login() -> dict:
    ts = tailscale_state()
    if not ts["installed"]:
        raise RemoteError(
            "tailscale not found on PATH; install it from https://tailscale.com/download",
            EXIT_NO_TS,
        )
    if not ts["logged_in"]:
        raise RemoteError(
            "tailscale is not logged in / running; run `tailscale up`", EXIT_NO_TS
        )
    return ts


def cmd_apply(a) -> int:
    if not a.yes:
        raise RemoteError(
            "refusing to change tailscale serve without --yes (see `plan`)"
        )
    port, target = remote_port(), web_url()
    ts = _need_login()
    entries, funnels = serve_entries()
    if any(f["port"] == port for f in funnels):
        raise RemoteError(
            f"port {port} has funnel enabled (public); run `tailscale funnel reset` first. Atlas will not proceed."
        )
    mine = mapping_on(port, entries)
    if mine and all(_norm(e["target"]) == _norm(target) for e in mine):
        print(f"already mapped: https://{ts['dns_name']}:{port} -> {target}")
        return EXIT_OK
    if mine and not a.replace:
        raise RemoteError(
            f"port {port} already maps to {mine[0]['target']}, not {target}; "
            "pass --replace to overwrite, or set ATLAS_REMOTE_PORT to another port"
        )
    ok, why = auth_gate_ok(web_state(target))
    if not ok:
        raise RemoteError(f"refusing to expose the colony: {why}")
    _ts(*serve_cmd(port, target)[1:])
    entries, funnels = serve_entries()
    now = mapping_on(port, entries)
    if (
        not now
        or any(_norm(e["target"]) != _norm(target) for e in now)
        or any(f["port"] == port for f in funnels)
    ):
        raise RemoteError(
            f"serve command ran but port {port} does not map to {target} afterwards: {now}",
            EXIT_FAIL,
        )
    print(f"ok: https://{ts['dns_name']}:{port} -> {target} ({why})")
    return EXIT_OK


def cmd_disable(a) -> int:
    if not a.yes:
        raise RemoteError("refusing to change tailscale serve without --yes")
    port = remote_port()
    _need_login()
    entries, _ = serve_entries()
    if not mapping_on(port, entries):
        print(f"nothing to do: no mapping on https port {port}")
        return EXIT_OK
    _ts(*off_cmd(port)[1:])
    entries, _ = serve_entries()
    if mapping_on(port, entries):
        raise RemoteError(f"`serve off` ran but port {port} is still mapped", EXIT_FAIL)
    print(f"ok: removed https port {port} mapping (other mappings untouched)")
    return EXIT_OK


def cmd_url(_a) -> int:
    ts = tailscale_state()
    if not ts["dns_name"]:
        raise RemoteError(
            "no tailnet DNS name: tailscale missing or not logged in", EXIT_NO_TS
        )
    print(f"https://{ts['dns_name']}:{remote_port()}")
    return EXIT_OK


VERBS = {
    "status": cmd_status,
    "plan": cmd_plan,
    "apply": cmd_apply,
    "disable": cmd_disable,
    "url": cmd_url,
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="atlas_remote.py", description="Tailnet-only remote access for the colony"
    )
    sub = p.add_subparsers(dest="verb", required=True)
    for v in VERBS:
        sp = sub.add_parser(v)
        if v in ("apply", "disable"):
            sp.add_argument("--yes", action="store_true", help="confirm the change")
        if v == "apply":
            sp.add_argument(
                "--replace",
                action="store_true",
                help="overwrite a different mapping on the atlas port",
            )
    a = p.parse_args(argv)
    try:
        return VERBS[a.verb](a)
    except RemoteError as exc:
        print(f"atlas_remote: {exc}", file=sys.stderr)
        return exc.code


if __name__ == "__main__":
    sys.exit(main())
