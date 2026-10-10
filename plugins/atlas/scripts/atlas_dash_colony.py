#!/usr/bin/env python3
"""Atlas dashboard v2: Colony roster (contract C3).

The roster of ONE project: its lead and the workers Atlas launched or registered in its channel
registry, each with the todos it owns, a live/idle/stuck/finished/dead state, and send/kill. The raw
herdr pane list stays one click away (`herdr_url`); `all=1` widens the roster to every herdr agent pane.

  GET  /api/v2/colony?project=<abs root>[&all=1]
  POST /api/v2/colony/<name>/send   {text, project?}
  POST /api/v2/colony/<name>/kill   {project?}
  POST /api/v2/colony/<name>/pause  {project?}    stop queueing to it; running work untouched
  POST /api/v2/colony/<name>/resume {project?}    queue again; returns any recorded resume state
  POST /api/v2/colony/<name>/cancel {project?, hard?}
        graceful (default): stop dispatching to it, let the running unit finish, pending units stay
        queued on the board, resume state recorded for the orchestrator; hard: the kill contract.

Wave state lives in `.atlas/.run/colony_wave.json` (paused/canceled flags per member plus the
graceful-cancel resume state). Roster rows carry `queued` (incoming messages still waiting for
the member's next tool call) and `wave` (paused/canceled flags) so holds are visible to the lead.

State: finished (exit 0 recorded) | dead (nonzero exit, or no live process, no exit record and no
activity for STUCK_S) | stuck (live, silent for STUCK_S with an open todo) | idle (live pane idle) |
running. A member without a pane (an in-process omp `task` subagent) counts as live while it has
recent activity (a note, a todo update, or its join).
"""

from __future__ import annotations

import json
import os
import signal
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import unquote

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_dash_irc  # noqa: E402
import atlas_db  # noqa: E402
import atlas_herdr  # noqa: E402
import atlas_todo  # noqa: E402
from atlas_dash_work import _err  # noqa: E402

STUCK_S = 15 * 60
NOTE_PREVIEW = 400
TITLE_MAX = 200
LIVE_STATES = ("running", "idle", "stuck")
OPEN = ("pending", "in_progress")
PARKED_S = (
    10 * 60
)  # a pane-less, pid-less worker silent this long is parked, not working


def is_lead_name(name: str) -> bool:
    return name == "lead" or name.startswith("lead-")


def _pid_alive(entry) -> bool:
    """The entry's recorded pid is its process only if the start time still matches."""
    return atlas_todo.pid_matches(entry.get("pid"), entry.get("pid_start"))


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
    # A session lead (`lead-<sid>`) is a person's working channel; a named lead (e.g. the self-improve daemon's `selffix`)
    # also posts constantly and must not take "current" from it just by being busier.
    return max(
        leads,
        key=lambda c: (
            is_lead_name(str(c.get("lead"))),
            c.get("last_activity") or 0,
            c.get("created") or 0,
        ),
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


def _cursor_touch(root: str, name: str) -> float:
    """When the worker's inbox hook last delivered it a note: proof it was making tool calls then."""
    try:
        return float(
            atlas_dash_irc.worker_inbox.cursor_path(root, name).stat().st_mtime
        )
    except (OSError, AttributeError):
        return 0.0


LEAD_ACTIVE_S = (
    120  # a lead whose newest real signal is older than this is idle, not active
)


def _session_roots() -> list[Path]:
    home = Path.home()
    return [home / ".omp" / "agent" / "sessions", home / ".claude" / "projects"]


def _session_file_mtime(sid6: str) -> float:
    """Newest mtime of the lead's transcript: omp `<slug>/<ts>_<sid>.jsonl`, Claude `<slug>/<sid>.jsonl`."""
    best = 0.0
    for base in _session_roots():
        for f in base.glob(f"*/*{sid6}*.jsonl"):
            try:
                best = max(best, f.stat().st_mtime)
            except OSError:
                pass
    return best


def _db_last(sid6: str) -> dict[str, float]:
    """Newest tool_calls / hook-event ts of any session whose id starts with `sid6` (read-only, indexed range)."""
    path = atlas_db.db_path()
    if not os.path.isfile(path):
        return {}
    lo, hi = sid6, sid6 + "\uffff"
    try:
        c = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=0.3)
        try:
            tool = c.execute(
                "SELECT MAX(ts) FROM tool_calls WHERE session_id>=? AND session_id<?",
                (lo, hi),
            ).fetchone()[0]
            hook = c.execute(
                "SELECT MAX(ts) FROM events WHERE run_id IN "
                "(SELECT id FROM runs WHERE session_id>=? AND session_id<?)",
                (lo, hi),
            ).fetchone()[0]
        finally:
            c.close()
    except sqlite3.Error:
        return {}
    return {"tool call": float(tool or 0), "hook call": float(hook or 0)}


def _span(age: float) -> str:
    age = int(max(age, 0))
    if age < 120:
        return f"{age}s"
    return f"{age // 60} min" if age < 7200 else f"{age // 3600} h"


def lead_liveness(root: str, lead: str, now: float) -> dict | None:
    """Is the session behind `lead-<sid6>` working? From real signals, never from a herdr pane:
    its newest tool call / hook event in the atlas DB, its transcript file's mtime, and the inbox
    cursor mtime. None when no signal exists (the caller then falls back to board activity)."""
    if not lead.startswith("lead-") or len(lead) <= 5:
        return None
    sid6 = lead[5:]
    sig = {
        **_db_last(sid6),
        "session write": _session_file_mtime(sid6),
        "inbox read": _cursor_touch(root, lead),
    }
    source, at = max(sig.items(), key=lambda kv: kv[1])
    if at <= 0:
        return None
    age = max(now - at, 0.0)
    active = age <= LEAD_ACTIVE_S
    return {
        "active": active,
        "at": at,
        "source": source,
        "text": f"active, last {source} {_span(age)} ago"
        if active
        else f"idle {_span(age)}",
    }


def _deliver(
    name: str, c: dict, state: str, steerable: bool, parked: bool = False
) -> dict:
    """Can a message to this member ever be read, and how? The reason is shown before sending."""
    if state in REFUSAL:
        return {
            "ok": False,
            "how": None,
            "reason": f"{name} is {state}: nothing will read a message sent to it",
        }
    if parked:
        return {
            "ok": False,
            "how": None,
            "reason": f"{name} is parked: no process or pane and no activity for {PARKED_S // 60} min, so it makes no tool calls to read a board note until it is revived",
        }
    if steerable:
        return {
            "ok": True,
            "how": "pane",
            "reason": "typed into its terminal when it is idle, otherwise queued for its next tool call",
        }
    if not c.get("channel"):
        return {
            "ok": False,
            "how": None,
            "reason": f"{name} is not an atlas worker in this project's channel and has no interactive claude/omp pane",
        }
    return {
        "ok": True,
        "how": "hook",
        "reason": "queued on the channel board; it reads it on its next tool call",
    }


def _state(
    c: dict,
    live: bool,
    row: dict | None,
    idle_since_activity: float,
    open_todo: bool,
    log_stale: bool = False,
    liveness: dict | None = None,
) -> str:
    entry = c["entry"]
    if "exit_code" in entry:
        return "finished" if int(entry["exit_code"]) == 0 else "dead"
    quiet = idle_since_activity > STUCK_S
    if c["role"] == "lead":
        if row and row["status"] == "idle":
            return "idle"
        if not row and liveness:  # no pane to ask: the session's own signals decide
            return "running" if liveness["active"] else "idle"
        return "idle" if not live and quiet else "running"
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
    sent: dict = {}  # member -> the newest message the dashboard (human) sent to it
    pending: dict = {}  # member -> incoming messages still queued for its next tool call
    try:
        reg = atlas_todo._reg_read(root)["channels"]
    except (OSError, KeyError, ValueError):
        reg = {}
    memo: dict = {}
    wave = _wave_read(root)["members"]
    try:
        for r in atlas_todo.notes(root):
            last_note[r.get("owner")] = r
            to = str(r.get("to") or "all")
            if r.get("owner") == atlas_dash_irc.HUMAN:
                sent[to] = r
            kind = _irc_kind(r)
            if atlas_dash_irc._tracked(r, kind) and (
                atlas_dash_irc._delivery_status(root, r, kind, memo) == "queued"
            ):
                pending[to] = pending.get(to, 0) + 1
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
        live = pane_id is not None or _pid_alive(entry)
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
        liveness = lead_liveness(root, name, now) if c["role"] == "lead" else None
        activity = max(
            [float(entry.get("joined") or 0), float(note["ts"]) if note else 0.0]
            + [float(i.get("updated_at") or 0) for i in mine]
            + [_cursor_touch(root, name), liveness["at"] if liveness else 0.0]
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
            liveness,
        )
        steerable = (
            bool(row and row["agent"] in atlas_dash_irc.INTERACTIVE_AGENTS)
            and state in LIVE_STATES
        )
        snt = sent.get(name)
        parked = (
            c["role"] != "lead"
            and not live
            and state in LIVE_STATES
            and now - activity > PARKED_S
        )
        members.append(
            {
                "name": name,
                "kind": c["role"],
                "state": "parked" if parked else state,  # same decision as deliver
                "parked": parked,
                "pane_id": pane_id,
                "steerable": steerable,
                "queued": pending.get(name, 0),
                "wave": {
                    "paused": bool((wave.get(name) or {}).get("paused")),
                    "canceled": bool((wave.get(name) or {}).get("canceled")),
                },
                "headless": state in LIVE_STATES
                and not steerable,  # = no terminal pane, not a state
                "liveness": liveness,
                "deliver": _deliver(
                    name,
                    c,
                    state,
                    steerable,
                    parked=parked,
                ),
                "last_active": activity or None,
                "last_sent": {
                    k: v
                    for k, v in atlas_dash_irc._normalize_note(
                        root, snt, memo, reg
                    ).items()
                    if k in ("id", "ts", "status", "delivery_text")
                }
                | {"body": str(snt.get("text") or "")[:NOTE_PREVIEW]}
                if snt
                else None,
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
    chan = (
        {
            "name": lead_chan["name"],
            "lead": lead_chan["lead"],
            "project": root,
            "created": lead_chan.get("created"),
            "branch": lead_chan.get("branch"),
            "members": len([m for m in members if m["kind"] != "lead"]),
        }
        if lead_chan
        else None
    )
    return {
        "ok": True,
        "project": root,
        "lead": {"name": lead_chan["lead"], "channel": lead_chan["name"]}
        if lead_chan
        else None,
        "channel": chan,
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
    """(409, body) when a message to `name` could never be read (finished, dead, not an atlas worker), else None."""
    for m in build_colony(root, all_=True)["members"]:
        if m["name"] == name and m["kind"] != "lead" and not m["deliver"]["ok"]:
            return _err(
                409,
                REFUSAL.get(m["state"], "not_deliverable"),
                m["deliver"]["reason"],
                "dispatch a new worker, or read its final report on the channel",
            )
    return None


# --- wave control: pause / resume / cancel ---------------------------------------------------
# Dispatching here means sends (steering text). A wave verb flips a persisted flag the send
# handler re-reads on every call, so a wave can be held without touching running workers.
# The resume state is a snapshot for the orchestrator's "resuming interrupted runs" path.


def _wave_path(root: str) -> Path:
    return Path(root) / ".atlas" / ".run" / "colony_wave.json"


def _wave_read(root: str) -> dict:
    try:
        wave = json.loads(_wave_path(root).read_text())
    except (OSError, ValueError):
        return {"members": {}}
    if isinstance(wave, dict) and isinstance(wave.get("members"), dict):
        return wave
    return {"members": {}}


def _wave_write(root: str, wave: dict) -> None:
    """Atomic write so a crash mid-write cannot truncate the wave state."""
    p = _wave_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.parent / (f".{p.name}.tmp{os.getpid()}")
    tmp.write_text(json.dumps(wave, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)


def _wave_gate(root: str, name: str):
    """(409, body) when sends to `name` are held by a wave verb, else None."""
    wm = _wave_read(root)["members"].get(name) or {}
    if wm.get("paused"):
        return _err(
            409,
            "member_paused",
            f"{name!r} is paused; nothing is being queued for it",
            "POST /api/v2/colony/<name>/resume to start queueing again",
        )
    if wm.get("canceled"):
        return _err(
            409,
            "member_canceled",
            f"{name!r} was gracefully canceled; its pending units are recorded for resume",
            "POST /api/v2/colony/<name>/resume to requeue its pending units",
        )
    return None


def _lead_only_guard(m: dict):
    """The wave verbs never touch the lead: it is the user's own session, like kill."""
    if m["kind"] == "lead":
        return _err(
            409,
            "lead_not_killable",
            "the lead is the user's own session",
            "close it in its own terminal",
        )
    return None


def _irc_kind(rec: dict) -> str:
    text = str(rec.get("text") or "")
    kind = (
        "exit"
        if atlas_dash_irc.EXIT_RE.match(text)
        else ("irc" if rec.get("irc") else "note")
    )
    return "system" if str(rec.get("owner") or "") in ("board", "system") else kind


def _resume_state(root: str, name: str) -> dict:
    """What re-dispatching `name` needs: its open todos and its still-queued messages."""
    items = [
        {"id": i.get("id"), "content": i.get("content"), "status": i.get("status")}
        for i in atlas_todo.load(root).get("items", [])
        if not i.get("archived") and i.get("owner") == name and i.get("status") in OPEN
    ]
    queued = []
    memo: dict = {}
    try:
        notes = atlas_todo.notes(root)
    except OSError:
        notes = []
    for r in notes:
        if str(r.get("to") or "all") != name:
            continue
        kind = _irc_kind(r)
        if not atlas_dash_irc._tracked(r, kind):
            continue
        if atlas_dash_irc._delivery_status(root, r, kind, memo) == "queued":
            queued.append(atlas_dash_irc._message_id(root, r))
    return {"open_items": items, "queued_messages": queued}


def _wave_target(ctx):
    """((root, member), None) for a wave-verb target, or (None, error)."""
    name = unquote(ctx.groups[0])
    b = ctx.json() or {}
    project = b.get("project") or (ctx.query or {}).get("project")
    if not ctx.project_root(project):
        return None, _err(
            400, "project_required", "no known project given", "pass project=<abs root>"
        )
    hit = _find(ctx, name, project)
    if not hit:
        return None, _err(
            404,
            "no_such_member",
            f"{name!r} is not on the colony roster",
            "GET /api/v2/colony",
        )
    return hit, None


def h_colony_pause(ctx):
    hit, err = _wave_target(ctx)
    if hit is None:
        return err
    root, m = hit
    if guard := _lead_only_guard(m):
        return guard
    wave = _wave_read(root)
    wave["members"].setdefault(m["name"], {})["paused"] = True
    _wave_write(root, wave)
    return 200, {
        "ok": True,
        "paused": m["name"],
        "note": "sends to it are refused until resume; running work is untouched",
    }


def h_colony_resume(ctx):
    hit, err = _wave_target(ctx)
    if hit is None:
        return err
    root, m = hit
    if guard := _lead_only_guard(m):
        return guard
    wave = _wave_read(root)
    wm = wave["members"].pop(m["name"], {})
    _wave_write(root, wave)
    return 200, {
        "ok": True,
        "resumed": m["name"],
        "resume_state": wm.get("resume_state"),
    }


def h_colony_cancel(ctx):
    hit, err = _wave_target(ctx)
    if hit is None:
        return err
    root, m = hit
    if (ctx.json() or {}).get("hard"):
        # --hard keeps the kill contract verbatim: lead guard, refusals, SIGTERM/pane close.
        return h_colony_kill(ctx)
    if guard := _lead_only_guard(m):
        return guard
    if m["state"] in REFUSAL:
        return _err(
            409,
            REFUSAL[m["state"]],
            f"{m['name']!r} is already {m['state']}",
            "nothing to cancel",
        )
    state = _resume_state(root, m["name"])
    wave = _wave_read(root)
    wave["members"][m["name"]] = {
        "canceled": True,
        "canceled_at": time.time(),
        "resume_state": state,
    }
    _wave_write(root, wave)
    return 200, {
        "ok": True,
        "canceled": m["name"],
        "mode": "graceful",
        "running": m["state"],
        "resume_state": state,
    }


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
    if not m["deliver"]["ok"]:
        return _err(
            409,
            "not_deliverable",
            m["deliver"]["reason"],
            "pick a member that is running, or dispatch a new worker",
        )
    gate = _wave_gate(root, m["name"])
    if gate:
        return gate
    channel = m["channel"]
    if m["steerable"]:
        flat = atlas_dash_irc.sanitize_keys(
            f"From: {atlas_dash_irc.HUMAN}\nTo: {name}\n{text}".replace("\n", " | ")
        )
        try:
            atlas_herdr.send_prompt(m["pane_id"], flat)
        except atlas_herdr.PromptRefused as e:
            if e.http != 409:  # busy falls through to the board queue
                # receipt on the board: nothing was typed, nothing vanishes
                msg = atlas_dash_irc._record_irc(
                    root,
                    atlas_dash_irc.HUMAN,
                    name,
                    text,
                    delivery="refused",
                    channel=channel,
                )
                return e.http, {
                    "ok": False,
                    "error": e.error,
                    "why": e.why,
                    "receipt": msg["status"],
                }
        else:
            msg = atlas_dash_irc._record_irc(
                root,
                atlas_dash_irc.HUMAN,
                name,
                text,
                delivery="delivered",
                channel=channel,
            )
            return 200, {"ok": True, "delivered": True, "queued": False, "message": msg}
    msg = atlas_dash_irc._record_irc(
        root, atlas_dash_irc.HUMAN, name, text, channel=channel
    )
    return 200, {"ok": True, "delivered": False, "queued": True, "message": msg}


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
    entry = _entry(root, name)
    if entry and _pid_alive(entry):
        pid = entry["pid"]
        try:
            os.kill(int(pid), signal.SIGTERM)
        except OSError as e:
            return _err(409, "kill_failed", str(e), "the process is gone or not yours")
        return 200, {"ok": True, "killed": name, "via": "pid"}
    return _err(409, "member_dead", f"{name!r} has no live process", "nothing to kill")


def _entry(root: str, name: str):
    for c in _flatten(root):
        for m in c.get("members") or []:
            if m.get("name") == name and m.get("pid"):
                return m
    return None


ROUTES = [
    ("GET", r"^/api/v2/colony$", h_colony_get),
    ("POST", r"^/api/v2/colony/([^/?#]+)/send$", h_colony_send),
    ("POST", r"^/api/v2/colony/([^/?#]+)/kill$", h_colony_kill),
    ("POST", r"^/api/v2/colony/([^/?#]+)/pause$", h_colony_pause),
    ("POST", r"^/api/v2/colony/([^/?#]+)/resume$", h_colony_resume),
    ("POST", r"^/api/v2/colony/([^/?#]+)/cancel$", h_colony_cancel),
]
