#!/usr/bin/env python3
"""Atlas dashboard v2: IRC (board notes) routes.

``GET/POST /api/v2/irc`` read and write the inter-agent channel, which is the board's notes
(atlas_todo stays the single writer). A message to a named agent is delivered one of two ways:

* the worker's own PostToolUse hook drains it from the board (hooks/worker_inbox.py advances a
  cursor): the note reads ``queued`` until then, ``read`` after; or
* when herdr lists an agent for that name (pane id like ``wA:p1``, tab title or workspace label) and it is an idle
  claude/omp session, the dashboard hands it over with ``atlas_herdr.send_prompt`` and stamps
  ``delivery=delivered`` on the note so the hook never injects it a second time. herdr's agent list holds only
  panes it recognises as agents, so a plain shell pane is never matched: that note simply stays ``queued``. A
  listed agent that is not claude/omp is stamped ``refused`` and never typed into.

Stdlib only. Nothing here types into a terminal or spawns a process.
"""

from __future__ import annotations

import hashlib
import re
import sys
import time
from datetime import datetime
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_herdr  # noqa: E402
import atlas_todo  # noqa: E402
from atlas_dash_work import _err, _iso, _project_roots  # noqa: E402

# Delivery state of a message to a worker comes from the cursor the worker's own
# PostToolUse hook advances (hooks/worker_inbox.py); one module owns the file layout.
HOOKS_DIR = SCRIPTS_DIR.parent / "hooks"
if str(HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(HOOKS_DIR))
try:
    import worker_inbox
except ImportError:  # hooks dir absent from a trimmed install: nothing is ever "read"
    worker_inbox = None

NAME_RE = re.compile(
    r"^[A-Za-z0-9_.:-]{1,64}$"
)  # ':' so herdr pane ids (wA:p1) are addressable
EXIT_RE = re.compile(r"^exit (-?\d+)(?: \[failed: (.*)\])?")
HUMAN = "human"
# herdr's `agent` column for a pane running an interactive claude/omp session; anything else
# (a plain shell reports "unknown") would run typed text as a command and is never prompted.
INTERACTIVE_AGENTS = ("claude", "omp")
# Characters that would act as keystrokes (Enter, Tab, ESC, ^C ...) in a tty.
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _valid(name: str | None) -> bool:
    return bool(name) and bool(NAME_RE.match(name))


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


def sanitize_keys(text: str) -> str:
    """Collapse every control character (newline, CR, tab, ESC, DEL ...) to one space."""
    return CONTROL_RE.sub(" ", text or "")


# --- board notes / IRC ---------------------------------------------------------------


def _message_id(root: str, rec: dict) -> str:
    key = f"{root}|{rec.get('ts')}|{rec.get('owner')}|{rec.get('to')}|{rec.get('text')}"
    return "m" + hashlib.sha256(key.encode("utf-8", "replace")).hexdigest()[:12]


QUEUED_TTL_S = (
    900  # a message nobody drained for this long is undeliverable, not queued
)


def _tracked(rec: dict, kind: str) -> bool:
    """True when a message has a reader to wait for: anything addressed to a named agent.

    Not tracked: broadcasts, lines to the lead or the human (mux stdout mirrors,
    exits), and system notes: nobody drains them, so a queued label would never clear."""
    return not (
        str(rec.get("to") or "all") in ("all", HUMAN, "lead")
        or kind in ("exit", "system")
    )


def _delivery_status(root: str, rec: dict, kind: str, memo: dict | None) -> str:
    """``queued``, ``read``, ``delivered``, ``refused`` or ``undeliverable`` for one message.

    Human and agent-to-agent notes to a named agent are tracked alike. When the dashboard
    itself typed one into an interactive pane the send outcome is persisted on the note
    (``delivery``): ``delivered`` (typed; the worker hook skips it, so it is never injected
    twice) or ``refused`` (shell/non-steerable pane, never typed). Otherwise it is queued
    on the board until that worker's PostToolUse hook drains it (hooks/worker_inbox.py moves
    the cursor), then read; one nobody drained within QUEUED_TTL_S is ``undeliverable``,
    so every message reaches a terminal state. Untracked lines are always ``read``."""
    if not _tracked(rec, kind):
        return "read"
    outcome = rec.get("delivery")
    if outcome in ("delivered", "refused"):
        return outcome
    to = str(rec.get("to") or "all")
    if worker_inbox is not None and worker_inbox.is_read(root, to, rec, memo):
        return "read"
    return (
        "undeliverable"
        if time.time() - _epoch(rec.get("ts")) > QUEUED_TTL_S
        else "queued"
    )


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
        "tracked": _tracked(rec, kind),
        "run": rec.get("run"),
        "project": root,
        "channel": "all" if to == "all" else f"@{to}",
        "channel_name": rec.get("channel"),
        "_epoch": _epoch(rec.get("ts")),
    }


def read_messages(
    roots: list[str],
    since=None,
    agent: str | None = None,
    limit: int = 200,
    channel: str | None = None,
    legacy_main: bool = False,
):
    """(messages, more): normalized, deduped, ts-ordered messages across the roots.

    Without `since` the newest `limit` messages. With `since` (a message id or an epoch) the
    OLDEST `limit` after it, and `more` says newer ones remain: a poller that follows
    `more` sees every message of a burst instead of only its newest page."""
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
            if (
                channel
                and rec.get("channel") != channel
                and not (legacy_main and not rec.get("channel"))
            ):
                continue  # another channel's note (channel-less legacy notes belong to main)
            msg = _normalize_note(root, rec, memo)
            seen.setdefault(msg["id"], msg)
    msgs = sorted(seen.values(), key=lambda m: (m["_epoch"], m["id"]))
    paging = False
    if since_id:
        ids = [m["id"] for m in msgs]
        if since_id in ids:
            msgs = msgs[ids.index(since_id) + 1 :]
            paging = True
    elif since_epoch:
        msgs = [m for m in msgs if m["_epoch"] > since_epoch]
        paging = True
    if agent:
        msgs = [m for m in msgs if agent in (m["from"], m["to"])]
    limit = max(1, min(int(limit or 200), 1000))
    more = paging and len(msgs) > limit
    msgs = msgs[:limit] if paging else msgs[-limit:]
    for m in msgs:
        m.pop("_epoch", None)
    return msgs, more


def _record_irc(
    root: str,
    sender: str,
    to: str,
    body: str,
    run: str | None = None,
    delivery: str | None = None,
    channel: str | None = None,
) -> dict:
    kw = {"channel": channel} if channel else {}
    rec = atlas_todo.note(root, sender, body, to=to, delivery=delivery, **kw)
    return _normalize_note(root, {**rec, "irc": True, "run": run})


def h_irc_get(ctx):
    q = ctx.query
    roots = _project_roots(ctx, q.get("project"))
    try:
        limit = int(q.get("limit", "200"))
    except ValueError:
        limit = 200
    msgs, more = read_messages(
        roots, since=q.get("since"), agent=q.get("agent"), limit=limit
    )
    agents = sorted(
        {m["from"] for m in msgs} | {m["to"] for m in msgs if m["to"] != "all"}
    )
    channels = sorted({m["channel"] for m in msgs})
    return 200, {"messages": msgs, "agents": agents, "channels": channels, "more": more}


def _find_pane(live: dict, name: str) -> dict | None:
    """The herdr agent addressed by `name`: its pane id, tab title or workspace label."""
    for a in live["agents"]:
        if name in (a["pane_id"], a["title"], a["workspace"]):
            return a
    return None


def _deliver(pane: dict, sender: str, to: str, text: str):
    """Hand `text` to the idle herdr pane. -> (delivery stamp | None, refusal | None)."""
    if pane["agent"] not in INTERACTIVE_AGENTS:
        return "refused", {
            "error": "pane_not_steerable",
            "why": f"the pane runs {pane['agent']!r}, not an interactive claude/omp session; typed text could run as a command",
            "do": "open the pane in the herd view to type there yourself, or message a worker that runs claude/omp",
        }
    flat = sanitize_keys(f"From: {sender}\nTo: {to}\n{text}".replace("\n", " | "))
    try:
        atlas_herdr.send_prompt(pane["pane_id"], flat)
    except atlas_herdr.PromptRefused as e:
        # busy / unreachable / rejected: nothing was typed, so no stamp. The note stays queued
        # on the board and the worker's hook drains it on its next tool call.
        return None, {
            "error": "agent_busy" if e.http == 409 else "herdr_refused",
            "why": e.why or e.error,
            "do": "it is queued on the board; the worker reads it on its next tool call",
            "http": e.http,
        }
    return "delivered", None


def h_irc_post(ctx):
    b = ctx.json()
    return _post(ctx, b, ctx.project_root(b.get("project")))


def _post(ctx, b, root):
    channel = b.get("channel") or None
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
            f"{to!r} is not [A-Za-z0-9_.:-] or 'all'",
            "address an agent name or all",
        )
    stamp, refusal = None, None
    pane = None
    if to != "all":
        live = atlas_herdr.agents()
        pane = _find_pane(live, to) if live["reachable"] else None
        if pane:
            stamp, refusal = _deliver(pane, sender, to, body)
    if pane is None and to != "all" and not (to == "lead" or to.startswith("lead-")):
        import atlas_dash_colony

        gone = atlas_dash_colony.refusal(root, to)
        if gone:
            return gone
    msg = _record_irc(root, sender, to, body, delivery=stamp, channel=channel)
    if refusal:
        status = 409 if stamp == "refused" else refusal.pop("http")
        msg["delivered"] = False
        return status, {
            "ok": False,
            **refusal,
            "message": msg,
            "delivered": False,
            "next": "recorded on the board, but not typed into the pane",
        }
    return 200, {
        "ok": True,
        "delivered": stamp == "delivered",
        "message": msg,
        "next": "delivered to the pane"
        if stamp == "delivered"
        else "recorded on the board",
    }


# --- channels (main `<folder>@<branch>`, per-lead subchannels `<main>/<lead>`) ----------------
# Storage (registry, members, board-by-owner) lives in atlas_todo; this layer adds presence from
# herdr and the todo views the UI renders. Channel names contain '@' and '/', so the detail
# route takes one URL-encoded path segment.


def _unavailable():
    return _err(
        503,
        "channels_unavailable",
        "atlas_todo has no channel registry in this install",
        "update the atlas plugin",
    )


def _live_index() -> dict:
    """name/pane/title/colony label -> {pane_id, state} for the live herdr agents (empty if down)."""
    live = atlas_herdr.agents()
    idx: dict = {}
    if not live["reachable"]:
        return idx
    try:
        labels = {p["pane_id"]: p["label"] for p in atlas_herdr.list_panes()}
    except atlas_herdr.HerdrSockError:
        labels = {}
    for a in live["agents"]:
        info = {"pane_id": a["pane_id"], "state": a["status"], "kind": a["agent"]}
        for key in (a["pane_id"], a["title"], labels.get(a["pane_id"])):
            if key:
                idx.setdefault(key, info)
    return idx


def _member_view(m: dict, live: dict, seen: dict | None = None) -> dict:
    name = str(m.get("name") or "")
    info = live.get(name) or {}
    return {
        "name": name,
        "kind": m.get("role") or "subagent",
        "parent": m.get("parent"),
        "pane_id": info.get("pane_id"),
        "state": info.get("state"),
        "last_seen": (seen or {}).get(name),
    }


def _chan_view(root: str, c: dict, live: dict) -> dict:
    return {
        "name": c.get("name"),
        "kind": c.get("kind") or "main",
        "parent": c.get("parent"),
        "lead": c.get("lead"),
        "members": [_member_view(m, live) for m in c.get("members") or []],
        "project": c.get("project_root") or root,
        "branch": c.get("branch"),
        "created": _iso(c.get("created"))
        if not isinstance(c.get("created"), str)
        else c.get("created"),
        "last_activity": c.get("last_activity"),
    }


def _decode(name: str) -> str:
    from urllib.parse import unquote

    return unquote(name)


def h_channels_get(ctx):
    if not hasattr(atlas_todo, "channels"):
        return _unavailable()
    roots = _project_roots(ctx, ctx.query.get("project"))
    live = _live_index()
    out = []
    for root in roots:
        try:
            mains = atlas_todo.channels(root)
            if not mains and ctx.query.get("project") not in (None, "", "all"):
                atlas_todo.ensure_main(
                    root
                )  # the one deterministic registry row, idempotent
                mains = atlas_todo.channels(root)
        except OSError:
            continue
        for m in mains:
            for c in [m, *(m.get("children") or [])]:
                out.append(_chan_view(root, c, live))
    return 200, {"channels": out}


def _find_channel(ctx, name: str):
    """(root, channel dict) for the first project holding `name`, else (None, None)."""
    for root in _project_roots(
        ctx, ctx.query.get("project") or (ctx.json() or {}).get("project")
    ):
        try:
            chan = atlas_todo.get_channel(root, name)
        except OSError:
            continue
        if chan:
            return root, chan
    return None, None


def _board_view(root: str, name: str) -> dict:
    from atlas_dash_work import _todo_view

    try:
        board = atlas_todo.channel_board(root, name) or {}
    except (OSError, KeyError):
        board = {}
    owners = []
    for m in board.get("members") or []:
        items = []
        for it in m.get("items") or []:
            try:
                items.append(_todo_view(it))
            except Exception:
                continue
        owners.append(
            {
                "owner": m.get("name"),
                "role": m.get("role"),
                "parent": m.get("parent"),
                "counts": m.get("counts") or {},
                "last_note": m.get("last_note"),
                "items": items,
            }
        )
    return {"owners": owners, "counts": board.get("counts") or {}}


def h_channel_get(ctx):
    if not hasattr(atlas_todo, "get_channel"):
        return _unavailable()
    name = _decode(ctx.groups[0])
    root, chan = _find_channel(ctx, name)
    if not chan:
        return _err(
            404,
            "no_such_channel",
            f"{name!r} is not a channel",
            "list /api/v2/channels",
        )
    q = ctx.query
    try:
        limit = int(q.get("limit", "200"))
    except ValueError:
        limit = 200
    msgs, more = read_messages(
        [root],
        since=q.get("since"),
        limit=limit,
        channel=name,
        legacy_main=(chan.get("kind") or "main") == "main",
    )
    seen: dict = {}
    for m in msgs:  # presence: newest message each member sent in this channel
        seen[m["from"]] = m["ts"]
    view = _chan_view(root, chan, _live_index())
    for mem in view["members"]:
        mem["last_seen"] = seen.get(mem["name"])
    return 200, {
        "channel": view,
        "messages": msgs,
        "more": more,
        "board": _board_view(root, name),
    }


def h_channels_post(ctx):
    b = ctx.json() or {}
    name = str(b.get("channel") or "")
    if not name:
        return _err(400, "channel_required", "no channel", "pass the channel name")
    if not hasattr(atlas_todo, "get_channel"):
        return _unavailable()
    root, chan = _find_channel(ctx, name)
    if not chan:
        return _err(
            404,
            "no_such_channel",
            f"{name!r} is not a channel",
            "list /api/v2/channels",
        )
    return _post(ctx, {**b, "channel": name}, root)


ROUTES = [
    ("GET", r"/api/v2/irc", h_irc_get),
    ("POST", r"/api/v2/irc", h_irc_post),
    ("GET", r"/api/v2/channels", h_channels_get),
    ("POST", r"/api/v2/channels", h_channels_post),
    ("GET", r"/api/v2/channels/([^/?#]+)", h_channel_get),
]
