#!/usr/bin/env python3
"""Cheap counter writer for hooks that run on every tool call or prompt.

scripts/atlas_analytics.py is the client: schema, validation, preview, send. Importing it costs a few
milliseconds (pathlib, datetime, the schema matchers) that a per-event hook cannot spend, so the per-event
call sites (event_dispatch, prompt_optimizer, completion_gate) use this stdlib-only module instead. It does
two things and nothing else:

  enabled()      the same opt-out resolution as atlas_analytics.state(): DO_NOT_TRACK, then ATLAS_ANALYTICS
                 (environment, else ~/.atlas/settings.json "env"), then the enable/disable choice in
                 analytics/consent.json, then the CI/test guard, then on by default. test_analytics_contract
                 pins the two to the same answers.
  record(keys)   one append of {"w": ISO week, "k": key, "n": 1} lines to analytics/events.jsonl, for keys
                 the caller builds from closed constants (a hook name from a fixed table, an event name, a
                 bucket function, a shipped skill directory). A key not shaped like a counter key is dropped.
                 It does not match the schema: read_events/build_payload in atlas_analytics re-validate every
                 stored line before anything can be previewed or sent, so a bad line is never counted.

Never raises; writes nothing when off.
"""

import json
import os
from datetime import date

OFF_VALUES = ("off", "0", "false", "no", "disabled")
ON_VALUES = ("on", "1", "true", "yes", "enabled")
AUTOMATION_VARS = (
    "CI",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "BUILDKITE",
    "CIRCLECI",
    "TRAVIS",
    "JENKINS_URL",
    "TF_BUILD",
    "PYTEST_CURRENT_TEST",
)
_KEY_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")


def _dir():
    home = os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")
    return home, os.path.join(home, "analytics")


def _json(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def enabled():
    """True when anonymous counters are on for this process (see the module docstring)."""
    dnt = os.environ.get("DO_NOT_TRACK", "").strip().lower()
    if dnt and dnt not in ("0", "false", "no"):
        return False
    home, adir = _dir()
    knob = os.environ.get("ATLAS_ANALYTICS")
    if knob is None:
        v = (_json(os.path.join(home, "settings.json")).get("env") or {})
        v = v.get("ATLAS_ANALYTICS") if isinstance(v, dict) else None
        knob = v if isinstance(v, str) else ""
    knob = knob.strip().lower()
    if knob in OFF_VALUES:
        return False
    if knob in ON_VALUES:
        return True
    chosen = _json(os.path.join(adir, "consent.json")).get("enabled")
    if chosen is False:
        return False
    if chosen is True:
        return True
    return not any(os.environ.get(v) for v in AUTOMATION_VARS)


def record(keys, n=1):
    """Append one counter line per well-formed key. No-op when off. Never raises."""
    try:
        if not keys or type(n) is not int or n < 1 or not enabled():
            return
        y, w, _ = date.today().isocalendar()
        week = f"{y}-W{w:02d}"
        lines = [
            json.dumps({"w": week, "k": k, "n": min(n, 10000)}, separators=(",", ":")) + "\n"
            for k in keys
            if type(k) is str and 0 < len(k) <= 96 and _KEY_CHARS.issuperset(k)
        ]
        if not lines:
            return
        adir = _dir()[1]
        os.makedirs(adir, exist_ok=True)
        with open(os.path.join(adir, "events.jsonl"), "a", encoding="utf-8") as f:
            f.write("".join(lines))
    except Exception:
        return
