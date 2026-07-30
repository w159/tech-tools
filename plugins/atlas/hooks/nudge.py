#!/usr/bin/env python3
"""Atlas self-improvement nudge — enhanced to report what was captured.

Fires on Stop and SubagentStop after memory_capture.py and auto_skill.py have
already run. Instead of just saying "please capture a lesson," it reports
what was actually captured by the hooks above, and only nudges if nothing
was captured but the session was orchestrating.

Rate-limited and non-blocking: returns additionalContext only, never exit 2.
Throttling, the stop_hook_active loop guard, and the circuit breaker all
live in atlas_hook_guard now (see that module for the shared invariant).
Any error exits 0 silently.
"""

import os
import sys
import time

WINDOW_SECONDS = 900  # at most once per 15 minutes

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_hook_guard  # noqa: E402


def _check_memory_captured():
    """Check if memory_capture.py wrote anything to memory recently."""
    try:
        mem_path = os.path.join(os.path.expanduser("~/.atlas"), "memory", "MEMORY.md")
        if os.path.exists(mem_path):
            mtime = os.path.getmtime(mem_path)
            # If memory was written in the last 60 seconds, the hook just captured
            if (time.time() - mtime) < 60:
                return True
    except Exception:
        pass
    return False


def _check_skill_created():
    """Check if auto_skill.py created a skill recently."""
    try:
        skills_dir = os.path.join(os.path.expanduser("~/.atlas"), "skills")
        if not os.path.isdir(skills_dir):
            return False
        for item in os.listdir(skills_dir):
            skill_dir = os.path.join(skills_dir, item)
            skill_md = os.path.join(skill_dir, "SKILL.md")
            if os.path.isfile(skill_md):
                mtime = os.path.getmtime(skill_md)
                if (time.time() - mtime) < 60:
                    return True
    except Exception:
        pass
    return False


def main():
    payload = atlas_hook_guard.read_payload()

    # stop_hook_active, the throttle window, and the circuit breaker are all
    # checked here before we even touch the DB.
    if not atlas_hook_guard.should_run(payload, "nudge", window_seconds=WINDOW_SECONDS):
        sys.exit(0)

    session = payload.get("session_id", "")
    conn = None
    try:
        import atlas_db

        conn = atlas_db.connect()
        if not atlas_db.is_orchestrating(conn, session):
            sys.exit(0)  # only nudge after real orchestration turns
    except Exception as exc:
        # Fail-closed on the orchestration check: a transient DB error must not
        # fall through to a spurious self-improvement nudge. Skip rather than
        # nudge, since we cannot confirm this was an orchestration turn.
        sys.stderr.write("[atlas] nudge: skipping, DB error: %s\n" % exc)
        sys.exit(0)
    finally:
        if conn is not None:
            conn.close()

    # Check what was already captured by the hooks above
    memory_captured = _check_memory_captured()
    skill_created = _check_skill_created()

    if memory_captured or skill_created:
        # Report what was captured — self-improvement happened
        parts = []
        if memory_captured:
            parts.append("memory facts captured to ~/.atlas/memory/")
        if skill_created:
            parts.append("new skill auto-created under ~/.claude/skills/")
        msg = (
            "[atlas] Self-improvement complete: " + ", ".join(parts) + ". "
            "These will be available next session."
        )
    else:
        # Nothing was captured — nudge to do it manually
        msg = (
            "Atlas self-improvement check: if this turn produced a reusable decision, "
            "fix, or gotcha, capture it (claude-mem observation_add or a note under "
            ".agents/) so the next session starts ahead. If you changed behavior or "
            "structure, confirm docs/ still matches (CHANGELOG/ROADMAP/architecture)."
        )
    atlas_hook_guard.emit(payload, "nudge", msg)
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
