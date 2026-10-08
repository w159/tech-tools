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
   "evidence": str|None, "completed_at": float|None, "archived": bool,
   "phase": <one of contracts/operating-contract.json todoPhases>}

`phase` is optional and present only when valid: an item whose phase is unknown
or unset simply has no `phase` key (never null, never an error). It comes from
an explicit `phase` field or, failing that, the content prefix `[<phase>] `
(for example `[verify] run the suites`), which is how Claude TodoWrite items
carry it.

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
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_memory import LockTimeout, _file_lock  # noqa: E402

STATUSES = ("pending", "in_progress", "completed")
ORIGINS = ("session", "carried", "manual", "advisor")
_KEEP_ORIGINS = (
    "manual",
    "advisor",
)  # never mirrored away or carried over; sweep() ages advisor notes out
_ADVISOR_TTL_S = 2 * 3600
BOARD_DIR = ".atlas/.run"
BOARD_NAME = "todos.json"
_CLAIM_STALE_S = 30 * 60  # a claim older than this can be taken over
CONTRACT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "contracts",
    "operating-contract.json",
)
_PHASE_PREFIX = re.compile(r"^\[([A-Za-z]+)\]\s")
_todo_phases_cache: Optional[tuple] = None


def todo_phases() -> tuple:
    """The phase ids an item may carry: contracts/operating-contract.json
    `todoPhases`, in contract order. An unreadable or malformed contract yields
    () so no item gets a phase (fail open: phases are presentation)."""
    global _todo_phases_cache
    if _todo_phases_cache is None:
        try:
            with open(CONTRACT_PATH, "r", encoding="utf-8") as fh:
                raw = json.load(fh).get("todoPhases")
            ok = isinstance(raw, list) and all(isinstance(p, str) for p in raw)
            _todo_phases_cache = tuple(raw) if ok else ()
        except (OSError, ValueError, AttributeError):
            _todo_phases_cache = ()
    return _todo_phases_cache


def _norm_phase(phase: Any) -> Optional[str]:
    """`phase` as a contract phase id, else None (unknown is absent, not an error)."""
    if not isinstance(phase, str):
        return None
    p = phase.strip().lower()
    return p if p in todo_phases() else None


def _entry_phase(entry: Any) -> Optional[str]:
    """Phase of one imported todo entry: its explicit `phase` key when that is a
    contract phase, else the `[<phase>] ` prefix of its content, else None."""
    if not isinstance(entry, dict):
        return None
    explicit = _norm_phase(entry.get("phase"))
    if explicit:
        return explicit
    m = _PHASE_PREFIX.match(str(entry.get("content") or "").strip())
    return _norm_phase(m.group(1)) if m else None


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
            git_dir = stripped[len("gitdir:") :].strip()
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
            note(
                root,
                "board",
                f"todos.json was corrupt; preserved as {moved}; board reset",
                to="all",
            )
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
            if i.get("session_id") == session_id
            and i.get("origin") not in _KEEP_ORIGINS
        ]
        manual = [i for i in board["items"] if i.get("origin") in _KEEP_ORIGINS]
        others = [
            i
            for i in board["items"]
            if i.get("origin") not in _KEEP_ORIGINS
            and i.get("session_id") != session_id
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
            phase = _entry_phase(entry)
            if phase:
                item["phase"] = phase
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
    unique: bool = False,
    phase: Optional[str] = None,
    owner: Optional[str] = None,
    channel: Optional[str] = None,
) -> dict:
    content = (content or "").strip()
    if not content:
        return {"ok": False, "error": "content_required"}
    with _file_lock(board_path(root)):
        board = _locked_load(root)
        if unique:
            # Idempotent add: one item per (session, exact content) whatever its
            # status or archived flag. Replayed advisor notes (omp re-sends the
            # whole history after a restart) must not re-open a closed item.
            for existing in board["items"]:
                if (
                    existing.get("session_id") == session_id
                    and existing.get("content") == content
                ):
                    return {
                        "ok": True,
                        "duplicate": True,
                        "item": existing,
                        "counts": counts(board, session_id),
                    }
        if content.startswith("advisor[") and origin == "manual":
            origin = "advisor"
        item = {
            "id": _new_id(),
            "content": content,
            "status": _norm_status(status),
            "owner": (str(owner).strip() or None) if owner else None,
            "claimed_at": None,
            "origin": origin,
            "session_id": session_id,
            "created_at": _now(),
            "updated_at": _now(),
            "evidence": None,
            "completed_at": None,
            "archived": False,
        }
        norm = _norm_phase(phase)
        if norm:
            item["phase"] = norm
        if channel:
            item["channel"] = str(channel).strip()
        board["items"].append(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board, session_id)}


def scaffold(
    root: Optional[str],
    task: str,
    session_id: Optional[str] = None,
    phases: Optional[List[str]] = None,
    origin: str = "session",
) -> dict:
    """Add one `[<phase>] <task>` item per phase (default: every contract
    todoPhase, in contract order) so a plan is phased from its first turn.

    Idempotent per (session, content): each item goes through add(unique=True),
    so a second run adds nothing and never reopens a closed item. Phase ids that
    are not contract phases are skipped, not errors. Returns the items (new or
    existing) in phase order plus how many were created."""
    task = (task or "").strip()
    if not task:
        return {"ok": False, "error": "task_required"}
    wanted = list(todo_phases()) if phases is None else phases
    chosen: List[str] = []
    for raw in wanted:
        p = _norm_phase(raw)
        if p and p not in chosen:
            chosen.append(p)
    items: List[dict] = []
    created = 0
    for p in chosen:
        res = add(
            root,
            f"[{p}] {task}",
            session_id=session_id,
            origin=origin,
            unique=True,
            phase=p,
        )
        if not res.get("ok"):
            return res
        if not res.get("duplicate"):
            created += 1
        items.append(res["item"])
    return {
        "ok": True,
        "created": created,
        "items": items,
        "counts": counts(load(root), session_id),
    }


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
                or item.get("origin") in _KEEP_ORIGINS
                or item.get("session_id") == session_id
            ):
                continue
            if item.get("status") == "completed":
                item["archived"] = True
                archived += 1
            else:
                item["origin"] = "carried"
                item["session_id"] = session_id
                if not item.get("launch"):  # a dashboard-launched agent keeps its claim
                    item["owner"] = None
                    item["claimed_at"] = None
                    item["status"] = "pending"
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


def restore(root: Optional[str], item_id: str) -> dict:
    """Unarchive one item (any prior status) back to pending."""
    with _file_lock(board_path(root)):
        board = _locked_load(root)
        item = _find(board, item_id)
        if item is None:
            return {"ok": False, "error": "not_found", "id": item_id}
        item["archived"] = False
        item.pop("archived_reason", None)
        item.pop("archived_at", None)
        item["status"] = "pending"
        item["completed_at"] = None
        item["owner"] = None
        item["claimed_at"] = None
        item.pop("launch", None)
        _touch(item)
        save(root, board)
        return {"ok": True, "item": item, "counts": counts(board)}


def _launch_live(item: dict) -> bool:
    target = (item.get("launch") or {}).get("target")
    if not target:
        return False
    import atlas_launch  # lazy: atlas_launch -> atlas_mux -> atlas_todo

    return atlas_launch.is_live(target)


def sweep(root: Optional[str], ttl_s: int = 86400) -> int:
    """Archive (recoverable via restore) unfinished items that are stale, advisor notes of an ended session,
    and duplicate content. An item with a live launch is never swept. Returns how many were archived."""
    with _file_lock(board_path(root)):
        board = _locked_load(root)
        now = _now()
        newest = board.get("last_session_id")
        live: Dict[str, bool] = {}

        def alive(item: dict) -> bool:
            if item["id"] not in live:
                live[item["id"]] = bool(item.get("launch")) and _launch_live(item)
            return live[item["id"]]

        def archive(item: dict, reason: str) -> None:
            item["archived"] = True
            item["archived_reason"] = reason
            item["archived_at"] = now

        def is_advisor(i: dict) -> bool:
            return i.get("origin") == "advisor" or str(i.get("content", "")).startswith(
                "advisor["
            )

        open_items = [
            i
            for i in _active(board["items"])
            if i.get("status") != "completed"
            and (i.get("origin") != "manual" or is_advisor(i))
        ]
        n = 0
        keep = []
        for i in open_items:
            age = now - float(i.get("updated_at") or 0)
            if alive(i):
                continue
            if age > ttl_s:
                archive(i, "stale")
            elif (
                is_advisor(i) and i.get("session_id") != newest and age > _ADVISOR_TTL_S
            ):
                archive(i, "advisor_session_ended")
            else:
                keep.append(i)
                continue
            n += 1
        newest_by_content: Dict[str, dict] = {}
        for i in sorted(keep, key=lambda x: float(x.get("updated_at") or 0)):
            newest_by_content[i.get("content", "")] = i
        for i in keep:
            if newest_by_content[i.get("content", "")] is not i:
                archive(i, "duplicate")
                n += 1
        if n:
            save(root, board)
        return n


# --- notes channel (append-only sibling messaging) -------------------------------

NOTES_SUBDIR = "board"
NOTE_FILE_SUFFIX = ".jsonl"
_NOTE_NAME_BAD = re.compile(r"[^A-Za-z0-9_.-]")


def notes_dir(root: Optional[str] = None) -> Path:
    return Path(_resolve_base(root)) / BOARD_DIR / NOTES_SUBDIR


def _sanitize_owner(owner: Any) -> str:
    return _NOTE_NAME_BAD.sub("_", str(owner or "").strip()) or "anon"


def _next_seq(root: Optional[str], target: Path) -> int:
    """Next board-wide note sequence; the caller holds the notes lock. A missing or
    corrupt counter is rebuilt from the highest seq already on the board, so notes
    written before the counter existed (no seq) are simply older than seq 1."""
    counter = target / ".seq"
    try:
        last = int(counter.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        last = max((_note_seq(r) for r in notes(root)), default=0)
    tmp = target / ".seq.tmp"
    tmp.write_text(str(last + 1), encoding="utf-8")
    os.replace(tmp, counter)
    return last + 1


def note(
    root: Optional[str],
    owner: Any,
    text: str,
    to: str = "all",
    item: Optional[str] = None,
    delivery: Optional[str] = None,
    channel: Optional[str] = None,
    kind: str = "note",
) -> dict:
    """Append one note to `<root>/.atlas/.run/board/<owner>.jsonl`.

    Each note gets a board-wide monotonic `seq` and its `ts` under one lock, so the
    seq order is exactly the append order and a reader cursor on seq cannot skip a
    note that lands late (a cursor on ts could). The append is one os.write of a
    single JSON line on an O_APPEND fd. `delivery` ("delivered" | "refused")
    records the dashboard's own send outcome on the line; it is omitted when unset.
    Returns the record as written."""
    name = _sanitize_owner(owner)
    chan = (channel or "").strip()
    # A launched worker (env ATLAS_WORKER_NAME == owner) is a member only if its lead
    # registered it; a channel it merely inherited from a lead's env is dropped.
    worker_env = (os.environ.get("ATLAS_WORKER_NAME") or "").strip()
    if chan and worker_env and name == _sanitize_owner(worker_env):
        if not may_post(root, chan, name):
            chan = ""
    target = notes_dir(root)
    target.mkdir(parents=True, exist_ok=True)
    record = {
        "ts": 0.0,
        "seq": 0,
        "owner": name,
        "to": to,
        "item": item,
        "text": str(text or ""),
        "channel": chan or default_channel(root, name),
    }
    if kind and kind != "note":
        record["kind"] = kind
    if delivery:
        record["delivery"] = delivery
    with _file_lock(target / ".seq"):
        record["seq"] = _next_seq(root, target)
        record["ts"] = time.time()
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
    root: Optional[str],
    to: Optional[str] = None,
    since: Optional[float] = None,
    consistent: bool = False,
    channel: Optional[str] = None,
) -> List[dict]:
    """Merge every worker's note file: malformed lines are skipped (never
    losing the rest), `to` filters as (to == name or to == 'all'), `since`
    drops older ts, and the result is sorted by ts.

    The files are scanned one after another, so a plain read can see seq 100 in a
    later file while seq 99, which landed in an already-scanned file a moment
    earlier, is missing. A reader that advances a cursor on seq (the worker inbox)
    passes `consistent=True` to scan under the note lock: every note up to the
    highest seq it sees is then present."""
    target = notes_dir(root)
    if not target.is_dir():
        return []
    if consistent:
        with _file_lock(target / ".seq"):
            return _scan_notes(target, to, since, channel)
    return _scan_notes(target, to, since, channel)


def _scan_notes(
    target: Path,
    to: Optional[str],
    since: Optional[float],
    channel: Optional[str] = None,
) -> List[dict]:
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
                    if (
                        to is not None
                        and rec.get("to") != to
                        and rec.get("to") != "all"
                    ):
                        continue
                    if channel is not None and rec.get("channel") != channel:
                        continue
                    if since is not None and _note_ts_key(rec) < since:
                        continue
                    out.append(rec)
        except OSError:
            continue  # unreadable file: skip it, never lose the rest
    out.sort(key=lambda r: (_note_ts_key(r), _note_seq(r)))
    return out


def _note_ts_key(rec: dict) -> float:
    try:
        return float(rec.get("ts") or 0)
    except (TypeError, ValueError):
        return 0.0


def _note_seq(rec: dict) -> int:
    """Board-wide sequence of a note; 0 for legacy notes written before seq existed."""
    try:
        return int(rec.get("seq") or 0)
    except (TypeError, ValueError):
        return 0


# --- channels (IRC model: main per project@branch, one subchannel per lead) ------
#
# Registry: <root>/.atlas/.run/channels.json = {"version":1,"channels":{name: chan}}
# chan = {name, kind: main|lead, parent, lead, members:[{name, role: lead|subagent,
# parent, joined}], project_root, branch, created, last_activity}. Notes carry a
# `channel` field and keep the board-wide monotonic `seq` (so a per-channel cursor on
# seq loses and duplicates nothing). Subchannel name = `<main>/<lead>`.

CHANNELS_NAME = "channels.json"


def _git(cwd: str, *args: str) -> Optional[str]:
    try:
        r = subprocess.run(
            ["git", "-C", cwd, *args], capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.SubprocessError):
        return None
    out = r.stdout.strip()
    return out if r.returncode == 0 and out else None


def _main_parts(cwd: Optional[str]) -> tuple:
    d = os.path.abspath(cwd or os.getcwd())
    base = os.path.basename(d.rstrip(os.sep)) or d
    # symbolic-ref also works on an unborn branch; detached/non-repo fall through
    ref = _git(d, "symbolic-ref", "--short", "-q", "HEAD") or _git(
        d, "rev-parse", "--short", "HEAD"
    )
    return (f"{base}@{ref}" if ref else base), ref


def main_channel(cwd: Optional[str] = None) -> str:
    """`<cwd-basename>@<branch>`; detached HEAD -> `@<short-sha>`; non-git -> basename."""
    return _main_parts(cwd)[0]


def _channels_path(root: Optional[str]) -> Path:
    return Path(_resolve_base(root)) / BOARD_DIR / CHANNELS_NAME


def _reg_read(root: Optional[str]) -> dict:
    try:
        data = json.loads(_channels_path(root).read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("channels"), dict):
            return data
    except (OSError, ValueError):
        pass
    return {"version": 1, "channels": {}}


CHANNEL_LOCK_TIMEOUT_S = 2.0  # hook/note paths must never hang on a stuck registry lock


def _reg_update(root: Optional[str], fn, timeout: Optional[float] = None) -> Any:
    """Read-modify-write the registry under its lock; returns fn(registry).
    `timeout` (seconds) bounds the lock wait, raising atlas_memory.LockTimeout."""
    path = _channels_path(root)
    with _file_lock(path, timeout):
        reg = _reg_read(root)
        out = fn(reg)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(reg, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        return out


def _add_member(
    chan: dict, name: str, role: str, parent: Optional[str], revive: bool = False
) -> None:
    for m in chan["members"]:
        if m["name"] == name:
            if role == "lead":
                m["role"] = "lead"
            if parent and not m.get("parent"):
                m["parent"] = parent
            if revive:  # a respawn under the same name is a new live run
                for k in ("exit_code", "ended_at", "pid", "pane_id"):
                    m.pop(k, None)
                m["joined"] = time.time()
                chan.get("departed", {}).pop(name, None)
            return
    if revive:
        chan.get("departed", {}).pop(name, None)
    chan["members"].append(
        {"name": name, "role": role, "parent": parent, "joined": time.time()}
    )


def _upsert(
    reg: dict,
    name: str,
    kind: str,
    parent: Optional[str],
    lead: Optional[str],
    base: str,
    branch: Optional[str],
) -> dict:
    chans = reg["channels"]
    if name not in chans:
        now = time.time()
        chans[name] = {
            "name": name,
            "kind": kind,
            "parent": parent,
            "lead": lead,
            "members": [],
            "project_root": base,
            "branch": branch,
            "created": now,
            "last_activity": now,
        }
    return chans[name]


def ensure_main(root: Optional[str] = None) -> dict:
    """Create (idempotent) the main channel of this project@branch; returns it."""
    base = _resolve_base(root)
    name, branch = _main_parts(base)
    return _reg_update(
        root, lambda reg: dict(_upsert(reg, name, "main", None, None, base, branch))
    )


def open_lead_channel(
    root: Optional[str],
    lead_name: str,
    subagents: Any = (),
    timeout: Optional[float] = None,
    revive: bool = False,
) -> dict:
    """Open (idempotent) `<main>/<lead>`; the lead joins it and main, each subagent
    joins it with parent=lead. Returns the subchannel record. `timeout` bounds the
    registry lock wait (LockTimeout)."""
    base = _resolve_base(root)
    main, branch = _main_parts(base)
    lead = _sanitize_owner(lead_name)

    def fn(reg: dict) -> dict:
        mchan = _upsert(reg, main, "main", None, None, base, branch)
        _add_member(mchan, lead, "lead", None)
        sub = _upsert(reg, f"{main}/{lead}", "lead", main, lead, base, branch)
        _add_member(sub, lead, "lead", None)
        for s in subagents or ():
            s = _sanitize_owner(s)
            if s != lead:
                _add_member(sub, s, "subagent", lead, revive)
        sub["last_activity"] = time.time()
        return dict(sub)

    return _reg_update(root, fn, timeout)


def join(
    root: Optional[str],
    channel: str,
    name: str,
    role: str = "subagent",
    parent: Optional[str] = None,
    timeout: Optional[float] = None,
    revive: bool = False,
) -> dict:
    """Add `name` to an existing channel (idempotent). KeyError if it does not exist."""

    def fn(reg: dict) -> dict:
        chan = reg["channels"][channel]
        _add_member(
            chan, _sanitize_owner(name), role, parent or chan.get("lead"), revive
        )
        return dict(chan)

    return _reg_update(root, fn, timeout)


def leave(root: Optional[str], channel: str, name: str) -> Optional[dict]:
    """Remove `name` from a channel, except a member already marked finished (it stays so the
    Colony can list it); None when the channel does not exist. A removed member is kept in
    chan["departed"] so a later mark_finished() can still restore it as finished."""

    def fn(reg: dict) -> Optional[dict]:
        chan = reg["channels"].get(channel)
        if chan is None:
            return None
        n = _sanitize_owner(name)
        gone = [m for m in chan["members"] if m["name"] == n and "exit_code" not in m]
        if gone:
            chan.setdefault("departed", {})[n] = gone[0]
        chan["members"] = [
            m for m in chan["members"] if m["name"] != n or "exit_code" in m
        ]
        return dict(chan)

    return _reg_update(root, fn, CHANNEL_LOCK_TIMEOUT_S)


def mark_finished(root: Optional[str], name: str, exit_code: int) -> int:
    """Record {exit_code, ended_at} on every channel-member entry of `name`, restoring
    entries leave() already removed (call order vs leave() does not matter); returns how
    many entries were marked."""
    n = _sanitize_owner(name)
    now = time.time()

    def fn(reg: dict) -> int:
        hit = 0
        for chan in reg["channels"].values():
            gone = chan.get("departed", {}).pop(n, None)
            if gone is not None and not any(m["name"] == n for m in chan["members"]):
                chan["members"].append(gone)
            for m in chan["members"]:
                if m["name"] == n:
                    m["exit_code"], m["ended_at"] = int(exit_code), now
                    hit += 1
        return hit

    return _reg_update(root, fn, CHANNEL_LOCK_TIMEOUT_S)


def set_member_handles(
    root: Optional[str],
    name: str,
    channel: Optional[str] = None,
    pid: Optional[int] = None,
    pane_id: Optional[str] = None,
) -> int:
    """Record the member's own process/pane handles on its registry entry (every channel
    entry of `name`, or only `channel`); returns entries updated. Colony Kill/Send use
    only these handles."""
    n = _sanitize_owner(name)

    def fn(reg: dict) -> int:
        hit = 0
        for cname, chan in reg["channels"].items():
            if channel and cname != channel:
                continue
            for m in chan["members"]:
                if m["name"] == n:
                    if pid is not None:
                        m["pid"] = int(pid)
                    if pane_id is not None:
                        m["pane_id"] = str(pane_id)
                    hit += 1
        return hit

    try:  # never break a worker run over a missing handle
        return _reg_update(root, fn, CHANNEL_LOCK_TIMEOUT_S)
    except Exception:
        return 0


def _with_activity(root: Optional[str], chans: List[dict]) -> List[dict]:
    last: Dict[str, float] = {}
    for r in notes(root):
        c = r.get("channel")
        if c:
            last[c] = max(last.get(c, 0.0), _note_ts_key(r))
    for c in chans:
        c["last_activity"] = max(
            float(c.get("last_activity") or 0), last.get(c["name"], 0.0)
        )
    return chans


def get_channel(root: Optional[str], name: str) -> Optional[dict]:
    chan = _reg_read(root)["channels"].get(name)
    return _with_activity(root, [json.loads(json.dumps(chan))])[0] if chan else None


def channels(root: Optional[str] = None) -> List[dict]:
    """The tree: every main channel (oldest first) with its lead subchannels in
    `children`."""
    chans = _with_activity(
        root, [json.loads(json.dumps(c)) for c in _reg_read(root)["channels"].values()]
    )
    for c in chans:
        c["children"] = []
    by_name = {c["name"]: c for c in chans}
    mains = []
    for c in sorted(chans, key=lambda c: c.get("created") or 0):
        parent = by_name.get(c.get("parent") or "")
        (parent["children"] if parent else mains).append(c)
    return mains


def channels_of(root: Optional[str], name: str) -> List[str]:
    """Names of every channel `name` is a member of."""
    n = _sanitize_owner(name)
    return [
        c["name"]
        for c in _reg_read(root)["channels"].values()
        if any(m["name"] == n for m in c["members"])
    ]


SYSTEM_OWNERS = (
    "human",
    "board",
)  # dashboard sender / board housekeeping: never members


def is_lead_name(name: Any) -> bool:
    """A lead's identity: the bare alias `lead` or `lead-<session>`."""
    n = _sanitize_owner(name)
    return n == "lead" or n.startswith("lead-")


def may_post(
    root: Optional[str], channel: str, name: Any, reg: Optional[dict] = None
) -> bool:
    """May `name` speak in `channel`? Membership is granted by the lead side only
    (open_lead_channel / join / register_member), never by a poster's own env.
    A lead subchannel admits its members, departed members (a finished worker keeps
    its report), its lead, the `lead` alias and the dashboard's `human`/`board`.
    Main and unregistered channels have no inbox to protect and admit anyone."""
    chan = (reg or _reg_read(root))["channels"].get(channel)
    if chan is None or chan.get("kind") != "lead":
        return True
    n = _sanitize_owner(name)
    return (
        n in SYSTEM_OWNERS
        or n == "lead"
        or n == chan.get("lead")
        or n in chan.get("departed", {})
        or any(m["name"] == n for m in chan["members"])
    )


def default_channel(root: Optional[str], owner: Any = None) -> str:
    """Channel a note lands in when none is given: ATLAS_CHANNEL when `owner` may
    speak there (an inherited env alone grants nothing), else the newest lead
    subchannel `owner` belongs to (how an omp subagent, which has no env of its
    own, posts into its lead's subchannel), else the project's main channel."""
    n = _sanitize_owner(owner)
    env = (os.environ.get("ATLAS_CHANNEL") or "").strip()
    if env and may_post(root, env, n):
        return env
    mine = [
        c
        for c in _reg_read(root)["channels"].values()
        if c.get("kind") == "lead" and any(m["name"] == n for m in c["members"])
    ]
    if mine:
        return max(mine, key=lambda c: c.get("created") or 0)["name"]
    main = main_channel(_resolve_base(root))
    if (
        n == "lead"
    ):  # omp's main thread posts as `lead`; its real name is lead-<session>
        subs = [
            c
            for c in _reg_read(root)["channels"].values()
            if c.get("kind") == "lead" and c.get("parent") == main
        ]
        if subs:
            return max(subs, key=lambda c: c.get("created") or 0)["name"]
    return main


def env_channel(root: Optional[str]) -> tuple:
    """(channel, lead) a launcher inherits from its own env. A worker (ATLAS_WORKER_NAME
    set) that is not that channel's lead has no say over it: its children get no inherited
    channel and it is their lead, so they never enrol into the lead it merely inherited."""
    chan = (os.environ.get("ATLAS_CHANNEL") or "").strip()
    lead = (os.environ.get("ATLAS_LEAD_NAME") or "").strip()
    me = (os.environ.get("ATLAS_WORKER_NAME") or "").strip()
    if chan and me:
        owner_lead = (_reg_read(root)["channels"].get(chan) or {}).get("lead")
        if _sanitize_owner(me) != owner_lead:
            return "", _sanitize_owner(me)
    return chan, lead


def register_member(
    root: Optional[str],
    name: str,
    channel: Optional[str] = None,
    lead: Optional[str] = None,
) -> str:
    """LEAD-SIDE registration of a launched worker (atlas_launch, atlas_mux spawn):
    joins `channel` (default ATLAS_CHANNEL) when it is a registered lead subchannel,
    else opens `<main>/<lead>` (lead default: ATLAS_LEAD_NAME, else `lead`; never the
    newest lead of the project, that is how a stranger reached another lead's inbox).
    Returns the channel the worker ended up
    in. Idempotent; fail-open (fault recorded, `channel` returned as given)."""
    env_chan, env_lead = env_channel(root)
    chan_name = (channel or env_chan or "").strip()
    worker = _sanitize_owner(name)
    try:
        chans = _reg_read(root)["channels"]
        chan = chans.get(chan_name)
        if chan is not None and chan.get("kind") == "lead":
            join(
                root,
                chan_name,
                worker,
                "subagent",
                chan.get("lead"),
                timeout=CHANNEL_LOCK_TIMEOUT_S,
                revive=True,
            )
            return chan_name
        lead_n = (lead or env_lead or "lead").strip()
        return open_lead_channel(
            root, lead_n, [worker], timeout=CHANNEL_LOCK_TIMEOUT_S, revive=True
        )["name"]
    except Exception as exc:  # never block a launch
        try:
            import atlas_faults

            hook = (
                "atlas_todo.register_worker.lock_timeout"
                if isinstance(exc, LockTimeout)
                else "atlas_todo.register_worker"
            )
            atlas_faults.record(hook, exc, str(root or ""))
        except Exception:
            pass
        return chan_name


def _item_counts(items: List[dict]) -> dict:
    out = {s: 0 for s in STATUSES}
    for i in items:
        out[_norm_status(i.get("status"))] += 1
    return out


def channel_brief(root: Optional[str], channel: str, lead: str, name: str) -> str:
    """The CHANNEL block appended to a subagent's brief: where it posts, how it
    reads its inbox, who its siblings are. Short on purpose."""
    script = os.path.abspath(__file__)
    chan = get_channel(root, channel) or {"members": []}
    sibs = [m["name"] for m in chan["members"] if m["name"] not in (name, lead)]
    base = f'python3 "{script}"'
    rt = _resolve_base(root)
    return (
        f"CHANNEL: {channel} (you are {name}; lead {lead}; siblings: "
        f"{', '.join(sibs) or 'none yet'}).\n"
        f'Post: {base} note --root "{rt}" --channel "{channel}" --owner {name} '
        f'--to <sibling|{lead}|all> "<text>" (to=all reaches the whole channel).\n'
        f'Inbox (run between steps): {base} inbox --root "{rt}" --owner {name}\n'
        f'Your todos: {base} claim --root "{rt}" --id <id> --owner {name}; the lead '
        f"watches this channel's board."
    )


def lead_name(session_id: Any = None) -> str:
    """Name of the orchestrating lead: ATLAS_LEAD_NAME, else the mux worker name,
    else `lead-<first 6 of the session id>` (`lead` when there is no session)."""
    for key in ("ATLAS_LEAD_NAME", "ATLAS_WORKER_NAME"):
        v = (os.environ.get(key) or "").strip()
        if v:
            return _sanitize_owner(v)
    sid = _sanitize_owner(session_id)[:6] if session_id else ""
    return f"lead-{sid}" if sid else "lead"


def channel_board(root: Optional[str], channel: str) -> dict:
    """Todo items grouped by channel member: {channel, members:[{name, role, parent,
    counts, items, last_note}], counts}. KeyError if the channel is unknown."""
    chan = get_channel(root, channel)
    if chan is None:
        raise KeyError(channel)
    live = [i for i in load(root).get("items", []) if not i.get("archived")]
    posted = notes(root, channel=channel)
    members = []
    for m in chan["members"]:
        # the lead's own plan (todo mirror) carries no owner: it is the lead's, matched by
        # session (lead-<first 6 of the session id>) or, for a named lead, any unowned item
        lead_plan = chan.get("kind") == "lead" and m["name"] == chan.get("lead")
        sid6 = m["name"][5:] if m["name"].startswith("lead-") else ""
        mine = [
            i
            for i in live
            if i.get("owner") == m["name"]
            or (
                lead_plan
                and not i.get("owner")
                and (not sid6 or _sanitize_owner(i.get("session_id"))[:6] == sid6)
            )
        ]
        theirs = [r for r in posted if r.get("owner") == m["name"]]
        members.append(
            {
                "name": m["name"],
                "role": m.get("role"),
                "parent": m.get("parent"),
                "counts": _item_counts(mine),
                "items": mine,
                "last_note": (theirs[-1] if theirs else None),
            }
        )
    owned = [i for mm in members for i in mm["items"]]
    return {
        "channel": chan["name"],
        "kind": chan["kind"],
        "lead": chan.get("lead"),
        "members": members,
        "counts": _item_counts(owned),
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
            or a == "--to"
            or a == "--item"
            or a == "--since"
            or a == "--phase"
            or a == "--phases"
            or a == "--task"
            or a == "--channel"
            or a == "--lead"
            or a == "--members"
        ):
            flags[a[2:]] = args[i + 1] if i + 1 < len(args) else ""
            i += 2
        elif a == "--force" or a == "--unique":
            flags[a[2:]] = "1"
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
                unique=bool(flags.get("unique")),
                phase=flags.get("phase"),
                owner=flags.get("owner"),
                channel=flags.get("channel"),
            )
        elif cmd == "scaffold":
            phases_raw = flags.get("phases")
            out = scaffold(
                root,
                flags.get("task", ""),
                session_id=flags.get("session"),
                phases=(
                    [p for p in phases_raw.split(",") if p.strip()]
                    if phases_raw is not None
                    else None
                ),
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
                        channel=flags.get("channel") or None,
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
                    channel=flags.get("channel") or None,
                ),
            }
        elif cmd == "counts":
            board = load(root)
            out = {
                "ok": True,
                **counts(board, flags.get("session")),
                "session_id": flags.get("session"),
            }
        elif cmd == "channels":
            out = {
                "ok": True,
                "main": main_channel(_resolve_base(root)),
                "channels": channels(root),
            }
        elif cmd == "channel-open":
            lead = flags.get("lead", "").strip()
            if not lead:
                out = {"ok": False, "error": "lead_required"}
            else:
                members = [m for m in flags.get("members", "").split(",") if m.strip()]
                # a dispatcher passes its cwd, which may be a subdirectory of the project
                root = find_root(root) if root else root
                chan = open_lead_channel(root, lead, members)
                out = {
                    "ok": True,
                    "channel": chan,
                    "briefs": {
                        _sanitize_owner(m): channel_brief(
                            root, chan["name"], chan["lead"], _sanitize_owner(m)
                        )
                        for m in members
                    },
                }
        elif cmd == "channel-board":
            out = {
                "ok": True,
                **channel_board(root, positional[1] if len(positional) > 1 else ""),
            }
        elif cmd == "inbox":
            owner = flags.get("owner", "").strip()
            if not owner:
                out = {"ok": False, "error": "owner_required"}
            else:
                sys.path.insert(
                    0, str(Path(__file__).resolve().parent.parent / "hooks")
                )
                import worker_inbox

                out = {
                    "ok": True,
                    "text": worker_inbox.drain(root or _resolve_base(None), owner),
                }
        else:
            out = {"ok": False, "error": "unknown_command", "command": cmd}
    except Exception as exc:  # fail-open for hooks: report, never traceback
        out = {"ok": False, "error": str(exc)}
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(_cli())
