#!/usr/bin/env python3
"""PostToolUse hook: mirror every TodoWrite call to the project todo board.

TodoWrite rewrites the WHOLE list on every call, so tool_input.todos IS the
current plan. Mirroring it into <project>/.atlas/.run/todos.json makes the
session's progress visible to the dashboard (Work tab) and readable by the
completion gate and subagents, without depending on the transcript.

Silent no-op on anything unexpected. ATLAS_TODO=off disables. Stdlib only.
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_todo  # noqa: E402


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError, OSError):
        return 0  # fail open: a hook must never block on its own failure
    if not isinstance(data, dict):
        return 0
    if os.environ.get("ATLAS_TODO", "").lower() in ("0", "off", "false", "no"):
        return 0
    if (data.get("tool_name") or "") != "TodoWrite":
        return 0
    todos = (data.get("tool_input") or {}).get("todos")
    if not isinstance(todos, list):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    session_id = str(data.get("session_id") or "")
    try:
        atlas_todo.mirror(cwd, todos, session_id)
    except Exception:
        return 0  # mirroring is observability, never a blocker
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
