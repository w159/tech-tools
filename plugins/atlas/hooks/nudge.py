#!/usr/bin/env python3
"""Atlas self-improvement nudge. Fires on Stop and SubagentStop.

Rate-limited and non-blocking: returns additionalContext only, never exit 2.
Encourages capturing a lesson to claude-mem / .agents and a light docs-drift
check. Self-throttles via a timestamp marker so it fires at most once per
window. Any error exits 0 silently.
"""

import json
import os
import sys
import time

WINDOW_SECONDS = 900  # at most once per 15 minutes


def marker_path(cwd):
    # WS1: write under ~/.atlas/ so the throttle marker never enters the source tree
    base = os.path.join(os.path.expanduser("~"), ".atlas")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        base = "/tmp"
    return os.path.join(base, ".atlas_nudge")


def throttled(path):
    try:
        last = os.path.getmtime(path)
        if (time.time() - last) < WINDOW_SECONDS:
            return True
    except Exception:
        pass
    try:
        with open(path, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass
    return False


def main():
    raw = ""
    try:
        raw = sys.stdin.read()
    except Exception:
        pass
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}
    cwd = payload.get("cwd", ".")

    session = payload.get("session_id", "")
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        if not atlas_db.is_orchestrating(atlas_db.connect(), session):
            sys.exit(0)  # WS1: only nudge after real orchestration turns
    except Exception:
        pass  # fail-open: if we cannot tell, fall through to the throttle

    if throttled(marker_path(cwd)):
        sys.exit(0)

    msg = (
        "Atlas self-improvement check: if this turn produced a reusable decision, "
        "fix, or gotcha, capture it (claude-mem observation_add or a note under "
        ".agents/) so the next session starts ahead. If you changed behavior or "
        "structure, confirm docs/ still matches (CHANGELOG/ROADMAP/architecture)."
    )
    sys.stdout.write(json.dumps({"additionalContext": msg}))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
