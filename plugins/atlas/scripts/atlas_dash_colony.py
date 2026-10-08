#!/usr/bin/env python3
"""Atlas dashboard v2: Colony roster (contract C3).

The roster of ONE project: its lead and the workers Atlas launched or registered in its channel
registry, each with the todos it owns, a live/idle/stuck/finished/dead state, and send/kill. The raw
herdr pane list stays one click away (`herdr_url`); `all=1` widens the roster to every herdr agent pane.

  GET  /api/v2/colony?project=<abs root>[&all=1]
  POST /api/v2/colony/<name>/send   {text, project?}
  POST /api/v2/colony/<name>/kill   {project?}

State: finished (exit 0 recorded) | dead (nonzero exit, or no live process, no exit record and no
activity for STUCK_S) | stuck (live, silent for STUCK_S with an open todo) | idle (live pane idle) |
running. A member without a pane (an in-process omp `task` subagent) counts as live while it has
recent activity (a note, a todo update, or its join).
"""

from __future__ import annotations

import os
import signal
import sys
import time
from pathlib import Path
from urllib.parse import unquote

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_dash_irc  # noqa: E402
import atlas_herdr  # noqa: E402
import atlas_todo  # noqa: E402
from atlas_dash_work import _err  # noqa: E402

STUCK_S = 15 * 60
NOTE_PREVIEW = 400
TITLE_MAX = 200
LIVE_STATES = ("running", "idle", "stuck")
OPEN = ("pending", "in_progress")


def is_lead_name(name: str) -> bool:
    return name == "lead" or name.startswith("lead-")


def _pid_alive(pid) -> bool:
    try:
        pid = int(pid)
        if pid <= 0:
            return False
        os.kill(pid, 0)
        return True
    except (TypeError, ValueError, ProcessLookupError):
        return False
    except PermissionError:
        return True


def _within(cwd: str, root: str) -> bool:
    cwd, root = (cwd or "").rstrip("/"), root.rstrip("/")
    return bool(cwd) and (cwd == root or cwd.startswith(root + "/"))


def _herdr() -> tuple[dict, dict]:
    """(pane_id -> herdr agent row, colony pane label -> {pane_id, workspace_id}); both {} when herdr is down."""
    rows: dict = {}
    panes: dict = {}
    try:
        snap = atlas_herdr.agents()
        if snap["reachable"]:
            rows = {a["pane_id"]: a for a in snap["agents"]}
            for p in atlas_herdr.list_panes():
                if p["label"]:
                    panes[p["label"]] = p
    except atlas_herdr.HerdrSockError:
        pass
    return rows, panes


def _flatten(root: str) -> list[dict]:
    try:
        mains = atlas_todo.channels(root)
    except OSError:
        return []
    return [c for m in mains for c in [m, *(m.get("children") or [])]]


def _active_lead(chans: list[dict]) -> dict | None:
    leads = [c for c in chans if c.get("kind") == "lead" and c.get("lead")]
    if not leads:
        return None
    return max(
        leads, key=lambda c: (c.get("last_activity") or 0, c.get("created") or 0)
    )


def _candidates(chans: list[dict], lead_chan: dict | None, all_: bool) -> dict:
    """name -> {role, channel, entry}: the registry members in scope (+ the active lead)."""
    out: dict = {}
    for c in chans:
        in_scope = all_ or c.get("kind") == "main" or c is lead_chan
        if not in_scope:
            continue
        for m in c.get("members") or []:
            name = str(m.get("name") or "")
            if not name:
                continue
            lead_like = is_lead_name(name) or m.get("role") == "lead"
            if lead_like and not all_ and (not lead_chan or name != lead_chan["lead"]):
                continue  # earlier leads never become roster rows
            cur = out.get(name)
            if cur is None or ("exit_code" in m and "exit_code" not in cur["entry"]):
                out[name] = {
                    "role": "lead" if lead_like else "worker",
                    "channel": c["name"] if cur is None else cur["channel"],
                    "entry": m,
                }
            if lead_like and c is lead_chan:
                out[name]["channel"] = c["name"]
    if lead_chan and lead_chan["lead"] not in out:
        out[lead_chan["lead"]] = {
            "role": "lead",
            "channel": lead_chan["name"],
            "entry": {"name": lead_chan["lead"], "joined": lead_chan.get("created")},
        }
    return out


def _state(
    c: dict,
    live: bool,
    row: dict | None,
    idle_since_activity: float,
    open_todo: bool,
    log_stale: bool = False,
) -> str:
    entry = c["entry"]
    if "exit_code" in entry:
        return "finished" if int(entry["exit_code"]) == 0 else "dead"
    quiet = idle_since_activity > STUCK_S
    if c["role"] == "lead":
        return (
            "idle"
            if (row and row["status"] == "idle") or (not live and quiet)
            else "running"
        )
    if live:
        if quiet and open_todo:
            return "stuck"
        return "idle" if row and row["status"] == "idle" else "running"
    if entry.get("pid") or log_stale:  # observable process loss
        return "dead"
    # no liveness signal at all (in-process subagent): activity decides running vs stuck
    return "stuck" if quiet and open_todo else "running"


def build_colony(root: str, all_: bool = False, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    chans = _flatten(root)
    lead_chan = _active_lead(chans)
    cands = _candidates(chans, lead_chan, all_)
    rows, panes = _herdr()
    name_of_pane = {p["pane_id"]: n for n, p in panes.items()}
    live_panes = set(rows) | {p["pane_id"] for p in panes.values()}

    # Atlas-launched panes the registry does not know (interactive launches), scoped by cwd
    for label, p in panes.items():
        if label in cands:
            continue
        row = rows.get(p["pane_id"])
        if all_ or (row and _within(row["cwd"], root)):
            cands[label] = {
                "role": "worker",
                "channel": None,
                "entry": {"name": label},
                "pane": p["pane_id"],
            }
    if all_:
        for pid, row in rows.items():
            if pid in name_of_pane or row["agent"] in ("unknown", ""):
                continue  # sidebar/preview shells are not agents
            cands.setdefault(
                row["title"] or pid,
                {
                    "role": "worker",
                    "channel": None,
                    "entry": {"name": row["title"] or pid},
                    "pane": pid,
                },
            )

    items = [i for i in atlas_todo.load(root).get("items", []) if not i.get("archived")]
    last_note: dict = {}
    try:
        for r in atlas_todo.notes(root):
            last_note[r.get("owner")] = r
    except OSError:
        pass
    sid6 = (
        lead_chan["lead"][5:]
        if lead_chan and lead_chan["lead"].startswith("lead-")
        else ""
    )

    by_title = {r["title"]: pid for pid, r in rows.items() if r.get("title")}
    members = []
    for name, c in cands.items():
        entry = c["entry"]
        # a registry member's pane is the one recorded on ITS entry at spawn, never a label match
        # (the same member name can be live in another project); the lead's pane is its agent title
        recorded = entry.get("pane_id")
        pane_id = c.get("pane") or (
            recorded if recorded and recorded in live_panes else None
        )
        if pane_id is None and c["role"] == "lead":
            pane_id = by_title.get(name)
        row = rows.get(pane_id) if pane_id else None
        live = pane_id is not None or _pid_alive(entry.get("pid"))
        mine = [i for i in items if i.get("owner") == name]
        if c["role"] == "lead" and lead_chan and name == lead_chan["lead"]:
            mine += [  # the lead's own plan (todo mirror) carries no owner
                i
                for i in items
                if not i.get("owner")
                and (
                    not sid6
                    or atlas_todo._sanitize_owner(i.get("session_id"))[:6] == sid6
                )
            ]
        note = last_note.get(name)
        activity = max(
            [float(entry.get("joined") or 0), float(note["ts"]) if note else 0.0]
            + [float(i.get("updated_at") or 0) for i in mine]
        )
        log = Path(root) / ".atlas" / ".run" / "logs" / f"{name}.log"
        try:  # a mux worker streams its log; a stale one with no process is a crash
            log_stale = now - log.stat().st_mtime > STUCK_S
        except OSError:
            log_stale = False
        state = _state(
            c,
            live,
            row,
            now - activity,
            any(i.get("status") in OPEN for i in mine),
            log_stale,
        )
        steerable = (
            bool(row and row["agent"] in atlas_dash_irc.INTERACTIVE_AGENTS)
            and state in LIVE_STATES
        )
        members.append(
            {
                "name": name,
                "kind": c["role"],
                "state": state,
                "pane_id": pane_id,
                "steerable": steerable,
                "headless": state in LIVE_STATES and not steerable,
                "channel": c["channel"],
                "tasks": [
                    {
                        "id": i.get("id"),
                        "title": " ".join(str(i.get("content") or "").split())[
                            :TITLE_MAX
                        ],
                        "status": i.get("status"),
                    }
                    for i in mine
                ],
                "last_note": {
                    "ts": note["ts"],
                    "text": str(note.get("text") or "")[:NOTE_PREVIEW],
                }
                if note
                else None,
                "log_path": str(log) if log.is_file() else None,
                "exit_code": entry.get("exit_code"),
                "ended_at": entry.get("ended_at"),
            }
        )
    members.sort(
        key=lambda m: (
            m["kind"] != "lead",
            m["state"] in ("finished", "dead"),
            m["name"],
        )
    )
    return {
        "ok": True,
        "project": root,
        "lead": {"name": lead_chan["lead"], "channel": lead_chan["name"]}
        if lead_chan
        else None,
        "members": members,
        "herdr_url": _herdr_url(),
    }


def _herdr_url() -> str:
    try:
        return str(atlas_herdr._url())
    except Exception:
        return str(getattr(atlas_herdr, "HERDR_URL", "") or "")


def member_state(root: str, name: str) -> str | None:
    """State of a registry member, None when `name` is not on the roster (or is a lead)."""
    for m in build_colony(root, all_=True)["members"]:
        if m["name"] == name and m["kind"] != "lead":
            return m["state"]
    return None


REFUSAL = {"finished": "member_finished", "dead": "member_dead"}


def refusal(root: str, name: str):
    """(409, body) when a message to `name` could never be read (finished/dead), else None."""
    state = member_state(root, name)
    if state not in REFUSAL:
        return None
    return _err(
        409,
        REFUSAL[state],
        f"{name!r} is {state}; nothing will read a message sent to it",
        "dispatch a new worker, or read its final report on the channel",
    )


# --- routes ----------------------------------------------------------------------------------


def _find(ctx, name: str, project) -> tuple[str, dict] | None:
    root = ctx.project_root(project)
    if not root:
        return None
    # default scope, not all=1: the all-panes view lists other projects' panes, which a
    # project-scoped Send/Kill must never reach
    for m in build_colony(root)["members"]:
        if m["name"] == name:
            return root, m
    return None


def h_colony_get(ctx):
    q = ctx.query or {}
    all_ = str(q.get("all") or "") in ("1", "true")
    project = q.get("project")
    if not project:
        return _err(
            400, "project_required", "no project given", "pass ?project=<abs root>"
        )
    root = ctx.project_root(project)
    if not root:
        return _err(
            400,
            "unknown_project",
            f"{project!r} is not a known project",
            "pass the project root path",
        )
    return 200, build_colony(root, all_)


def h_colony_send(ctx):
    name = unquote(ctx.groups[0])
    b = ctx.json() or {}
    text = b.get("text")
    if not isinstance(text, str) or not text.strip():
        return _err(400, "text_required", "empty message", "type something to send")
    project = b.get("project") or (ctx.query or {}).get("project")
    if not ctx.project_root(project):
        return _err(
            400, "project_required", "no known project given", "pass project=<abs root>"
        )
    hit = _find(ctx, name, project)
    if not hit:
        return _err(
            404,
            "no_such_member",
            f"{name!r} is not on the colony roster",
            "GET /api/v2/colony",
        )
    root, m = hit
    if m["state"] in REFUSAL:
        return _err(
            409,
            REFUSAL[m["state"]],
            f"{name!r} is {m['state']}; nothing will read a message sent to it",
            "dispatch a new worker, or read its final report on the channel",
        )
    channel = m["channel"]
    if m["steerable"]:
        flat = atlas_dash_irc.sanitize_keys(
            f"From: {atlas_dash_irc.HUMAN}\nTo: {name}\n{text}".replace("\n", " | ")
        )
        try:
            atlas_herdr.send_prompt(m["pane_id"], flat)
        except atlas_herdr.PromptRefused as e:
            if e.http != 409:  # busy falls through to the board queue
                return e.http, {"ok": False, "error": e.error, "why": e.why}
        else:
            atlas_dash_irc._record_irc(
                root,
                atlas_dash_irc.HUMAN,
                name,
                text,
                delivery="delivered",
                channel=channel,
            )
            return 200, {"ok": True, "delivered": True, "queued": False}
    atlas_dash_irc._record_irc(root, atlas_dash_irc.HUMAN, name, text, channel=channel)
    return 200, {"ok": True, "delivered": False, "queued": True}


def h_colony_kill(ctx):
    name = unquote(ctx.groups[0])
    b = ctx.json() or {}
    project = b.get("project") or (ctx.query or {}).get("project")
    if not ctx.project_root(project):
        return _err(
            400, "project_required", "no known project given", "pass project=<abs root>"
        )
    hit = _find(ctx, name, project)
    if not hit:
        return _err(
            404,
            "no_such_member",
            f"{name!r} is not on the colony roster",
            "GET /api/v2/colony",
        )
    root, m = hit
    if m["kind"] == "lead":
        return _err(
            409,
            "lead_not_killable",
            "the lead is the user's own session",
            "close it in its own terminal",
        )
    if m["state"] in ("finished", "dead"):
        return _err(
            409,
            REFUSAL[m["state"]],
            f"{name!r} is already {m['state']}",
            "nothing to kill",
        )
    if m["pane_id"]:
        out = atlas_herdr.close_pane(m["pane_id"])
        return (
            (200, {"ok": True, "killed": name, "via": "pane"})
            if out.get("ok")
            else (404, out)
        )
    pid = _entry_pid(root, name)
    if pid and _pid_alive(pid):
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError as e:
            return _err(409, "kill_failed", str(e), "the process is gone or not yours")
        return 200, {"ok": True, "killed": name, "via": "pid"}
    return _err(409, "member_dead", f"{name!r} has no live process", "nothing to kill")


def _entry_pid(root: str, name: str):
    for c in _flatten(root):
        for m in c.get("members") or []:
            if m.get("name") == name and m.get("pid"):
                return m["pid"]
    return None


ROUTES = [
    ("GET", r"^/api/v2/colony$", h_colony_get),
    ("POST", r"^/api/v2/colony/([^/?#]+)/send$", h_colony_send),
    ("POST", r"^/api/v2/colony/([^/?#]+)/kill$", h_colony_kill),
]
