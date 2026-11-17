#!/usr/bin/env python3
"""Show the decision-model, Ollama and analytics settings and where each value comes from.

  python3 atlas_settings.py show              each option: effective value and source
                                               (environment, dashboard setting, plugin setting, default)
  python3 atlas_settings.py decision-status   probe the decision endpoint: reachable, protocol, model,
                                               decisions recorded in the last 7 days

Read-only (no cache file is written, unlike prompt_decision's own probe), stdlib only, and a URL is
printed without its user:password part so no secret reaches the terminal.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
HOOKS = SCRIPTS.parent / "hooks"
sys.path.insert(0, str(SCRIPTS))
import atlas_env  # noqa: E402

LABELS = {
    "ATLAS_DECISION": "on (only off disables)",
    "ATLAS_DECISION_URL": "http://127.0.0.1:11434",
    "ATLAS_DECISION_MODEL": "(protocol default: llama3.2:3b on ollama, nimble on systemone)",
    "ATLAS_DECISION_PROTOCOL": "auto",
    "ATLAS_OLLAMA_URL": "http://127.0.0.1:11434",
    "ATLAS_OLLAMA_MODEL": "(none: workers stay on Claude)",
    "ATLAS_OLLAMA_AUTO_ROLES": "explorer,docs-auditor",
    "ATLAS_ANALYTICS": "on (DO_NOT_TRACK, `disable` or CI turn it off)",
}
# prompt_decision.TIMEOUT_S; read from the module when it imports.
TIMEOUT_S = 4.0


def _redact(value: str) -> str:
    """Drop user:password from a URL; any other value passes through."""
    try:
        u = urllib.parse.urlsplit(value)
    except ValueError:
        return value
    if u.scheme and "@" in u.netloc:
        return urllib.parse.urlunsplit(u._replace(netloc=u.netloc.rsplit("@", 1)[1]))
    return value


def resolve(environ=None) -> list:
    """[(var, value, source)] for every option, with the same precedence the hooks apply."""
    env0 = dict(os.environ if environ is None else environ)
    env = dict(env0)
    store = atlas_env.apply_store_env(env)
    rows = []
    for key, var in atlas_env.PLUGIN_OPTIONS:
        if var in store:
            rows.append((var, store[var], "dashboard setting"))
        elif var in env0:
            rows.append((var, env0[var], "environment"))
        elif atlas_env.option_value(key, env0) is not None:
            rows.append((var, env[var], "plugin setting"))
        else:
            rows.append((var, LABELS[var], "default"))
    return rows


def cmd_show() -> int:
    for var, value, source in resolve():
        print("%s = %s  [%s]" % (var, _redact(value), source))
    return 0


def _load_decision():
    sys.path.insert(0, str(HOOKS))
    try:
        import prompt_decision

        return prompt_decision
    except Exception:
        return None


def _probe(base: str, timeout: float):
    """(reachable, protocol or None, models list). GET /api/tags only, nothing cached."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(base + "/api/tags", timeout=timeout) as resp:
            body = resp.read(1_000_000)
    except urllib.error.HTTPError:
        return True, "systemone", []
    except (urllib.error.URLError, OSError, ValueError):
        return False, None, []
    try:
        data = json.loads(body)
    except ValueError:
        return True, "systemone", []
    if isinstance(data, dict) and isinstance(data.get("models"), list):
        names = [m.get("name") for m in data["models"] if isinstance(m, dict) and m.get("name")]
        return True, "ollama", names
    return True, "systemone", []


def _recorded_7d() -> int | None:
    """Decision events in atlas.db over the last 7 days, None when none exist or no db."""
    path = os.environ.get("ATLAS_DB") or os.path.join(
        os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas"), "atlas.db"
    )
    if not os.path.isfile(path):
        return None
    try:
        con = sqlite3.connect("file:%s?mode=ro" % urllib.parse.quote(path), uri=True, timeout=1)
        try:
            n = con.execute(
                "SELECT COUNT(*) FROM events WHERE tool LIKE 'decision.%' AND ts >= ?",
                (time.time() - 7 * 86400,),
            ).fetchone()[0]
        finally:
            con.close()
    except sqlite3.Error:
        return None
    return n or None


def _analytics_counts() -> int | None:
    """decision.* counters prompt_decision's callers record (analytics events.jsonl, week buckets)."""
    home = os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")
    path = os.path.join(home, "analytics", "events.jsonl")
    try:
        import atlas_analytics

        weeks = {
            atlas_analytics._week_of(time.time()),
            atlas_analytics._week_of(time.time() - 7 * 86400),
        }
    except Exception:
        weeks = None
    total = 0
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if str(rec.get("k", "")).startswith("decision.") and (weeks is None or rec.get("w") in weeks):
                    total += int(rec.get("n") or 0)
    except (OSError, ValueError, TypeError):
        return None
    return total or None


def cmd_decision_status() -> int:
    atlas_env.apply_store_env()
    pd = _load_decision()
    if pd is None:
        print("decision model: prompt_decision.py did not import")
        return 1
    base = pd.decision_url()
    if not base:
        print("decision model: off (ATLAS_DECISION=off, or a remote URL without ATLAS_DECISION_ALLOW_REMOTE=1)")
        return 0
    timeout = float(getattr(pd, "TIMEOUT_S", TIMEOUT_S))
    reachable, detected, models = _probe(base, timeout)
    forced = os.environ.get("ATLAS_DECISION_PROTOCOL", "auto").strip().lower()
    protocol = forced if forced in ("ollama", "systemone") else detected
    configured = os.environ.get("ATLAS_DECISION_MODEL", "").strip()
    default_model = pd.OLLAMA_DEFAULT_MODEL if protocol == "ollama" else pd.SYSTEMONE_DEFAULT_MODEL
    model = configured or default_model
    print("endpoint: %s" % _redact(base))
    print("reachable: %s (timeout %.1fs)" % ("yes" if reachable else "no", timeout))
    print("protocol: %s%s" % (protocol or "unknown", " (forced)" if forced in ("ollama", "systemone") else " (detected)"))
    print("model: %s%s" % (model, "" if configured else " (default)"))
    if protocol == "ollama" and reachable and models and model not in models:
        print("warning: model %s is not pulled on this endpoint" % model)
    n = _recorded_7d()
    print("decisions in atlas.db, last 7 days: %s" % (n if n else "none recorded"))
    a = _analytics_counts()
    print("decision counters in analytics, this and last week: %s" % (a if a else "none recorded"))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="atlas_settings.py",
        description="Show the decision-model, Ollama and analytics settings and where each value comes from.",
    )
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("show", help="each option: effective value and source (the default command)")
    sub.add_parser(
        "decision-status",
        help="probe the decision endpoint: reachable, protocol, model, decisions in the last 7 days",
    )
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if args.cmd == "decision-status":
        return cmd_decision_status()
    return cmd_show()


if __name__ == "__main__":
    sys.exit(main())
