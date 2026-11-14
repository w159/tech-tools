#!/usr/bin/env python3
"""Worker provider selection: Claude (default) or a local Ollama model via its Anthropic-compatible API.

Claude Code runs on Ollama with ANTHROPIC_BASE_URL=<ollama url>, ANTHROPIC_AUTH_TOKEN=ollama and an empty
ANTHROPIC_API_KEY. Ollama serves POST /v1/messages (streaming, tools, system, thinking); it has no
/v1/messages/count_tokens, tool_choice, metadata, prompt caching or batches. This module decides, per worker,
which provider launches it, checks the endpoint is healthy, and returns the env to apply. It never fails a run:
an unhealthy or unconfigured Ollama falls back to Claude with a reason, unless ATLAS_OLLAMA_STRICT=1.

Knobs (all environment variables):
  ATLAS_WORKER_PROVIDER      claude (default) | ollama | auto
  ATLAS_OLLAMA_MODEL         default Ollama model for every role
  ATLAS_OLLAMA_ROLE_MODELS   "explorer=qwen3:8b,runner=qwen3:8b" per-role models
  ATLAS_OLLAMA_URL           default http://127.0.0.1:11434 (loopback only unless ATLAS_OLLAMA_ALLOW_REMOTE=1)
  ATLAS_OLLAMA_ALLOW_REMOTE  1 allows a non-loopback URL
  ATLAS_OLLAMA_STRICT        1 refuses (exit 2) instead of falling back to Claude
  ATLAS_ADVERSARIAL_PAIRING  on (default) | off: cross-family verifier pairing in teams

CLI: atlas_provider.py doctor [--role R] | resolve [--role R] [--model M] [--provider P]
Stdlib only.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_URL = "http://127.0.0.1:11434"
HEALTH_TTL_S = 30
HEALTH_TIMEOUT_S = 1.5
MODEL_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
)  # same rule as atlas_ollama.NAME_RE
ROLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
PROVIDERS = ("claude", "ollama", "auto")
# env a worker on Ollama gets; CLAUDE_CODE_OAUTH_TOKEN is removed so the CLI cannot silently use the account
PROVIDER_ENV_KEYS = (
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "ATLAS_PROVIDER_ACTIVE",
)
UNSET_ENV = ("CLAUDE_CODE_OAUTH_TOKEN",)
VERIFIER_ROLES = ("verifier", "completeness-critic")
IMPLEMENTER_ROLES = ("implementer", "runner", "test-engineer", "docs-curator")
FALLBACK_REASONS = (
    "down",
    "model_missing",
    "no_anthropic_api",
    "timeout",
    "no_model",
    "remote_refused",
)


class ProviderRefused(Exception):
    """ATLAS_OLLAMA_STRICT=1 and Ollama cannot serve the worker."""


def _home() -> Path:
    return Path(os.environ.get("ATLAS_HOME") or (Path.home() / ".atlas"))


def is_loopback(url: str) -> bool:
    try:
        host = urllib.parse.urlparse(url).hostname or ""
    except ValueError:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def ollama_url(env=None) -> str:
    e = os.environ if env is None else env
    return (e.get("ATLAS_OLLAMA_URL") or DEFAULT_URL).strip().rstrip("/")


def role_models(env=None) -> dict:
    """{role: model} from ATLAS_OLLAMA_ROLE_MODELS; entries with an invalid role or model name are dropped."""
    e = os.environ if env is None else env
    out = {}
    for part in (e.get("ATLAS_OLLAMA_ROLE_MODELS") or "").split(","):
        role, _, model = part.partition("=")
        role, model = role.strip(), model.strip()
        if ROLE_RE.match(role) and MODEL_RE.match(model):
            out[role] = model
    return out


def model_for_role(role, env=None):
    e = os.environ if env is None else env
    m = role_models(e).get(role or "")
    if m:
        return m
    d = (e.get("ATLAS_OLLAMA_MODEL") or "").strip()
    return d if MODEL_RE.match(d) else None


# ---------------------------------------------------------------- health


def _http(method: str, url: str, body: bytes | None, timeout: float):
    """(status, text). Raises on connect failure or timeout; an HTTP error status is returned, not raised."""
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"content-type": "application/json", "x-api-key": "ollama"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 -- loopback unless opted in
            return r.status, r.read(1 << 20).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, e.read(1 << 16).decode("utf-8", "replace")
        except OSError:
            return e.code, ""


def _is_timeout(exc: BaseException) -> bool:
    import socket

    if isinstance(exc, (socket.timeout, TimeoutError)):
        return True
    reason = getattr(exc, "reason", None)
    return isinstance(reason, (socket.timeout, TimeoutError))


def _probe(url: str, model: str, timeout: float) -> dict:
    try:
        st, text = _http("GET", url + "/api/version", None, timeout)
        if st != 200:
            return {"ok": False, "reason": "down"}
        st, text = _http("GET", url + "/api/tags", None, timeout)
        names = []
        if st == 200:
            try:
                names = [
                    m.get("name", "") for m in (json.loads(text).get("models") or [])
                ]
            except (ValueError, AttributeError):
                names = []
        have = set(names) | {
            n[: -len(":latest")] for n in names if n.endswith(":latest")
        }
        if model not in have and f"{model}:latest" not in names:
            return {"ok": False, "reason": "model_missing"}
        # an invalid body must reach the handler (any non-404 answer) -- a 404 means no Anthropic API
        st, _ = _http("POST", url + "/v1/messages", b"{}", timeout)
        if st == 404:
            return {"ok": False, "reason": "no_anthropic_api"}
        return {"ok": True, "reason": None}
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {"ok": False, "reason": "timeout" if _is_timeout(exc) else "down"}


def _cache_path() -> Path:
    return _home() / "provider-health.json"


def _read_cache() -> dict:
    try:
        d = json.loads(_cache_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_cache(d: dict) -> None:
    p = _cache_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            dir=str(p.parent), prefix=".provider-health.", suffix=".tmp"
        )
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(d, fh)
        os.replace(tmp, p)
    except OSError:
        pass


def health(
    url: str, model: str, timeout: float = HEALTH_TIMEOUT_S, use_cache: bool = True
) -> dict:
    """{ok, reason, checked, cached}. Cached 30 s per (url, model) in $ATLAS_HOME/provider-health.json."""
    key = f"{url}|{model}"
    now = time.time()
    cache = _read_cache() if use_cache else {}
    hit = cache.get(key)
    if isinstance(hit, dict) and now - float(hit.get("checked") or 0) < HEALTH_TTL_S:
        return {**hit, "cached": True}
    res = {**_probe(url, model, timeout), "checked": now}
    if use_cache:
        fresh = {
            k: v
            for k, v in cache.items()
            if isinstance(v, dict) and now - float(v.get("checked") or 0) < HEALTH_TTL_S
        }
        fresh[key] = res
        _write_cache(fresh)
    return {**res, "cached": False}


# ---------------------------------------------------------------- resolve


def provider_env(url: str) -> dict:
    return {
        "ANTHROPIC_BASE_URL": url,
        "ANTHROPIC_AUTH_TOKEN": "ollama",
        "ANTHROPIC_API_KEY": "",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "ATLAS_PROVIDER_ACTIVE": "ollama",
    }


def apply_env(base: dict, res: dict) -> dict:
    """base with the resolution's env set and the account token removed (a copy)."""
    out = dict(base)
    for k in res.get("unset") or ():
        out.pop(k, None)
    out.update(res.get("env") or {})
    return out


def _claude(requested, why, model, extra=None):
    return {
        "provider": "claude",
        "model": model,
        "env": {},
        "unset": [],
        "fallback": why,
        "requested": requested,
        **(extra or {}),
    }


def resolve(role=None, model=None, provider=None, env=None) -> dict:
    """{provider, model, env, unset, fallback, requested, url?}.

    `provider` ("claude"|"ollama"|"auto") and `model` are an explicit per-worker request; `model` is an Ollama
    model only when provider is "ollama" (otherwise it is the Claude model and passes through untouched).
    Without them ATLAS_WORKER_PROVIDER decides and the Ollama model comes from ATLAS_OLLAMA_ROLE_MODELS /
    ATLAS_OLLAMA_MODEL. Raises ProviderRefused only under ATLAS_OLLAMA_STRICT=1."""
    e = os.environ if env is None else env
    req = (provider or e.get("ATLAS_WORKER_PROVIDER") or "claude").strip().lower()
    if req not in PROVIDERS:
        req = "claude"
    if req == "claude":
        return _claude("claude", None, model if provider != "ollama" else None)
    claude_model = None if provider == "ollama" else model
    chosen = (
        (model or "").strip()
        if provider == "ollama" and model
        else model_for_role(role, e)
    )
    if chosen is not None and not MODEL_RE.match(chosen):
        chosen = None

    def fall(reason: str) -> dict:
        if (e.get("ATLAS_OLLAMA_STRICT") or "").strip() == "1":
            raise ProviderRefused(
                f"ollama requested but unavailable: {reason} (ATLAS_OLLAMA_STRICT=1)"
            )
        return _claude(req, reason, claude_model)

    if not chosen:
        return fall("no_model")
    url = ollama_url(e)
    if (
        not is_loopback(url)
        and (e.get("ATLAS_OLLAMA_ALLOW_REMOTE") or "").strip() != "1"
    ):
        return fall("remote_refused")
    h = health(url, chosen)
    if not h["ok"]:
        return fall(h["reason"] or "down")
    return {
        "provider": "ollama",
        "model": chosen,
        "env": provider_env(url),
        "unset": list(UNSET_ENV),
        "fallback": None,
        "requested": req,
        "url": url,
    }


def record_launch(res: dict) -> None:
    """provider.<name>.used per launch, plus provider.ollama.fallback.<reason> when Ollama was wanted. Never raises."""
    try:
        import atlas_analytics

        atlas_analytics.record(f"provider.{res['provider']}.used")
        if res.get("fallback") in FALLBACK_REASONS and res.get("requested") != "claude":
            atlas_analytics.record(f"provider.ollama.fallback.{res['fallback']}")
    except Exception:  # noqa: BLE001 -- telemetry never changes a launch
        pass


def public(res: dict) -> dict:
    """The resolution without env (what a worker record or report shows)."""
    return {
        k: res.get(k)
        for k in ("provider", "model", "fallback", "requested")
        if k in res
    }


# ---------------------------------------------------------------- cross-family pairing


def adversarial_on(env=None) -> bool:
    e = os.environ if env is None else env
    return (e.get("ATLAS_ADVERSARIAL_PAIRING") or "on").strip().lower() not in (
        "off",
        "0",
        "false",
        "no",
    )


def pair_seats(
    seats: list, ollama_options: dict | None = None, adversarial: bool = True
) -> list:
    """Pure. seats: [{name, role, provider, model}]. Returns copies; a verifier seat may get a new provider/model
    and a `pair` note. ollama_options: {role: model} of healthy Ollama models configured for that role.

    * implementers on ollama -> verifier / completeness-critic seats run on claude
    * adversarial and implementers all on claude and a healthy Ollama model is configured for the verifier's
      role -> that verifier runs on ollama
    * a verifier never shares provider+model with an implementer when a different healthy option exists"""
    out = [dict(s) for s in seats]
    impl = [s for s in out if s.get("role") in IMPLEMENTER_ROLES]
    opts = ollama_options or {}
    if not impl:
        return out
    impl_keys = {(s.get("provider") or "claude", s.get("model")) for s in impl}
    for s in out:
        if s.get("role") not in VERIFIER_ROLES:
            continue
        own = (s.get("provider") or "claude", s.get("model"))
        if any(k[0] == "ollama" for k in impl_keys):
            if own[0] == "ollama":
                s.update(
                    provider="claude",
                    model=None,
                    pair="cross-family:implementer-on-ollama",
                )
            continue
        if adversarial and s.get("role") in opts and own[0] == "claude":
            s.update(
                provider="ollama",
                model=opts[s["role"]],
                pair="cross-family:implementer-on-claude",
            )
    return out


def team_options(roles, env=None) -> dict:
    """{role: model} for verifier roles with an EXPLICIT ATLAS_OLLAMA_ROLE_MODELS entry whose endpoint is healthy.
    The default ATLAS_OLLAMA_MODEL alone never moves a verifier: pairing is opt-in per role."""
    e = os.environ if env is None else env
    url = ollama_url(e)
    if (
        not is_loopback(url)
        and (e.get("ATLAS_OLLAMA_ALLOW_REMOTE") or "").strip() != "1"
    ):
        return {}
    out = {}
    for r in set(roles):
        m = role_models(e).get(r)
        if r in VERIFIER_ROLES and m and health(url, m)["ok"]:
            out[r] = m
    return out


# ---------------------------------------------------------------- CLI


def _cmd(args) -> int:
    try:
        res = resolve(
            args.role, getattr(args, "model", None), getattr(args, "provider", None)
        )
    except ProviderRefused as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    show = {**public(res), "env": res["env"], "role": args.role}
    if args.cmd == "resolve":
        print(json.dumps(show))
        return 0
    url = ollama_url()
    m = model_for_role(args.role) or getattr(args, "model", None)
    h = (
        health(url, m, use_cache=False)
        if m
        and (is_loopback(url) or os.environ.get("ATLAS_OLLAMA_ALLOW_REMOTE") == "1")
        else None
    )
    print(
        json.dumps(
            {
                **show,
                "url": url,
                "health": h,
                "ok": res["provider"] == "ollama" or res["requested"] == "claude",
            }
        )
    )
    return 0 if res["fallback"] is None else 1


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("doctor", "resolve"):
        sp = sub.add_parser(name)
        sp.add_argument("--role")
        sp.add_argument("--model")
        sp.add_argument("--provider", choices=PROVIDERS)
    return _cmd(p.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
