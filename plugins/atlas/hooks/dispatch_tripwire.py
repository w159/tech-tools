#!/usr/bin/env python3
"""PostToolUse tripwire: counts inline ops in the main session and STOPs drift.

Fail-open: any error exits 0. Logs to the atlas observability DB. Advisory only -
it injects context, never blocks. Disable with ATLAS_TRIPWIRE=off.
"""

import json
import os
import sys

INLINE_TOOLS = {"Read", "Grep", "Glob", "Edit", "Write", "Bash"}
DISPATCH_TOOLS = {"Agent", "Task"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
ORCH_MARKERS = ("docs/",)


def _threshold():
    try:
        return int(os.environ.get("ATLAS_TRIPWIRE_THRESHOLD", "4"))
    except ValueError:
        return 4


def _is_orchestration_path(path):
    if not path:
        return True  # unknown path -> do not punish
    norm = path.replace("\\", "/")
    return norm.startswith("docs/") or "/docs/" in norm


def main():
    if os.environ.get("ATLAS_TRIPWIRE", "on").lower() == "off":
        return
    raw = sys.stdin.read()
    payload = json.loads(raw)  # may raise -> caught below
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import atlas_db

    tool = payload.get("tool_name", "")
    tinput = payload.get("tool_input", {}) or {}
    session = payload.get("session_id", "")
    path = tinput.get("file_path") or tinput.get("path")

    conn = atlas_db.connect()
    atlas_db.init(conn)
    run_id = atlas_db.current_run_id(conn, session)
    if run_id is None:
        return  # no active run; boot hook will create one

    if tool in DISPATCH_TOOLS:
        atlas_db.log_dispatch(conn, run_id, tinput.get("subagent_type", tool))
        return
    if tool not in INLINE_TOOLS:
        return

    atlas_db.log_event(conn, run_id, tool, "main", 1, path)
    count = atlas_db.inline_ops_since_last_dispatch(conn, run_id)

    edit_to_target = tool in EDIT_TOOLS and not _is_orchestration_path(path)
    if count >= _threshold() or edit_to_target:
        if edit_to_target:
            msg = (
                "STOP - atlas orchestrators never edit target code inline. "
                "Route this %s of %s to atlas:implementer." % (tool, path)
            )
        else:
            msg = (
                "STOP - %d inline ops this turn with no dispatch. This is "
                "orchestrator drift. Dispatch the next investigative or edit "
                "step to a subagent (atlas:explorer / atlas:implementer)." % count
            )
        out = {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": msg,
            }
        }
        print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail-open: never block a session
    sys.exit(0)
