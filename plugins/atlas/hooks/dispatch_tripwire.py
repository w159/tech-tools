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
# Skills whose invocation means the session IS an atlas orchestration run.
# Deliberately excludes advisory/config skills (atlas-architect, atlas-harbor)
# so casual sessions never trip the completion gate.
ORCH_SKILLS = {
    "atlas-engine",
    "atlas-survey",
    "atlas-cartographer",
    "atlas-expedition",
    "atlas-orbit",
    "atlas-stacks",
}


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

    if tool == "Skill":
        # Invoking an orchestration skill flags the run deterministically -
        # nothing else guarantees the model runs `atlas_db.py mark-orchestrating`.
        skill = str(tinput.get("skill", "")).split(":")[-1]
        if skill in ORCH_SKILLS:
            atlas_db.mark_orchestrating(conn, session, payload.get("cwd"))
        return

    if tool in DISPATCH_TOOLS:
        # Dispatches may arrive after the run is finalized; use the fallback
        # resolver so late Agent/Task PostToolUse events are still logged.
        dispatch_run_id = atlas_db.current_or_last_run_id(conn, session)
        if dispatch_run_id is not None:
            atlas_db.log_dispatch(
                conn, dispatch_run_id, tinput.get("subagent_type", tool)
            )
        agent_type = str(tinput.get("subagent_type", ""))
        if agent_type.startswith(("atlas:", "atlas-")):
            # Dispatching an atlas squad agent is unambiguous orchestration.
            atlas_db.mark_orchestrating(conn, session, payload.get("cwd"))
        return

    run_id = atlas_db.current_run_id(conn, session)
    if run_id is None:
        return  # no active run for inline ops; boot hook will create one

    if tool not in INLINE_TOOLS:
        return

    atlas_db.log_event(conn, run_id, tool, "main", 1, path)
    count = atlas_db.inline_ops_since_last_dispatch(conn, run_id)

    edit_to_target = tool in EDIT_TOOLS and not _is_orchestration_path(path)
    if count >= _threshold() or edit_to_target:
        if not atlas_db.is_orchestrating(conn, session):
            return  # WS1: non-orchestration sessions are logged but never nagged
        if edit_to_target:
            msg = (
                "STOP - atlas orchestrators never edit target code inline. "
                "Route this %s of %s to atlas:implementer." % (tool, path)
            )
        else:
            msg = (
                "STOP - %d inline ops since your last dispatch with no dispatch. This is "
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
