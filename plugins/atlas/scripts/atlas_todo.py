#!/usr/bin/env python3
"""Durable todo board shared by the orchestrator, its subagents, and the dashboard.

Board file: <project>/.atlas/.run/todos.json

Three writers share one store:
  - hooks/todo_capture.py mirrors every TodoWrite call (PostToolUse), so the
    session's live plan is on disk without the orchestrator doing anything.
  - The orchestrator uses the CLI (`set`/`add`) when TodoWrite is unavailable
    (Claude Code auto mode drops it) -- the completion gate and the dashboard
    read the same board.
  - Subagents `claim` items before working on them and `complete` them with
    evidence, which is what lets parallel waves share one visible plan.

Item shape:
  {"id": "tab12cd34", "content": str, "status": pending|in_progress|completed,
   "owner": str|None, "claimed_at": float|None, "origin": session|carried|manual,
   "session_id": str|None, "created_at": float, "updated_at": float,
   "evidence": str|None, "completed_at": float|None, "archived": bool}

Origin semantics:
  session  -- written by (or mirrored from) the orchestrating session; a TodoWrite
             mirror or `set` replaces exactly these items for that session.
  carried  -- unfinished items session_boot carried into the current session.
  manual   -- added from the dashboard/CLI by a human; TodoWrite mirrors never
              touch them, and the completion gate does not count them.

Stdlib only. Same fcntl/msvcrt lock pattern as atlas_memory.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_memory import _file_lock  # noqa: E402

STATUSES = ("pending", "in_progress", "completed")
ORIGINS = ("session", "carried", "manual")
BOARD_DIR = ".atlas/.run"
BOARD_NAME = "todos.json"
_CLAIM_STALE_S = 30 * 60  # a claim older than this can be taken over


# --- root + path ---------------------------------------------------------------


def find_root(start: Optional[str] = None) -> str:
    """Walk up from `start` (default cwd) to a project root: the first dir with
    .git, .atlas, or docs/. Fails open to the start dir."""
    d = os.path.abspath(start or os.getcwd())
    for _ in range(7):
        for marker in (".git", ".atlas", "docs"):
            if os.path.exists(os.path.join(d, marker)):
                return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.abspath(start or os.getcwd())


def board_path(root: Optional[str] = None) -> Path:
    base = root or os.environ.get("ATLAS_PROJECT_ROOT") or find_root()
    return Path(base) / BOARD_DIR / BOARD_NAME


def empty_board(root: str) -> dict:
    return {"version": 1, "root": str(root), "updated_at": time.time(), "items": []}


def load(root: Optional[str] = None) -> dict:
    path = board_path(root)
    project_root = str(path.parent.parent.parent)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return empty_board(project_root)
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return empty_board(project_root)
    return data


def save(root: Optional[str], board: dict) -> None:
    path = board_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    board["version"] = 1
    board["root"] = str(path.parent.parent.parent)
    board["updated_at"] = time.time()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(board, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


# --- helpers -------------------------------------------------------------------


def _now() -> float:
    return time.time()


def _new_id() -> str:
    return "t" + uuid.uuid4().hex[:8]


def _norm_status(status: Any) -> str:
    s = str(status or "pending").lower()
    return s if s in STATUSES else "pending"


def _active(items: List[dict]) -> List[dict]:
    return [i for i in items if not i.get("archived")]


def _for_session(items: List[dict], session_id: Optional[str]) -> List[dict]:
    if session_id:
        return [i for i in _active(items) if i.get("session_id") == session_id]
    return _active(items)


def counts(board: dict, session_id: Optional[str] = None) -> dict:
    """needed / remaining / complete for the board (or one session's slice)."""
    items = _for_session(board.get("items", []), session_id)
    done = sum(1 for i in items if i.get("status") == "completed")
    total = len(items)
    return {
        "needed": total,
        "remaining": total - done,
        "complete": done,
        "claimed": sum(
            1 for i in items if i.get("status") == "in_progress" and i.get("owner")
        ),
    }


def _touch(item: dict) -> None:
    item["updated_at"] = _now()


# --- writers (all lock, read, mutate, save) ------------------------------------


def mirror(
    root: Optional[str], todos: List[dict], session_id: str, origin: str = "session"
) -> dict:
    """Replace the session's plan with a fresh TodoWrite-style list.

    TodoWrite rewrites the whole list every call, so `todos` IS current state.
    Items keep their id/owner/claim when the content matches (so a subagent
    claim survives a mirror). Manual items are never touched. Returns counts.
    """
    with _file_lock(board_path(root)):
        board = load(root)
        old = [
            i
            for i in board["items"]
            if i.get("session_id") == session_id and i.get("origin") != "manual"
        ]
        manual = [i for i in board["items"] if i.get("origin") == "manual"]
        by_content = {i.get("content"): i for i in old}

        fresh = []
        for entry in todos or []:
            content = str((entry or {}).get("content") or "").strip()
            if not content:
                continue
            prior = by_content.get(content)
            item = {
                "id": prior["id"] if prior else _new_id(),
                "content": content,
                "status": _norm_status((entry or {}).get("status")),
                "owner": prior.get("owner") if prior else None,
                "claimed_at": prior.get("claimed_at") if prior else None,
                "origin": origin,
                "session_id": session_id,
                "created_at": prior.get("created_at") if prior else _now(),
                "updated_at": _now(),
                "evidence": prior.get("evidence") if prior else None,
                "completed_at": prior.get("completed_at") if prior else None,
                "archived": False,
            }
            fresh.append(item)
        board["items"] = manual + fresh
        board["last_session_id"] = session_id
        save(root, board)
        return counts(board, session_id)


def add(
    root: Optional[str],
    content: str,
    session_id: Optional[str] = None,
    origin: str = "manual",
    status: str = "pending",
) -> dict:
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "content_required"}
    with _file_lock(board_path(root)):
        board = load(root)
        item = {
            "id": _new_id(),
            "content": content,
            "status": _norm_status(status),
            "owner": None,
            "claimed_at": None,
            "origin": origin,
            "session_id": session_id,
            "created_at": _now(),
            "updated_at": _now(),
            "evidence": None,
            "completed_at": None,
            "archived": False,
        }
        board["items"].append(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board, session_id)}


def _find(board: dict, item_id: str) -> Optional[dict]:
    for item in board.get("items", []):
        if item.get("id") == item_id:
            return item
    return None


def claim(root: Optional[str], item_id: str, owner: str, force: bool = False) -> dict:
    owner = (owner or "").strip()
    if not owner:
        return {"ok": False, "error": "owner_required"}
    with _file_lock(board_path(root)):
        board = load(root)
        item = _find(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        if item.get("status") == "completed":
            return {"ok": False, "error": "already_completed", "id": item_id}
        holder = item.get("owner")
        stale = holder and (
            _now() - float(item.get("claimed_at") or 0) > _CLAIM_STALE_S
        )
        if holder and holder != owner and not force and not stale:
            return {"ok": False, "error": "claimed_by_other", "claimed_by": holder}
        item["owner"] = owner
        item["claimed_at"] = _now()
        item["status"] = "in_progress"
        item["origin"] = item.get("origin") or "session"
        _touch(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board)}


def unclaim(root: Optional[str], item_id: str, owner: str) -> dict:
    with _file_lock(board_path(root)):
        board = load(root)
        item = _find(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        if item.get("owner") and owner and item["owner"] != owner:
            return {"ok": False, "error": "not_claim_owner"}
        item["owner"] = None
        item["claimed_at"] = None
        if item.get("status") == "in_progress":
            item["status"] = "pending"
        _touch(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board)}


def set_status(
    root: Optional[str],
    item_id: str,
    status: str,
    owner: Optional[str] = None,
    evidence: str = "",
) -> dict:
    status = _norm_status(status)
    with _file_lock(board_path(root)):
        board = load(root)
        item = _find(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        if owner and item.get("owner") and item["owner"] != owner:
            return {
                "ok": False,
                "error": "not_claim_owner",
                "claimed_by": item["owner"],
            }
        item["status"] = status
        if status == "completed":
            item["completed_at"] = _now()
            if evidence:
                item["evidence"] = evidence
        else:
            item["completed_at"] = None
        _touch(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board)}


def edit(root: Optional[str], item_id: str, content: str) -> dict:
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "content_required"}
    with _file_lock(board_path(root)):
        board = load(root)
        item = _find(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        item["content"] = content
        _touch(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board)}


def remove(root: Optional[str], item_id: str) -> dict:
    with _file_lock(board_path(root)):
        board = load(root)
        before = len(board["items"])
        board["items"] = [i for i in board["items"] if i.get("id") != item_id]
        if len(board["items"]) == before:
            return {"ok": False, "error": "not_found", "id": item_id}
        save(root, board)
        return {"ok": True, "counts": counts(board)}


def carry_over(root: Optional[str], session_id: str) -> dict:
    """New session: archive old completed items, hand unfinished ones to the
    new session as origin=carried. Returns what moved."""
    with _file_lock(board_path(root)):
        board = load(root)
        carried = archived = 0
        for item in board.get("items", []):
            if (
                item.get("archived")
                or item.get("origin") == "manual"
                or item.get("session_id") == session_id
            ):
                continue
            if item.get("status") == "completed":
                item["archived"] = True
                archived += 1
            else:
                item["origin"] = "carried"
                item["session_id"] = session_id
                item["owner"] = None
                item["claimed_at"] = None
                _touch(item)
                carried += 1
        if carried or archived:
            save(root, board)
        return {
            "ok": True,
            "carried": carried,
            "archived": archived,
            "counts": counts(board, session_id),
        }


# --- CLI -----------------------------------------------------------------------


def _cli(argv: Optional[List[str]] = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    flags: Dict[str, str] = {}
    positional: List[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if (
            a == "--root"
            or a == "--session"
            or a == "--id"
            or a == "--owner"
            or a == "--status"
            or a == "--evidence"
        ):
            flags[a[2:]] = args[i + 1] if i + 1 < len(args) else ""
            i += 2
        elif a == "--force":
            flags["force"] = "1"
            i += 1
        else:
            positional.append(a)
            i += 1

    root = flags.get("root")
    cmd = positional[0] if positional else "counts"
    out: Dict[str, Any]
    try:
        if cmd == "list":
            board = load(root)
            out = {
                "ok": True,
                "items": board.get("items", []),
                "counts": counts(board, flags.get("session")),
            }
        elif cmd == "set":
            session_id = flags.get("session") or ""
            todos = json.loads(positional[1] if len(positional) > 1 else "{}")
            if not isinstance(todos, list):
                raise ValueError("set expects a JSON array of {content,status}")
            out = {"ok": True, "counts": mirror(root, todos, session_id)}
        elif cmd == "add":
            out = add(
                root,
                positional[1] if len(positional) > 1 else "",
                session_id=flags.get("session"),
            )
        elif cmd == "claim":
            out = claim(
                root,
                flags.get("id", ""),
                flags.get("owner", ""),
                force=bool(flags.get("force")),
            )
        elif cmd == "complete":
            out = set_status(
                root,
                flags.get("id", ""),
                "completed",
                owner=flags.get("owner"),
                evidence=flags.get("evidence", ""),
            )
        elif cmd == "status":
            out = set_status(
                root,
                flags.get("id", ""),
                flags.get("status", "pending"),
                owner=flags.get("owner"),
            )
        elif cmd == "remove":
            out = remove(root, flags.get("id", ""))
        elif cmd == "carry":
            out = carry_over(root, flags.get("session") or "")
        elif cmd == "counts":
            board = load(root)
            out = {
                "ok": True,
                **counts(board, flags.get("session")),
                "session_id": flags.get("session"),
            }
        else:
            out = {"ok": False, "error": "unknown_command", "command": cmd}
    except Exception as exc:  # fail-open for hooks: report, never traceback
        out = {"ok": False, "error": str(exc)}
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(_cli())
