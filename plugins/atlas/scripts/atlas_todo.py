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
import re
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


def _worktree_main_root(worktree: str) -> Optional[str]:
    """Map a linked git worktree dir to the MAIN repo root, stdlib only.

    In a worktree, `.git` is a file (`gitdir: <main>/.git/worktrees/<n>`);
    that private git dir has a `commondir` file pointing at the main `.git`,
    whose parent is the main repo root. Returns None on anything unexpected
    (plain repos, submodule dirs, malformed files) so callers fail open.
    """
    try:
        with open(os.path.join(worktree, ".git"), "r", encoding="utf-8") as fh:
            content = fh.read()
    except OSError:
        return None
    git_dir = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("gitdir:"):
            git_dir = stripped[len("gitdir:"):].strip()
            break
    if not git_dir:
        return None
    if not os.path.isabs(git_dir):
        git_dir = os.path.join(worktree, git_dir)
    try:
        with open(os.path.join(git_dir, "commondir"), "r", encoding="utf-8") as fh:
            common = fh.read().strip()
    except OSError:
        return None
    if not common:
        return None
    common_dir = os.path.normpath(
        common if os.path.isabs(common) else os.path.join(git_dir, common)
    )
    main_root = os.path.dirname(common_dir)
    return main_root if os.path.isdir(main_root) else None


def find_root(start: Optional[str] = None) -> str:
    """Walk up from `start` (default cwd) to a project root: the first dir with
    .git, .atlas, or docs/. A linked git worktree (`.git` is a file) maps to the
    main repo root, so worktree-isolated workers share the lead's board.
    Fails open to the start dir."""
    d = os.path.abspath(start or os.getcwd())
    for _ in range(7):
        for marker in (".git", ".atlas", "docs"):
            if os.path.exists(os.path.join(d, marker)):
                if marker == ".git" and os.path.isfile(os.path.join(d, ".git")):
                    main_root = _worktree_main_root(d)
                    if main_root:
                        return main_root
                return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.abspath(start or os.getcwd())


def _resolve_base(root: Optional[str] = None) -> str:
    """Root resolution for board paths: ATLAS_PROJECT_ROOT wins, then an
    explicit root, then find_root(); a linked-worktree base (`.git` file)
    maps to the main repo root so workers share the lead's board."""
    base = root or os.environ.get("ATLAS_PROJECT_ROOT") or find_root()
    if os.path.isfile(os.path.join(base, ".git")):
        main_root = _worktree_main_root(base)
        if main_root:
            return main_root
    return base


def board_path(root: Optional[str] = None) -> Path:
    return Path(_resolve_base(root)) / BOARD_DIR / BOARD_NAME


def empty_board(root: str) -> dict:
    return {"version": 1, "root": str(root), "updated_at": time.time(), "items": []}


def load(root: Optional[str] = None) -> dict:
    """Read-only load: an unusable board reads as empty and is left alone."""
    board, _corrupt = _read_state(root)
    return board


def _read_state(root: Optional[str]) -> tuple:
    """Return (board, corrupt). `corrupt` is True only when todos.json EXISTS
    but is unreadable or not a board-shaped mapping; a missing file is not
    corrupt. Read-only callers ignore the flag; writers use it to quarantine
    the file instead of silently saving an empty board over it."""
    path = board_path(root)
    project_root = str(path.parent.parent.parent)
    if not path.exists():
        return empty_board(project_root), False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return empty_board(project_root), True
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return empty_board(project_root), True
    return data, False


def _quarantine_corrupt(root: Optional[str]) -> Optional[str]:
    """Writers only (caller holds the board lock): move an unparseable
    todos.json aside so nothing is silently erased. Returns the archived
    name, or None if there was nothing to move."""
    path = board_path(root)
    if not path.exists():
        return None
    dest = path.with_name(f"{path.name}.corrupt-{time.time_ns()}")
    try:
        os.replace(path, dest)
    except OSError:
        return None
    return dest.name


def _locked_load(root: Optional[str]) -> dict:
    """Writer-side load (caller holds the board lock): if the board file is
    corrupt, archive it to todos.json.corrupt-<ts> before any mutation/save
    and record the event on the notes channel."""
    board, corrupt = _read_state(root)
    if not corrupt:
        return board
    moved = _quarantine_corrupt(root)
    if moved:
        try:
            note(root, "board", f"todos.json was corrupt; preserved as {moved}; board reset", to="all")
        except OSError:
            pass  # best-effort record; the archived file is the real safety
    return board


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
    """Replace THIS session's plan with a fresh TodoWrite-style list.

    TodoWrite rewrites the whole list every call, so `todos` IS current state
    for `session_id`. Items keep their id/owner/claim when the content matches
    (so a subagent claim survives a mirror). Two classes of item are never
    touched: manual items (a human's notes), and items belonging to ANOTHER
    session -- concurrent terminals share one project board, so a mirror that
    dropped them would wipe a parallel run's plan and any work carried over
    from a previous session. Returns counts for this session's slice.
    """
    with _file_lock(board_path(root)):
        board = _locked_load(root)
        old = [
            i
            for i in board["items"]
            if i.get("session_id") == session_id and i.get("origin") != "manual"
        ]
        manual = [i for i in board["items"] if i.get("origin") == "manual"]
        others = [
            i
            for i in board["items"]
            if i.get("origin") != "manual" and i.get("session_id") != session_id
        ]
        by_content = {i.get("content"): i for i in old}

        fresh = []
        for entry in todos or []:
            content = str((entry or {}).get("content") or "").strip()
            if not content:
                continue
            prior = by_content.get(content)
            status = _norm_status((entry or {}).get("status"))
            if (
                prior
                and prior.get("status") == "completed"
                and str(prior.get("evidence") or "").strip()
            ):
                # Completion is monotonic: a worker's completed-with-evidence
                # state cannot be reverted by the lead's next TodoWrite.
                status = "completed"
            elif (
                prior
                and prior.get("owner")
                and prior.get("status") == "in_progress"
                and status == "pending"
            ):
                # A live worker claim is never reopened by a stale lead plan.
                status = "in_progress"
            item = {
                "id": prior["id"] if prior else _new_id(),
                "content": content,
                "status": status,
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
        board["items"] = manual + others + fresh
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
        board = _locked_load(root)
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
        board = _locked_load(root)
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
        board = _locked_load(root)
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
        board = _locked_load(root)
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
        board = _locked_load(root)
        item = _find(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        item["content"] = content
        _touch(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board)}


def remove(root: Optional[str], item_id: str) -> dict:
    with _file_lock(board_path(root)):
        board = _locked_load(root)
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
        board = _locked_load(root)
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


# --- notes channel (append-only sibling messaging) -------------------------------

NOTES_SUBDIR = "board"
NOTE_FILE_SUFFIX = ".jsonl"
_NOTE_NAME_BAD = re.compile(r"[^A-Za-z0-9_.-]")


def notes_dir(root: Optional[str] = None) -> Path:
    return Path(_resolve_base(root)) / BOARD_DIR / NOTES_SUBDIR


def _sanitize_owner(owner: Any) -> str:
    return _NOTE_NAME_BAD.sub("_", str(owner or "").strip()) or "anon"


def note(
    root: Optional[str], owner: Any, text: str, to: str = "all", item: Optional[str] = None
) -> dict:
    """Append one note to `<root>/.atlas/.run/board/<owner>.jsonl`.

    Only this owner ever writes its own file, so there is no cross-writer
    contention; the append is one os.write of a single JSON line on an
    O_APPEND fd. Returns the record as written."""
    name = _sanitize_owner(owner)
    target = notes_dir(root)
    target.mkdir(parents=True, exist_ok=True)
    record = {"ts": time.time(), "owner": name, "to": to, "item": item, "text": str(text or "")}
    line = (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8")
    fd = os.open(
        str(target / f"{name}{NOTE_FILE_SUFFIX}"),
        os.O_WRONLY | os.O_APPEND | os.O_CREAT,
        0o644,
    )
    try:
        os.write(fd, line)
    finally:
        os.close(fd)
    return record


def notes(
    root: Optional[str], to: Optional[str] = None, since: Optional[float] = None
) -> List[dict]:
    """Merge every worker's note file: malformed lines are skipped (never
    losing the rest), `to` filters as (to == name or to == 'all'), `since`
    drops older ts, and the result is sorted by ts."""
    target = notes_dir(root)
    if not target.is_dir():
        return []
    out: List[dict] = []
    for path in sorted(target.glob(f"*{NOTE_FILE_SUFFIX}")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for raw in fh:
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except (json.JSONDecodeError, ValueError):
                        continue
                    if not isinstance(rec, dict):
                        continue
                    if to is not None and rec.get("to") != to and rec.get("to") != "all":
                        continue
                    if since is not None and _note_ts_key(rec) < since:
                        continue
                    out.append(rec)
        except OSError:
            continue  # unreadable file: skip it, never lose the rest
    out.sort(key=_note_ts_key)
    return out


def _note_ts_key(rec: dict) -> float:
    try:
        return float(rec.get("ts") or 0)
    except (TypeError, ValueError):
        return 0.0


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
            or a == "--to"
            or a == "--item"
            or a == "--since"
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
        elif cmd == "note":
            owner = flags.get("owner", "").strip()
            if not owner:
                out = {"ok": False, "error": "owner_required"}
            else:
                out = {
                    "ok": True,
                    "note": note(
                        root,
                        owner,
                        positional[1] if len(positional) > 1 else "",
                        to=flags.get("to") or "all",
                        item=flags.get("item") or None,
                    ),
                }
        elif cmd == "notes":
            since_raw = flags.get("since")
            out = {
                "ok": True,
                "notes": notes(
                    root,
                    to=flags.get("to"),
                    since=float(since_raw) if since_raw else None,
                ),
            }
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
