#!/usr/bin/env python3
"""Atlas dashboard v2: colony (tmux rigs/agents), IRC (board notes) and todo mutations.

Mounted by atlas_dashboard.py through ``ROUTES``. Every handler takes a ``ctx``
(``.query`` dict, ``.json()`` body, ``.groups`` regex groups, ``.db()`` sqlite
connection, ``.project_root(param)``) and returns ``(status, body)``.

Read-only unless a route is a POST. Nothing here spawns arbitrary commands:
the only subprocess calls are fixed ``tmux`` argv lists against sessions named
``atlas-<run>`` whose run/agent names match atlas_mux.NAME_RE.
Stdlib only; all todo writes go through atlas_todo under its file lock.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_todo  # noqa: E402

_file_lock = atlas_todo._file_lock  # the lock atlas_todo's own writers use

# Delivery state of a message to a worker comes from the cursor the worker's own
# PostToolUse hook advances (hooks/worker_inbox.py); one module owns the file layout.
HOOKS_DIR = SCRIPTS_DIR.parent / "hooks"
if str(HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(HOOKS_DIR))
try:
    import worker_inbox
except ImportError:  # hooks dir absent from a trimmed install: nothing is ever "read"
    worker_inbox = None

NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SESSION_PREFIX = "atlas-"
EXIT_RE = re.compile(r"^exit (-?\d+)(?: \[failed: (.*)\])?")
HUMAN = "human"
STUCK_NEEDS_INPUT_S = 120
STUCK_IDLE_WITH_WORK_S = 600
WORKING_WINDOW_S = 45
CAPTURE_MAX_LINES = 2000

# Interactive prompts a typed line would answer by accident. Checked against
# the last non-empty pane lines only.
PROMPT_RES = (
    re.compile(r"\(y/n\)|\[y/N\]|\[Y/n\]|\(yes/no\)", re.I),
    re.compile(r"\bdo you want to\b.*\?\s*$", re.I),
    re.compile(r"press (?:enter|any key)", re.I),
    re.compile(r"^\s*[❯>]\s*\d+\.\s", re.M),  # numbered selection menus
    re.compile(r"\bpermission\b.*\b(allow|approve|deny)\b", re.I),
    re.compile(r"(?:password|passphrase)[^\n]*:\s*$", re.I),
)
FAIL_RES = (
    re.compile(r"\bmodel\b[^\n]{0,60}\bnot found\b", re.I),
    re.compile(r"insufficient credit|credit balance|payment required", re.I),
    re.compile(r"invalid api[ _-]?key|authentication (?:failed|error)", re.I),
    re.compile(r"Traceback \(most recent call last\)"),
)
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")


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


def _epoch(value) -> float:
    """ISO string, numeric string or float -> epoch seconds (0.0 when unparseable)."""
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _err(status: int, error: str, why: str = "", do: str = ""):
    return status, {"ok": False, "error": error, "why": why, "do": do}


def _strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text or "")


def tmux_available() -> bool:
    return shutil.which("tmux") is not None


def _tmux(*args: str, timeout: float = 5.0) -> subprocess.CompletedProcess | None:
    if not tmux_available():
        return None
    try:
        return subprocess.run(
            ["tmux", *args], capture_output=True, text=True, timeout=timeout
        )
    except (OSError, subprocess.SubprocessError):
        return None


def _session(run: str) -> str:
    return run if run.startswith(SESSION_PREFIX) else SESSION_PREFIX + run


def _run_of(session: str) -> str:
    return (
        session[len(SESSION_PREFIX) :]
        if session.startswith(SESSION_PREFIX)
        else session
    )


def _valid(name: str | None) -> bool:
    return bool(name) and bool(NAME_RE.match(name))


def _mux_enabled() -> bool:
    return os.environ.get("ATLAS_MUX") == "tmux"


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


# --- tmux discovery ---------------------------------------------------------------


def list_sessions() -> list[dict]:
    """[{session, run, created}] for every ``atlas-*`` tmux session."""
    res = _tmux("list-sessions", "-F", "#{session_name}\t#{session_created}")
    if not res or res.returncode != 0:
        return []
    out = []
    for line in res.stdout.splitlines():
        name, _, created = line.partition("\t")
        if name.startswith(SESSION_PREFIX):
            out.append(
                {"session": name, "run": _run_of(name), "created": _epoch(created)}
            )
    return out


def list_panes(session: str) -> list[dict]:
    fmt = "\t".join(
        (
            "#{window_name}",
            "#{pane_id}",
            "#{pane_dead}",
            "#{pane_dead_status}",
            "#{window_activity}",
            "#{pane_current_command}",
        )
    )
    res = _tmux("list-panes", "-s", "-t", session, "-F", fmt)
    if not res or res.returncode != 0:
        return []
    panes = []
    for line in res.stdout.splitlines():
        p = line.split("\t")
        if len(p) < 6 or not p[0]:
            continue
        panes.append(
            {
                "window": p[0],
                "pane_id": p[1],
                "dead": p[2] == "1",
                "dead_status": int(p[3]) if p[3].lstrip("-").isdigit() else None,
                "activity": _epoch(p[4]),
                "command": p[5],
            }
        )
    return panes


def capture_pane(pane_id_or_target: str, lines: int = 200) -> str | None:
    lines = max(1, min(int(lines or 200), CAPTURE_MAX_LINES))
    res = _tmux("capture-pane", "-p", "-J", "-t", pane_id_or_target, "-S", f"-{lines}")
    if not res or res.returncode != 0:
        return None
    return _strip_ansi(res.stdout)


def _tail_nonempty(text: str, n: int = 6) -> list[str]:
    return [ln for ln in (text or "").splitlines() if ln.strip()][-n:]


def pane_shows_prompt(text: str) -> bool:
    tail = "\n".join(_tail_nonempty(text, 6))
    return any(r.search(tail) for r in PROMPT_RES)


def pane_shows_failure(text: str) -> str | None:
    tail = "\n".join(_tail_nonempty(text, 25))
    for r in FAIL_RES:
        m = r.search(tail)
        if m:
            return m.group(0)[:80]
    return None


# --- board notes / IRC ---------------------------------------------------------------


def _project_name(root: str) -> str:
    return os.path.basename(root.rstrip("/")) or root


def _message_id(root: str, rec: dict) -> str:
    key = f"{root}|{rec.get('ts')}|{rec.get('owner')}|{rec.get('to')}|{rec.get('text')}"
    return "m" + hashlib.sha256(key.encode("utf-8", "replace")).hexdigest()[:12]


def _delivery_status(root: str, rec: dict, kind: str, memo: dict | None) -> str:
    """``queued``, ``read``, ``delivered`` or ``refused`` for one message.

    Only a dashboard message to a named agent waits for anyone. When the dashboard itself
    typed it into an interactive pane the send outcome is persisted on the note
    (``delivery``): ``delivered`` (typed, nobody drains a cursor for it, so it would
    otherwise read ``queued`` forever) or ``refused`` (shell/non-steerable pane, never
    typed). Otherwise it is queued on the board until that worker's PostToolUse hook
    drains it (hooks/worker_inbox.py moves the cursor), then read. Every other line
    (agent output mirrored to the lead, broadcasts, exits, system notes, agent-to-agent
    notes) has no reader to wait for, so labelling it queued would be noise that never
    clears."""
    sender = str(rec.get("owner") or "anon")
    to = str(rec.get("to") or "all")
    if sender != HUMAN or to in ("all", HUMAN) or kind in ("exit", "system"):
        return "read"
    outcome = rec.get("delivery")
    if outcome in ("delivered", "refused"):
        return outcome
    if worker_inbox is None:
        return "queued"
    return "read" if worker_inbox.is_read(root, to, rec.get("ts"), memo) else "queued"


def _normalize_note(root: str, rec: dict, memo: dict | None = None) -> dict:
    text = str(rec.get("text") or "")
    sender = str(rec.get("owner") or "anon")
    to = str(rec.get("to") or "all")
    kind = "exit" if EXIT_RE.match(text) else ("irc" if rec.get("irc") else "note")
    if sender in ("board", "system"):
        kind = "system"
    return {
        "id": _message_id(root, rec),
        "ts": _iso(rec.get("ts")),
        "from": sender,
        "to": to,
        "body": text,
        "kind": kind,
        "status": _delivery_status(root, rec, kind, memo),
        "run": rec.get("run"),
        "project": root,
        "channel": "all" if to == "all" else f"@{to}",
        "_epoch": _epoch(rec.get("ts")),
    }


def read_messages(
    roots: list[str], since=None, agent: str | None = None, limit: int = 200
):
    """Normalized, deduped, ts-ordered messages across the roots."""
    since_epoch = _epoch(since) if since else 0.0
    since_id = since if (since and str(since).startswith("m")) else None
    seen: dict[str, dict] = {}
    for root in roots:
        try:
            recs = atlas_todo.notes(root)
        except OSError:
            continue
        memo: dict = {}  # worker -> cursor for THIS root: two projects can share a worker name
        for rec in recs:
            if not isinstance(rec, dict):
                continue
            msg = _normalize_note(root, rec, memo)
            seen.setdefault(msg["id"], msg)
    msgs = sorted(seen.values(), key=lambda m: (m["_epoch"], m["id"]))
    if since_id:
        ids = [m["id"] for m in msgs]
        if since_id in ids:
            msgs = msgs[ids.index(since_id) + 1 :]
    elif since_epoch:
        msgs = [m for m in msgs if m["_epoch"] > since_epoch]
    if agent:
        msgs = [m for m in msgs if agent in (m["from"], m["to"])]
    limit = max(1, min(int(limit or 200), 1000))
    msgs = msgs[-limit:]
    for m in msgs:
        m.pop("_epoch", None)
    return msgs


# --- dispatches (no-tmux fallback) -----------------------------------------------------


def _dispatch_agents(ctx, roots: list[str]) -> list[dict]:
    """Recent dispatches joined to their project, for agents with no tmux window."""
    out: list[dict] = []
    if not roots:
        return out
    try:
        conn = ctx.db()
    except sqlite3.Error:
        return out
    try:
        marks = ",".join("?" for _ in roots)
        rows = conn.execute(
            f"""SELECT d.id, d.ts, d.agent_type, d.model, r.session_id, p.root_path
                FROM dispatches d JOIN runs r ON r.id = d.run_id
                JOIN projects p ON p.id = r.project_id
                WHERE p.root_path IN ({marks}) AND d.ts > ?
                ORDER BY d.ts DESC LIMIT 200""",
            (*roots, time.time() - 6 * 3600),
        ).fetchall()
    except sqlite3.Error:
        rows = []
    finally:
        conn.close()
    for did, ts, agent_type, model, session_id, root in rows:
        out.append(
            {
                "id": did,
                "ts": float(ts or 0),
                "agent_type": agent_type or "agent",
                "model": model or "",
                "session_id": session_id or "",
                "root": root,
            }
        )
    return out


# --- agent state ------------------------------------------------------------------------


def _harness_of(text: str, model: str = "") -> str:
    blob = f"{text} {model}".lower()
    if re.search(r"\bomp\b", blob):
        return "omp"
    if "claude" in blob:
        return "claude"
    return "other"


def infer_state(
    *,
    pane_text: str | None,
    dead: bool,
    exit_code: int | None,
    activity: float,
    last_note_ts: float,
    now: float,
    has_pane: bool,
) -> tuple[str, str]:
    """(state, reason). Evidence order: exit > failure text > prompt > recency."""
    if dead or exit_code is not None:
        if exit_code not in (None, 0) or (dead and exit_code is None):
            return ("failed" if exit_code not in (None, 0) else "exited"), (
                f"exit {exit_code}" if exit_code is not None else "pane dead"
            )
        return "exited", "exit 0"
    if pane_text is not None:
        fail = pane_shows_failure(pane_text)
        if fail:
            return "failed", f"pane output: {fail}"
        if pane_shows_prompt(pane_text):
            return "needs_input", "interactive prompt on screen"
    last = max(activity or 0.0, last_note_ts or 0.0)
    if not last:
        return (
            ("idle", "no activity recorded") if has_pane else ("unknown", "no evidence")
        )
    age = now - last
    if age <= WORKING_WINDOW_S:
        return "working", f"activity {int(age)}s ago"
    return "idle", f"quiet for {int(age)}s"


def diagnose_stuck(
    state: str, idle_s: int | None, open_todos: int, reason: str
) -> dict:
    if state == "needs_input" and (idle_s or 0) >= STUCK_NEEDS_INPUT_S:
        return {
            "is_stuck": True,
            "reason": f"waiting on an interactive prompt for {idle_s}s; attach and answer it",
        }
    if state == "failed":
        return {
            "is_stuck": True,
            "reason": f"failed ({reason}); inspect capture, then respawn",
        }
    if state == "idle" and open_todos and (idle_s or 0) >= STUCK_IDLE_WITH_WORK_S:
        return {
            "is_stuck": True,
            "reason": f"idle {idle_s}s while {open_todos} claimed todo(s) remain open",
        }
    return {"is_stuck": False, "reason": ""}


def _todos_by_owner(root: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    try:
        for it in atlas_todo.load(root).get("items", []):
            if it.get("archived"):
                continue
            owner = it.get("owner")
            if owner:
                out.setdefault(str(owner), []).append(it)
    except (OSError, ValueError, AttributeError):
        return out
    return out


def _agent_record(
    *,
    name: str,
    root: str,
    pane: dict | None,
    pane_text: str | None,
    notes_by_owner: dict[str, list[dict]],
    todos: dict[str, list[dict]],
    now: float,
    harness_hint: str = "",
    started: float | None = None,
    model: str = "",
) -> dict:
    mine = notes_by_owner.get(name, [])
    last_note = mine[-1] if mine else None
    exit_code = None
    exit_reason = ""
    for rec in reversed(mine):
        m = EXIT_RE.match(str(rec.get("text") or ""))
        if m:
            exit_code, exit_reason = int(m.group(1)), (m.group(2) or "")
            break
    first_note_text = str(mine[0].get("text") or "") if mine else ""
    activity = pane["activity"] if pane else 0.0
    last_note_ts = _epoch(last_note.get("ts")) if last_note else 0.0
    state, reason = infer_state(
        pane_text=pane_text,
        dead=bool(pane and pane["dead"]),
        exit_code=exit_code
        if exit_code is not None
        else (pane or {}).get("dead_status"),
        activity=activity,
        last_note_ts=last_note_ts,
        now=now,
        has_pane=pane is not None,
    )
    if exit_reason and state in ("failed", "exited"):
        reason = f"exit {exit_code} [{exit_reason}]"
    last_ts = max(activity, last_note_ts)
    idle_s = int(now - last_ts) if last_ts else None
    todo_items = todos.get(name, [])
    open_todos = [t for t in todo_items if t.get("status") != "completed"]
    harness = _harness_of(
        f"{harness_hint} {first_note_text[:200]} {(pane or {}).get('command', '')}",
        model,
    )
    return {
        "name": name,
        "role": harness_hint or name,
        "harness": harness,
        "state": state,
        "window": pane["window"] if pane else None,
        "pane_id": pane["pane_id"] if pane else None,
        "started": _iso(started or (_epoch(mine[0].get("ts")) if mine else 0) or None),
        "last_activity": _iso(last_ts) if last_ts else None,
        "idle_seconds": idle_s,
        "exit_code": exit_code
        if exit_code is not None
        else (pane or {}).get("dead_status"),
        "todo_ids": [t.get("id") for t in todo_items],
        "last_note": str((last_note or {}).get("text") or "")[:200],
        "stuck": diagnose_stuck(state, idle_s, len(open_todos), reason),
    }


def _notes_by_owner(root: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    try:
        for rec in atlas_todo.notes(root):
            if isinstance(rec, dict):
                out.setdefault(str(rec.get("owner") or "anon"), []).append(rec)
    except (OSError, ValueError, AttributeError):
        return out
    return out


# --- colony snapshot ---------------------------------------------------------------------


def colony_snapshot(ctx, project_param=None) -> dict:
    now = time.time()
    roots = _project_roots(ctx, project_param)
    have_tmux = tmux_available()
    rigs: list[dict] = []
    claimed_names: set[tuple[str, str]] = set()
    sessions = list_sessions() if have_tmux else []

    for sess in sessions:
        panes = list_panes(sess["session"])
        # The rig belongs to the project whose board holds notes from its windows.
        names = {p["window"] for p in panes if p["window"] != "lead"}
        rig_root = None
        for root in roots or []:
            owners = set(_notes_by_owner(root))
            if names & owners:
                rig_root = root
                break
        if roots and rig_root is None:
            continue  # other project's rig
        root = rig_root or (roots[0] if roots else "")
        by_owner = _notes_by_owner(root) if root else {}
        todos = _todos_by_owner(root) if root else {}
        agents = []
        for p in panes:
            if p["window"] == "lead":
                continue
            text = None if p["dead"] else capture_pane(p["pane_id"], 60)
            agents.append(
                _agent_record(
                    name=p["window"],
                    root=root,
                    pane=p,
                    pane_text=text,
                    notes_by_owner=by_owner,
                    todos=todos,
                    now=now,
                    started=sess["created"],
                )
            )
            claimed_names.add((root, p["window"]))
        live = sum(
            1 for a in agents if a["state"] in ("working", "idle", "needs_input")
        )
        rigs.append(
            {
                "id": sess["session"],
                "run": sess["run"],
                "project": root,
                "project_name": _project_name(root) if root else "",
                "tmux_session": sess["session"],
                "state": "stopped"
                if not live
                else ("running" if live == len(agents) else "partial"),
                "started": _iso(sess["created"]),
                "agents": agents,
            }
        )

    # Subagents with no tmux window: board-note owners and recent dispatches.
    dispatches = _dispatch_agents(ctx, roots)
    for root in roots:
        by_owner = _notes_by_owner(root)
        todos = _todos_by_owner(root)
        loose = []
        for owner in sorted(by_owner):
            if (root, owner) in claimed_names or owner in (
                "board",
                "lead",
                "human",
                "anon",
            ):
                continue
            loose.append(
                _agent_record(
                    name=owner,
                    root=root,
                    pane=None,
                    pane_text=None,
                    notes_by_owner=by_owner,
                    todos=todos,
                    now=now,
                )
            )
        recent = [d for d in dispatches if d["root"] == root]
        for d in recent[:20]:
            name = f"{d['agent_type']}#{d['id']}"
            loose.append(
                {
                    "name": name,
                    "role": d["agent_type"],
                    "harness": _harness_of(d["agent_type"], d["model"]),
                    "state": "working"
                    if now - d["ts"] <= WORKING_WINDOW_S
                    else "unknown",
                    "window": None,
                    "pane_id": None,
                    "started": _iso(d["ts"]),
                    "last_activity": _iso(d["ts"]),
                    "idle_seconds": int(now - d["ts"]),
                    "exit_code": None,
                    "todo_ids": [],
                    "last_note": "",
                    "stuck": {"is_stuck": False, "reason": ""},
                }
            )
        if loose:
            rigs.append(
                {
                    "id": "board-" + _project_name(root),
                    "run": "board",
                    "project": root,
                    "project_name": _project_name(root),
                    "tmux_session": None,
                    "state": "running"
                    if any(
                        a["state"] in ("working", "idle", "needs_input") for a in loose
                    )
                    else "stopped",
                    "started": min(
                        (a["started"] for a in loose if a["started"]), default=None
                    ),
                    "agents": loose,
                }
            )

    # `unknown` = a board dispatch with no live pane that is past the working window:
    # no evidence either way, counted so the header adds up to the agents listed.
    counts = {
        "working": 0,
        "idle": 0,
        "needs_input": 0,
        "failed": 0,
        "exited": 0,
        "unknown": 0,
    }
    for rig in rigs:
        for a in rig["agents"]:
            if a["state"] in counts:
                counts[a["state"]] += 1
    return {
        "mux_enabled": _mux_enabled(),
        "tmux_available": have_tmux,
        "rigs": rigs,
        "counts": counts,
    }


def _find_agent(ctx, run: str, name: str, project_param=None):
    """(rig, agent) for a run/name pair, or None. Never a half-filled tuple."""
    snap = colony_snapshot(ctx, project_param)
    for rig in snap["rigs"]:
        if rig["run"] == run or rig["id"] == run:
            for a in rig["agents"]:
                if a["name"] == name:
                    return rig, a
    return None


# --- colony handlers -----------------------------------------------------------------------


def h_colony(ctx):
    return 200, colony_snapshot(ctx, ctx.query.get("project"))


def h_agent(ctx):
    run, name = ctx.query.get("run", ""), ctx.query.get("name", "")
    if not run or not name:
        return _err(
            400,
            "run_and_name_required",
            "both query params are needed",
            "pass ?run=&name=",
        )
    found = _find_agent(ctx, run, name, ctx.query.get("project"))
    if not found:
        return _err(
            404,
            "agent_not_found",
            f"no agent {name!r} in run {run!r}",
            "refresh the colony",
        )
    rig, agent = found
    root = rig["project"]
    memo: dict = {}
    notes = [
        _normalize_note(root, r, memo)
        for r in atlas_todo.notes(root)
        if isinstance(r, dict) and name in (str(r.get("owner")), str(r.get("to")))
    ][-100:]
    for m in notes:
        m.pop("_epoch", None)
    todo_items = [
        it
        for it in atlas_todo.load(root).get("items", [])
        if it.get("id") in set(agent["todo_ids"])
    ]
    tail = ""
    if agent["pane_id"]:
        tail = "\n".join(_tail_nonempty(capture_pane(agent["pane_id"], 40) or "", 40))
    elif notes:
        tail = "\n".join(m["body"] for m in notes[-20:])
    return 200, {
        **agent,
        "run": rig["run"],
        "project": root,
        "notes": notes,
        "todos": [_todo_view(t) for t in todo_items],
        "pane_tail": tail,
    }


def h_capture(ctx):
    run, name = ctx.query.get("run", ""), ctx.query.get("name", "")
    try:
        lines = int(ctx.query.get("lines", "200"))
    except ValueError:
        lines = 200
    found = _find_agent(ctx, run, name, ctx.query.get("project"))
    if not found:
        return _err(
            404,
            "agent_not_found",
            f"no agent {name!r} in run {run!r}",
            "refresh the colony",
        )
    rig, agent = found
    if agent["pane_id"]:
        text = capture_pane(agent["pane_id"], lines)
        if text is not None:
            return 200, {"text": text, "captured": _iso(time.time()), "source": "tmux"}
    msgs = [
        m["body"]
        for m in read_messages(
            [rig["project"]], agent=name, limit=max(1, min(lines, 1000))
        )
        if m["from"] == name
    ]
    return 200, {
        "text": "\n".join(msgs),
        "captured": _iso(time.time()),
        "source": "notes",
    }


def _record_irc(
    root: str,
    sender: str,
    to: str,
    body: str,
    run: str | None = None,
    delivery: str | None = None,
) -> dict:
    rec = atlas_todo.note(root, sender, body, to=to, delivery=delivery)
    return _normalize_note(root, {**rec, "irc": True, "run": run})


# Characters that would act as keystrokes (Enter, Tab, ESC, ^C ...) when typed into a tty. `send-keys -l` types a
# literal newline exactly like Enter, so they are neutralised to spaces before anything is typed.
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
# Foreground commands that are an interactive harness TUI reading the tty. Compared lower-cased (macOS reports
# `Python`, Linux `python3`); anything not listed here is never typed into.
INTERACTIVE_HARNESSES = ("claude", "omp")
SHELLS = ("bash", "zsh", "sh", "fish", "dash", "ksh", "tcsh", "csh")
QUEUED_DETAIL = "queued on the board; the worker reads it on its next tool call"


def sanitize_keys(text: str) -> str:
    """Collapse every control character (newline, CR, tab, ESC, DEL ...) to one space."""
    return CONTROL_RE.sub(" ", text or "")


def _ps_tree(pid: str) -> list[str]:
    """Full command lines of `pid` and all its descendants (one `ps` snapshot)."""
    try:
        res = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,command="],
            capture_output=True,
            text=True,
            timeout=5.0,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if res.returncode != 0:
        return []
    rows: dict[str, tuple[str, str]] = {}
    for line in res.stdout.splitlines():
        parts = line.split(None, 2)
        if len(parts) >= 2:
            rows[parts[0]] = (parts[1], parts[2] if len(parts) > 2 else "")
    keep, changed = {pid}, True
    while changed:
        changed = False
        for p, (ppid, _cmd) in rows.items():
            if ppid in keep and p not in keep:
                keep.add(p)
                changed = True
    return [rows[p][1] for p in keep if p in rows]


def _is_headless(argv_line: str) -> bool:
    """True when a `claude`/`omp` command line runs print mode (`-p` as its own argument)."""
    toks = argv_line.split()
    names = [os.path.basename(t).lower() for t in toks]
    return any(n in INTERACTIVE_HARNESSES for n in names) and "-p" in toks


def probe_pane(pane_id: str) -> dict:
    """What is actually running in the pane's foreground.

    {"kind": "interactive" | "mux_worker" | "refuse", "command": str, "reason": str}. Fails closed: when the
    pane cannot be probed the answer is "refuse", never "interactive"."""
    res = _tmux("display", "-p", "-t", pane_id, "#{pane_pid}\t#{pane_current_command}")
    if not res or res.returncode != 0 or "\t" not in res.stdout:
        return {
            "kind": "refuse",
            "command": "",
            "reason": "the pane's foreground process could not be read",
        }
    pid, command = res.stdout.rstrip("\n").split("\t", 1)
    low = os.path.basename(command.strip()).lower()
    lines = _ps_tree(pid.strip())
    mux = any("atlas_mux.py" in ln and "run-worker" in ln for ln in lines)
    if mux or any(_is_headless(ln) for ln in lines):
        return {
            "kind": "mux_worker",
            "command": command,
            "reason": "a headless (-p) mux worker that never reads the terminal",
        }
    if low in INTERACTIVE_HARNESSES:
        return {"kind": "interactive", "command": command, "reason": ""}
    if low in SHELLS or low.lstrip("-") in SHELLS:
        why = f"the pane's foreground process is a shell ({command}); typed text would run as a command"
    else:
        why = f"the pane's foreground process is {command or 'unknown'}, not an interactive claude/omp session"
    return {"kind": "refuse", "command": command, "reason": why}


def _deliver(pane_id: str, sender: str, to: str, text: str) -> tuple[bool, str]:
    envelope = f"From: {sender}\nTo: {to}\n{text}"
    flat = sanitize_keys(envelope.replace("\r", "").replace("\n", " | "))
    first = _tmux("send-keys", "-t", pane_id, "-l", "--", flat)
    if not first or first.returncode != 0:
        return False, (first.stderr.strip() if first else "tmux unavailable")
    enter = _tmux("send-keys", "-t", pane_id, "Enter")
    ok = bool(enter and enter.returncode == 0)
    return ok, "" if ok else (enter.stderr.strip() if enter else "tmux unavailable")


def send_to_agent(
    ctx,
    run: str,
    name: str,
    text: str,
    *,
    sender=HUMAN,
    force=False,
    verify=False,
    project_param=None,
) -> tuple[int, dict]:
    if not _valid(name):
        return _err(
            400,
            "invalid_name",
            f"{name!r} is not [A-Za-z0-9_-]",
            "use the agent's window name",
        )
    if not text or not str(text).strip():
        return _err(400, "text_required", "nothing to send", "pass a non-empty text")
    found = _find_agent(ctx, run, name, project_param)
    if not found:
        return _err(
            404,
            "agent_not_found",
            f"no agent {name!r} in run {run!r}",
            "refresh the colony",
        )
    rig, agent = found
    root = rig["project"]
    delivered: bool | str = False
    detail = ""
    refusal = None
    if agent["pane_id"] and agent["state"] not in ("exited", "failed"):
        # The foreground process decides whether typing is safe or even read. force:true only overrides the
        # prompt guard below, never this: a shell would run the text as a command, and a headless worker would
        # never read it.
        probe = probe_pane(agent["pane_id"])
        if probe["kind"] == "refuse":
            refusal = {
                "error": "pane_not_steerable",
                "why": probe["reason"],
                "do": "attach to the pane to type there yourself, or message a worker that runs an interactive claude/omp session",
            }
        elif probe["kind"] == "mux_worker":
            delivered, detail = "queued", QUEUED_DETAIL
        else:
            live = capture_pane(agent["pane_id"], 30) or ""
            if (
                agent["state"] == "needs_input" or pane_shows_prompt(live)
            ) and not force:
                return _err(
                    409,
                    "typing_guard",
                    "the pane is showing an interactive prompt; typed text would answer it",
                    "attach to the pane and respond, or resend with force:true",
                )
            delivered, detail = _deliver(agent["pane_id"], sender, name, str(text))
    outcome = "refused" if refusal else ("delivered" if delivered is True else None)
    msg = _record_irc(root, sender, name, str(text), rig["run"], delivery=outcome)
    if refusal:
        msg["delivered"] = False
        status, out = _err(409, **refusal)
        out["message"] = msg
        out["delivered"] = False
        return status, out
    out = {"ok": True, "delivered": delivered, "message": msg}
    if delivered == "queued":
        out["detail"] = detail
    elif detail:
        out["why"] = detail
    if verify and delivered is True:
        time.sleep(0.4)
        after = capture_pane(agent["pane_id"], 15) or ""
        out["verified"] = str(text).strip()[:40] in after
    out["state"] = colony_snapshot(ctx, project_param)["counts"]
    if delivered == "queued":
        out["next"] = QUEUED_DETAIL
    else:
        out["next"] = (
            "delivered to the pane"
            if delivered
            else "recorded on the board only (no live pane)"
        )
    return 200, out


def h_send(ctx):
    b = ctx.json()
    return send_to_agent(
        ctx,
        str(b.get("run") or ""),
        str(b.get("name") or ""),
        str(b.get("text") or ""),
        force=bool(b.get("force")),
        verify=bool(b.get("verify")),
        project_param=b.get("project"),
    )


def h_kill(ctx):
    b = ctx.json()
    run, name = str(b.get("run") or ""), b.get("name")
    if not _valid(
        run.replace(SESSION_PREFIX, "", 1) if run.startswith(SESSION_PREFIX) else run
    ):
        return _err(
            400,
            "invalid_run",
            f"{run!r} is not a valid run id",
            "use the run from the colony list",
        )
    if name and not _valid(str(name)):
        return _err(
            400,
            "invalid_name",
            f"{name!r} is not [A-Za-z0-9_-]",
            "use the agent window name",
        )
    session = _session(run)
    if not tmux_available():
        return _err(
            409,
            "tmux_unavailable",
            "tmux is not installed or not on PATH",
            "install tmux first",
        )
    has = _tmux("has-session", "-t", session)
    if not has or has.returncode != 0:
        return _err(
            404, "rig_not_found", f"no tmux session {session}", "the rig already exited"
        )
    if name:
        res = _tmux("kill-window", "-t", f"{session}:{name}")
    else:
        res = _tmux("kill-session", "-t", session)
    if not res or res.returncode != 0:
        return _err(
            500,
            "kill_failed",
            (res.stderr.strip() if res else "tmux unavailable"),
            "check `tmux ls`",
        )
    return 200, {
        "ok": True,
        "state": colony_snapshot(ctx, b.get("project"))["counts"],
        "next": f"killed {'window ' + str(name) if name else 'session ' + session}",
    }


def h_spawn_help(ctx):
    mux = SCRIPTS_DIR / "atlas_mux.py"
    return 200, {
        "ok": True,
        "mux_enabled": _mux_enabled(),
        "tmux_available": tmux_available(),
        "steps": [
            {"label": "Install tmux (if missing)", "command": "brew install tmux"},
            {
                "label": "Enable colony mode for this shell",
                "command": "export ATLAS_MUX=tmux",
            },
            {
                "label": "Spawn one worker window",
                "command": (
                    f"python3 {mux} spawn --run <run> --name <name> --harness claude "
                    "--agent implementer --prompt-file <prompt.md> --root <project-root>"
                ),
            },
            {"label": "Check the rig", "command": f"python3 {mux} status --run <run>"},
        ],
        "next": "run the commands in your terminal; the dashboard never spawns processes itself",
    }


def h_attach(ctx):
    b = ctx.json()
    run, name = str(b.get("run") or ""), b.get("name")
    bare = run.replace(SESSION_PREFIX, "", 1) if run.startswith(SESSION_PREFIX) else run
    if not _valid(bare):
        return _err(
            400,
            "invalid_run",
            f"{run!r} is not a valid run id",
            "use the run from the colony list",
        )
    target = _session(run)
    if name:
        if not _valid(str(name)):
            return _err(
                400,
                "invalid_name",
                f"{name!r} is not [A-Za-z0-9_-]",
                "use the agent window name",
            )
        target = f"{target}:{name}"
    return 200, {"ok": True, "command": f"tmux attach -t {target}"}


# --- IRC handlers --------------------------------------------------------------------------


def h_irc_get(ctx):
    q = ctx.query
    roots = _project_roots(ctx, q.get("project"))
    try:
        limit = int(q.get("limit", "200"))
    except ValueError:
        limit = 200
    msgs = read_messages(roots, since=q.get("since"), agent=q.get("agent"), limit=limit)
    agents = sorted(
        {m["from"] for m in msgs} | {m["to"] for m in msgs if m["to"] != "all"}
    )
    channels = sorted({m["channel"] for m in msgs})
    return 200, {"messages": msgs, "agents": agents, "channels": channels}


def h_irc_post(ctx):
    b = ctx.json()
    root = ctx.project_root(b.get("project"))
    to, body = str(b.get("to") or "all"), str(b.get("body") or "")
    sender = str(b.get("from") or HUMAN)
    if not root:
        return _err(
            400,
            "unknown_project",
            "project is required for IRC",
            "pass the project root path",
        )
    if not body.strip():
        return _err(400, "body_required", "empty message", "type something to send")
    if to != "all" and not _valid(to):
        return _err(
            400,
            "invalid_to",
            f"{to!r} is not [A-Za-z0-9_-] or 'all'",
            "address an agent name or all",
        )
    delivered, guard = False, None
    if to != "all" and tmux_available():
        for rig in colony_snapshot(ctx, root)["rigs"]:
            a = next(
                (x for x in rig["agents"] if x["name"] == to and x["pane_id"]), None
            )
            if a:
                status, res = send_to_agent(
                    ctx,
                    rig["run"],
                    to,
                    body,
                    sender=sender,
                    force=bool(b.get("force")),
                    project_param=root,
                )
                if status == 200:
                    return 200, {**res, "next": res.get("next", "")}
                guard = res  # typing guard or failure: surface it, still record below
                break
    msg = (
        guard["message"]
        if guard and guard.get("message")
        else _record_irc(root, sender, to, body)
    )
    out = {
        "ok": True,
        "delivered": delivered,
        "message": msg,
        "next": "recorded on the board",
    }
    if guard:
        out["ok"] = False
        out["error"] = guard.get("error")
        out["why"] = guard.get("why")
        out["do"] = guard.get("do")
        out["next"] = "recorded on the board, but not typed into the pane"
    return 200, out


# --- todos ----------------------------------------------------------------------------------

UI_STATUS = {"pending": "open", "in_progress": "in_progress", "completed": "done"}
STATUS_IN = {
    "open": "pending",
    "pending": "pending",
    "in_progress": "in_progress",
    "done": "completed",
    "completed": "completed",
}
OPS = ("add", "update", "status", "remove", "claim", "assign", "move", "reorder")


def _todo_view(item: dict) -> dict:
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
    }


def todos_state(root: str) -> dict:
    board = atlas_todo.load(root)
    phases: dict[str, list[dict]] = {}
    counts = {"open": 0, "in_progress": 0, "done": 0, "blocked": 0}
    latest = 0.0
    for it in board.get("items", []):
        if it.get("archived"):
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


def todos_all_state(roots: list[str]) -> dict:
    """Read-only merge of every project's board: phases by name, counts summed.

    Each item carries its owning ``project`` root so the UI can tell them apart.
    Writes always go to one concrete project (POST requires it).
    """
    phases: dict[str, list[dict]] = {}
    counts = {"open": 0, "in_progress": 0, "done": 0, "blocked": 0}
    updated: list[str] = []
    for root in roots:
        st = todos_state(root)
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
    if param in (None, "", "all"):
        # No single project selected: show every project's board (read-only view).
        return 200, todos_all_state(_project_roots(ctx, None))
    root = ctx.project_root(param)
    if not root:
        return _err(
            400, "unknown_project", "unknown project", "pass ?project=<root path>"
        )
    return 200, todos_state(root)


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
        status = (
            404
            if r.get("error") == "not_found"
            else 409
            if r.get("error")
            in ("claimed_by_other", "not_claim_owner", "already_completed")
            else 400
        )
        return status, {
            "ok": False,
            "error": r.get("error", "failed"),
            "why": r.get("hint") or r.get("claimed_by") or "",
            "do": "refresh and retry",
        }
    return 200, {"ok": True, "state": todos_state(root), "next": f"{op} applied"}


ROUTES = [
    ("GET", r"/api/v2/colony", h_colony),
    ("GET", r"/api/v2/colony/agent", h_agent),
    ("GET", r"/api/v2/colony/capture", h_capture),
    ("POST", r"/api/v2/colony/send", h_send),
    ("POST", r"/api/v2/colony/kill", h_kill),
    ("POST", r"/api/v2/colony/spawn-help", h_spawn_help),
    ("POST", r"/api/v2/colony/attach-command", h_attach),
    ("GET", r"/api/v2/irc", h_irc_get),
    ("POST", r"/api/v2/irc", h_irc_post),
    ("GET", r"/api/v2/todos", h_todos_get),
    ("POST", r"/api/v2/todos", h_todos_post),
]
