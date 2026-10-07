#!/usr/bin/env python3
"""PostToolUse hook: mirror every TodoWrite call to the project todo board.

TodoWrite rewrites the WHOLE list on every call, so tool_input.todos IS the
current plan. Mirroring it into <project>/.atlas/.run/todos.json makes the
session's progress visible to the dashboard (Work tab) and readable by the
completion gate and subagents, without depending on the transcript.

Silent no-op on anything unexpected. ATLAS_TODO=off disables. Stdlib only.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_faults  # noqa: E402
import atlas_hook_guard  # noqa: E402
import atlas_todo  # noqa: E402


def main() -> int:
    if os.environ.get("ATLAS_TODO", "").lower() in ("0", "off", "false", "no"):
        return 0
    data = atlas_hook_guard.load_payload("todo_capture")
    if data.get("tool_name") != "TodoWrite":
        return 0
    todos = data.get("tool_input", {}).get("todos")
    if not isinstance(todos, list):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    session_id = data.get("session_id") or ""
    try:
        atlas_todo.mirror(cwd, todos, session_id)
    except Exception as exc:
        atlas_faults.record("todo_capture", exc, cwd)
        return 0  # mirroring is observability, never a blocker
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("todo_capture", main))
