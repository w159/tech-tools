#!/usr/bin/env python3
"""Ollama wrapper for the Command Center: model list, status, pull jobs, delete.

Everything shells out to the `ollama` CLI through `run`, the one subprocess
seam: tests replace it with a fake binary. Mounted by atlas_dashboard.py via
ROUTES, like the other atlas_dash_* modules.

Cloud detection: a tag ending in `:cloud`, or a SIZE column of `-` (the CLI
prints no size for models served from ollama.com).
"""

from __future__ import annotations

import difflib
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

LIBRARY_URL = "https://ollama.com/library?sort=popular"
LIBRARY_TTL_S = 600
LIBRARY_FETCH_TIMEOUT_S = 3
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_UNITS = {"B": 1, "KB": 10**3, "MB": 10**6, "GB": 10**9, "TB": 10**12}
_AGE = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
    "week": 7 * 86400,
    "month": 30 * 86400,
    "year": 365 * 86400,
}
_ROW = re.compile(r"^(\S+)\s+(\S+)\s+(-|[\d.]+\s*[KMGT]?B)\s+(.+?)\s*$")


def _env() -> dict:
    env = dict(os.environ)
    if os.environ.get("ATLAS_OLLAMA_URL"):
        env["OLLAMA_HOST"] = os.environ["ATLAS_OLLAMA_URL"]
    return env


def run(argv, timeout: float | None = 15, on_line=None):
    """(returncode, stdout, stderr). With on_line, stdout+stderr stream to it line by line.

    rc 127 means the binary is missing; rc 124 means it timed out.
    """
    try:
        if on_line is None:
            p = subprocess.run(
                argv, capture_output=True, text=True, timeout=timeout, env=_env()
            )
            return p.returncode, p.stdout, p.stderr
        p = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=_env(),
        )
        buf = ""
        assert p.stdout is not None
        while True:
            ch = p.stdout.read(1)
            if not ch:
                break
            if ch in "\r\n":  # ollama redraws progress with \r
                if buf.strip():
                    on_line(buf.strip())
                buf = ""
            else:
                buf += ch
        if buf.strip():
            on_line(buf.strip())
        return p.wait(), "", ""
    except FileNotFoundError:
        return 127, "", "ollama binary not found"
    except subprocess.TimeoutExpired:
        return 124, "", "ollama timed out"


# --- parsing ---------------------------------------------------------------


def _size_bytes(text: str):
    m = re.match(r"^([\d.]+)\s*([KMGT]?B)$", text.strip())
    return int(float(m.group(1)) * _UNITS[m.group(2)]) if m else None


def _age_seconds(text: str):
    m = re.match(r"^(?:about\s+)?(an?|\d+)\s+(\w+?)s?\s+ago$", text.strip())
    if not m or m.group(2) not in _AGE:
        return None
    n = 1 if m.group(1) in ("a", "an") else int(m.group(1))
    return n * _AGE[m.group(2)]


def _params(name: str):
    m = re.search(r"(?<![\w.])(\d+(?:\.\d+)?)([bm])\b", name.lower())
    return f"{m.group(1)}{m.group(2).upper()}" if m else None


def parse_list(text: str, now=None) -> list[dict]:
    """Rows of `ollama list` (header skipped) as model dicts."""
    now = time.time() if now is None else now
    out = []
    for line in text.splitlines():
        m = _ROW.match(line.strip())
        if not m or m.group(1) == "NAME":
            continue
        name, mid, size, modified = m.groups()
        family, _, tag = name.partition(":")
        age = _age_seconds(modified)
        out.append(
            {
                "name": name,
                "id": mid,
                "tag": tag or "latest",
                "family": family.rsplit("/", 1)[-1],
                "params": _params(tag) or _params(family),
                "size_bytes": _size_bytes(size),
                "modified": modified,
                "modified_at": round(now - age) if age is not None else None,
                "cloud": tag == "cloud" or size == "-",
                "running": False,
                "context": None,
                "quant": None,
                "popularity_rank": None,
            }
        )
    return out


def parse_ps(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines()[1:]:
        parts = re.split(r"\s{2,}", line.strip())
        if parts and parts[0]:
            rows.append({"name": parts[0], "line": line.strip()})
    return rows


# --- popularity (cached scrape of the public library page) -----------------


def _library_cache() -> Path:
    return Path.home() / ".atlas" / "ollama-library.json"


def fetch_library(url: str = LIBRARY_URL, timeout=LIBRARY_FETCH_TIMEOUT_S) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "atlas-dashboard"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (fixed https URL)
        return r.read().decode("utf-8", "replace")


def parse_library(html: str) -> list[str]:
    seen: list[str] = []
    for name in re.findall(r'href="/library/([A-Za-z0-9._-]+)"', html):
        if name not in seen:
            seen.append(name)
    return seen


def popular_order(now=None) -> list[str]:
    """Library model names, most popular first. [] when unreachable (ranks stay null)."""
    now = time.time() if now is None else now
    path = _library_cache()
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        if now - float(cached["ts"]) < LIBRARY_TTL_S:
            return list(cached["names"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        names = parse_library(fetch_library())
    except Exception:  # offline, slow, or page changed: never block the request
        return []
    if names:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"ts": now, "names": names}), encoding="utf-8")
        except OSError:
            pass
    return names


# --- operations ------------------------------------------------------------


def list_models(scope="all", sort="latest", q="", detail=False) -> dict:
    rc, out, err = run(["ollama", "list"])
    if rc != 0:
        return {
            "ok": False,
            "error": "ollama_unavailable",
            "detail": err.strip(),
            "models": [],
        }
    models = parse_list(out)
    prc, pout, _ = run(["ollama", "ps"])
    running = {r["name"] for r in parse_ps(pout)} if prc == 0 else set()
    for m in models:
        m["running"] = m["name"] in running
    if scope == "local":
        models = [m for m in models if not m["cloud"]]
    elif scope == "cloud":
        models = [m for m in models if m["cloud"]]
    q = (q or "").strip().lower()
    if q:
        models = [m for m in models if q in m["name"].lower()]
    if sort == "popular":
        order = popular_order()
        for m in models:
            if m["family"] in order:
                m["popularity_rank"] = order.index(m["family"]) + 1
    if detail:
        for m in models:
            if not m["cloud"]:
                m.update(show_detail(m["name"]))
    big = float("inf")
    keys = {
        "name": lambda m: m["name"].lower(),
        "size": lambda m: -(m["size_bytes"] or -1),
        "popular": lambda m: (m["popularity_rank"] or big, m["name"].lower()),
        "latest": lambda m: -(m["modified_at"] or 0),
    }
    models.sort(key=keys.get(sort, keys["latest"]))
    return {"ok": True, "models": models}


def show_detail(name: str) -> dict:
    """context length and quantization from `ollama show` (nulls when unavailable)."""
    rc, out, _ = run(["ollama", "show", name])
    ctx = re.search(r"context length\s+(\d+)", out)
    quant = re.search(r"quantization\s+(\S+)", out)
    return {
        "context": int(ctx.group(1)) if rc == 0 and ctx else None,
        "quant": quant.group(1) if rc == 0 and quant else None,
    }


def status() -> dict:
    vrc, vout, _ = run(["ollama", "--version"])
    prc, pout, perr = run(["ollama", "ps"])
    ver = re.search(r"(\d+\.\d+[\w.\-]*)", vout or "")
    return {
        "ok": True,
        "reachable": prc == 0,
        "version": ver.group(1) if vrc == 0 and ver else None,
        "ps": parse_ps(pout) if prc == 0 else [],
        "error": None if prc == 0 else (perr.strip() or "ollama unavailable"),
    }


def validate_model(name: str):
    """(ok, closest). ok is None when the local list cannot be read (cannot validate)."""
    rc, out, _ = run(["ollama", "list"])
    if rc != 0:
        return None, []
    names = [m["name"] for m in parse_list(out)]
    if name in names or (":" not in name and f"{name}:latest" in names):
        return True, []
    return False, difflib.get_close_matches(name, names, n=5, cutoff=0.4)


# --- pull jobs --------------------------------------------------------------

_jobs: dict = {}
_jobs_lock = threading.Lock()
MAX_JOBS = 50


def _pull_worker(job: dict) -> None:
    def on_line(line):
        with _jobs_lock:
            job["lines"].append(line)
            del job["lines"][:-200]
            m = re.search(r"(\d{1,3})%", line)
            if m:
                job["percent"] = int(m.group(1))

    rc, _, err = run(["ollama", "pull", job["name"]], timeout=None, on_line=on_line)
    with _jobs_lock:
        job["rc"] = rc
        job["status"] = "done" if rc == 0 else "error"
        if rc == 0:
            job["percent"] = 100
        elif err:
            job["lines"].append(err.strip())
        job["finished"] = time.time()


def start_pull(name: str) -> dict:
    job = {
        "id": secrets.token_urlsafe(8),
        "name": name,
        "status": "running",
        "percent": 0,
        "lines": [],
        "rc": None,
        "started": time.time(),
        "finished": None,
    }
    with _jobs_lock:
        for jid in [j for j, v in _jobs.items() if v["finished"]][
            : max(0, len(_jobs) - MAX_JOBS + 1)
        ]:
            del _jobs[jid]
        _jobs[job["id"]] = job
    threading.Thread(target=_pull_worker, args=(job,), daemon=True).start()
    return job


def get_job(job_id: str):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job, lines=list(job["lines"])) if job else None


# --- routes ------------------------------------------------------------------


def _models(ctx):
    scope = ctx.query.get("scope", "all")
    sort = ctx.query.get("sort", "latest")
    if scope not in ("local", "cloud", "all") or sort not in (
        "latest",
        "size",
        "name",
        "popular",
    ):
        return 400, {"ok": False, "error": "bad_query"}
    res = list_models(
        scope, sort, ctx.query.get("q", ""), ctx.query.get("detail") == "1"
    )
    return (200 if res["ok"] else 503), res


def _status(ctx):
    return 200, status()


def _pull(ctx):
    name = str((ctx.json() or {}).get("name") or "").strip()
    if not NAME_RE.match(name):
        return 400, {"ok": False, "error": "bad_name"}
    job = start_pull(name)
    return 202, {"ok": True, "job": job["id"], "name": name}


def _job(ctx):
    job = get_job(ctx.groups[0])
    return (
        (200, {"ok": True, **job})
        if job
        else (404, {"ok": False, "error": "unknown_job"})
    )


def _delete(ctx):
    name = urllib.parse.unquote(ctx.groups[0])
    if not NAME_RE.match(name):
        return 400, {"ok": False, "error": "bad_name"}
    if (ctx.json() or {}).get("confirm") is not True:
        return 409, {"ok": False, "error": "needs_confirm", "name": name}
    ok, _ = validate_model(name)
    if ok is False:
        return 404, {"ok": False, "error": "unknown_model", "name": name}
    rc, _, err = run(["ollama", "rm", name])
    if rc != 0:
        return 502, {"ok": False, "error": "rm_failed", "detail": err.strip()}
    return 200, {"ok": True, "removed": name}


ROUTES = [
    ("GET", r"/api/v2/ollama/models", _models),
    ("GET", r"/api/v2/ollama/status", _status),
    ("POST", r"/api/v2/ollama/pull", _pull),
    ("GET", r"/api/v2/ollama/jobs/([A-Za-z0-9_-]+)", _job),
    ("DELETE", r"/api/v2/ollama/models/(.+)", _delete),
]
