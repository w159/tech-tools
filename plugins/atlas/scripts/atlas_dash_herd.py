#!/usr/bin/env python3
"""Atlas Workboard v2: Herd page backend (single-instance herdr web UI + herdr socket) and the
unified agents feed of the Atlas Command Center.

GET  /api/v2/herd, /api/v2/herd/status -> atlas_herdr.status()  (cached, never spawns; says whether
                                          the herdr SERVER or only the web UI is down)
GET  /api/v2/herd/agents               -> live agents from the herdr socket (read-only, HTTP 200 always);
                                          rows carry tab_label, state_changed_at, parent_pane, children
GET  /api/v2/herd/agents/<pane>/peek   -> last N lines of a pane's output (read-only, bounded, redacted)
GET  /api/v2/herd/colony               -> status + the colony's live panes (read-only)
POST /api/v2/herd/agents/<pane>/prompt -> send text to an IDLE agent (token-gated by the central guard)
POST /api/v2/herd/ensure               -> atlas_herdr.ensure()  (reuse, or launch only if none)
POST /api/v2/herd/panes                -> open a worker pane via atlas_launch.launch {name,prompt,project,[harness,run]}
POST /api/v2/herd/panes/<pane>/kill    -> close one COLONY pane (ids outside the colony are refused)

GET  /api/v2/agents                    -> the unified AgentRecord list: herdr agents joined with colony (mux)
                                          workers, board todo owners and channel participants, plus the status
                                          of the three layers (atlas, herdr socket, herdr web UI)
GET  /api/v2/agents/<id>/peek          -> same as the herd peek, <id> = pane id, worker name or title
POST /api/v2/agents/<id>/prompt        -> same guards as the channel: interactive claude/omp only, idle only,
                                          control characters collapsed (never typed as keystrokes)

Auth/CSRF/Host checks live in the central guard in atlas_dashboard.Handler:
every POST needs X-Atlas-Token; peeks expose terminal output so they need it too. Nothing here builds a
shell string: pane ids are matched against the live herdr list before any socket call.
"""

from __future__ import annotations

import re
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_herdr  # noqa: E402
import atlas_todo  # noqa: E402
import atlas_dash_irc  # noqa: E402
import atlas_dash_work  # noqa: E402
import atlas_dash_colony  # noqa: E402

STATUSES = ("working", "blocked", "idle", "done", "unknown")
# herdr status -> the one status vocabulary of the UI (MASTER 5.2): blocked reads "Needs input"
STATE = {
    "working": "working",
    "blocked": "input",
    "idle": "idle",
    "done": "done",
    "unknown": "unknown",
}
WORKER_NAME_RE = re.compile(
    r"^[a-z][a-z0-9]*(-[a-z0-9]+)+$"
)  # same rule as the old host
PEEK_DEFAULT_LINES, PEEK_MAX_LINES, PEEK_LINE_CHARS = 12, 60, 240
CHILD_WINDOW_S = (
    30 * 60
)  # dispatches of an agent's own session this recent are its live subagents
MAX_CHILDREN = 8
GHOST_WINDOW_S = (
    6 * 3600
)  # a participant without a pane appears while it is this recent
GHOST_CLEAN_S = 3600
PROJECT_TTL_S = 60.0
PANE_RE = r"[A-Za-z0-9:_.-]{1,64}"
_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]")
_CTRL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_NON_PARTICIPANTS = {atlas_dash_irc.HUMAN, "all", "anon"}


def _iso(ts) -> str | None:
    try:
        return datetime.fromtimestamp(float(ts), timezone.utc).isoformat(
            timespec="seconds"
        )
    except (TypeError, ValueError, OverflowError, OSError):
        return None


# --- state-change timestamps (G4) ---------------------------------------------------------
# herdr only reports a monotonically growing state_change_seq. The daemon stamps the time it
# first saw each (status, seq) pair, so an age is "since this daemon observed the transition".
# A pane first seen mid-state is stamped with its first sighting and flagged `first_seen`:
# it has been in that state at least this long. The map lives for the daemon's lifetime.

_SEEN: dict[str, tuple] = {}
_SEEN_LOCK = threading.Lock()


def _stamp(pane: str, status: str, seq, now: float) -> tuple[float, str]:
    key = (status, seq)
    with _SEEN_LOCK:
        cur = _SEEN.get(pane)
        if cur is None:
            cur = (key, now, "first_seen")
        elif cur[0] != key:
            cur = (key, now, "observed")
        _SEEN[pane] = cur
    return cur[1], cur[2]


def _prune_seen(live: set[str]) -> None:
    with _SEEN_LOCK:
        for pane in [p for p in _SEEN if p not in live]:
            del _SEEN[pane]


# --- herdr side reads (all through the public socket helper, all guarded) -------------------


def _tabs() -> list[dict]:
    """[{tab_id, workspace_id, label, number, focused, pane_count, agent_status}] (G2 tab labels)."""
    try:
        tabs = atlas_herdr.rpc("tab.list").get("tabs")
    except atlas_herdr.HerdrSockError:
        return []
    return [
        {
            "tab_id": t.get("tab_id"),
            "workspace_id": t.get("workspace_id"),
            "label": t.get("label") or "",
            "number": t.get("number"),
            "focused": bool(t.get("focused")),
            "pane_count": t.get("pane_count"),
            "agent_status": t.get("agent_status"),
        }
        for t in (tabs if isinstance(tabs, list) else [])
        if isinstance(t, dict)
    ]


def _sessions() -> dict[str, str]:
    """pane_id -> agent session id. The session PATH never leaves this process: only the id that
    joins the pane to the telemetry runs table is kept."""
    try:
        al = atlas_herdr.rpc("agent.list").get("agents")
    except atlas_herdr.HerdrSockError:
        return {}
    out = {}
    for a in al if isinstance(al, list) else []:
        sess = a.get("agent_session") if isinstance(a, dict) else None
        value = str((sess or {}).get("value") or "")
        if a.get("pane_id") and value:
            out[str(a["pane_id"])] = Path(value).stem.rsplit("_", 1)[-1]
    return out


def _colony() -> dict[str, dict]:
    """pane_id -> {label, run} for the colony's panes (the mux workers); {} when none or unreachable."""
    try:
        panes = atlas_herdr.list_panes()
    except atlas_herdr.HerdrSockError:
        return {}
    return {
        p["pane_id"]: {
            "label": p["label"],
            "run": p["workspace"].removeprefix("atlas-"),
        }
        for p in panes
    }


# --- telemetry side reads --------------------------------------------------------------------

_PROJECTS: dict = {"at": 0.0, "roots": []}


def _project_roots_cached(conn) -> list[str]:
    """Project roots, longest first (so a nested checkout wins), refreshed every PROJECT_TTL_S."""
    now = time.monotonic()
    if now - _PROJECTS["at"] > PROJECT_TTL_S or not _PROJECTS["roots"]:
        roots: list[str] = []
        try:
            roots = [
                r[0]
                for r in conn.execute("SELECT root_path FROM projects")
                if r[0] and not atlas_dash_work._junk_root(r[0])
            ]
        except Exception:
            pass
        _PROJECTS.update(at=now, roots=sorted(set(roots), key=len, reverse=True))
    return _PROJECTS["roots"]


def _project_of(cwd: str, roots: list[str]) -> str | None:
    cwd = (cwd or "").rstrip("/")
    for r in roots:
        r = r.rstrip("/")
        if cwd == r or cwd.startswith(r + "/"):
            return r
    return None


def _children(conn, sessions: dict[str, str], now: float) -> dict[str, dict]:
    """pane_id -> {items, total}: subagents the pane's own session dispatched recently (the
    parent link: dispatches -> runs.session_id == the pane's agent session)."""
    by_session: dict[str, list[str]] = {}
    for pane, sid in sessions.items():
        by_session.setdefault(sid, []).append(pane)
    out: dict[str, dict] = {}
    if not by_session or conn is None:
        return out
    marks = ",".join("?" * len(by_session))
    try:
        rows = conn.execute(
            "SELECT r.session_id, d.agent_type, d.ts, d.model FROM dispatches d "
            "JOIN runs r ON r.id=d.run_id "
            f"WHERE d.ts>=? AND r.session_id IN ({marks}) ORDER BY d.ts DESC",
            (now - CHILD_WINDOW_S, *by_session),
        ).fetchall()
    except Exception:
        return out
    for sid, agent_type, ts, model in rows:
        for pane in by_session.get(sid, ()):
            slot = out.setdefault(pane, {"items": [], "total": 0})
            slot["total"] += 1
            if len(slot["items"]) < MAX_CHILDREN:
                slot["items"].append(
                    {
                        "agent_type": agent_type or "(untyped)",
                        "at": _iso(ts),
                        "model": model,
                    }
                )
    return out


def _owned_items(roots: list[str]) -> list[dict]:
    """Open, in-progress and blocked board items that name an owner or a launched pane."""
    out = []
    for root in roots:
        try:
            board = atlas_todo.load(root)
        except Exception:
            continue
        for it in board.get("items", []):
            if it.get("archived") or it.get("status") == "completed":
                continue
            launch = it.get("launch") or {}
            if not it.get("owner") and not launch.get("target"):
                continue
            status = atlas_dash_work.UI_STATUS.get(str(it.get("status") or ""), "open")
            if it.get("blocked"):
                status = "blocked"
            out.append(
                {
                    "id": it.get("id"),
                    "content": " ".join(str(it.get("content") or "").split())[:160],
                    "status": status,
                    "owner": it.get("owner"),
                    "target": launch.get("target"),
                    "parent_pane": launch.get("parent_pane"),
                    "project": root,
                    "updated_at": float(it.get("updated_at") or 0),
                }
            )
    return out


def _participants(roots: list[str], now: float) -> dict[str, dict]:
    """Channel participants over the newest messages: name -> counts and the last exit note."""
    try:
        msgs, _more = atlas_dash_irc.read_messages(roots, limit=500)
    except Exception:
        return {}
    out: dict[str, dict] = {}
    for m in msgs:
        at = atlas_dash_irc._epoch(m.get("ts"))
        for name, incoming in ((m.get("from"), False), (m.get("to"), True)):
            if not name or name in _NON_PARTICIPANTS:
                continue
            p = out.setdefault(
                name, {"count": 0, "last_at": 0.0, "unread": 0, "exit_code": None}
            )
            p["count"] += 1
            p["last_at"] = max(p["last_at"], at)
            if incoming and m.get("status") == "queued":
                p["unread"] += 1
            if not incoming and m.get("kind") == "exit":
                found = atlas_dash_irc.EXIT_RE.match(str(m.get("body") or ""))
                p["exit_code"] = int(found.group(1)) if found else None
    return out


def _record_name(row: dict, label: str, tab_label: str) -> str:
    for cand in (label, tab_label, row["title"]):
        if cand and WORKER_NAME_RE.match(cand):
            return cand
    return row["title"] or label or tab_label or row["pane_id"]


def _close(conn) -> None:
    try:
        conn.close()
    except Exception:
        pass


def _db(ctx):
    try:
        return ctx.db()
    except Exception:
        return None


def _parents(items: list[dict]) -> dict[str, str]:
    """pane_id -> launching pane, from items atlas_launch recorded with a parent_pane."""
    return {
        it["target"].removeprefix("herdr:"): it["parent_pane"]
        for it in items
        if it["target"] and it["parent_pane"]
    }


def _enrich(
    rows: list[dict], conn, now: float, tabs: list[dict], parents: dict
) -> None:
    """Add tab_label, state_changed_at(+_source), parent_pane, children, colony to herdr rows in place."""
    labels = {t["tab_id"]: t["label"] for t in tabs}
    kids = _children(conn, _sessions(), now)
    colony = _colony()
    for r in rows:
        at, source = _stamp(r["pane_id"], r["status"], r["state_change_seq"], now)
        r["tab_label"] = labels.get(r["tab_id"], "")
        r["state_changed_at"] = _iso(at)
        r["state_changed_source"] = source
        r["parent_pane"] = parents.get(r["pane_id"])
        slot = kids.get(r["pane_id"], {"items": [], "total": 0})
        r["children"], r["children_total"] = slot["items"], slot["total"]
        r["colony"] = r["pane_id"] in colony
    _prune_seen({r["pane_id"] for r in rows})


# --- herd routes -------------------------------------------------------------------------------


def _status(ctx):
    return 200, {"ok": True, **atlas_herdr.status()}


def _counts(rows: list[dict]) -> dict:
    counts = dict.fromkeys(STATUSES, 0)
    for a in rows:
        counts[a["status"] if a["status"] in counts else "unknown"] += 1
    return counts


def _bg_agents(ctx) -> list[dict]:
    """claude-bg worker rows for the herd agents feed: additive, source-tagged rows from
    `claude agents --json` (via atlas_mux), merged when the mux transport is claude-bg. A missing
    or failing CLI read contributes no rows and no keys; herdr rows are never touched."""
    import atlas_mux

    if ctx is None or atlas_mux.transport() != "claude-bg":
        return []
    try:
        roots = atlas_dash_work._canon_roots(
            atlas_dash_work._project_roots(ctx, (ctx.query or {}).get("project"))
        )
    except Exception:
        roots = []
    rows, seen = [], set()
    for root in roots:
        for w in atlas_mux._claude_workers(root) or []:
            pid = str(w.get("pid") or "")
            if pid in seen:
                continue
            seen.add(pid)
            state = str(w.get("state") or "")
            name = str(w.get("name") or pid)
            rows.append(
                {
                    "pane_id": f"bg:{pid or name}",
                    "label": name,
                    "title": name,
                    "agent": "claude",
                    "status": (
                        "working"
                        if state == "working"
                        else "done"
                        if state in atlas_mux._BG_DONE_STATES
                        else "idle"
                    ),
                    "cwd": root,
                    "workspace": "",
                    "workspace_id": None,
                    "tab_id": None,
                    "focused": False,
                    "deep_link": "",
                    "state_change_seq": None,
                    "state_changed_at": None,
                    "state_changed_source": None,
                    "parent_pane": None,
                    "children": [],
                    "children_total": 0,
                    "bg_state": state,
                    "dead": w.get("dead"),
                    "source": "claude-bg",
                    "sources": ["claude-bg"],
                }
            )
    return rows


def _agents(ctx):
    t0 = time.perf_counter()
    now = time.time()
    snap = atlas_herdr.agents()
    st = atlas_herdr.status()
    conn = _db(ctx)
    tabs = _tabs() if snap["reachable"] else []
    try:
        if snap["reachable"]:
            roots = atlas_dash_work._canon_roots(
                atlas_dash_work._project_roots(ctx, ctx.query.get("project"))
                if ctx
                else []
            )
            _enrich(snap["agents"], conn, now, tabs, _parents(_owned_items(roots)))
    finally:
        _close(conn)
    bg = _bg_agents(ctx)
    return 200, {
        "ok": True,
        "herdr": {"reachable": snap["reachable"], "reason": snap["reason"]},
        "web_ui": {
            "healthy": st["healthy"],
            "url": st["url"],
            "auth_required": st["auth_required"],
        },
        "counts": _counts(snap["agents"] + bg),
        "workspaces": snap["workspaces"],
        "tabs": tabs,
        "agents": snap["agents"] + bg,
        "fetched_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def _redact(text: str) -> str | None:
    """Terminal text with secrets masked, or None when the redactor is unavailable (fail closed)."""
    try:
        import atlas_memory

        return atlas_memory.redact_secrets(text)
    except Exception:
        return None


def _peek_pane(pane: str, lines_raw) -> tuple[int, dict]:
    try:
        n = int(lines_raw) if lines_raw not in (None, "") else PEEK_DEFAULT_LINES
    except (TypeError, ValueError):
        return 400, {"ok": False, "error": "lines must be an integer"}
    n = max(1, min(n, PEEK_MAX_LINES))
    t0 = time.perf_counter()
    try:
        res = atlas_herdr.rpc(
            "pane.read",
            {"pane_id": pane, "source": "recent", "lines": n, "format": "text"},
            timeout=2.0,
        ).get("read")
    except atlas_herdr.HerdrSockError as e:
        code = 404 if e.reason == "rpc_error" else 503
        return code, {
            "ok": False,
            "error": "no such pane" if code == 404 else "herdr server is not reachable",
            "why": e.reason,
        }
    text = _redact(
        _CTRL_RE.sub("", _ANSI_RE.sub("", str((res or {}).get("text") or "")))
    )
    if text is None:
        return 503, {
            "ok": False,
            "error": "redaction unavailable",
            "why": "pane output is only served after secrets are masked",
        }
    lines = [ln.rstrip()[:PEEK_LINE_CHARS] for ln in text.splitlines()]
    while lines and not lines[-1]:
        lines.pop()
    lines = lines[-n:]
    return 200, {
        "ok": True,
        "pane_id": pane,
        "lines": lines,
        "source": "recent",
        "redacted": True,
        "truncated": bool((res or {}).get("truncated")),
        "read_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def _peek(ctx):
    return _peek_pane(ctx.groups[0], (ctx.query or {}).get("lines"))


def _prompt(ctx):
    pane = ctx.groups[0]
    body = ctx.json() or {}
    try:
        res = atlas_herdr.send_prompt(pane, body.get("text"))
    except atlas_herdr.PromptRefused as e:
        return e.http, {"ok": False, "error": e.error, "why": e.why}
    return 200, {"ok": True, "pane_id": pane, "result": res}


def _ensure(ctx):
    out = atlas_herdr.ensure()
    atlas_herdr._status_cache = None  # the page re-reads status right after
    return (200 if out.get("ok") else 503), out


def _colony_route(ctx):
    """Colony status: web UI state and the colony's live panes (never spawns)."""
    out = {"ok": True, **atlas_herdr.status()}
    try:
        out["panes"] = atlas_herdr.list_panes()
    except atlas_herdr.HerdrSockError as e:
        out["panes"], out["panes_error"] = [], e.reason
    return 200, out


def _create_pane(ctx):
    """Open one worker pane through atlas_launch (so the env pins, tier-free interactive command and prompt file
    are the ones every launch gets). The body names the worker and its prompt; it never carries a command."""
    import atlas_launch

    b = ctx.json() or {}
    name, prompt = b.get("name"), b.get("prompt")
    if not isinstance(name, str) or not name.strip():
        return 400, {"ok": False, "error": "name is required"}
    if not isinstance(prompt, str) or not prompt.strip():
        return 400, {"ok": False, "error": "prompt is required"}
    harness = b.get("harness") or "omp"
    if harness not in ("omp", "claude"):
        return 400, {"ok": False, "error": "harness must be omp or claude"}
    run = b.get("run") or "work"
    root = ctx.project_root(b.get("project"))
    if not root:
        return 400, {"ok": False, "error": "unknown project"}
    res = atlas_launch.launch(root, name, prompt, harness=harness, run=run)
    atlas_herdr._status_cache = None
    return (200 if res.get("ok") else 502), res


def _kill_pane(ctx):
    out = atlas_herdr.close_pane(ctx.groups[0])
    return (200 if out["ok"] else 404), out


# --- unified agents feed -------------------------------------------------------------------------


def build_agents(ctx, project: str | None = None) -> dict:
    """The AgentRecord list (PAGES section 0): herdr agents + colony workers + todo owners +
    channel participants, one record per agent, with the status of the three layers."""
    t0 = time.perf_counter()
    now = time.time()
    snap = atlas_herdr.agents()
    st = atlas_herdr.status()
    reachable = snap["reachable"]
    rows = snap["agents"]
    conn = _db(ctx)
    try:
        tabs = _tabs() if reachable else []
        tab_label = {t["tab_id"]: t["label"] for t in tabs}
        colony = _colony() if reachable else {}
        sessions = _sessions() if reachable else {}
        kids = _children(conn, sessions, now) if reachable else {}
        proj_roots = _project_roots_cached(conn) if conn is not None else []
        roots = []
        if conn is not None:
            roots = atlas_dash_work._canon_roots(
                atlas_dash_work._project_roots(ctx, project)
            )
    finally:
        _close(conn)
    items = _owned_items(roots)
    people = _participants(roots, now)
    parents = {
        it["target"].removeprefix("herdr:"): it["parent_pane"]
        for it in items
        if it["target"] and it["parent_pane"]
    }

    records: list[dict] = []
    claimed_names: set[str] = set()
    for r in rows:
        pane = r["pane_id"]
        label = colony.get(pane, {}).get("label", "")
        tab = tab_label.get(r["tab_id"], "")
        name = _record_name(r, label, tab)
        idents = {name, pane}
        if label:
            idents.add(label)
        claimed_names |= idents
        at, source = _stamp(pane, r["status"], r["state_change_seq"], now)
        mine = [
            it
            for it in items
            if it["owner"] in idents or it["target"] == f"herdr:{pane}"
        ]
        talk = [p for n, p in people.items() if n in idents]
        slot = kids.get(pane, {"items": [], "total": 0})
        records.append(
            {
                "key": pane,
                "name": name,
                "kind": r["agent"],
                "status": r["status"],
                "state": STATE.get(r["status"], "unknown"),
                "pane_id": pane,
                "workspace_id": r["workspace_id"],
                "workspace": r["workspace"],
                "tab_id": r["tab_id"],
                "tab_label": tab,
                "cwd": r["cwd"],
                "title": r["title"],
                "focused": r["focused"],
                "deep_link": r["deep_link"],
                "project": _project_of(r["cwd"], proj_roots),
                "colony": pane in colony,
                "run": colony.get(pane, {}).get("run"),
                "parent_pane": parents.get(pane),
                "children": slot["items"],
                "children_total": slot["total"],
                "state_change_seq": r["state_change_seq"],
                "completion_seq": r["completion_seq"],
                "state_changed_at": _iso(at),
                "state_changed_source": source,
                "tasks": [
                    {k: it[k] for k in ("id", "content", "status", "project")}
                    for it in mine
                ],
                "messages": {
                    "count": sum(p["count"] for p in talk),
                    "unread": sum(p["unread"] for p in talk),
                    "last_message_at": _iso(
                        max((p["last_at"] for p in talk), default=0) or None
                    ),
                },
                "sources": ["herdr"]
                + (["mux"] if pane in colony else [])
                + (["todo"] if mine else [])
                + (["irc"] if talk else []),
            }
        )
    if reachable:
        _prune_seen({r["pane_id"] for r in rows})

    # Participants with no live pane: workers that exited, a lead outside herdr, a pane herdr no
    # longer lists. Only recent ones, so months of channel history never become "agents".
    ghosts: dict[str, dict] = {}
    for it in items:
        owner = it["owner"]
        if not owner or owner in claimed_names or owner in _NON_PARTICIPANTS:
            continue
        if now - it["updated_at"] > GHOST_WINDOW_S:
            continue
        g = ghosts.setdefault(owner, {"tasks": [], "project": it["project"]})
        g["tasks"].append(it)
    for name, p in people.items():
        if name in claimed_names or name in _NON_PARTICIPANTS:
            continue
        # a clean exit is history after an hour; a failed one stays visible for GHOST_WINDOW_S
        keep = GHOST_WINDOW_S if p["exit_code"] not in (None, 0) else GHOST_CLEAN_S
        if now - p["last_at"] > keep:
            continue
        ghosts.setdefault(name, {"tasks": [], "project": None})["talk"] = p
    for name, g in sorted(ghosts.items()):
        p = g.get("talk")
        code = p["exit_code"] if p else None
        state = "unknown" if code is None else ("done" if code == 0 else "fail")
        records.append(
            {
                "key": name,
                "name": name,
                "kind": "lead" if atlas_dash_colony.is_lead_name(name) else "unknown",
                "status": "unknown",
                "state": state,
                "pane_id": None,
                "workspace_id": None,
                "workspace": "",
                "tab_id": None,
                "tab_label": "",
                "cwd": "",
                "title": "",
                "focused": False,
                "deep_link": None,
                "project": g["project"],
                "colony": False,
                "run": None,
                "parent_pane": None,
                "children": [],
                "children_total": 0,
                "state_change_seq": None,
                "completion_seq": None,
                "state_changed_at": None,
                "state_changed_source": None,
                "tasks": [
                    {k: it[k] for k in ("id", "content", "status", "project")}
                    for it in g["tasks"]
                ],
                "messages": {
                    "count": p["count"] if p else 0,
                    "unread": p["unread"] if p else 0,
                    "last_message_at": _iso(p["last_at"] or None) if p else None,
                },
                "sources": (["todo"] if g["tasks"] else []) + (["irc"] if p else []),
            }
        )

    want = ""
    if project and project != "all":
        want = ctx.project_root(project) or str(project)
        records = [r for r in records if r["project"] == want]
    return {
        "ok": True,
        "layers": {
            "atlas": {"ok": True},
            "herdr_socket": {"reachable": reachable, "reason": snap["reason"]},
            "herdr_web_ui": {
                "healthy": st["healthy"],
                "url": st["url"],
                "auth_required": st["auth_required"],
            },
        },
        "counts": _counts([r for r in records if r["pane_id"]]),  # == herdr agent list
        "states": {
            s: sum(1 for r in records if r["state"] == s)
            for s in ("input", "fail", "working", "idle", "done", "unknown")
        },
        "workspaces": snap["workspaces"],
        "tabs": tabs,
        "agents": records,
        "fetched_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


def _agents_unified(ctx):
    return 200, build_agents(ctx, (ctx.query or {}).get("project"))


def _resolve(ident: str) -> tuple[dict | None, dict]:
    """(live herdr row for a pane id, worker name or title, snapshot). Row is None when no match."""
    snap = atlas_herdr.agents()
    if not snap["reachable"]:
        return None, snap
    colony = _colony()
    for r in snap["agents"]:
        if ident in (
            r["pane_id"],
            colony.get(r["pane_id"], {}).get("label"),
            r["title"],
        ):
            return r, snap
    return None, snap


def _unified_peek(ctx):
    row, snap = _resolve(ctx.groups[0])
    if not snap["reachable"]:
        return 503, {
            "ok": False,
            "error": "herdr server is not reachable",
            "why": snap["reason"],
        }
    if row is None:
        return 404, {"ok": False, "error": "no live pane for that agent"}
    return _peek_pane(row["pane_id"], (ctx.query or {}).get("lines"))


def _refuse_finished(ctx, ident: str, body: dict):
    """(409, body) when `ident` is a finished/dead colony member: nothing would ever read the prompt."""
    project = body.get("project") or (ctx.query or {}).get("project")
    for root in atlas_dash_work._project_roots(ctx, project):
        refused = atlas_dash_colony.refusal(root, ident)
        if refused:
            return refused
    return None


def _unified_prompt(ctx):
    ident = ctx.groups[0]
    body = ctx.json() or {}
    row, snap = _resolve(ident)
    if not snap["reachable"]:
        return 503, {
            "ok": False,
            "error": "herdr server is not reachable",
            "why": snap["reason"],
        }
    if row is None:
        refused = _refuse_finished(ctx, ident, body)
        if refused:
            return refused
        return 404, {"ok": False, "error": "no live pane for that agent"}
    if row["agent"] not in atlas_dash_irc.INTERACTIVE_AGENTS:
        return 409, {
            "ok": False,
            "error": "pane_not_steerable",
            "why": f"the pane runs {row['agent']!r}, not an interactive claude/omp session; typed text could run as a command",
        }
    text = body.get("text")
    if isinstance(text, str):
        text = atlas_dash_irc.sanitize_keys(text)
    try:
        res = atlas_herdr.send_prompt(row["pane_id"], text)
    except atlas_herdr.PromptRefused as e:
        return e.http, {"ok": False, "error": e.error, "why": e.why}
    return 200, {"ok": True, "key": ident, "pane_id": row["pane_id"], "result": res}


def _console(ctx):
    """Where the Command Center frames the unmodified herdr web UI (same-origin gateway or direct)."""
    st = atlas_herdr.status()
    url = (st.get("url") or "").rstrip("/")
    return 200, {
        "ok": True,
        "url": url or None,
        "chrome_full_url": f"{url}/?chrome=full" if url else None,
        "herdr_ui_url": f"{url}/herdr" if url else None,
        "pane_url_template": f"{url}/?pane={{pane_id}}&machine=local&chrome=pane&theme={{theme}}"
        if url
        else None,
        "reachable": bool(st.get("healthy")),
        "auth_required": bool(st.get("auth_required")),
        "layers": {
            "atlas": {"ok": True},
            "herdr_socket": {
                "reachable": bool(st.get("herdr_server", st.get("server_up")))
            },
            "herdr_web_ui": {"healthy": bool(st.get("healthy")), "url": url or None},
        },
    }


ROUTES = [
    ("GET", r"^/api/v2/herd$", _status),
    ("GET", r"^/api/v2/herd/status$", _status),
    ("GET", r"^/api/v2/herd/agents$", _agents),
    ("GET", rf"^/api/v2/herd/agents/({PANE_RE})/peek$", _peek),
    ("GET", r"^/api/v2/herd/colony$", _colony_route),
    ("POST", rf"^/api/v2/herd/agents/({PANE_RE})/prompt$", _prompt),
    ("POST", r"^/api/v2/herd/ensure$", _ensure),
    ("POST", r"^/api/v2/herd/panes$", _create_pane),
    ("POST", rf"^/api/v2/herd/panes/({PANE_RE})/kill$", _kill_pane),
    ("GET", r"^/api/v2/herd/console$", _console),
    ("GET", r"^/api/v2/agents$", _agents_unified),
    ("GET", rf"^/api/v2/agents/({PANE_RE})/peek$", _unified_peek),
    ("POST", rf"^/api/v2/agents/({PANE_RE})/prompt$", _unified_prompt),
    *atlas_dash_colony.ROUTES,
]
