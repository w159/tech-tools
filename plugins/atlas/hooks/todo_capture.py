#!/usr/bin/env python3
"""PostToolUse hook: mirror every TodoWrite call to the project todo board.

TodoWrite rewrites the WHOLE list on every call, so tool_input.todos IS the
current plan. Mirroring it into <project>/.atlas/.run/todos.json makes the
session's progress visible to the dashboard (Work tab) and readable by the
completion gate and subagents, without depending on the transcript.

It also gives one advisory when an atlas:* worker is dispatched (Agent/Task, or
`atlas_mux.py spawn|spawn-team`) onto a board with no item for the session: TodoWrite is
not available to every model family, so the band would read `tasks 0/0` while workers run.
The advisory carries the exact `atlas_todo.py set` command, once per session.

Silent no-op on anything unexpected. ATLAS_TODO=off disables. Stdlib only.
"""

from __future__ import annotations

import json
import os
import shlex
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_env  # noqa: E402
atlas_env.apply_store_env()
import atlas_faults  # noqa: E402
import atlas_hook_guard  # noqa: E402
import atlas_todo  # noqa: E402


def _is_dispatch(data: dict) -> bool:
    tool, inp = data.get("tool_name"), data.get("tool_input") or {}
    if tool in ("Agent", "Task"):
        return str(inp.get("subagent_type") or "").startswith("atlas:")
    if tool == "Bash":
        cmd = str(inp.get("command") or "")
        return "atlas_mux.py" in cmd and (" spawn " in cmd or " spawn-team " in cmd)
    return False


def _nudge_if_board_empty(data: dict) -> None:
    if not _is_dispatch(data):
        return
    cwd = data.get("cwd") or os.getcwd()
    sid = data.get("session_id") or ""
    if not sid or atlas_todo.counts(atlas_todo.load(cwd), sid)["needed"]:
        return
    marker = atlas_todo.board_path(cwd).parent / "todo-nudged" / "".join(
        c for c in sid if c.isalnum() or c in "-_"
    )
    if marker.exists():
        return
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("1")
    script = os.path.abspath(atlas_todo.__file__)
    example = json.dumps(
        [{"content": "[implement] <what this worker delivers>", "status": "in_progress"}]
    )
    msg = (
        "[atlas] The board has no items for this session, so the band shows tasks 0/0 "
        "while workers run. Mirror the plan (one item per worker, `[<phase>] ` prefix): "
        f"python3 {shlex.quote(script)} set {shlex.quote(example)} --session {shlex.quote(sid)}"
    )
    print(
        json.dumps(
            {"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": msg}}
        )
    )


def main() -> int:
    if os.environ.get("ATLAS_TODO", "").lower() in ("0", "off", "false", "no"):
        return 0
    data = atlas_hook_guard.load_payload("todo_capture")
    if data.get("tool_name") != "TodoWrite":
        try:
            _nudge_if_board_empty(data)
        except Exception as exc:
            atlas_faults.record("todo_capture", exc, data.get("cwd") or os.getcwd())
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
