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
  record(keys)   (also starts the hourly background send, see _flush) one append of {"w": ISO week, "k": key, "n": 1} lines to analytics/events.jsonl, for keys
                 the caller builds from closed constants (a hook name from a fixed table, an event name, a
                 bucket function, a shipped skill directory). A key not shaped like a counter key is dropped.
                 It does not match the schema: read_events/build_payload in atlas_analytics re-validate every
                 stored line before anything can be previewed or sent, so a bad line is never counted.

Never raises; writes nothing when off.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

SEND_RETRY_S = 3600  # the same hourly window as atlas_analytics.SEND_RETRY_S (test_analytics_contract pins them)

OFF_VALUES = ("off", "0", "false", "no", "disabled", "disable")
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
_KEY_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-+")  # "+" for crew.rounds.3+ and team.size.9+


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


def _under_test():
    """A test run must never start a real send to the shipped endpoint."""
    return bool(os.environ.get("PYTEST_CURRENT_TEST")) or "pytest" in sys.modules


def _try_lock(adir):
    """Non-blocking take of the analytics/.lock that atlas_analytics._locked() holds around its read-modify-write
    of last_send.json. Returns the open handle, None when no lock is available on this platform (proceed
    unlocked, as _locked does), or False when another process holds it (the caller skips; a hook never waits)."""
    fh = None
    try:
        os.makedirs(adir, exist_ok=True)
        fh = open(os.path.join(adir, ".lock"), "a+b")
        try:
            import fcntl

            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:
            import msvcrt

            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        return fh
    except (BlockingIOError, PermissionError):
        contended = True
    except Exception:
        contended = False  # no lock to be had (read-only directory, no lock module): proceed unlocked
    if fh is not None:
        try:
            fh.close()
        except Exception:
            pass
    return False if contended else None


def _unlock(fh):
    if fh:
        try:
            fh.close()  # closing releases the flock
        except Exception:
            pass


def _flush(adir):
    """Counts used to leave this machine only when a later session started at least an hour after the last
    attempt, so a short or only session (a cloud container, a day-long session) sent its session and weekday
    and none of what it did. Each hook that records counts now checks the same hourly stamp (one stat) and
    starts the detached `send --auto` the session-start path starts. The child applies every gate (opt-out,
    first-run notice, endpoint) and sends the current week as a snapshot the server replaces. Claiming the
    stamp first keeps concurrent hooks to one child; a lost race only repeats an idempotent snapshot."""
    stamp = os.path.join(adir, "last_send.json")
    try:
        if time.time() - os.stat(stamp).st_mtime < SEND_RETRY_S:
            return
    except FileNotFoundError:
        pass
    if _under_test():
        return
    import subprocess

    fh = _try_lock(adir)
    if fh is False:
        return  # another process is inside its read-modify-write of the stamp; the next hook retries
    try:
        try:
            if time.time() - os.stat(stamp).st_mtime < SEND_RETRY_S:
                return  # a concurrent hook or a finishing send refreshed it while we took the lock
        except FileNotFoundError:
            pass
        now = time.time()
        try:
            prev = _json(stamp)
            prev["at"] = now
            tmp = stamp + ".%d.tmp" % os.getpid()
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(prev, f)
            os.replace(tmp, stamp)
        except Exception:
            return
    finally:
        _unlock(fh)
    try:
        subprocess.Popen(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "atlas_analytics.py"), "send", "--auto"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
    except Exception:
        return


def record(keys, n=1):
    """Append one counter line per well-formed key. No-op when off. Never raises."""
    try:
        if not keys or type(n) is not int or n < 1 or not enabled():
            return
        y, w, _ = datetime.now(timezone.utc).date().isocalendar()  # the server validates ISO weeks in UTC
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
        _flush(adir)
    except Exception:
        return
