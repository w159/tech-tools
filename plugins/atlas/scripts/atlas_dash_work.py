#!/usr/bin/env python3
"""Atlas dashboard v2: Work board (todos) routes.

Mounted by atlas_dashboard.py through ``ROUTES``. Every handler takes a ``ctx``
(``.query`` dict, ``.json()`` body, ``.groups`` regex groups, ``.db()`` sqlite
connection, ``.project_root(param)``) and returns ``(status, body)``.

All todo writes go through atlas_todo under its file lock. The only process the
Work board starts is ``atlas_launch.launch`` (a todo's "Start" op). Stdlib only.
"""

from __future__ import annotations

import os
import shlex
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_launch  # noqa: E402
import atlas_todo  # noqa: E402

_file_lock = atlas_todo._file_lock  # the lock atlas_todo's own writers use


# --- small helpers -------------------------------------------------------------


def _iso(ts) -> str | None:
    try:
        return (
            datetime.fromtimestamp(float(ts), tz=timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _err(status: int, error: str, why: str = "", do: str = ""):
    return status, {"ok": False, "error": error, "why": why, "do": do}


_BASE_CACHE: dict = {}
_BASE_TTL_S = 300.0


def _board_base(root: str) -> str | None:
    """Canonical project root for a path, or None when it holds no colony state.

    Linked worktrees resolve (via atlas_todo) to their main repo, so a worktree and
    its main checkout are one project. The git subprocess behind that is cached,
    and a root with no `.atlas/.run` directory never reaches it.
    """
    hit = _BASE_CACHE.get(root)
    if hit and time.time() - hit[0] < _BASE_TTL_S:
        return hit[1]
    base = None
    if os.path.isdir(os.path.join(root, ".atlas", ".run")):
        base = atlas_todo._resolve_base(root)
    _BASE_CACHE[root] = (time.time(), base)
    return base


def _project_roots(ctx, project_param) -> list[str]:
    """Selected project root, or every known root with colony state when omitted/all."""
    if project_param and project_param != "all":
        root = ctx.project_root(project_param)
        return [root] if root else []
    roots: list[str] = []
    try:
        conn = ctx.db()
        try:
            for row in conn.execute(
                "SELECT root_path FROM projects ORDER BY last_seen DESC"
            ):
                if not row[0] or not os.path.isdir(row[0]):
                    continue
                base = _board_base(row[0])
                if base and base not in roots:
                    roots.append(base)
        finally:
            conn.close()
    except (sqlite3.Error, OSError):
        return roots
    return roots


# --- todos ----------------------------------------------------------------------------------

UI_STATUS = {"pending": "open", "in_progress": "in_progress", "completed": "done"}
STATUS_IN = {
    "open": "pending",
    "pending": "pending",
    "in_progress": "in_progress",
    "done": "completed",
    "completed": "completed",
}
OPS = (
    "add",
    "update",
    "status",
    "remove",
    "claim",
    "assign",
    "move",
    "reorder",
    "start",
    "restore",
)


def _todo_view(item: dict) -> dict:
    launch = item.get("launch") or None
    status = UI_STATUS.get(str(item.get("status") or ""), "open")
    if item.get("blocked") and status != "done":
        status = "blocked"
    return {
        "id": item.get("id"),
        "content": item.get("content", ""),
        "status": status,
        "phase": item.get("phase") or "unphased",
        "owner": item.get("owner"),
        "claimed_by": item.get("owner")
        if item.get("status") == "in_progress"
        else None,
        "updated": _iso(item.get("updated_at")),
        "origin": item.get("origin"),
        "evidence": item.get("evidence"),
        "launch": launch,
        "live": bool(launch and atlas_launch.is_live(launch.get("target"))),
        "archived_reason": item.get("archived_reason"),
    }


_SWEEP_AT: dict[str, float] = {}
SWEEP_EVERY_S = 600


def _maybe_sweep(root: str) -> None:
    """Archive stale items, at most once per SWEEP_EVERY_S per root (read path)."""
    now = time.time()
    if now - _SWEEP_AT.get(root, 0) < SWEEP_EVERY_S:
        return
    _SWEEP_AT[root] = now
    try:
        atlas_todo.sweep(root)
    except OSError:
        pass


def _junk_root(path: str) -> bool:
    """Shared 'not a real project' predicate: temp dirs, self-fix worktrees, tool/plugin caches."""
    path = (path or "").rstrip("/")
    home = os.path.realpath(os.path.expanduser("~"))
    raw_home = os.path.expanduser("~")
    return (
        path in ("", "/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
        or path.startswith(
            ("/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/")
        )
        or any(
            path == p or path.startswith(p + os.sep)
            for h in {home, raw_home}
            for p in (
                os.path.join(h, ".claude"),
                os.path.join(h, ".hyper_plugins"),
                os.path.join(h, ".atlas", "worktrees"),
            )
        )
        or "/plugins/cache/" in path + "/"
    )


def _canon_roots(roots: list[str]) -> list[str]:
    """Realpath each root, drop tool/temp junk, dedupe in order."""
    out: list[str] = []
    for r in roots:
        real = os.path.realpath(r)
        if real not in out and not _junk_root(real):
            out.append(real)
    return out


def todos_state(root: str, archived: bool = False) -> dict:
    board = atlas_todo.load(root)
    phases: dict[str, list[dict]] = {}
    counts = {"open": 0, "in_progress": 0, "done": 0, "blocked": 0}
    latest = 0.0
    for it in board.get("items", []):
        if bool(it.get("archived")) != archived:
            continue
        v = _todo_view(it)
        phases.setdefault(v["phase"], []).append(v)
        counts[v["status"]] = counts.get(v["status"], 0) + 1
        latest = max(latest, float(it.get("updated_at") or 0))
    order = list(atlas_todo.todo_phases()) + ["unphased"]
    names = sorted(
        phases, key=lambda p: (order.index(p) if p in order else len(order), p)
    )
    return {
        "project": root,
        "phases": [{"name": n, "items": phases[n]} for n in names],
        "counts": counts,
        "updated": _iso(latest or board.get("updated_at")),
    }


def todos_all_state(roots: list[str], archived: bool = False) -> dict:
    """Read-only merge of every project's board: phases by name, counts summed.

    Each item carries its owning ``project`` root so the UI can tell them apart.
    Writes always go to one concrete project (POST requires it).
    """
    phases: dict[str, list[dict]] = {}
    counts = {"open": 0, "in_progress": 0, "done": 0, "blocked": 0}
    updated: list[str] = []
    for root in roots:
        st = todos_state(root, archived)
        for ph in st["phases"]:
            for item in ph["items"]:
                phases.setdefault(ph["name"], []).append(dict(item, project=root))
        for k, n in st["counts"].items():
            counts[k] = counts.get(k, 0) + n
        if st.get("updated"):
            updated.append(st["updated"])
    order = list(atlas_todo.todo_phases()) + ["unphased"]
    names = sorted(
        phases, key=lambda p: (order.index(p) if p in order else len(order), p)
    )
    return {
        "project": "all",
        "projects": roots,
        "phases": [{"name": n, "items": phases[n]} for n in names],
        "counts": counts,
        "updated": max(updated) if updated else None,
    }


def h_todos_get(ctx):
    param = ctx.query.get("project")
    archived = ctx.query.get("archived") in ("1", "true")
    if param in (None, "", "all"):
        # No single project selected: show every project's board (read-only view).
        roots = _canon_roots(_project_roots(ctx, None))
        for r in roots:
            _maybe_sweep(r)
        return 200, todos_all_state(roots, archived)
    root = ctx.project_root(param)
    if not root:
        return _err(
            400, "unknown_project", "unknown project", "pass ?project=<root path>"
        )
    _maybe_sweep(root)
    return 200, todos_state(root, archived)


def _locked_edit(root: str, fn):
    """Run ``fn(board)`` under atlas_todo's own board lock; save when it returns ok."""
    with _file_lock(atlas_todo.board_path(root)):
        board = atlas_todo._locked_load(root)
        result = fn(board)
        if result.get("ok"):
            atlas_todo.save(root, board)
        return result


def _find_item(board: dict, item_id: str):
    return atlas_todo._find(board, item_id)


def _op_add(root, b):
    content = str(b.get("content") or "")
    r = atlas_todo.add(root, content, origin="manual", phase=b.get("phase"))
    if r.get("ok") and b.get("owner"):
        r = atlas_todo.claim(root, r["item"]["id"], str(b["owner"]), force=True)
        atlas_todo.set_status(root, r["item"]["id"], "pending")
        _locked_edit(
            root, lambda bd: _assign(bd, r["item"]["id"], str(b["owner"]), claim=False)
        )
    return r


def _assign(board, item_id, owner, claim=True):
    item = _find_item(board, item_id)
    if item is None:
        return {"ok": False, "error": "not_found", "id": item_id}
    item["owner"] = owner or None
    if not claim:
        item["claimed_at"] = None
    atlas_todo._touch(item)
    return {"ok": True, "item": item}


def _op_update(root, b):
    item_id = str(b.get("id") or "")
    if b.get("content") is not None:
        r = atlas_todo.edit(root, item_id, str(b["content"]))
        if not r.get("ok"):
            return r
    if "phase" in b:
        r = _op_move(root, {"id": item_id, "phase": b.get("phase")})
        if not r.get("ok"):
            return r
    if "owner" in b:
        r = _locked_edit(
            root,
            lambda bd: _assign(bd, item_id, str(b.get("owner") or ""), claim=False),
        )
        if not r.get("ok"):
            return r
    return {"ok": True}


def _op_status(root, b):
    item_id, want = str(b.get("id") or ""), str(b.get("status") or "")
    if want == "blocked":

        def mark(board):
            item = _find_item(board, item_id)
            if item is None:
                return {"ok": False, "error": "not_found", "id": item_id}
            item["blocked"] = True
            if item.get("status") == "completed":
                item["status"] = "pending"
                item["completed_at"] = None
            atlas_todo._touch(item)
            return {"ok": True}

        return _locked_edit(root, mark)
    if want not in STATUS_IN:
        return {
            "ok": False,
            "error": "invalid_status",
            "hint": "open|in_progress|done|blocked",
        }
    r = atlas_todo.set_status(
        root,
        item_id,
        STATUS_IN[want],
        evidence=str(b.get("evidence") or "completed from dashboard"),
    )
    if r.get("ok"):
        _locked_edit(root, lambda bd: _clear_blocked(bd, item_id))
    return r


def _clear_blocked(board, item_id):
    item = _find_item(board, item_id)
    if item is not None and item.pop("blocked", None) is not None:
        return {"ok": True}
    return {"ok": False}


def _op_move(root, b):
    phase = b.get("phase")
    norm = atlas_todo._norm_phase(phase) if phase else None
    if phase and not norm:
        return {
            "ok": False,
            "error": "unknown_phase",
            "hint": ", ".join(atlas_todo.todo_phases()),
        }
    item_id = str(b.get("id") or "")

    def move(board):
        item = _find_item(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        if norm:
            item["phase"] = norm
        else:
            item.pop("phase", None)
        atlas_todo._touch(item)
        return {"ok": True}

    return _locked_edit(root, move)


def _op_reorder(root, b):
    ids = [str(i) for i in (b.get("ids") or [])]
    phase = b.get("phase")
    norm = atlas_todo._norm_phase(phase) if phase and phase != "unphased" else None

    def reorder(board):
        items = board["items"]
        in_phase = [
            i
            for i in items
            if (i.get("phase") or None) == norm and not i.get("archived")
        ]
        by_id = {i["id"]: i for i in in_phase}
        if not ids or set(ids) - set(by_id):
            return {
                "ok": False,
                "error": "ids_not_in_phase",
                "hint": "send existing ids of that phase",
            }
        ordered = [by_id[i] for i in ids] + [i for i in in_phase if i["id"] not in ids]
        slots = iter(ordered)
        board["items"] = [next(slots) if (i in in_phase) else i for i in items]
        return {"ok": True}

    return _locked_edit(root, reorder)


def _todo_prompt(root: str, item: dict) -> str:
    script = os.path.abspath(atlas_todo.__file__)
    return (
        "You are working a todo from the Atlas board.\n\n"
        f"Task: {item.get('content', '')}\n"
        f"Phase: {item.get('phase') or 'unphased'}\n"
        f"Todo id: {item.get('id')}\n"
        f"Project root: {root}\n\n"
        "When the work is done and verified, close the todo with:\n"
        f"python3 {shlex.quote(script)} complete --root {shlex.quote(root)} --id {item.get('id')} "
        '--evidence "<what you ran and its result>"\n'
    )


def _op_start(root, b, window):
    """Launch an agent for one todo (detached tmux), then claim it for that window."""
    item_id = str(b.get("id") or "")
    item = atlas_todo._find(atlas_todo.load(root), item_id)
    if item is None:
        return {"ok": False, "error": "not_found", "id": item_id}
    if item.get("status") == "completed":
        return {"ok": False, "error": "already_completed", "id": item_id}
    harness = str(b.get("harness") or "omp")
    res = atlas_launch.launch(
        root,
        window or f"todo-{item_id}",
        _todo_prompt(root, item),
        harness=harness,
        run="work",
    )
    if not res.get("ok"):
        argv = [harness, "--cwd", root]
        if res.get("prompt_file"):
            argv.append(f"@{res['prompt_file']}")
        return {
            "ok": False,
            "error": "launch_failed",
            "reason": res.get("reason"),
            "command": shlex.join(argv),
        }

    def claim(board):
        it = _find_item(board, item_id)
        if it is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        it.update(
            status="in_progress",
            owner=res["window"],
            claimed_at=time.time(),
            launch=res,
        )
        atlas_todo._touch(it)
        return {"ok": True, "item": it, "launch": res}

    return _locked_edit(root, claim)


def h_todos_post(ctx):
    b = ctx.json()
    root = ctx.project_root(b.get("project"))
    op = str(b.get("op") or "")
    if not root:
        return _err(
            400, "unknown_project", "project is required", "pass the project root path"
        )
    if op not in OPS:
        return _err(
            400,
            "unknown_op",
            f"{op!r} is not one of {', '.join(OPS)}",
            "use a listed op",
        )
    item_id = str(b.get("id") or "")
    try:
        if op == "add":
            r = _op_add(root, b)
        elif op == "update":
            r = _op_update(root, b)
        elif op == "status":
            r = _op_status(root, b)
        elif op == "remove":
            r = atlas_todo.remove(root, item_id)
        elif op == "claim":
            r = atlas_todo.claim(
                root, item_id, str(b.get("owner") or ""), force=bool(b.get("force"))
            )
        elif op == "start":
            r = _op_start(root, b, None)
        elif op == "restore":
            r = atlas_todo.restore(root, item_id)
        elif op == "assign" and b.get("launch"):
            r = _op_start(root, b, str(b.get("owner") or "") or None)
        elif op == "assign":
            r = _locked_edit(
                root, lambda bd: _assign(bd, item_id, str(b.get("owner") or ""))
            )
        elif op == "move":
            r = _op_move(root, b)
        else:
            r = _op_reorder(root, b)
    except OSError as e:
        return _err(
            500,
            "todo_write_failed",
            str(e),
            "check permissions on .atlas/.run/todos.json",
        )
    if not r.get("ok"):
        err = r.get("error")
        status = (
            404
            if err == "not_found"
            else 409
            if err in ("claimed_by_other", "not_claim_owner", "already_completed")
            else 502
            if err == "launch_failed"
            else 400
        )
        body = {
            "ok": False,
            "error": err or "failed",
            "why": r.get("reason") or r.get("hint") or r.get("claimed_by") or "",
            "do": "refresh and retry",
        }
        if err == "launch_failed":
            body["reason"], body["command"] = r.get("reason"), r.get("command")
        return status, body
    out = {"ok": True, "state": todos_state(root), "next": f"{op} applied"}
    if r.get("launch"):
        out["item"], out["launch"] = _todo_view(r["item"]), r["launch"]
    return 200, out


ROUTES = [
    ("GET", r"/api/v2/todos", h_todos_get),
    ("POST", r"/api/v2/todos", h_todos_post),
]
