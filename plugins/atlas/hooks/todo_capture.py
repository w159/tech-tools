#!/usr/bin/env python3
"""PostToolUse hook: mirror every TodoWrite / TaskCreate / TaskUpdate call to the project todo board.

Claude Code provides TaskCreate/TaskUpdate by default (TodoWrite only under
CLAUDE_CODE_ENABLE_TASKS=0). A TaskCreate adds one board item keyed by the task id from
tool_response.task.id; a TaskUpdate edits that item (status / subject, `deleted` removes it).
Items are scoped to the calling session; an unknown id is ignored.

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


def _response(data: dict) -> dict:
    resp = data.get("tool_response")
    if isinstance(resp, str):
        try:
            resp = json.loads(resp)
        except ValueError:
            return {}
    return resp if isinstance(resp, dict) else {}


def _task_create(cwd: str, sid: str, data: dict) -> None:
    inp = data.get("tool_input") or {}
    task = _response(data).get("task")
    task_id = str((task or {}).get("id") or "") if isinstance(task, dict) else ""
    content = str(inp.get("subject") or (task or {}).get("subject") or "").strip()
    if not task_id or not content:
        return
    with atlas_todo._file_lock(atlas_todo.board_path(cwd)):
        board = atlas_todo._locked_load(cwd)
        if any(i.get("task_id") == task_id and i.get("session_id") == sid for i in board["items"]):
            return
        now = atlas_todo._now()
        item = {
            "id": atlas_todo._new_id(),
            "content": content,
            "status": "pending",
            "owner": None,
            "claimed_at": None,
            "origin": "session",
            "session_id": sid,
            "created_at": now,
            "updated_at": now,
            "evidence": None,
            "completed_at": None,
            "archived": False,
            "task_id": task_id,
        }
        phase = atlas_todo._entry_phase({"content": content})
        if phase:
            item["phase"] = phase
        board["items"].append(item)
        board["last_session_id"] = sid
        atlas_todo.save(cwd, board)


def _task_update(cwd: str, sid: str, data: dict) -> None:
    inp = data.get("tool_input") or {}
    task_id = str(inp.get("taskId") or "")
    if not task_id or _response(data).get("success") is False:
        return
    with atlas_todo._file_lock(atlas_todo.board_path(cwd)):
        board = atlas_todo._locked_load(cwd)
        item = next(
            (
                i
                for i in board["items"]
                if i.get("task_id") == task_id and i.get("session_id") == sid and not i.get("archived")
            ),
            None,
        )
        if item is None:
            return
        status = inp.get("status")
        if status == "deleted":
            board["items"].remove(item)
        else:
            subject = str(inp.get("subject") or "").strip()
            if subject:
                item["content"] = subject
                phase = atlas_todo._entry_phase({"content": subject})
                if phase:
                    item["phase"] = phase
                else:
                    item.pop("phase", None)
            if status in ("pending", "in_progress", "completed"):
                item["status"] = status
                item["completed_at"] = atlas_todo._now() if status == "completed" else None
            atlas_todo._touch(item)
        atlas_todo.save(cwd, board)


def main() -> int:
    if os.environ.get("ATLAS_TODO", "").lower() in ("0", "off", "false", "no"):
        return 0
    data = atlas_hook_guard.load_payload("todo_capture")
    tool = data.get("tool_name")
    if tool in ("TaskCreate", "TaskUpdate"):
        cwd = data.get("cwd") or os.getcwd()
        try:
            (_task_create if tool == "TaskCreate" else _task_update)(
                cwd, data.get("session_id") or "", data
            )
        except Exception as exc:
            atlas_faults.record("todo_capture", exc, cwd)
        return 0
    if tool != "TodoWrite":
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
