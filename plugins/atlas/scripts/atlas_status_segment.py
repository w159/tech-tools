#!/usr/bin/env python3
"""One atlas run-state segment for the Claude Code and omp statuslines.

  atlas  implement 2/6 · 3 live · gates ✔ · verified 4m · scoring ok

segment(root, now) reads the project's .atlas/.run files plus a read-only
look at ~/.atlas/atlas.db and returns a dict; render_text() turns it into the
line. Both harnesses print this module's output (omp shells out to it), so the
wording cannot drift. No network. A 60 s cache file under ~/.atlas keeps the
hot path to a JSON read.

  atlas_status_segment.py --text ROOT [--session S] [--home H] [--plain]
  atlas_status_segment.py --refresh-gates ROOT SESSION [--home H]   (background)
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime

CACHE_S = 60
STALE_S = 24 * 3600
LIVE_MAX_S = 6 * 3600  # a member with no ended_at older than this is a crashed worker
GOOD_KINDS = "kind NOT IN ('error','metric')"  # deterministic metrics keep landing during an outage

R, DIM, GREEN, RED, YELLOW, CYAN = (
    "\x1b[0m",
    "\x1b[1;90m",
    "\x1b[1;32m",
    "\x1b[1;31m",
    "\x1b[1;33m",
    "\x1b[1;36m",
)


def _json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def find_root(cwd, home=None):
    """Nearest ancestor of cwd holding .atlas (never ~ itself: that is the global dir)."""
    home = os.path.realpath(home or os.path.expanduser("~"))
    p = os.path.realpath(cwd or os.getcwd())
    while True:
        if p != home and os.path.isdir(os.path.join(p, ".atlas")):
            return p
        parent = os.path.dirname(p)
        if parent == p:
            return None
        p = parent


def _iso_epoch(s):
    try:
        return datetime.fromisoformat(str(s)).timestamp()
    except Exception:
        return None


def _scoring(home, now):
    """(state, detail). error: newest scoring_error is newer than the newest real score."""
    db = os.path.join(home, ".atlas", "atlas.db")
    if not os.path.exists(db):
        return "ok", ""
    try:
        c = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=0.05)
        try:
            err = c.execute(
                "SELECT scored_at, label FROM turn_scores WHERE judgment='scoring_error' "
                "ORDER BY scored_at DESC LIMIT 1"
            ).fetchone()
            good = c.execute(
                "SELECT MAX(scored_at) FROM turn_scores WHERE %s" % GOOD_KINDS
            ).fetchone()[0]
            ran = c.execute(
                "SELECT 1 FROM turn_scores WHERE scored_at >= ? LIMIT 1",
                (now - STALE_S,),
            ).fetchone()
        finally:
            c.close()
    except Exception:
        return "ok", ""  # unreadable db is not evidence of an outage
    if err and (good is None or err[0] > good):
        m = re.search(r"error (\d+)", err[1] or "")
        return "error", ("api %s" % m.group(1)) if m else (err[1] or "")[:24]
    if ran and (good is None or good < now - STALE_S):
        return "stale", "no score in 24h"
    return "ok", ""


def _gates_path(home, root, session):
    key = hashlib.sha1(("%s|%s" % (root, session)).encode()).hexdigest()[:12]
    return os.path.join(home, ".atlas", "status-gates-%s.json" % key)


def _gates(home, root, session, now):
    """Failing-gate count from the last background refresh; None = unknown.

    atlas_gates.py takes ~0.6 s, far over the statusline budget, so a stale
    reading spawns a detached refresh instead of blocking.
    """
    if not session:
        return None
    path = _gates_path(home, root, session)
    c = _json(path, {})
    if now - float(c.get("at", 0)) >= CACHE_S:
        try:
            subprocess.Popen(
                [
                    sys.executable,
                    os.path.abspath(__file__),
                    "--refresh-gates",
                    root,
                    session,
                    "--home",
                    home,
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except Exception:
            pass
    n = c.get("failing")
    return n if isinstance(n, int) else None


def refresh_gates(root, session, home):
    out = subprocess.run(
        [
            sys.executable,
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "atlas_gates.py"),
            "--root",
            root,
            "--session",
            session,
            "--json",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout
    groups = json.loads(out)["groups"]
    n = sum(
        sum(1 for l in g.get("lines", []) if not l.get("ok"))
        + (1 if g.get("error") else 0)
        for g in groups
    )
    path = _gates_path(home, root, session)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"at": time.time(), "failing": n}, f)


def segment(root, now=None, session=None, home=None):
    """None when root has no .atlas; else the segment dict (cached 60 s)."""
    now = time.time() if now is None else now
    home = home or os.path.expanduser("~")
    run = os.path.join(root, ".atlas", ".run")
    if not os.path.isdir(os.path.join(root, ".atlas")):
        return None
    todos = _json(os.path.join(run, "todos.json"), {})
    session = session or todos.get("last_session_id")
    key = hashlib.sha1(("%s|%s" % (root, session)).encode()).hexdigest()[:12]
    cache = os.path.join(home, ".atlas", "status-segment-%s.json" % key)
    c = _json(cache, {})
    if now - float(c.get("at", 0)) < CACHE_S and isinstance(c.get("seg"), dict):
        return c["seg"]

    items = [
        i
        for i in todos.get("items", [])
        if isinstance(i, dict)
        and not i.get("archived")
        and i.get("origin") != "advisor"
        and (not session or i.get("session_id") == session)
    ]
    active = next((i for i in items if i.get("status") == "in_progress"), None)
    phase = (active or {}).get("phase") or "idle"

    live = 0
    for ch in (
        _json(os.path.join(run, "channels.json"), {}).get("channels", {}).values()
    ):
        for m in ch.get("members", []):
            if (
                m.get("role") != "lead"
                and not m.get("ended_at")
                and now - float(m.get("joined", 0)) < LIVE_MAX_S
            ):
                live += 1

    stamps = [
        t
        for f in _json(os.path.join(run, "findings.json"), [])
        if isinstance(f, dict) and f.get("status") == "verified"
        for t in [_iso_epoch(f.get("verified_at"))]
        if t
    ]
    state, detail = _scoring(home, now)
    seg = dict(
        phase=phase,
        done=sum(1 for i in items if i.get("status") == "completed"),
        total=len(items),
        live=live,
        gates_failing=_gates(home, root, session, now),
        last_verified_age_s=int(now - max(stamps)) if stamps else None,
        scoring=state,
        scoring_detail=detail,
    )
    try:
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            json.dump({"at": now, "seg": seg}, f)
    except Exception:
        pass
    return seg


def _age(s):
    if s is None:
        return "never"
    s = max(0, int(s))
    return (
        "%ds" % s
        if s < 60
        else "%dm" % (s // 60)
        if s < 3600
        else "%dh" % (s // 3600)
        if s < 86400
        else "%dd" % (s // 86400)
    )


def render_text(seg, color=True):
    """The one-line wording shared by Claude Code and omp."""

    def c(code, s):
        return code + s + R if color else s

    g = seg["gates_failing"]
    gates = (
        c(DIM, "gates ?")
        if g is None
        else c(GREEN, "gates ✔")
        if g == 0
        else c(RED, "gates ✖%d" % g)
    )
    if seg["scoring"] == "ok":
        score = c(GREEN, "scoring ok")
    elif seg["scoring"] == "stale":
        score = c(YELLOW, "scoring stale")
    else:
        score = c(
            RED,
            "scoring error"
            + (" (%s)" % seg["scoring_detail"] if seg["scoring_detail"] else ""),
        )
    prog = (
        "%s %d/%d" % (seg["phase"], seg["done"], seg["total"])
        if seg["total"]
        else seg["phase"]
    )
    parts = [
        c(CYAN, prog),
        "%d live" % seg["live"],
        gates,
        "verified " + _age(seg["last_verified_age_s"]),
        score,
    ]
    return "atlas  " + (c(DIM, " · ") if color else " · ").join(parts)


def line_for(cwd, session=None, home=None, color=True, now=None):
    """Statusline entry point: '' when the project has no .atlas; never raises."""
    try:
        root = find_root(cwd, home)
        seg = segment(root, now, session, home) if root else None
        return render_text(seg, color) if seg else ""
    except Exception:
        return ""


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--text", metavar="CWD")
    ap.add_argument("--session")
    ap.add_argument("--home", default=os.path.expanduser("~"))
    ap.add_argument("--plain", action="store_true")
    ap.add_argument("--now", type=float, help="fixed clock for tests")
    ap.add_argument("--refresh-gates", nargs=2, metavar=("ROOT", "SESSION"))
    a = ap.parse_args(argv)
    if a.refresh_gates:
        try:
            refresh_gates(a.refresh_gates[0], a.refresh_gates[1], a.home)
        except Exception:
            return 1
    elif a.text:
        out = line_for(a.text, a.session, a.home, not a.plain, a.now)
        if out:
            print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
