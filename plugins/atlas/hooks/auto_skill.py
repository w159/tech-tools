#!/usr/bin/env python3
"""Atlas auto-skill hook — automatically creates skills from worthy sessions.

Fires on Stop. Uses skill_factory.auto_create_from_session() to:
  1. Find the most recent orchestrating session
  2. Check if it's skill-worthy (>= 5 tool calls, learnable signals)
  3. Extract lessons (improvements, corrections, error patterns)
  4. Create a SKILL.md under ~/.claude/skills/ with `created_by: "atlas-auto"` provenance

The created skill shows up with a "learned" label — it was auto-learned from
session experience. The atlas curator will manage its lifecycle (stale/archive).

This mirrors Hermes Agent's skill_manage(action='create') but is hook-driven:
the agent doesn't need to decide to save — it happens automatically.

Fail-open: any error exits 0 silently. Disable with ATLAS_AUTO_SKILL=off.
Rate-limited: at most once per 10 minutes. stop_hook_active, the throttle
window, and the circuit breaker are all enforced by atlas_hook_guard now.
"""

import os
import sys

WINDOW_SECONDS = 600  # at most once per 10 minutes

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_hook_guard  # noqa: E402


def main():
    if os.environ.get("ATLAS_AUTO_SKILL", "on").lower() == "off":
        sys.exit(0)

    payload = atlas_hook_guard.read_payload()

    if not atlas_hook_guard.should_run(
        payload, "auto_skill", window_seconds=WINDOW_SECONDS
    ):
        sys.exit(0)

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
                f"The skill is available next session under ~/.claude/skills/{name}/ "
                f"(or $ATLAS_SKILLS_DIR if set)."
            )
            atlas_hook_guard.emit(payload, "auto_skill", msg)
        else:
            # Fail-open but observable: surface why no skill was created so
            # silent zero-output curator runs can be diagnosed.
            reason = result.get("reason", "unknown")
            sys.stderr.write(
                f"[atlas] auto-skill: no skill created (reason: {reason})\n"
            )
    except Exception as e:
        # Fail-open but observable: surface the error so the hook is diagnosable
        # rather than silently swallowing skill_factory failures.
        sys.stderr.write(f"[atlas] auto-skill error: {e}\n")

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
