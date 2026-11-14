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
     atlas_provider.py bench --models claude:<model>,ollama:<model> [--runs N] [--task T] [--out F]
Stdlib only.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import shutil
import statistics
import subprocess
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


# ---------------------------------------------------------------- bench

BENCH_TASK = "Implement slugify(text) in slug.py so that every test in test_slug.py passes. Do not edit the tests."
BENCH_CHECK = "python3 -m unittest -q test_slug"
BENCH_STUB = (
    '"""URL slugs."""\n\n\ndef slugify(text):\n    """Return the URL slug of text."""\n    raise NotImplementedError\n'
)
BENCH_TESTS = """import unittest

from slug import slugify


class SlugTests(unittest.TestCase):
    def test_lower_and_hyphen(self):
        self.assertEqual(slugify("Hello World"), "hello-world")

    def test_punctuation_dropped(self):
        self.assertEqual(slugify("Hello, World!"), "hello-world")

    def test_runs_collapse(self):
        self.assertEqual(slugify("a   b---c"), "a-b-c")

    def test_trim_edges(self):
        self.assertEqual(slugify("  --Hi--  "), "hi")

    def test_digits_kept(self):
        self.assertEqual(slugify("Top 10 Tips"), "top-10-tips")

    def test_accents_folded(self):
        self.assertEqual(slugify("Caf\\u00e9 Cr\\u00e8me"), "cafe-creme")

    def test_empty(self):
        self.assertEqual(slugify("***"), "")


if __name__ == "__main__":
    unittest.main()
"""
BENCH_NOTE = (
    "wall_s is the crew engine's own clock (run start to sealed summary), so the lead's CLI start and exit are "
    "excluded. The first run per model is cold, the rest are warm. A run that fell back to another provider is "
    "marked and excluded from its column."
)


def parse_models(text: str) -> list:
    """[(provider, model)] from "claude:<model>,ollama:<model>". Raises ValueError on a bad entry."""
    out = []
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        prov, _, model = part.partition(":")
        prov, model = prov.strip().lower(), model.strip()
        if prov not in ("claude", "ollama") or not MODEL_RE.match(model):
            raise ValueError(f"bad --models entry {part!r}: use claude:<model> or ollama:<model>")
        out.append((prov, model))
    if not out:
        raise ValueError("--models needs at least one claude:<model> or ollama:<model>")
    return out


def make_fixture(parent: str, task: str, check: str) -> tuple:
    """A fresh git repo under parent with a stub, its tests and a one-worker plan. Returns (root, plan_path)."""
    root = tempfile.mkdtemp(prefix="repo-", dir=parent)
    Path(root, "slug.py").write_text(BENCH_STUB, encoding="utf-8")
    Path(root, "test_slug.py").write_text(BENCH_TESTS, encoding="utf-8")
    plan = {
        "goal": task,
        "check": check,
        "workers": [{"name": "slug", "owns": ["slug.py"], "task": task, "check": check, "tests": ["test_slug.py"]}],
    }
    plan_path = str(Path(root, "bench-plan.json"))
    Path(plan_path).write_text(json.dumps(plan, indent=1), encoding="utf-8")
    for argv in (
        ["init", "-q"],
        ["config", "user.name", "atlas-bench"],
        ["config", "user.email", "atlas-bench@localhost"],
        ["add", "-A"],
        ["commit", "-q", "-m", "bench fixture"],
    ):
        subprocess.run(["git", *argv], cwd=root, check=True, capture_output=True, timeout=60)
    return root, plan_path


def crew_runner(spec: dict, root: str, plan_path: str, timeout: float) -> dict:
    """Run the plan through the real `atlas_crew.py run --wait` and normalise its sealed summary:
    {ok, wall_s, tokens_in, tokens_out, tokens_cache_read, tokens_total, cost_usd, workers, error}."""
    scripts = Path(__file__).resolve().parent
    run_id = "bench-" + time.strftime("%H%M%S") + os.urandom(2).hex()
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in ("ATLAS_CREW_WORKER_MODEL", "ATLAS_OLLAMA_STRICT", "ATLAS_WORKER_PROVIDER")
    }
    argv = [
        sys.executable, str(scripts / "atlas_crew.py"), "run", "--plan", plan_path, "--root", root,
        "--model", spec["model"], "--provider", spec["provider"], "--no-tmux",
        "--wait", str(timeout), "--timeout", str(timeout), "--run-id", run_id,
    ]  # fmt: skip
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout + 60, cwd=root, env=env)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    lines = [ln for ln in p.stdout.splitlines() if ln.strip().startswith("{")]
    try:
        lead = json.loads(lines[-1])
    except (IndexError, ValueError):
        return {"ok": False, "error": f"no crew JSON (exit {p.returncode}): {(p.stderr or p.stdout)[-300:]}"}
    try:
        summ = json.loads(Path(lead.get("summary")).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {"ok": False, "error": f"no summary: {lead.get('error') or lead}"}
    usage = {"input": 0, "cache_write": 0, "cache_read": 0, "output": 0}
    try:
        import atlas_crew

        for w in summ.get("workers") or []:
            for log in sorted(Path(summ.get("transcripts") or "").glob(f"{w['name']}*.log")):
                u = atlas_crew.usage_of(log)
                for k in usage:
                    usage[k] += u.get(k, 0)
    except Exception:  # noqa: BLE001 -- the split is best effort; the rollup total still counts
        pass
    tw = summ.get("tokens_workers") or {}
    return {
        "ok": summ.get("ok") is True,
        "wall_s": summ.get("wall_s"),
        "tokens_in": usage["input"] + usage["cache_write"],
        "tokens_out": usage["output"],
        "tokens_cache_read": usage["cache_read"],
        "tokens_total": tw.get("total"),
        "cost_usd": tw.get("cost_usd") or 0.0,
        "workers": [
            {"provider": w.get("provider"), "model": w.get("model"), "fallback": w.get("fallback")}
            for w in summ.get("workers") or []
        ],
        "error": None if summ.get("ok") is True else (summ.get("check_tail") or "crew not ok")[-200:],
    }


def fixture_check(root: str, check: str) -> bool:
    """The harness runs the fixture's own test after the crew; it, not the crew's verdict, decides pass."""
    try:
        r = subprocess.run(check, shell=True, cwd=root, capture_output=True, timeout=120)  # noqa: S602
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def bench_one(spec: dict, idx: int, task: str, check: str, timeout: float, runner, checker, parent: str) -> dict:
    """One run in a fresh repo. A run is a fallback when a worker ran on another provider than requested."""
    root, plan_path = make_fixture(parent, task, check)
    t0 = time.time()
    try:
        out = runner(spec, root, plan_path, timeout) or {}
        passed = bool(checker(root, check))
    finally:
        shutil.rmtree(root, ignore_errors=True)
    fb = None
    for w in out.get("workers") or []:
        if w.get("fallback"):
            fb = w["fallback"]
            break
        if w.get("provider") and w["provider"] != spec["provider"]:
            fb = "provider_mismatch"
            break
    return {
        "provider": spec["provider"],
        "model": spec["model"],
        "run": idx + 1,
        "phase": "cold" if idx == 0 else "warm",
        "wall_s": out.get("wall_s"),
        "outer_s": round(time.time() - t0, 1),
        "tokens_in": out.get("tokens_in"),
        "tokens_out": out.get("tokens_out"),
        "tokens_cache_read": out.get("tokens_cache_read"),
        "cost_usd": 0.0 if spec["provider"] == "ollama" else (out.get("cost_usd") or 0.0),
        "crew_ok": bool(out.get("ok")),
        "pass": passed,
        "fallback": fb,
        "error": out.get("error"),
    }


def _mean(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    return round(statistics.fmean(vals), 4) if vals else None


def aggregate(runs: list) -> list:
    """One row per (provider, model, phase), in first-seen order. A fallback run is left out of the row's
    numbers and counted in `excluded`."""
    keys = []
    for r in runs:
        k = (r["provider"], r["model"], r["phase"])
        if k not in keys:
            keys.append(k)
    rows = []
    for prov, model, phase in keys:
        mine = [r for r in runs if (r["provider"], r["model"], r["phase"]) == (prov, model, phase)]
        used = [r for r in mine if not r.get("fallback")]
        walls = [r["wall_s"] for r in used if isinstance(r.get("wall_s"), (int, float))]
        rows.append(
            {
                "provider": prov,
                "model": model,
                "phase": phase,
                "n": len(used),
                "excluded": len(mine) - len(used),
                "wall_mean_s": _mean(walls),
                "wall_min_s": min(walls) if walls else None,
                "wall_max_s": max(walls) if walls else None,
                "tokens_in": _mean([r.get("tokens_in") for r in used]),
                "tokens_out": _mean([r.get("tokens_out") for r in used]),
                "tokens_cache_read": _mean([r.get("tokens_cache_read") for r in used]),
                "cost_usd": _mean([r.get("cost_usd") for r in used]),
                "passed": sum(1 for r in used if r.get("pass")),
            }
        )
    return rows


def _cell(v, nd=1):
    return "-" if v is None else f"{v:.{nd}f}"


def render_table(rows: list) -> str:
    head = ["provider:model", "phase", "n", "excluded", "wall s mean", "wall s min-max", "tok in", "tok out",
            "cache read", "Claude USD", "pass"]  # fmt: skip
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    for r in rows:
        span = "-" if r["wall_min_s"] is None else f"{_cell(r['wall_min_s'])}-{_cell(r['wall_max_s'])}"
        cost = "0.0000" if r["provider"] == "ollama" else _cell(r["cost_usd"], 4)
        cells = [f"{r['provider']}:{r['model']}", r["phase"], str(r["n"]), str(r["excluded"]), _cell(r["wall_mean_s"]),
                 span, _cell(r["tokens_in"], 0), _cell(r["tokens_out"], 0), _cell(r["tokens_cache_read"], 0), cost,
                 f"{r['passed']}/{r['n']}"]  # fmt: skip
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def cmd_bench(args, runner=None, checker=None) -> int:
    """Refuses (exit 2) before any run when a requested Ollama model is unhealthy: it never benchmarks a fallback."""
    try:
        specs = [{"provider": p, "model": m} for p, m in parse_models(args.models)]
    except ValueError as exc:
        print(f"bench refused: {exc}", file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    if args.runs < 1:
        print("bench refused: --runs must be at least 1", file=sys.stderr)
        print(json.dumps({"ok": False, "error": "--runs must be at least 1"}))
        return 2
    url = ollama_url()
    for s in (x for x in specs if x["provider"] == "ollama"):
        if not is_loopback(url) and (os.environ.get("ATLAS_OLLAMA_ALLOW_REMOTE") or "").strip() != "1":
            why = "remote_refused"
        else:
            h = health(url, s["model"], use_cache=False)
            why = None if h["ok"] else (h["reason"] or "down")
        if why:
            msg = (
                f"bench refused: ollama model {s['model']!r} at {url} is not healthy (reason: {why}). "
                f"Start Ollama and run `ollama pull {s['model']}`, then retry. A fallback to Claude is never benchmarked."
            )
            print(msg, file=sys.stderr)
            print(json.dumps({"ok": False, "error": msg, "reason": why}))
            return 2
    if runner is None and shutil.which("claude") is None:
        print("bench refused: the claude CLI is not on PATH", file=sys.stderr)
        print(json.dumps({"ok": False, "error": "claude CLI not on PATH"}))
        return 2
    task = (args.task or BENCH_TASK).strip()
    check = (args.check or BENCH_CHECK).strip()
    parent = tempfile.mkdtemp(prefix="atlas-bench-")
    runs = []
    try:
        for s in specs:
            for i in range(args.runs):
                r = bench_one(s, i, task, check, args.timeout, runner or crew_runner, checker or fixture_check, parent)
                runs.append(r)
                tail = f", FALLBACK {r['fallback']} (excluded)" if r["fallback"] else ""
                print(
                    f"{s['provider']}:{s['model']} run {i + 1}/{args.runs} {r['phase']}: "
                    f"wall {_cell(r['wall_s'])} s, pass={r['pass']}{tail}",
                    file=sys.stderr,
                )
    finally:
        shutil.rmtree(parent, ignore_errors=True)
    rows = aggregate(runs)
    print(render_table(rows))
    print("\n" + BENCH_NOTE)
    if args.out:
        report = {"task": task, "check": check, "runs_per_model": args.runs, "note": BENCH_NOTE, "summary": rows, "runs": runs}
        Path(args.out).write_text(json.dumps(report, indent=1), encoding="utf-8")
    return 0


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
    b = sub.add_parser("bench", help="same one-worker crew task on Claude and Ollama, side by side")
    b.add_argument("--models", required=True, help="claude:<model>,ollama:<model>")
    b.add_argument("--runs", type=int, default=3, help="runs per model; the first is cold, the rest warm")
    b.add_argument("--task", help="worker task text (default: the bundled slugify fixture task)")
    b.add_argument("--check", help="pass/fail command run in the repo (default: the fixture unittest)")
    b.add_argument("--timeout", type=float, default=900, help="seconds per run")
    b.add_argument("--out", help="write the JSON report here")
    a = p.parse_args(argv)
    if a.cmd == "bench":
        return cmd_bench(a)
    return _cmd(a)


if __name__ == "__main__":
    sys.exit(main())
