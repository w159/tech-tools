#!/usr/bin/env python3
"""Atlas auto-skill hook — automatically creates skills from worthy sessions.

Fires on Stop. Uses skill_factory.auto_create_from_session() to:
  1. Find the most recent orchestrating session
  2. Check if it's skill-worthy (>= 5 tool calls, learnable signals)
  3. Extract lessons (improvements, corrections, error patterns)
  4. Create a SKILL.md under ~/.atlas/skills/ with `created_by: "atlas-auto"` provenance

The created skill shows up with a "learned" label — it was auto-learned from
session experience. The atlas curator will manage its lifecycle (stale/archive).

This mirrors Hermes Agent's skill_manage(action='create') but is hook-driven:
the agent doesn't need to decide to save — it happens automatically.

Fail-open: any error exits 0 silently. Disable with ATLAS_AUTO_SKILL=off.
Rate-limited: at most once per 10 minutes via a marker file.
"""

import json
import os
import sys
import time

WINDOW_SECONDS = 600  # at most once per 10 minutes


def _marker_path():
    base = os.path.join(os.path.expanduser("~"), ".atlas")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        base = "/tmp"
    return os.path.join(base, ".atlas_auto_skill")


def _throttled(path):
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
    if os.environ.get("ATLAS_AUTO_SKILL", "on").lower() == "off":
        sys.exit(0)

    # Throttle: don't run more than once per window
    if _throttled(_marker_path()):
        sys.exit(0)

    # Read payload (but we don't need most of it — skill_factory finds the
    # most recent orchestrating session itself)
    try:
        raw = sys.stdin.read()
    except Exception:
        raw = ""

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

    try:
        import skill_factory

        result = skill_factory.auto_create_from_session()
        if result.get("created"):
            # Report the new skill via additionalContext
            name = result.get("name", "unknown")
            lessons = result.get("lessons", [])
            msg = (
                f"[atlas] Self-improvement: auto-created skill '{name}' "
                f"from session {result.get('session_id', '?')[:8]}. "
                f"{len(lessons)} lesson(s) captured. "
                f"The skill is available next session under ~/.atlas/skills/{name}/."
            )
            sys.stdout.write(json.dumps({"additionalContext": msg}))
    except Exception:
        pass  # fail-open

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)