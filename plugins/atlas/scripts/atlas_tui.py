#!/usr/bin/env python3
"""Atlas Command Center: curses TUI over atlas_colony_model.snapshot().

`render(snapshot, ui_state, width, height) -> list[str]` is a pure function used by both
the curses loop and `--once`. `handle_key` / `run_command` / `handle_click` mutate
ui_state and return an effect tuple (("quit",), ("refresh",), ("term", seat),
("send", seat, text), ("stop", seat), ("broadcast", text)) for the loop. On-screen
actions render as bracketed buttons (`[ msg ]`), registered in `hitmap` and drawn
highlighted by the loop. Stdlib only. Layout mirrors the OpenRig native TUI captures.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
from collections.abc import Mapping
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

LEFT = 32
COMPACT_LEFT = 24  # explorer width below COMPACT_W columns
COMPACT_W = 100
MIN_W, MIN_H = 60, 18
SECTIONS = ["topology", "specs", "projects", "terminals", "feed", "system", "colony"]  # colony is the landing view (loop/once), kept last so explorer indexes stay put
CLW = 34  # colony workspace: SESSIONS column width at >= COMPACT_W
REGIONS = ["sessions", "channel", "steer"]  # 1/2/3 and Tab order
TABS = ["table", "wall", "recent", "overview", "graph", "health"]
RT = {"claude": "cl", "omp": "omp", "codex": "cx"}
RT_LONG = {"omp": "omp", "claude": "Claude Code", "codex": "Codex CLI"}
WALL_BODY = 5  # output lines shown per wall tile
RT_GLYPH = {"claude": "><", "omp": ">_", "codex": "#>"}
DOT = {"working": "●", "idle": "·", "blocked": "!", "finished": "✓", "dead": "✗"}
COMMANDS = [
    ("colony <id>", "open a colony"),
    ("seat <name>", "live view of a seat's tmux pane"),
    ("term <seat>", "attach the seat's tmux pane (C-b d returns)"),
    ("send <seat> <text>", "post a board note to a seat"),
    ("msg <seat>", "prefill the command line with a note to a seat"),
    ("view <seat>", "open a seat's view (pane, transcript, log or notes)"),
    ("stop <seat>", "stop a pane seat after a y/n confirm"),
    ("broadcast <text>", "post a board note to the colony's channel (to all)"),
    (": <section>", "colony|topology|specs|projects|terminals|feed|system"),
    ("/ <text>", "filter the current view"),
    ("tab <table|wall|recent|overview|graph|health>", "switch right-pane tab"),
    ("refresh", "re-read the snapshot"),
    ("back", "go up one level"),
    ("help", "this list"),
    ("quit", "leave"),
]
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")
# Bracketed on-screen buttons: every label here is clickable (hitmap) and drawn highlighted.
BTNS = re.compile(r"\[ (msg all|msg|view|term|stop|hold|release|@all|@lead|back|refresh|\? help|q quit) \]")
BTN_ACT = {  # label -> handle_click/_button_effect action name
    "msg": "msg", "msg all": "msgall", "view": "view", "term": "term",
    "stop": "stop", "hold": "hold", "release": "release", "@all": "at_all", "@lead": "at_lead", "back": "back", "refresh": "refresh", "? help": "help", "q quit": "quit",
}
# The declared key contract: {mode: [(keys, action, help_text)]}; keys is one key name or a tuple of them.
# "colony" and "steer" drive _colony_key/_steer_key dispatch; "shared" (handle_key fall-through) and
# "explorer" (the other sections) are declarative, listed so conflicts show. A mode may not bind a key twice;
# "colony" intentionally overrides "explorer" for m and v. _help_lines renders this table.
KEYMAP = {
    "colony": [
        (("1", "2", "3"), "focus", "1/2/3 focus SESSIONS/CHANNEL/STEER"),
        ("tab", "cycle", "Tab cycle the three regions"),
        (("up", "down", "pgup", "pgdn"), "move", "Up/Down/PgUp/PgDn move the SESSIONS row, scroll CHANNEL"),
        ("enter", "pick", "Enter open the selected SESSIONS row"),
        (("home", "end"), "jump", "Home/End jump CHANNEL to the oldest/newest row"),
        (("i", "m"), "steer", "i or m type a message to the selected seat (or the lead)"),
        ("b", "steer_all", "b type a broadcast (@all)"),
        ("l", "steer_lead", "l type a message to the lead (@lead)"),
        ("h", "hold", "h hold or release the selected seat"),
        ("f", "filter", "f filter CHANNEL to the selected seat (again clears)"),
        ("v", "view", "v open the selected seat's view"),
        (("left", "right"), "noop", "Left/Right unused in the workspace"),
    ],
    "steer": [
        ("enter", "send", "Enter send (an @seat, @all or @lead prefix retargets)"),
        ("esc", "cancel", "Esc leave STEER and drop the text"),
        ("backspace", "erase", "Backspace erase one character"),
    ],
    "shared": [
        ("W", "workspace", "W return to the colony workspace"),
        ("t", "term", "t attach the selected seat's pane"),
        ("x", "stop", "x stop the selected seat (y/n confirm)"),
        ("r", "refresh", "r re-read the snapshot"),
        ("a", "all", "a toggle all projects"),
        ("q", "quit", "q quit"),
        ("?", "help", "? this help"),
        (":", "cmd", ": command bar"),
        ("/", "filter_view", "/ filter the current view"),
        ("esc", "back", "Esc go back one level"),
    ],
    "explorer": [
        (("up", "down", "pgup", "pgdn"), "move", "Up/Down/PgUp/PgDn move in the focused pane"),
        (("left", "right"), "pane", "Left/Right switch pane focus"),
        ("enter", "open", "Enter open the row"),
        ("tab", "tab", "Tab next right-pane tab"),
        ("m", "msg", "m message the selected seat"),
        ("v", "view", "v open the selected seat's view"),
    ],
}
_KEY_ACT = {
    mode: {k: act for ks, act, _h in rows for k in ((ks,) if isinstance(ks, str) else ks)}
    for mode, rows in KEYMAP.items()
}
SEAT_HEAD = 3  # seat-view header rows (title, facts, buttons); the body starts after


def new_ui(**kw) -> dict:
    ui = {
        "section": "topology",
        "cursor": 0,
        "focus": "explorer",
        "colony": None,
        "pod": None,
        "tab": "table",
        "seat": None,
        "seat_text": "",
        "seat_scroll": 0,
        "row": 0,
        "mode": "",
        "buf": "",
        "filter": "",
        "help_sel": 0,
        "sub": None,
        "confirm": None,  # seat awaiting the y/n stop gate
        "confirm_sess": None,  # tmux session awaiting the y/n kill gate
        "wall_text": {},  # seat name -> output lines, refreshed at snapshot cadence only
        "status": "",
        "region": "sessions",  # focused colony-workspace region
        "srow": 0,  # selected SESSIONS row
    }
    ui.update(kw)
    return ui


# ---------------------------------------------------------------- helpers
def _fit(s: str, w: int) -> str:
    s = s.replace("\t", " ").replace("\n", " ")
    if len(s) > w:
        s = s[: max(0, w - 1)] + "…" if w > 0 else ""
    return s.ljust(w)


def _clock(snap) -> str:
    return str(snap.get("clock") or "")


def _colonies(snap) -> list:
    return snap.get("colonies") or []


def _find_colony(snap, cid):
    cs = _colonies(snap)
    return next((c for c in cs if c.get("id") == cid), None) or next((c for c in cs if c.get("name") == cid), None)


def normalize_snapshot(snap: dict) -> dict:
    """Fill safe defaults once at load so every view can index seat rows and format fields without KeyError/TypeError."""
    if not isinstance(snap, dict):
        return snap
    snap["_norm"] = True  # idempotence marker for render()/hitmap(), which normalize unprotected callers
    for s in snap.get("seats") or []:
        s["name"] = str(s.get("name") or "?")
        s["target"] = s.get("target") or ""
        s["state"] = s.get("state") or "unknown"
        for k in ("description", "channels", "session"):
            if s.get(k) is None:
                s[k] = ""
    for key, strs, ints in (
        ("specs", ("name", "description"), ()),
        ("projects", ("name", "root"), ("channels",)),
        ("terminals", ("session",), ("windows", "panes", "attached")),
    ):
        for r in snap.get(key) or []:
            for k in strs:
                if r.get(k) is None:
                    r[k] = ""
            for k in ints:
                if r.get(k) is None:
                    r[k] = 0
    return snap


def body_height(height: int) -> int:
    """Rows between the header rule and bottom rule: cmd, header rule, bottom rule, hints+status are chrome."""
    return height - 1 - 1 - 1 - 2


def _seats(snap, colony=None, pod=None, flt="") -> list:
    out = []
    for s in snap.get("seats") or []:
        if colony and s.get("colony") != colony:
            continue
        if pod and s.get("pod") != pod:
            continue
        if (
            flt
            and flt.lower()
            not in " ".join(
                str(s.get(k) or "")
                for k in ("pod", "name", "runtime", "model", "state", "work", "now")
            ).lower()
        ):
            continue
        out.append(s)
    cs = _find_colony(snap, colony) if colony else None
    order = [p.get("id") for p in (cs or {}).get("pods") or []]
    # stable: group by pod in the colony's pod order so table rows and row selection agree
    return sorted(out, key=lambda s: order.index(s.get("pod")) if s.get("pod") in order else len(order)) if order else out


def _match(text: str, flt: str) -> bool:
    return not flt or flt.lower() in text.lower()


def _ts(ts) -> str:
    try:
        return time.strftime("%H:%M:%S", time.gmtime(float(ts)))
    except (TypeError, ValueError, OverflowError):
        return "--:--:--"


def _ev(e) -> str:
    return f"▪ [{e.get('kind') or 'note'}] {_ts(e.get('ts'))} {e.get('from')} → {e.get('to')}: {e.get('text') or ''}"


def _attention(s) -> bool:
    return s.get("state") in ("blocked", "dead")


def _cname(c) -> str:
    return str((c or {}).get("name") or (c or {}).get("id") or "")


def _cname_of(snap, cid) -> str:
    return _cname(_find_colony(snap, cid)) or str(cid)


def _slabel(s) -> str:
    """Seat label from the contract `address` (`label@colony`); the raw id before names land."""
    return str(s.get("address") or "").split("@")[0] or str(s.get("name"))


def _seat_of(snap, name):
    return next((x for x in snap.get("seats") or [] if x.get("name") == name), None)


def _seat_root(snap, name, root: str) -> str:
    """The seat's own project (realpath), not the watched root: `--all` spans projects."""
    p = str((_seat_of(snap, name) or {}).get("project") or "")
    return os.path.realpath(p) if p else root


def _stoppable(s) -> bool:
    """TUI side of the kill contract: a pane seat that is not the lead. In-process subagents (no pane) are out of reach."""
    return bool(s.get("target")) and not s.get("lead")


def _seat_buttons(s) -> str:
    # a lead reads the board itself (worker_inbox never drains tui->lead notes): no msg button
    b = "[ view ]" if s.get("lead") else "[ msg ] [ view ]"
    if s.get("target"):
        b += " [ term ]"
        if _stoppable(s):
            b += " [ stop ]"
    return b


def _context_seat(snap, ui):
    """The seat the current context acts on: the open seat, else the table row under the cursor."""
    if ui.get("seat"):
        return _seat_of(snap, ui["seat"])
    if ui["section"] == "topology" and ui.get("colony") and ui["tab"] == "table":
        seats = _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
        return seats[max(0, min(ui.get("row", 0), len(seats) - 1))] if seats else None
    return None


def _file_tail(path: str, n: int = 200) -> list:
    """Plain-text tail of a file: only the last 512 KiB is read, newest last."""
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 512 * 1024))
            return f.read().decode("utf-8", "replace").splitlines()[-n:]
    except OSError:
        return []


def _hints(snap, ui) -> str:
    """Footer: keyboard equivalents for the current context plus the clickable help/quit buttons."""
    s = _context_seat(snap, ui)
    if ui["section"] == "colony":
        base = "↑↓ move · ⏎ pick · tab region"
    elif ui.get("seat"):
        base = "m msg · v/enter view" + _seat_keys(s) + " · esc back"
    elif ui["section"] == "terminals":
        base = "↑↓ move · enter attach · x kill session"
    elif ui.get("colony") and ui["tab"] == "wall":
        base = "↑↓←→ tile · enter open seat · tab next tab · esc back"
    elif s:
        base = "↑↓ move · enter/v open · m msg" + _seat_keys(s) + " · esc back"
    else:
        base = "↑↓ move · ←→ pane · ⏎ open · : command · / filter"
    return base + " · [ ? help ]  [ q quit ]"


def _seat_keys(s) -> str:
    """`t term` / `x stop` only for seats that can use them (in-process subagents have no pane)."""
    return (" · t term" if (s or {}).get("target") else "") + (" · x stop" if _stoppable(s) else "")


# ---------------------------------------------------------------- explorer
def explorer_rows(snap, ui) -> list:
    """[(text, kind, key)] for the left tree; kind in section|colony|pod|seat|sub."""
    rows = []
    colonies = _colonies(snap)
    for sec in SECTIONS:
        rows.append((sec.upper(), "section", sec))
        if sec == "topology" and ui.get("section") == "topology":
            rows.append(("  ┗━ ⊕ " + str(snap.get("host") or "host"), "host", None))
            for i, c in enumerate(colonies):
                last = i == len(colonies) - 1
                rows.append(
                    (
                        "    " + ("┗━" if last else "┣━") + " ▦ " + _cname(c) + (" ✓ finished" if c.get("finished") else ""),
                        "colony",
                        c.get("id"),
                    )
                )
                pods = c.get("pods") or []
                for j, p in enumerate(pods):
                    n = len(
                        [
                            s
                            for s in snap.get("seats") or []
                            if s.get("colony") == c.get("id")
                            and s.get("pod") == p.get("id")
                        ]
                    ) or len(p.get("seats") or [])
                    stem = "      " if last else "    ┃ "
                    rows.append(
                        (
                            stem
                            + ("┗━" if j == len(pods) - 1 else "┣━")
                            + " › "
                            + str(p.get("id")),
                            "pod",
                            (c.get("id"), p.get("id")),
                            n,
                        )
                    )
                    pseats = [
                        s
                        for s in snap.get("seats") or []
                        if s.get("colony") == c.get("id")
                        and s.get("pod") == p.get("id")
                    ]
                    for k, s in enumerate(pseats):
                        q = _qlen(s)
                        rows.append(
                            (
                                stem
                                + "  "
                                + ("┗━" if k == len(pseats) - 1 else "┣━")
                                + " "
                                + DOT.get(s.get("state"), "?")
                                + " "
                                + _slabel(s)
                                + (f" ·{q}" if q else ""),
                                "seat",
                                s.get("name"),
                            )
                        )
        if sec == "feed" and ui.get("section") == "feed":
            for label, key in (
                ("Needs attention", "needs"),
                ("Updates", "updates"),
                ("Back", None),
            ):
                rows.append(("   " + label, "sub", key))
    return rows


def _explorer_top(rows, ui, h) -> int:
    cur = max(0, min(ui["cursor"], len(rows) - 1))
    return max(0, min(cur - h + 1, len(rows) - h)) if len(rows) > h else 0


def _explorer_lines(rows, ui, h, lw=LEFT) -> list:
    cur = max(0, min(ui["cursor"], len(rows) - 1))
    top = _explorer_top(rows, ui, h)
    out = []
    for i in range(top, min(len(rows), top + h)):
        r = rows[i]
        mark = "▶" if i == cur and ui.get("focus") == "explorer" else " "
        text = mark + (r[0][1:] if r[1] in ("host", "colony", "pod") else r[0])  # tree rows: the arrow takes col 0
        if len(r) > 3:
            text = _fit(text, lw - len(str(r[3]))) + str(r[3])
        out.append(_fit(text, lw))
    return out


# ---------------------------------------------------------------- right panes
def _tabbar(ui, snap) -> str:
    bar = "".join(
        f"[ {t.upper()} ]" if t == ui["tab"] else f"  {t.upper()}  " for t in TABS
    )
    tail = f"   colony {_cname_of(snap, ui['colony'])}"
    if ui["tab"] in ("table", "overview"):
        tail += "   [ msg all ] [ refresh ]"
    return bar + tail


def _compact_now(text: str, w: int) -> str:
    """`tool path/to/file.py:1-50` -> `tool file.py:1-50`; a still-too-long range row keeps its tail, which is what changes."""
    m = re.match(r"^(\S+)\s+(?:\S*/)?(\S+:\d+(?:-\d+)?)$", text)
    if m:
        text = f"{m.group(1)} {m.group(2)}"
    if len(text) > w and re.search(r":\d+(?:-\d+)?$", text):
        return "…" + text[-(w - 1) :] if w > 1 else text[-w:]
    return text


def _qlen(s) -> int:
    try:
        return int(s.get("queue") or 0)
    except (TypeError, ValueError):
        return 0


def _table(snap, ui, w) -> list:
    seats = _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
    allseats = _seats(snap, ui["colony"])
    wide = w >= 119  # narrower panes drop RT/MODEL/CTX/WORK so NOW keeps the room
    pw, sw, rw, mw, stw, ww = (8, 15, 4, 17, 13, 15) if wide else (6, 14, 0, 0, 7, 0)
    # POD/SEAT grow to the colony's longest labels (caps 22/26; SEAT carries a 2-col state dot); NOW pays for it below
    pw = max(pw, min(22, max((len(str(x.get("pod") or "")) for x in allseats), default=0)))
    sw = max(sw, min(26, max((len(_slabel(x)) + 2 for x in allseats), default=0)))
    cols = {"pw": pw, "sw": sw, "rw": rw, "mw": mw, "stw": stw, "ww": ww}

    def _row(s, nw, mark=" ", pod_prev=None):
        st = s.get("state") or "unknown"
        dotseat = _fit(DOT.get(st, "?") + " " + _slabel(s), cols["sw"])
        pcell = _fit(str(s.get("pod") or "") if s.get("pod") != pod_prev else "", cols["pw"])
        now = _fit(_compact_now(str(s.get("now") or "—"), nw), nw)
        act = _seat_buttons(s)
        if wide:
            return (
                f"{pcell}{mark}{dotseat} {_fit(RT.get(s.get('runtime'), '?'), cols['rw'])} {_fit(str(s.get('model') or '—'), cols['mw'])} {'—':<3} "
                f"{_fit(st, cols['stw'])} {_qlen(s) or '·'} {_fit(str(s.get('work') or '—'), cols['ww'])} {now} {act}"
            )
        return f"{pcell}{mark}{dotseat} {_fit(st, cols['stw'])} {_qlen(s) or '·'} {now} {act}"

    # NOW gets what the widest row leaves once the full ACTIONS cell fits; the roomy
    # MODEL/WORK/STATE columns yield down to their content first (floor 8 for NOW).
    if seats:
        over = max(len(_row(s, 8)) for s in seats) - w
        mins = {
            "mw": max(5, max((len(str(x.get("model") or "—")) for x in allseats), default=5) + 2),
            "ww": max(4, max((len(str(x.get("work") or "—")) for x in allseats), default=4) + 2),
            "stw": max(5, max((len(str(x.get("state") or "unknown")) for x in allseats), default=5) + 2),
        }
        for name in ("mw", "ww", "stw"):
            if over <= 0:
                break
            cut = min(over, max(0, cols[name] - mins[name]))
            cols[name] -= cut
            over -= cut
    nw = max(8, w - max((len(_row(s, 0)) for s in seats), default=20)) if seats else 20
    hdr = (
        f"{'POD':<{cols['pw']}} {'SEAT':<{cols['sw']}} {'RT':<{cols['rw']}} {'MODEL':<{cols['mw']}} {'CTX':<3} {'STATE':<{cols['stw']}} {'Q':<1} {'WORK':<{cols['ww']}} {'NOW':<{nw}} ACTIONS"
        if wide
        else f"{'POD':<{cols['pw']}} {'SEAT':<{cols['sw']}} {'STATE':<{cols['stw']}} {'Q':<1} {'NOW':<{nw}} ACTIONS"
    )
    bad = [s for s in allseats if _attention(s)]
    tm = (snap.get("system") or {}).get("tmux") or {}
    if not allseats:
        health = "EMPTY FOR COLONY · no seats served; not a healthy verdict"
    elif bad:
        health = "ATTENTION · " + ", ".join(f"{s['name']} {s.get('state')}" for s in bad)
    else:
        panes = any(s.get("target") for s in allseats)
        where = f"tmux {'ok' if tm.get('ok') else 'DOWN'}" if panes else "in-process subagents (no panes)"
        health = f"OK · {len(allseats)} seats reporting · {where}"
    if (_find_colony(snap, ui["colony"]) or {}).get("finished"):
        health = "✓ finished · " + health
    flt = ui.get("filter", "")
    out = [
        "  ▪ CONFIG · colony settings  (open ▸)",
        f"HEALTH  {health}",
        f"/ {flt}" if flt else "/ filter agents…",
        hdr,
        "━" * w,
    ]
    sel = max(0, min(ui.get("row", 0), len(seats) - 1))
    prev = None
    for i, s in enumerate(seats):
        pod = str(s.get("pod") or "")
        if prev is not None and pod != prev:
            out.append("┈" * w)
        mark = "▶" if i == sel and ui.get("focus") == "pane" else " "
        out.append(_row(s, nw, mark, prev))
        prev = pod
    if not seats:
        out.append("no seats match")
    working = sum(1 for s in allseats if s.get("state") == "working")
    q = sum(_qlen(s) for s in allseats)
    out.append(f"{len(allseats)} seats · {working} working · {len(bad)} need attention · {q} open rows")
    return out + _recent_block(snap, ui, w, 5)


def _recent_block(snap, ui, w, n=None) -> list:
    c = _find_colony(snap, ui["colony"]) or {}
    ch = c.get("channel")
    ev = [e for e in snap.get("feed") or [] if not ch or e.get("channel") == ch]
    ev = [e for e in ev if _match(_ev(e), ui.get("filter", ""))]
    ev = ev[-n:] if n else ev
    out = [
        ("  ── RECENT · colony " + (_cname(c) or str(ui["colony"])) + " ").ljust(w, "─"),
        "  Recorded board notes · oldest to newest · Enter inspects",
    ]
    for e in ev:
        try:
            when = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(float(e.get("ts"))))
        except (TypeError, ValueError, OverflowError):
            when = "—"
        out += [
            f"  ▪ {when} · #{e.get('seq') or '?'}  (open ▸)",
            f"    {e.get('from')} → {e.get('to')} · {e.get('kind') or 'note'}",
            f"    {' '.join(str(e.get('text') or '').split())}",
        ]
    return out + ([] if ev else ["  No current items."])


def _overview(snap, ui) -> list:
    c = _find_colony(snap, ui["colony"]) or {}
    seats = _seats(snap, ui["colony"])
    out = [
        f"OVERVIEW · {c.get('label') or _cname(c) or ui['colony']}",
        f"  task       {c.get('task') or '—'}",
        f"  session    {c.get('session') or '—'} ({c.get('transport') or '?'})",
        f"  channel    {c.get('channel') or '—'}",
    ]
    src = c.get("source")
    if src:
        out.append(
            f"  from {src.get('harness') or '?'} session {src.get('session') or '—'}"
            f" · lead {src.get('lead') or '—'} · project {src.get('project') or '—'}"
        )
    out += [
        "",
    ]
    for state in ("working", "idle", "blocked", "finished", "dead", "unknown"):
        n = sum(1 for s in seats if (s.get("state") or "unknown") == state)
        if n:
            out.append(f"  {DOT.get(state, '?')} {state:<9}{n}")
    out.append("")
    for p in c.get("pods") or []:
        out.append(f"  › {p.get('id')}: {', '.join(p.get('seats') or []) or '—'}")
    return out


def _graph(snap, ui, w) -> list:
    c = _find_colony(snap, ui["colony"]) or {}
    seats = _seats(snap, ui["colony"], flt=ui.get("filter", ""))
    pods = []
    for p in c.get("pods") or []:
        ps = [s for s in seats if s.get("pod") == p.get("id")]
        if ps or not ui.get("filter"):
            pods.append((p.get("id"), ps))
    cols = []
    for pid, ps in pods:
        cells = []
        for s in ps:
            l1 = f"{DOT.get(s.get('state'), '?')} {_slabel(s)}"
            l2 = f"{RT_GLYPH.get(s.get('runtime'), '??')} —"
            bw = max(len(l1), len(l2)) + 2
            cells.append(
                (
                    bw,
                    [
                        "┌" + "─" * bw + "┐",
                        "│" + (" " + l1).ljust(bw) + "│",
                        "│" + (" " + l2).ljust(bw) + "│",
                        "└" + "─" * bw + "┘",
                    ],
                )
            )
        iw = max([len(f"≡ {pid} ") + 3] + [b + 4 for b, _ in cells])
        box = ["┌ ≡ " + str(pid) + " " + "─" * (iw - len(str(pid)) - 4) + "┐"]
        for i, (_bw, lines) in enumerate(cells):
            if i:
                box.append("│" + "▾".center(iw) + "│")
            box += ["│" + (" " + ln).ljust(iw) + "│" for ln in lines]
        box.append("└" + "─" * iw + "┘")
        cols.append(box)
    inner = w - 4
    groups, cur, curw = [], [], 0
    for b in cols:
        bw = len(b[0])
        if cur and curw + 4 + bw > inner:
            groups.append(cur)
            cur, curw = [], 0
        cur.append(b)
        curw += bw + (4 if len(cur) > 1 else 0)
    if cur:
        groups.append(cur)
    body = []
    for g in groups:
        h = max(len(b) for b in g)
        for i in range(h):
            row = ""
            for k, b in enumerate(g):
                a = b[i] if i < len(b) else " " * len(b[0])
                nxt = g[k + 1] if k + 1 < len(g) else None
                edge = i == 2 and nxt and b[1][1:3] == " ┌" and nxt[1][1:3] == " ┌"
                if edge:  # pod → next pod: the first seat's row carries the edge `──▸`
                    pad = len(a) - len(a[:-1].rstrip())
                    a = a[: len(a) - 1 - pad] + "─" * pad + "┼"
                if i == 2 and k and g[k - 1][1][1:3] == " ┌" and b[1][1:3] == " ┌":
                    a = "┼▸" + a[2:]
                row += a + ("────" if edge else "    " if nxt else "")
            body.append(row)
        body.append("")
    title = f"╔═ ▦ COLONY {_cname_of(snap, ui['colony'])} "
    width = max([len(title) + 2, 20] + [len(x) + 4 for x in body])
    out = [title + "═" * (width - len(title) - 1) + "╗"]
    out += ["║ " + x.ljust(width - 3) + "║" for x in body] or [
        "║" + " " * (width - 2) + "║"
    ]
    out.append("╚" + "═" * (width - 2) + "╝")
    return out


def _health(snap, colony=None) -> list:
    sy = snap.get("system") or {}
    seats = _seats(snap, colony)
    bad = [s for s in seats if _attention(s)]
    def ok(b):
        return "ok" if b else "DOWN"
    tm = sy.get("tmux") or {}
    out = [
        f"HEALTH  {'DEGRADED' if bad or not tm.get('ok') else 'OK'} · {len(bad)} seat(s) need attention",
        "",
        f"  tmux       {ok(tm.get('ok'))} {tm.get('version') or ''}",
        f"  dashboard  {ok((sy.get('dashboard') or {}).get('ok'))} {(sy.get('dashboard') or {}).get('url') or ''}",
        f"  herdr      {ok((sy.get('herdr') or {}).get('ok'))}",
        f"  rig        {ok((sy.get('rig') or {}).get('ok'))}",
    ]
    for k, v in (sy.get("harnesses") or {}).items():
        out.append(f"  {k:<10} {'installed' if v else 'missing'}")
    for s in bad:
        out.append(f"  ! {s.get('name')} {s.get('state')} {s.get('now') or ''}")
    return out


def _utc(ts) -> str:
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(float(ts)))
    except (TypeError, ValueError, OverflowError):
        return "—"


def _queue_counts(s) -> dict:
    counts = {"pending": 0, "in_progress": 0, "blocked": 0}
    for i in s.get("open_items") or []:
        st = str(i.get("status") or "")
        counts[st] = counts.get(st, 0) + 1
    return counts


def _needs_you(snap, s) -> list:
    """Blocked notes / notes to human from this seat, plus blocked notes addressed to it."""
    name = s.get("name")
    return [
        e
        for e in snap.get("needs") or []
        if e.get("from") == name or (e.get("to") == name and e.get("kind") == "blocked")
    ]


def _seat_feed(snap, s) -> list:
    name = s.get("name")
    return [
        e
        for e in snap.get("feed") or []
        if e.get("from") == name or e.get("to") == name
    ]


def _seat_view(snap, ui, h) -> list:
    s = _seat_of(snap, ui["seat"])
    if not s:
        return [f"SEAT {ui['seat']} · not found"]
    btns = _seat_buttons(s) + " [ back ]"
    qc = _queue_counts(s)
    items = s.get("open_items") or []
    needs = _needs_you(snap, s)
    comm = _seat_feed(snap, s)
    term = (
        f"term ▸ {s.get('pod')} ({s.get('target')} [ term ])"
        if s.get("target")
        else "in-process"
    )
    head = [
        f"SEAT {_slabel(s)} · {s.get('runtime')} · {DOT.get(s.get('state'), '?')} {s.get('state')}"
        + (f" · {s['role_title']}" if s.get("role_title") else ""),
        "  " + btns,
        "",
    ]
    work_lines = [
        f"  #{i.get('id')} {i.get('title')} · {i.get('status')}" for i in items
    ] or ["  nothing open"]
    body = [
        "CONTEXT",
        f"  runtime {RT_LONG.get(s.get('runtime'), s.get('runtime') or '?')} · model {s.get('model') or '—'}",
        f"  terminal {term}" + (" · t = attach" if s.get("target") else ""),
        "CURRENT ACTIVITY",
        f"  {s.get('state')} · {s.get('now') or '—'} · active {_utc(s.get('last_active'))}",
        f"CURRENT WORK · {len(items)}",
        *work_lines,
        "QUEUE",
        f"  pending {qc.get('pending', 0)} · in progress {qc.get('in_progress', 0)} · blocked {qc.get('blocked', 0)} · open {s.get('queue', 0) or 0}",
        f"NEEDS YOU · {len(needs)}",
        *(  # a blocked/human note ends up in snap['needs'], never in the feed window
            [f"  {_ev(e)}" for e in needs[-5:]] or ["  nothing needs you"]
        ),
        "SEAT",
        f"  host {snap.get('host') or '—'} · colony {_cname_of(snap, s.get('colony'))} · pod {s.get('pod')} · address {s.get('address') or s.get('name')}",
        f"COMMUNICATION · {len(comm)}",
        *(["  " + _ev(e) for e in comm[-8:]] or ["  no messages on the board yet"]),
        "OUTPUT",
    ] + (_seat_lines(snap, s, ui) or ["  (no output)"])
    room = max(1, h - len(head) - 1)
    off = max(0, min(ui.get("seat_scroll", 0), max(0, len(body) - room)))
    shown = body[off : off + room]
    return head + shown


def _seat_lines(snap, s, ui) -> list:
    """Pane capture first; then the transcript tail (contract: refreshed with the snapshot); then the log; then board notes."""
    if s.get("target"):
        txt = ui.get("seat_text") or ""
        return [
            ANSI.sub("", ln).rstrip()
            for ln in (txt.splitlines() if isinstance(txt, str) else txt)
        ]
    name = str(s.get("name"))
    if s.get("transcript"):
        tail = _model().transcript_tail(s["transcript"], 200)
        if tail:
            return [ANSI.sub("", str(ln)).rstrip() for ln in tail]
        return ["  (no transcript activity yet)"]
    if s.get("log_path"):
        tail = _file_tail(str(s["log_path"]))
        if tail:
            return [ANSI.sub("", ln).rstrip() for ln in tail]
        return [f"  log is empty or unreadable: {s['log_path']}"]
    ev = [
        e for e in snap.get("feed") or [] if e.get("from") == name or e.get("to") == name
    ]
    if ev:
        return [_ev(e) for e in ev]
    return ["  no messages on the board yet"]


# ---------------------------------------------------------------- wall
def _rt_label(rt) -> str:
    return RT_LONG.get(rt, str(rt or "?"))


def _wall_seats(snap, ui) -> list:
    return sorted(
        _seats(snap, ui.get("colony"), flt=ui.get("filter", "")),
        key=lambda s: not s.get("lead"),
    )


def refresh_wall(snap, ui, model=None) -> None:
    """Fill ui['wall_text'] for the colony's wall: one pane capture / transcript read per
    seat, run at snapshot cadence only (the loop calls this when a new snapshot lands)."""
    if not ui.get("colony"):
        return
    m = model or _model()
    wt = ui.setdefault("wall_text", {})
    for s in _wall_seats(snap, ui):
        if s.get("target"):
            wt[s["name"]] = m.capture(s["target"], 12, ansi=False)
        elif s.get("transcript"):
            wt[s["name"]] = "\n".join(m.transcript_tail(s["transcript"], WALL_BODY))


def _wall_body(snap, ui, s, n) -> list:
    txt = (ui.get("wall_text") or {}).get(s.get("name"))
    lines = (
        [ANSI.sub("", str(ln)).rstrip() for ln in str(txt).splitlines()] if txt else []
    )
    return lines[-n:] or [str(s.get("now") or "—")]


def _wall_tile(snap, ui, s, tw, sel) -> list:
    addr = s.get("address") or f"{_slabel(s)}@{_cname_of(snap, s.get('colony'))}"
    title = ("▶ " if sel else "  ") + f"{_rt_label(s.get('runtime'))} {addr} ↗"
    return [title[:tw].ljust(tw)] + [_fit(ln, tw) for ln in _wall_body(snap, ui, s, WALL_BODY)]


def _wall_layout(snap, ui, w) -> tuple[list, list]:
    """(lines, tiles): tiles = [(line_index, x0, x1, seat)] mirroring the rendered grid."""
    seats = _wall_seats(snap, ui)
    cols = 2 if w >= 70 else 1
    gut = 2
    tw = max(10, (w - gut * (cols - 1)) // cols)
    sel = max(0, min(ui.get("row", 0), len(seats) - 1)) if seats else 0
    lines, tiles = [], []
    for g in range(0, len(seats), cols):
        group = seats[g : g + cols]
        tl = [_wall_tile(snap, ui, s, tw, g + k == sel) for k, s in enumerate(group)]
        base = len(lines)
        for r in range(max(len(t) for t in tl)):
            line = ""
            for k, t in enumerate(tl):
                line += (t[r] if r < len(t) else " " * tw) + (" " * gut if k < cols - 1 else "")
            lines.append(line)
        for k, s in enumerate(group):
            tiles.append((base, k * (tw + gut), k * (tw + gut) + tw, g + k, s))
    return lines, tiles


def _wall(snap, ui, w) -> list:
    lines, _tiles = _wall_layout(snap, ui, w)
    n = len(_seats(snap, ui.get("colony"), flt=ui.get("filter", "")))
    return lines + ["", f"{n} agents in {_cname_of(snap, ui['colony'])}"]


def _list_view(snap, ui, h) -> list:
    sec, flt = ui["section"], ui.get("filter", "")
    out = []
    if sec == "specs":
        out = ["SPECS · agents and teams", ""]
        for sp in snap.get("specs") or []:
            line = (
                f"  agent  {sp.get('name'):<18} {sp.get('description') or ''}"
                if sp.get("kind") == "agent"
                else f"  team   {sp.get('name'):<18} efforts: {', '.join(sp.get('efforts') or [])}"
            )
            if _match(line, flt):
                out.append(line)
        if not flt and len(out) == 2:
            out += [
                "",
                f"no agent specs found under {_model().PLUGIN_DIR / 'agents'}",
                "— this TUI process may be from a removed install; relaunch it",
            ]
    elif sec == "projects":
        out = ["PROJECTS", ""]
        out += [
            ln
            for ln in (
                f"  {p.get('name'):<24} {p.get('channels')} channels  {p.get('root')}"
                for p in snap.get("projects") or []
            )
            if _match(ln, flt)
        ]
    elif sec == "terminals":
        out = [
            "TERMINALS · atlas tmux sessions",
            "",
            f"  {'SESSION':<28} WIN PANE ATT SEATS",
        ]
        sess_seats: dict = {}
        for s in snap.get("seats") or []:
            if not s.get("target"):
                continue
            c = _find_colony(snap, s.get("colony")) or {}
            if c.get("session"):
                sess_seats.setdefault(c["session"], []).append(_slabel(s))
        for t in snap.get("terminals") or []:
            names = sess_seats.get(t.get("session")) or []
            n = len(names) or len(
                [c for c in _colonies(snap) if c.get("session") == t.get("session")]
            )
            line = f"  {t.get('session'):<28} {t.get('windows'):>3} {t.get('panes'):>4} {t.get('attached'):>3} {n}  {', '.join(names)}"
            if _match(line, flt):
                out.append(line)
    elif sec == "feed":
        sub = ui.get("sub")
        out = ["FEED · all channels", ""]
        if sub in (None, "needs"):
            out.append("Needs attention")
            lines = [
                f"  {_ev(e)}" for e in snap.get("needs") or [] if _match(_ev(e), flt)
            ]
            out += lines or ["  No current items."]
            out.append("")
        if sub in (None, "updates"):
            out.append("Updates")
            lines = [
                f"  {_ev(e)}"
                for e in reversed(snap.get("feed") or [])
                if _match(_ev(e), flt)
            ]
            out += lines or ["  No current items in the available source window."]
        out += ["", f"Read at {_clock(snap)}"]
    elif sec == "system":
        out = ["System · Instance health", ""] + _health(snap)
    else:
        n = len(_colonies(snap))
        out = [
            f"TOPOLOGY · {snap.get('host')}",
            "Choose a colony to read its seats and work.",
        ]
        if snap.get("loading"):
            out.append("loading colonies…")
        elif n == 0:
            out += [
                f"no colonies · watching {snap.get('project') or '?'}",
                "Colonies appear when a session in this project dispatches subagents (omp `task`, Claude `Agent`) or `atlas_mux spawn-team`.",
                "`a` toggles all projects · Enter/click a PROJECTS row to switch the watched project.",
            ]
        else:
            out.append(f"{n} colonies · select one in Explorer")
        out.append("Bright ▦ live agents · gray ▦ none · ? unknown")
    return out


def _snap_error(snap) -> list:
    """Full right-pane report for a failed colony snapshot, with the exact diagnose command."""
    detail = str(snap.get("error") or "").splitlines() or ["(no detail)"]
    return [
        "SNAPSHOT ERROR",
        "",
        *detail,
        "",
        "Diagnose:",
        f"  python3 {HERE / 'atlas_colony_model.py'} --root {snap.get('root')}",
    ]


def right_lines(snap, ui, w, h) -> list:
    if snap.get("error"):
        return _snap_error(snap)
    if ui.get("seat"):
        return _seat_view(snap, ui, h)
    if ui["section"] == "topology" and ui.get("colony"):
        t = ui["tab"] if ui["tab"] in TABS else "table"  # unknown tab falls back to the default view
        body = {
            "table": lambda: _table(snap, ui, w),
            "wall": lambda: _wall(snap, ui, w),
            "recent": lambda: _recent_block(snap, ui, w),
            "overview": lambda: _overview(snap, ui),
            "graph": lambda: _graph(snap, ui, w),
            "health": lambda: _health(snap, ui["colony"]),
        }[t]()
        return [_tabbar(ui, snap)] + ([] if t in ("table", "recent") else [""]) + body
    return _list_view(snap, ui, h)


# ---------------------------------------------------------------- frame
def _title(snap, ui) -> str:
    if ui["section"] == "colony":
        return "colony"
    if ui.get("seat"):
        return "SEAT · " + str(ui["seat"])
    if ui["section"] == "system":
        return "SYSTEM · HEALTH"
    return ui["section"].upper()


def _help_lines(ui) -> list:
    cmds = (
        [c for c in COMMANDS if ui["buf"].split(" ")[0] in c[0]]
        if ui["buf"]
        else COMMANDS
    )
    sel = max(0, min(ui.get("help_sel", 0), len(cmds) - 1))
    out = [
        "HELP · Atlas Colony workspace, command bar & CLI",
        "At cmd ▸ type then Enter; Tab completes. <arg> required, [arg] optional.",
        "CLI in your terminal: atlas_tui.py --once · --view <section> · --seat <name> · --launch",
    ]
    for mode, title in (("colony", "Colony workspace"), ("steer", "STEER typing"), ("shared", "Everywhere"), ("explorer", "Other sections")):
        line = f"{title}:"
        for _k, _a, h in KEYMAP[mode]:  # pack whole entries per line; never split one
            if len(line) + len(h) + 3 > 118:
                out.append(line)
                line = "  "
            line += (" | " if line.strip().endswith(":") is False and line != "  " else " ") + h
        out.append(line)
    out.append("")
    for i, (c, d) in enumerate(cmds):
        out.append(("› " if i == sel else "  ") + f"{c:<44} {d}")
    return out


# ---------------------------------------------------------------- colony workspace
def _age(sec) -> str:
    sec = int(sec)
    return f"{sec}s" if sec < 60 else f"{sec // 60}m" if sec < 3600 else f"{sec // 3600}h" if sec < 86400 else f"{sec // 86400}d"


def _colony_age(c) -> str:
    """colony.age_s (S2) when present, else derived from an epoch `created`; empty when neither is meaningful."""
    if c.get("age_s") is not None:
        return _age(max(0, c["age_s"]))
    cr = c.get("created")
    return _age(max(0, time.time() - cr)) if isinstance(cr, (int, float)) and cr > 1e9 else ""


def _cstate(snap, c) -> str:
    ss = [s for s in snap.get("seats") or [] if s.get("colony") == c.get("id")]
    if c.get("finished"):
        return "done"
    if any(_attention(s) for s in ss):
        return "attn"
    return "work" if any(s.get("state") == "working" for s in ss) else "idle" if ss else "empty"


SEAT_CAP = 30  # seats listed per colony in SESSIONS; the rest fold into a "+N more" row


def sessions_rows(snap) -> list:
    """[(text, kind, key)] for SESSIONS: colony rows, their seats (lead first), then atlas-* terminals with no colony."""
    rows, seats = [], snap.get("seats") or []
    for c in _colonies(snap):
        mine = sorted((s for s in seats if s.get("colony") == c.get("id")), key=lambda s: not s.get("lead"))
        n = c.get("seat_count") if c.get("seat_count") is not None else len(mine)
        age = _colony_age(c)
        tr = "in-proc" if c.get("transport") == "in-process" else c.get("transport") or "?"
        rows.append((f"{_cname(c)} {tr} {n}s{' ' + age if age else ''} {_cstate(snap, c)}", "colony", c.get("id")))
        if len(mine) > SEAT_CAP:  # lead first, then the most recently active; the rest fold into one row
            keep = mine[:1] + sorted(mine[1:], key=lambda s: -(s.get("last_active") or 0))[: SEAT_CAP - 1]
            hidden, mine = len(mine) - len(keep), [s for s in mine if s in keep]
        else:
            hidden = 0
        for s in mine:
            rows.append((f"  {DOT.get(s.get('state'), '?')} {_slabel(s)} {s.get('state')}{' held' if s.get('held') else ''}", "seat", s.get("name")))
        if hidden:
            rows.append((f"  +{hidden} more", "colony", c.get("id")))
    owned = {c.get("session") for c in _colonies(snap)}
    for t in snap.get("terminals") or []:
        if str(t.get("session")).startswith("atlas-") and t.get("session") not in owned:
            rows.append((f"term {t.get('session')} {t.get('windows', 0)}win", "orphan", t.get("session")))
    return rows


def _srow(snap, ui, rows=None) -> int:
    n = len(rows if rows is not None else sessions_rows(snap))
    return max(0, min(ui.get("srow", 0), n - 1))


def _colony_ctx(snap, ui):
    """(colony id, selected seat or None, STEER target label): the lead of the colony when no seat is picked."""
    cs = _colonies(snap)
    cid = ui.get("colony") or (cs[0].get("id") if cs else None)
    s = _seat_of(snap, ui["seat"]) if ui.get("seat") else None
    if s:
        return s.get("colony") or cid, s, str(s["name"])
    lead = next((x for x in snap.get("seats") or [] if x.get("colony") == cid and x.get("lead")), None)
    return cid, None, str((lead or {}).get("name") or "lead")


def _colony_pick(snap, ui):
    """Enter/click on the selected SESSIONS row: colony -> CHANNEL, seat -> PEEK/STEER, orphan terminal -> attach."""
    rows = sessions_rows(snap)
    if not rows:
        return None
    _t, kind, key = rows[_srow(snap, ui, rows)]
    if kind == "colony":
        ui.update(colony=key, seat=None)
    elif kind == "seat":
        _open_seat(snap, ui, key)
        ui["colony"] = (_seat_of(snap, key) or {}).get("colony")
    else:
        return ("attach", key)
    return None


def _hold_effect(snap, ui, name=None):
    """('hold'|'release', seat, colony) for the named (else selected) seat; None plus a status when there is none."""
    s = _seat_of(snap, name or ui.get("seat")) if (name or ui.get("seat")) else None
    if not s:
        ui["status"] = "no seat selected"
        return None
    return ("release" if s.get("held") else "hold", s["name"], s.get("colony") or ui.get("colony"))


def _k_focus(snap, ui, key):
    ui["region"] = REGIONS[int(key) - 1]


def _k_cycle(snap, ui, key):
    reg = ui.get("region", "sessions")
    ui["region"] = REGIONS[(REGIONS.index(reg) + 1) % len(REGIONS)] if reg in REGIONS else REGIONS[0]


def _k_move(snap, ui, key):
    reg = ui.get("region", "sessions")
    n = len(sessions_rows(snap))
    if reg == "channel":  # newest at the bottom: pgup scrolls toward older, pgdn back toward the tail
        ui["chat_scroll"] = max(0, int(ui.get("chat_scroll") or 0) + (8 if key in ("up", "pgup") else -8))
    elif reg == "sessions" and n:
        d = -1 if key in ("up", "pgup") else 1
        cur = _srow(snap, ui)
        ui["srow"] = (cur + d) % n if key in ("up", "down") else max(0, min(cur + d * 10, n - 1))


def _k_pick(snap, ui, key):
    return _colony_pick(snap, ui) if ui.get("region", "sessions") == "sessions" else None


def _k_jump(snap, ui, key):
    if ui.get("region", "sessions") == "channel":
        ui["chat_scroll"] = 10**9 if key == "home" else 0  # clamped to the oldest row at render


def _k_steer(snap, ui, key):
    ui.update(mode="steer", region="steer", steer_text={"b": "@all ", "l": "@lead "}.get(key, ""))


def _k_filter(snap, ui, key):
    s = ui.get("seat")
    ui["chat_filter"] = None if ui.get("chat_filter") or not s else s
    ui["chat_scroll"] = 0


def _k_view(snap, ui, key):
    s = _seat_of(snap, ui["seat"]) if ui.get("seat") else None
    if not s:
        ui["status"] = "no seat selected"
    else:
        _open_colony(snap, ui, s["colony"])
        _open_seat(snap, ui, s["name"])


_COLONY_ACT = {
    "focus": _k_focus, "cycle": _k_cycle, "move": _k_move, "pick": _k_pick, "jump": _k_jump,
    "steer": _k_steer, "steer_all": _k_steer, "steer_lead": _k_steer,
    "hold": lambda snap, ui, key: _hold_effect(snap, ui), "filter": _k_filter, "view": _k_view,
    "noop": lambda snap, ui, key: None,
}


def _colony_key(snap, ui, key):
    """Colony-section keys from KEYMAP['colony']; NotImplemented lets handle_key's shared keys (t x q ? : / esc r a) run."""
    act = _KEY_ACT["colony"].get(key)
    return NotImplemented if act is None else _COLONY_ACT[act](snap, ui, key)


def _rtitle(ui, region, label, w) -> str:
    return ("━ " + ("{ " + label + " }" if ui.get("region") == region else label) + " " + "━" * w)[:w]


def _chat_rows(snap, ui, cid) -> list:
    """Selected colony's channel rows (seq order), narrowed by ui['chat_filter'] (a seat name; broadcasts always pass)."""
    c = _find_colony(snap, cid) or {}
    rows = sorted((snap.get("chat") or {}).get(c.get("channel")) or [], key=lambda r: r.get("seq") or 0)
    f = ui.get("chat_filter")
    if f:
        rows = [r for r in rows if f in (r.get("from"), r.get("to")) or r.get("to") == "all"]
    return rows


def chat_lines(snap, ui, width, height) -> list:
    """IRC view: `HH:MM from > to  text [kind]`, newest last; NEEDS strip first; scrolled up keeps the viewport."""
    cid = _colony_ctx(snap, ui)[0]
    rows = _chat_rows(snap, ui, cid)
    needs = snap.get("needs") or []
    out = []
    if needs:
        out.append(f"NEEDS {len(needs)}: " + ", ".join(f"{x.get('from')} {x.get('kind')}" for x in needs))
    avail = max(0, height - len(out))
    scroll = max(0, min(int(ui.get("chat_scroll") or 0), max(0, len(rows) - avail)))
    ui["chat_scroll"] = scroll
    if not scroll:  # following the tail: remember what the user has seen
        ui["chat_seq"] = rows[-1].get("seq") or 0 if rows else 0
    end = len(rows) - scroll
    for r in rows[max(0, end - avail):end]:
        who = str(r.get("from"))
        tag = " (lead)" if r.get("lead") else " (you)" if who == "tui" else ""
        out.append(f"{time.strftime('%H:%M', time.gmtime(r.get('ts') or 0))} {who}{tag} > {r.get('to')}  {r.get('text')} [{r.get('kind')}]")
    return [_fit(x, width) for x in out[:height]]


def _chat_title(snap, ui, cid) -> str:
    new = 0
    if ui.get("chat_scroll"):
        new = sum(1 for r in _chat_rows(snap, ui, cid) if (r.get("seq") or 0) > (ui.get("chat_seq") or 0))
    return f"CHANNEL {_cname_of(snap, cid) if cid else '-'} ({ui.get('chat_filter') or 'all'})" + (f" {new} new" if new else "")


def _channel_lines(snap, ui, n, w) -> list:
    return chat_lines(snap, ui, w, n)


def _peek_lines(ui, n, seat=None) -> list:
    if seat and not seat.get("target") and not ui.get("seat_text"):
        return ["no pane (in-process subagent)"][:n]
    txt = [x for x in ANSI.sub("", str(ui.get("seat_text") or "")).splitlines() if x.strip()]
    return (txt[-n:] if txt else ["(no capture yet)"])[:n]


def _steer_title(seat, tgt) -> str:
    return f"STEER -> {tgt}" + (" (held)" if (seat or {}).get("held") else "")


def _steer_lines(snap, ui, n, seat, tgt) -> list:
    txt = str(ui.get("steer_text") or "")
    cur = "_" if ui.get("mode") == "steer" else ""
    hold = " [ " + ("release" if seat.get("held") else "hold") + " ]" if seat and not seat.get("lead") else ""
    btn = (_seat_buttons(seat) + hold if seat else "[ msg all ]") + " [ @all ] [ @lead ]"
    return [f"say to {tgt} > {txt}{cur}", btn][:n]


def colony_body(snap, ui, width, bodyh):
    """(header, body lines each `width` wide, hits with absolute rows). One builder feeds render() and hitmap()."""
    cid, seat, tgt = _colony_ctx(snap, ui)
    rows = sessions_rows(snap)
    sel = _srow(snap, ui, rows)
    hits, body = [], []
    ncol, nseat = len(_colonies(snap)), len(snap.get("seats") or [])
    if snap.get("error"):
        return "━ ATLAS COLONY ━", [_fit(x, width) for x in (_snap_error(snap) + [""] * bodyh)[:bodyh]], hits

    def sess(n, w, x0, r0):
        top = max(0, min(sel - n + 1, len(rows) - n)) if len(rows) > n else 0
        out = []
        for k in range(n):
            i = top + k
            if i < len(rows):
                out.append(_fit(("> " if i == sel else "  ") + rows[i][0], w))
                hits.append((2 + r0 + k, x0, x0 + w, ("srow", i)))
            else:
                out.append(" " * w)
        return out

    def btns(text, r, x0, w):
        for bm in BTNS.finditer(_fit(text, w)):
            hits.append((2 + r, x0 + bm.start(), x0 + bm.start() + len(bm.group(0)), ("button", bm.group(1), (seat or {}).get("name"))))

    def block(region, label, content, r0, w, x0):
        """Title row plus content; the title is a click target that focuses the region."""
        hits.append((2 + r0, x0, x0 + w, ("region", region)))
        return [_rtitle(ui, region, label, w)] + [_fit(x, w) for x in content]

    if width >= COMPACT_W:
        rw = width - CLW - 1
        cw = rw - 1
        steer_h = 3 if bodyh >= 8 else 2
        peek_h = min(9, bodyh // 3) if bodyh >= 14 else 0
        chan_h = bodyh - steer_h - peek_h
        left = sess(bodyh, CLW, 0, 0)
        x0 = CLW + 2
        cl = _channel_lines(snap, ui, chan_h - 1, cw)
        right = block("channel", _chat_title(snap, ui, cid), cl, 0, cw, x0)
        hits += [(2 + k, x0, x0 + cw, ("chan",)) for k in range(1, len(cl) + 1)]  # wheel/click target: the CHANNEL body
        if peek_h:
            right += [_rtitle(ui, "peek", f"PEEK {seat['name'] if seat else '-'} (t attach . v view)", cw)] + [_fit(x, cw) for x in _peek_lines(ui, peek_h - 1, seat)]
        sl = _steer_lines(snap, ui, steer_h - 1, seat, tgt)
        right += block("steer", _steer_title(seat, tgt), sl, len(right), cw, x0)
        if len(sl) > 1:
            btns(sl[1], len(right) - 1, x0, cw)
        right += [""] * (bodyh - len(right))
        body = [left[i] + "┃" + " " + _fit(right[i], cw) for i in range(bodyh)]
        hits.append((1, 0, CLW, ("region", "sessions")))
        head = ("━ " + ("{ SESSIONS }" if ui.get("region") == "sessions" else "SESSIONS") + " " + "━" * CLW)[:CLW] + "╋" + (
            f"━ ATLAS COLONY . {snap.get('host') or 'atlas'} . {ncol} colonies {nseat} seats " + "━" * width)[:rw]
        return head, body, hits
    foc = ui.get("region") if ui.get("region") in REGIONS else "sessions"
    # Degrade order (small to large): PEEK goes first, then the focused region shrinks toward 2 rows; an unfocused
    # CHANNEL keeps 4 (title, NEEDS strip, 2 newest chat rows), a focused one gets 7 (title + 6).
    sizes = {r: 2 for r in REGIONS}
    sizes["channel"] = 4
    sizes[foc] = 7 if foc == "channel" else 6
    spare = bodyh - sum(sizes.values())
    peek_h = 0
    if spare >= 3:
        peek_h, spare = min(spare, 6), spare - min(spare, 6)
    sizes[foc] = max(2, sizes[foc] + spare)
    body = block("sessions", f"SESSIONS {sel + 1}/{len(rows)}", sess(sizes["sessions"] - 1, width, 0, 1), 0, width, 0)
    cl = _channel_lines(snap, ui, sizes["channel"] - 1, width)
    r0 = len(body)
    body += block("channel", _chat_title(snap, ui, cid), cl, r0, width, 0)
    hits += [(2 + r0 + k, 0, width, ("chan",)) for k in range(1, len(cl) + 1)]
    if peek_h:
        body += [_rtitle(ui, "peek", f"PEEK {seat['name'] if seat else '-'}", width)] + [_fit(x, width) for x in _peek_lines(ui, peek_h - 1, seat)]
    sl = _steer_lines(snap, ui, sizes["steer"] - 1, seat, tgt)
    r1 = len(body)
    body += block("steer", _steer_title(seat, tgt), sl, r1, width, 0)
    if len(sl) > 1:  # buttons sit two rows under the title, whatever size the focused region was padded to
        btns(sl[1], r1 + 2, 0, width)
    body += [" " * width] * (bodyh - len(body))
    return (f"━ ATLAS COLONY . {ncol} col {nseat} seats " + "━" * width)[:width], [x[:width] for x in body[:bodyh]], hits



def render(snap: dict, ui: dict, width: int, height: int) -> list:
    width, height = max(width, 40), max(height, 8)
    snap = snap or {}
    if not snap.get("_norm"):
        normalize_snapshot(snap)
    mode = ui.get("mode", "")
    if mode == "help":
        top = f"help ▸ {ui['buf']}▊  · type to find a command"
    elif mode in ("cmd", "filter", "confirm"):
        top = f"cmd ▸ {'/' if mode == 'filter' else ''}{ui['buf']}▊"
    else:
        top = f"cmd ▸ ▊  {'Tab region' if ui['section'] == 'colony' else 'Tab complete'} · ? help · last {_clock(snap)}"
        if ui.get("filter"):
            top += f" · filter /{ui['filter']}"
    lines = [_fit(top, width)]
    foot = [
        _fit(_hints(snap, ui), width),
        _fit(
            ui.get("status")
            or f"[{snap.get('host') or 'atlas'}] {_title(snap, ui).lower()}"
            + (f" · {snap.get('host')} → {_cname_of(snap, ui['colony'])}" if ui.get("colony") and not ui.get("seat") else ""),
            width,
        ),
    ]
    bodyh = body_height(height)
    if mode == "help":
        hl = _help_lines(ui)
        body = [_fit(x, width) for x in (hl + [""] * bodyh)[: bodyh + 2]]
        return (lines + body)[: height - 2] + foot
    if ui["section"] == "colony":
        head, body, _h = colony_body(snap, ui, width, bodyh)
        return lines + [_fit(head, width)] + body + ["━" * width] + foot
    lw = LEFT if width >= COMPACT_W else COMPACT_LEFT
    rw = width - lw - 1
    lines.append(
        ("━ { EXPLORER } " + "━" * lw)[:lw]
        + "╋"
        + ("━ " + _title(snap, ui) + " " + "━" * width)[:rw]
    )
    rows = explorer_rows(snap, ui)
    left = _explorer_lines(rows, ui, bodyh, lw)
    left += [" " * lw] * (bodyh - len(left))
    right = right_lines(snap, ui, rw - 1, bodyh)
    off = ui.get("pane_scroll", 0) if not ui.get("seat") else 0
    right = right[off : off + bodyh]
    for i in range(bodyh):
        lines.append(
            left[i] + "┃" + " " + _fit(right[i] if i < len(right) else "", rw - 1)
        )
    lines.append("━" * lw + "╋" + "━" * rw)
    return lines + foot


def hitmap(snap: dict, ui: dict, width: int, height: int) -> list:
    """Clickable rects of the last render: [(row, x0, x1, action)], first match wins. Mirrors render()'s layout."""
    width, height = max(width, 40), max(height, 8)
    snap = snap or {}
    if ui.get("mode") == "help":
        return []
    if not snap.get("_norm"):
        normalize_snapshot(snap)
    if ui["section"] == "colony":
        hits = colony_body(snap, ui, width, body_height(height))[2]
        for bm in BTNS.finditer(_fit(_hints(snap, ui), width)):
            hits.append((height - 2, bm.start(), bm.start() + len(bm.group(0)), ("button", bm.group(1), None)))
        return hits
    lw = LEFT if width >= COMPACT_W else COMPACT_LEFT
    rw = width - lw - 1
    bodyh = body_height(height)
    hits = []
    rows = explorer_rows(snap, ui)
    top = _explorer_top(rows, ui, bodyh)
    for k in range(min(len(rows) - top, bodyh)):
        hits.append((2 + k, 0, lw, ("explorer", top + k)))
    x0 = lw + 2
    if ui.get("seat"):
        right = right_lines(snap, ui, rw - 1, bodyh)
        for j in range(min(SEAT_HEAD, len(right))):  # only the header rows; body text must never become clickable
            fl = _fit(right[j], rw - 1)
            for bm in BTNS.finditer(fl):
                hits.append((2 + j, x0 + bm.start(), x0 + bm.start() + len(bm.group(0)), ("button", bm.group(1), ui["seat"])))
        return hits
    right = right_lines(snap, ui, rw - 1, bodyh)
    off = ui.get("pane_scroll", 0)
    tabbed = ui["section"] == "topology" and ui.get("colony")
    seats = _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", "")) if tabbed and ui["tab"] == "table" else []
    body_from = next((j for j, ln in enumerate(right) if ln.startswith("━")), None) if seats else None
    si = 0
    for j, ln in enumerate(right):
        r = 2 + j - off
        seat_row = None
        if body_from is not None and j > body_from and not ln.startswith("┈") and si < len(seats):
            seat_row, si = seats[si], si + 1
        if not 2 <= r < 2 + bodyh:
            continue
        ln = _fit(ln, rw - 1)
        if j == 0 and tabbed:
            pos = 0
            for t in TABS:
                hits.append((r, x0 + pos, x0 + pos + len(t) + 4, ("tab", t)))
                pos += len(t) + 4
            if ui["tab"] in ("table", "overview"):
                for bm in BTNS.finditer(ln):
                    hits.append((r, x0 + bm.start(), x0 + bm.start() + len(bm.group(0)), ("button", bm.group(1), None)))
            continue
        if seat_row is not None:
            for bm in BTNS.finditer(ln):
                hits.append((r, x0 + bm.start(), x0 + bm.start() + len(bm.group(0)), ("button", bm.group(1), seat_row["name"])))
            hits.append((r, x0, x0 + rw - 1, ("seatrow", si - 1)))
            continue
        if (
            ui["section"] == "projects"
            and not ui.get("filter")
            and 0 <= j - 2 < len(snap.get("projects") or [])
            and ln.strip()
        ):
            hits.append((r, x0, x0 + rw - 1, ("project", snap["projects"][j - 2].get("root"))))
            continue
        if (
            ui["section"] == "terminals"
            and not ui.get("filter")
            and 0 <= j - 3 < len(snap.get("terminals") or [])
            and ln.strip()
        ):
            hits.append((r, x0, x0 + rw - 1, ("termsess", snap["terminals"][j - 3].get("session"))))
            continue
        if tabbed and ui["tab"] == "wall":  # tiles register below; body text is never a link
            continue
        i = ln.find("(open ▸)")
        if i >= 0:
            m = re.search(r"#(\S+)\s+\(open", ln)
            act = ("open", f"note #{m.group(1)}") if m else ("open", "config")
            hits.append((r, x0 + i, x0 + i + 8, act))
    if tabbed and ui["tab"] == "wall":
        _wl, tiles = _wall_layout(snap, ui, rw - 1)
        for li, tx0, tx1, si, s in tiles:
            r = 2 + (li + 2) - off  # body sits two rows under the tab bar in right_lines
            if 2 <= r < 2 + bodyh:
                hits.append((r, x0 + tx0, x0 + tx1, ("walltile", si, s.get("name"))))
    fr = height - 2  # the hints footer: [ ? help ] and [ q quit ]
    fl = _fit(_hints(snap, ui), width)
    for bm in BTNS.finditer(fl):
        hits.append((fr, bm.start(), bm.start() + len(bm.group(0)), ("button", bm.group(1), None)))
    return hits


def hit_at(hits, x: int, y: int):
    return next((a for r, x0, x1, a in hits if r == y and x0 <= x < x1), None)


def _button_effect(snap, ui, act, seat=None):
    """What an on-screen button does: loop-effect tuples are returned, ui-only actions mutate in place."""
    if act == "msg":
        seat = seat or (_context_seat(snap, ui) or {}).get("name")
        if not seat:
            ui["status"] = "no seat selected"
        elif (_seat_of(snap, seat) or {}).get("lead"):
            ui["status"] = f"{seat} is the lead: it reads the board itself"
        else:
            ui.update(mode="cmd", buf=f"send {seat} ")
        return None
    if act == "msgall":
        if not ui.get("colony"):
            ui["status"] = "no colony selected"
        else:
            ui.update(mode="cmd", buf="broadcast ")
        return None
    if act == "view":
        s = _seat_of(snap, seat) if seat else _context_seat(snap, ui)
        if not s:
            ui["status"] = "no seat selected"
        else:
            _open_seat(snap, ui, s["name"])
        return None
    if act == "term":
        return _seat_target(snap, ui, seat)
    if act == "stop":
        s = _seat_of(snap, seat) if seat else _context_seat(snap, ui)
        if not s:
            ui["status"] = "no seat selected"
        elif not _stoppable(s):
            ui["status"] = f"not stoppable: {s['name']} has no pane"
        else:
            ui.update(mode="confirm", buf=f"stop {s['name']}? (y/n) ", confirm=s["name"])
        return None
    if act in ("hold", "release"):
        eff = _hold_effect(snap, ui, seat)
        return eff if eff and eff[0] == act else None  # a stale label (state flipped since render) does nothing
    if act in ("at_all", "at_lead"):
        _k_steer(snap, ui, "b" if act == "at_all" else "l")
        return None
    if act == "back":
        handle_key(snap, ui, "esc")
        return None
    if act == "refresh":
        return ("refresh",)
    if act == "help":
        ui.update(mode="help", buf="", help_sel=0)
        return None
    if act == "quit":
        return ("quit",)
    return None


def handle_click(snap, ui, hits, x: int, y: int):
    """Left click at cell (x, y): one click acts (opens the row, fires the button); returns a loop effect like handle_key."""
    act = hit_at(hits, x, y)
    if not act:
        return None
    kind = act[0]
    eff = None
    if kind == "explorer":
        ui.update(cursor=act[1], focus="explorer")
        handle_key(snap, ui, "enter")
    elif kind == "srow":
        ui.update(srow=act[1], region="sessions")
        eff = _colony_pick(snap, ui)
    elif kind == "region":
        ui["region"] = act[1]
    elif kind == "tab":
        ui.update(tab=act[1], seat=None, focus="pane", pane_scroll=0)
    elif kind == "seatrow":
        seats = (
            _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
            if ui["section"] == "topology" and ui.get("colony")
            else []
        )
        if seats:
            i = max(0, min(act[1], len(seats) - 1))
            ui.update(row=i, focus="pane")
            _open_seat(snap, ui, seats[i]["name"])
    elif kind == "walltile":
        ui.update(row=max(0, act[1]), focus="pane")
        _open_seat(snap, ui, act[2])
    elif kind == "termsess":
        eff = ("attach", act[1])
    elif kind == "term":
        eff = _seat_target(snap, ui, act[1])
    elif kind == "project":
        if act[1]:
            eff = ("project", act[1])
    elif kind == "button":
        eff = _button_effect(snap, ui, BTN_ACT[act[1]], act[2])
    elif kind == "open":
        if act[1] == "config":
            ui.update(tab="overview", seat=None, focus="pane")
        else:
            ui["status"] = act[1]
    _clamp(snap, ui)
    return eff


def scroll(ui, d: int):
    """Wheel: d=-1 up, +1 down, on the right pane."""
    if ui.get("seat"):
        ui["seat_scroll"] = max(0, ui.get("seat_scroll", 0) + d * 3)
    else:
        ui["pane_scroll"] = max(0, ui.get("pane_scroll", 0) + d * 3)


def wheel(snap, ui, hits, x: int, y: int, d: int):
    """Wheel at cell (x, y), d=-1 up / +1 down: CHANNEL scrolls its history, SESSIONS moves the selection, else the right pane."""
    act = hit_at(hits, x, y) if ui.get("section") == "colony" else None
    if act and (act[0] == "chan" or act == ("region", "channel")):
        ui["chat_scroll"] = max(0, int(ui.get("chat_scroll") or 0) - d * 3)
    elif act and (act[0] == "srow" or act == ("region", "sessions")):
        n = len(sessions_rows(snap))
        ui["srow"] = max(0, min(_srow(snap, ui) + d, n - 1))
    else:
        scroll(ui, d)


def bridge_seq(cid, seat=None) -> str:
    """Private OSC 7717 telling the web workspace to open this space/seat (OpenRig-style TUI to workspace bridge)."""
    clean = lambda v: re.sub(r"[\x07\x1b;]", "", str(v))  # BEL/ESC end or inject sequences; ';' splits fields
    return f"\x1b]7717;open;{clean(cid)}" + (f";{clean(seat)}" if seat else "") + "\x07"


def emit_bridge(ui, out=None, environ=None):
    """Pop the pending open and write it only when ATLAS_TUI_BRIDGE=1 (set by the dashboard terminal)."""
    pend = ui.pop("_bridge", None)
    env = os.environ if environ is None else environ
    if pend and env.get("ATLAS_TUI_BRIDGE") == "1":
        out = out or sys.stdout
        out.write(bridge_seq(*pend))
        out.flush()


# ---------------------------------------------------------------- input
def _clamp(snap, ui):
    ui["cursor"] = max(0, min(ui["cursor"], len(explorer_rows(snap, ui)) - 1))
    if ui["section"] == "projects":  # rows navigate projects, not seat tables
        ui["row"] = max(0, min(ui.get("row", 0), len(snap.get("projects") or []) - 1))
        return
    if ui["section"] == "terminals":
        ui["row"] = max(0, min(ui.get("row", 0), len(snap.get("terminals") or []) - 1))
        return
    n = len(
        _wall_seats(snap, ui)
        if ui.get("tab") == "wall"
        else _seats(snap, ui.get("colony"), ui.get("pod"), ui.get("filter", ""))
    )
    ui["row"] = max(0, min(ui.get("row", 0), max(0, n - 1)))


def _open_seat(snap, ui, name) -> str:
    s = next((x for x in snap.get("seats") or [] if x.get("name") == name), None)
    if not s:
        ui["status"] = f"no seat {name}"
        return ""
    ui["seat"], ui["seat_scroll"], ui["seat_text"], ui["focus"] = name, 0, "", "pane"
    ui["_bridge"] = (s.get("colony"), name)
    return name


def _open_colony(snap, ui, cid):
    c = _find_colony(snap, cid)
    if not c:
        ui["status"] = f"no colony {cid}"
        return
    cid = c["id"]
    ui["_bridge"] = (cid, None)
    ui.update(
        section="topology",
        colony=cid,
        pod=None,
        tab="table",
        seat=None,
        row=0,
        focus="pane",
    )


def _seat_target(snap, ui, name=None):
    name = name or ui.get("seat")
    if not name and ui.get("colony") and ui.get("focus") == "pane":
        seats = _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
        if seats:
            name = seats[max(0, min(ui.get("row", 0), len(seats) - 1))]["name"]
    s = next((x for x in snap.get("seats") or [] if x.get("name") == name), None)
    if not s:
        ui["status"] = "no seat selected"
        return None
    if not s.get("target"):
        ui["status"] = f"{name} has no tmux pane"
        return None
    return ("term", name)


def run_command(snap, ui, text: str):
    parts = text.strip().split(None, 2)
    if not parts:
        return None
    cmd, args = parts[0].lower(), parts[1:]
    if cmd in ("quit", "q", "exit"):
        return ("quit",)
    if cmd == "refresh":
        return ("refresh",)
    if cmd == "help":
        ui.update(mode="help", buf="", help_sel=0)
    elif cmd == "back":
        handle_key(snap, ui, "esc")
    elif cmd == "colony" and args:
        _open_colony(snap, ui, args[0])
    elif cmd == "seat" and args:
        _open_seat(snap, ui, args[0])
    elif cmd == "term" and args:
        return _seat_target(snap, ui, args[0])
    elif cmd == "msg" and args:
        return _button_effect(snap, ui, "msg", args[0])
    elif cmd == "view" and args:
        return _button_effect(snap, ui, "view", args[0])
    elif cmd == "stop" and args:
        return _button_effect(snap, ui, "stop", args[0])
    elif cmd == "broadcast" and args:
        if not ui.get("colony"):
            ui["status"] = "no colony selected"
            return None
        return ("broadcast", " ".join(args))
    elif cmd == "send" and len(args) == 2:
        s = next((x for x in snap.get("seats") or [] if x.get("name") == args[0]), None)
        if not s:
            ui["status"] = f"no seat {args[0]}"
            return None
        if s.get("lead"):  # the lead reads the board at its next turn (do_steer says so)
            return ("steer", s["name"], args[1], s.get("colony") or ui.get("colony"))
        return ("send", args[0], args[1])
    elif cmd == "tab" and args and args[0] in TABS:
        ui["tab"] = args[0]
        ui["seat"] = None
    elif cmd.startswith(":") or cmd in SECTIONS:
        sec = (
            (cmd[1:] or (args[0] if args else "")).lower()
            if cmd.startswith(":")
            else cmd
        )
        if sec in SECTIONS:
            ui.update(
                section=sec,
                colony=None,
                seat=None,
                sub=None,
                pane_scroll=0,
                cursor=SECTIONS.index(sec),
            )
        else:
            ui["status"] = f"unknown section {sec}"
    elif cmd.startswith("/"):
        ui["filter"] = text.strip()[1:].strip()
    else:
        ui["status"] = f"unknown command: {cmd} (? for help)"
    return None


def _complete(buf: str) -> str:
    names = [c[0].split(" ")[0] for c in COMMANDS if c[0][0].isalpha()]
    hit = [n for n in names if n.startswith(buf)] if buf and " " not in buf else []
    return (
        hit[0] + " " if len(hit) == 1 else (os.path.commonprefix(hit) if hit else buf)
    )


def _steer_key(snap, ui, key: str):
    """STEER input mode: printable keys build ui['steer_text']; Enter resolves the target and returns a ('steer', ...) effect."""
    if key == "esc":
        ui.update(mode="", steer_text="")
    elif key == "backspace":
        ui["steer_text"] = str(ui.get("steer_text") or "")[:-1]
    elif key == "enter":
        return _steer_submit(snap, ui)
    elif len(key) == 1 and key.isprintable():
        ui["steer_text"] = str(ui.get("steer_text") or "") + key
    return None


def _steer_submit(snap, ui):
    cid, _seat, tgt = _colony_ctx(snap, ui)
    text = str(ui.get("steer_text") or "").strip()
    m = re.match(r"@(\S+)\s*(.*)$", text)
    if m:
        tgt, text = m.group(1), m.group(2).strip()
    if not text:
        ui["status"] = "nothing to send"
        return None
    if tgt == "lead":  # the literal "@lead" or an unselected seat both mean the colony lead
        tgt = next((x["name"] for x in snap.get("seats") or [] if x.get("colony") == cid and x.get("lead")), "lead")
    if tgt != "all":
        s = _seat_of(snap, tgt)
        if s and s.get("held"):
            ui["status"] = f"{tgt} is held; h to release"
            return None
        if not s and not m:
            ui["status"] = f"no seat {tgt}"
            return None
    ui["steer_text"] = ""  # keep the target (selection) and the mode; the sent row shows in CHANNEL
    ui["chat_scroll"] = 0
    return ("steer", tgt, text, cid)


def do_steer(snap, ui, eff, root: str):
    """Loop effect for ('steer', target, text, colony): one board note on the colony channel."""
    _k, tgt, text, cid = eff
    try:
        c = _find_colony(snap, cid) or {}
        if not c.get("channel"):
            ui["status"] = "no colony channel to steer on"
            return
        import atlas_todo

        croot = os.path.realpath(c["project"]) if c.get("project") else root
        atlas_todo.note(croot, "tui", text, to=tgt, channel=c["channel"], kind="steer")
        lead = (_seat_of(snap, tgt) or {}).get("lead")
        ui["status"] = (
            "lead reads the board at its next turn" if lead or tgt == "lead" else f"sent to {tgt}"
        )
    except Exception as e:  # board write failure must not kill the TUI
        ui["status"] = f"steer failed: {e}"


def do_hold(snap, ui, eff, root: str):
    """Loop effect for ('hold'|'release', seat, colony)."""
    act, name, cid = eff
    try:
        import atlas_dash_colony as dash

        fn = dash.hold_member if act == "hold" else dash.release_member
        st, body = fn(_seat_root(snap, name, root), cid, name)
        ui["status"] = (
            f"{act} {name}: ok" if st == 200 else f"{act} {name} refused: {body.get('error') or body.get('why') or st}"
        )
    except Exception as e:  # hold failure must not kill the TUI
        ui["status"] = f"{act} failed: {e}"


def handle_key(snap, ui, key: str):
    """key: 'up','down','left','right','enter','esc','tab','backspace','pgup','pgdn' or a printable char."""
    mode = ui.get("mode", "")
    if mode == "confirm":
        if key == "y":
            tgt = ui.pop("confirm", None)
            sk = ui.pop("confirm_sess", None)
            ui.update(mode="", buf="")
            return ("kill", sk) if sk else (("stop", tgt) if tgt else None)
        if key in ("n", "esc"):
            ui.update(mode="", buf="", confirm=None, confirm_sess=None)
        return None
    if mode == "steer":
        return _steer_key(snap, ui, key)
    if mode:
        if key == "esc":
            if mode == "filter":
                ui["filter"] = ""
            ui.update(mode="", buf="")
        elif key == "backspace":
            ui["buf"] = ui["buf"][:-1]
            if mode == "filter":
                ui["filter"] = ui["buf"]
        elif key == "tab" and mode in ("cmd", "help"):
            ui["buf"] = _complete(ui["buf"])
        elif mode == "help" and key in ("up", "down"):
            ui["help_sel"] = max(
                0, ui.get("help_sel", 0) + (1 if key == "down" else -1)
            )
        elif key == "enter":
            buf = ui["buf"]
            if mode == "help":
                hits = [
                    c
                    for c in COMMANDS
                    if (ui["buf"].split(" ")[0] in c[0] if ui["buf"] else True)
                ]
                pick = (
                    hits[max(0, min(ui.get("help_sel", 0), len(hits) - 1))][0].split(
                        " "
                    )[0]
                    if hits
                    else ""
                )
                ui.update(mode="cmd", buf=pick + " " if pick[:1].isalpha() else "")
            elif mode == "filter":
                ui.update(mode="", buf="")
            else:
                ui.update(mode="", buf="")
                return run_command(snap, ui, buf)
        elif len(key) == 1 and key.isprintable():
            ui["buf"] += key
            if mode == "filter":
                ui["filter"] = ui["buf"]
            if mode == "help":
                ui["help_sel"] = 0
        _clamp(snap, ui)
        return None
    if key == "W":
        ui.update(section="colony", seat=None, sub=None, pane_scroll=0, cursor=SECTIONS.index("colony"))
        return None
    if ui["section"] == "colony":
        eff = _colony_key(snap, ui, key)
        if eff is not NotImplemented:
            return eff
    rows = explorer_rows(snap, ui)
    in_seat = bool(ui.get("seat"))
    if key == "q":
        return ("quit",)
    if key == "?":
        ui.update(mode="help", buf="", help_sel=0)
    elif key == ":":
        ui.update(mode="cmd", buf="")
    elif key == "/":
        ui.update(mode="filter", buf=ui.get("filter", ""))
    elif key == "r":
        return ("refresh",)
    elif key == "a":
        return ("all",)
    elif key == "t":
        return _seat_target(snap, ui)
    elif key == "m":
        return _button_effect(snap, ui, "msg")
    elif key == "v":
        return _button_effect(snap, ui, "view")
    elif key == "x":
        if ui["section"] == "terminals" and not ui.get("seat"):
            return _term_kill_gate(snap, ui)
        return _button_effect(snap, ui, "stop")
    elif key == "esc":
        if in_seat:
            ui["seat"] = None
        elif ui.get("filter"):
            ui["filter"] = ""
        elif ui.get("pod"):
            ui["pod"] = None
        elif ui.get("colony"):
            ui.update(colony=None, focus="explorer")
        ui["pane_scroll"] = 0
    elif key == "tab" and ui.get("colony") and not in_seat:
        ui["tab"] = TABS[(TABS.index(ui["tab"]) + 1) % len(TABS)]
    elif key in ("left", "right"):
        if (
            ui.get("focus") == "pane"
            and not in_seat
            and ui.get("colony")
            and ui["tab"] == "wall"
        ):
            seats = _wall_seats(snap, ui)
            ui["row"] = max(0, min(ui.get("row", 0) + (1 if key == "right" else -1), len(seats) - 1))
        else:
            ui["focus"] = "pane" if key == "right" else "explorer"
    elif key in ("up", "down", "pgup", "pgdn"):
        d = -1 if key in ("up", "pgup") else 1
        step = 10 if key in ("pgup", "pgdn") else 1
        if ui["focus"] == "explorer":
            ui["cursor"] += d * step
        elif in_seat:
            ui["seat_scroll"] = max(
                0, ui.get("seat_scroll", 0) + d * step
            )  # down = toward the output tail
        elif ui["section"] == "projects":
            ui["row"] = max(0, ui.get("row", 0) + d * step)
        elif ui.get("colony") and ui["tab"] == "table":
            ui["row"] = ui.get("row", 0) + d * step
        elif ui.get("colony") and ui["tab"] == "wall":
            seats = _wall_seats(snap, ui)
            ui["row"] = max(0, min(ui.get("row", 0) + d * 2 * step, len(seats) - 1))
        elif ui["section"] == "terminals":
            ui["row"] = max(0, min(ui.get("row", 0) + d * step, len(snap.get("terminals") or []) - 1))
        else:
            ui["pane_scroll"] = max(0, ui.get("pane_scroll", 0) + d * step)
    elif key == "enter":
        if (
            ui["focus"] == "pane"
            and not in_seat
            and ui.get("colony")
            and ui["tab"] in ("table", "wall")
        ):
            seats = (
                _wall_seats(snap, ui) if ui["tab"] == "wall" else _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
            )
            if seats:
                _open_seat(
                    snap,
                    ui,
                    seats[max(0, min(ui.get("row", 0), len(seats) - 1))]["name"],
                )
        elif ui["section"] == "projects" and ui["focus"] == "pane":
            projs = snap.get("projects") or []
            if projs:
                p = projs[max(0, min(ui.get("row", 0), len(projs) - 1))]
                if p.get("root"):
                    return ("project", p["root"])
        elif ui["section"] == "terminals" and ui["focus"] == "pane":
            terms = snap.get("terminals") or []
            if terms:
                sess = terms[max(0, min(ui.get("row", 0), len(terms) - 1))].get("session")
                if sess:
                    return ("attach", sess)
        elif ui["focus"] == "explorer" and rows:
            r = rows[max(0, min(ui["cursor"], len(rows) - 1))]
            if r[1] == "section":
                ui.update(section=r[2], colony=None, seat=None, sub=None, pane_scroll=0)
            elif r[1] == "colony":
                _open_colony(snap, ui, r[2])
            elif r[1] == "pod":
                _open_colony(snap, ui, r[2][0])
                ui.update(pod=r[2][1], focus="explorer")
            elif r[1] == "seat":
                _open_seat(snap, ui, r[2])
            elif r[1] == "sub":
                if r[2] is None:
                    ui.update(sub=None, cursor=SECTIONS.index("feed"))
                else:
                    ui["sub"] = r[2]
    _clamp(snap, ui)
    return None


# ---------------------------------------------------------------- IO
def _model():
    import atlas_colony_model as m

    return m


def _root(args) -> str:
    return str(Path(args.project or os.getcwd()).resolve())


def _norm_setup(setup) -> list:
    return [setup] if setup and isinstance(setup[0], str) else list(setup or [])


def attach(snap, name: str, model=None):
    """Suspend-safe tmux attach of a seat's pane via grouped session `atlas-view-<id>`."""
    m = model or _model()
    s = next((x for x in snap.get("seats") or [] if x.get("name") == name), None)
    if not s or not s.get("target"):
        return "no tmux pane"
    return attach_target(s["target"], m)


def attach_target(target: str, model=None) -> str:
    """Suspend-safe attach of any tmux target (seat pane or whole atlas session)."""
    m = model or _model()
    vid = f"tui{os.getpid()}"
    try:
        setup, argv = m.attach_argv(target, vid)
        for cmd in _norm_setup(setup):
            subprocess.run(
                cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        rc = subprocess.run(argv, check=False).returncode
    finally:
        with contextlib.suppress(Exception):
            m.cleanup_view(vid)
    return f"attach failed (rc {rc})" if rc else ""


def _own_session(env: Mapping[str, str]) -> str:
    """The tmux session this TUI runs in ('' when detached)."""
    if not env.get("TMUX"):
        return ""
    r = _run_tmux(["tmux", "display-message", "-p", "#S"])
    return r.stdout.strip() if r.returncode == 0 else ""


def _kill_refusal(sess, env: Mapping[str, str]) -> str:
    """Why the kill gate must refuse, or '' when the session may be killed."""
    sess = str(sess or "")
    if not sess.startswith("atlas-"):
        return f"refusing to kill {sess}: not an atlas-* session"
    if sess == "atlas-tui":
        return "refusing to kill atlas-tui (this TUI)"
    own = _own_session(env)
    if own and sess == own:
        return f"refusing to kill {sess}: this TUI runs there"
    return ""


def _term_kill_gate(snap, ui) -> None:
    """Arm the y/n kill gate for the terminal row under the cursor, guarded."""
    terms = snap.get("terminals") or []
    if not terms:
        ui["status"] = "no terminal sessions"
        return None
    sess = terms[max(0, min(ui.get("row", 0), len(terms) - 1))].get("session")
    why = _kill_refusal(sess, os.environ)
    if why:
        ui["status"] = why
        return None
    ui.update(mode="confirm", buf=f"kill {sess}? (y/n) ", confirm=None, confirm_sess=sess)
    return None


def send(root, seat, text, snap):
    """Board note addressed to the seat; the IRC live-delivery watcher (atlas_dash_irc) delivers to idle claude/omp panes."""
    import atlas_todo

    atlas_todo.note(root, "tui", text, to=seat)


def _keyname(ch, curses) -> str:
    table = {
        curses.KEY_UP: "up",
        curses.KEY_DOWN: "down",
        curses.KEY_LEFT: "left",
        curses.KEY_RIGHT: "right",
        curses.KEY_PPAGE: "pgup",
        curses.KEY_HOME: "home",
        curses.KEY_END: "end",
        curses.KEY_NPAGE: "pgdn",
        curses.KEY_BACKSPACE: "backspace",
        127: "backspace",
        8: "backspace",
        9: "tab",
        10: "enter",
        13: "enter",
        curses.KEY_ENTER: "enter",
    }
    if ch in table:
        return table[ch]
    return chr(ch) if 32 <= ch < 127 else ""


def focus_first_live(snap, ui):
    """Open the first live colony on its TABLE with the explorer arrow on it, as OpenRig does; no live colony keeps the overview."""
    if ui.get("section") != "topology" or ui.get("colony"):
        return
    live = {x.get("colony") for x in snap.get("seats") or [] if x.get("state") in ("working", "idle", "blocked")}
    rows = explorer_rows(snap, ui)
    cols = [r for r in rows if r[1] == "colony"]
    pick = next((r[2] for r in cols if r[2] in live), None)
    if pick is None:
        return
    ui["cursor"] = next(i for i, r in enumerate(rows) if r[1] == "colony" and r[2] == pick)
    _open_colony(snap, ui, pick)
    ui["focus"] = "explorer"
    ui.pop("_bridge", None)  # autofocus is not a user open


class Loader:
    """Runs the (slow) colony snapshot off the UI thread; `take()` hands back the newest result once."""

    def __init__(self, root, all_projects):
        self.root, self.all, self.busy, self._res = root, all_projects, False, None

    def start(self):
        if self.busy:
            return
        self.busy = True
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        try:
            res = _model().snapshot(self.root, self.all)
        except Exception as e:  # a failed scan must not kill the TUI
            res = e
        self._res, self.busy = res, False

    def take(self):
        res, self._res = self._res, None
        return res


def loop(stdscr, args):
    import curses

    root = _root(args)
    ui = new_ui(section="colony")
    ui["status"] = "loading colonies…"
    snap: dict = {"loading": True}
    loader = Loader(root, args.all)
    loader.start()
    first = True
    last_snap = last_cap = 0.0
    curses.curs_set(0)
    try:  # no mouse support (or no initscr under a test double): keyboard still works
        curses.mouseinterval(0)  # press/release arrive raw; a click is the press
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
    except curses.error:
        pass
    try:  # terminal default fg/bg (-1): paint no grey box over the host background
        curses.start_color()
        curses.use_default_colors()
        stdscr.bkgd(" ", curses.A_NORMAL)
    except curses.error:
        pass
    stdscr.timeout(250)
    stdscr.keypad(True)
    while True:
        now = time.time()
        res = loader.take()
        if isinstance(res, Exception):
            snap = {"error": str(res), "root": loader.root}  # full right-pane failure report
            ui["status"] = f"snapshot failed: {res}"
            last_snap = now
        elif res is not None:
            snap, last_snap = normalize_snapshot(res), now
            if first:
                first = False
                ui["status"] = ""
                focus_first_live(snap, ui)
            if ui.get("tab") == "wall":  # tile output refreshes only with the snapshot
                refresh_wall(snap, ui)
                ui["_wall_for"] = ui.get("colony")
        if ui.get("tab") == "wall" and ui.get("_wall_for") != ui.get("colony"):
            refresh_wall(snap, ui)  # a freshly opened wall fills now, not on the next snapshot
            ui["_wall_for"] = ui.get("colony")
        if now - last_snap >= 2:
            loader.start()
        if ui.get("seat") and now - last_cap >= 1:
            s = next(
                (x for x in snap.get("seats") or [] if x.get("name") == ui["seat"]),
                None,
            )
            if s and s.get("target"):
                # capture() cannot raise on tmux failures (atlas_colony_model.py:79-86, :103-106); no try needed
                ui["seat_text"] = _model().capture(s["target"], 200, False)
            last_cap = now
        h, w = stdscr.getmaxyx()
        if h < MIN_H or w < MIN_W:
            frame = [f"terminal too small ({w}x{h}); need {MIN_W}x{MIN_H}"]
        else:
            frame = render(snap, ui, w, h)
        stdscr.erase()
        hits = hitmap(snap, ui, w, h) if h >= MIN_H and w >= MIN_W else []
        spans: dict = {}
        for r, bx0, bx1, a in hits:  # on-screen buttons: drawn highlighted
            if a[0] == "button":
                spans.setdefault(r, []).append((bx0, bx1))
        for i, ln in enumerate(frame[:h]):
            sp = sorted(spans.get(i, ()))
            with contextlib.suppress(curses.error):
                dim = curses.A_DIM if "✓ finished" in ln else 0
                if not sp:
                    stdscr.addstr(i, 0, ln[: w - 1] if i == h - 1 else ln[:w], dim)
                else:
                    x = 0
                    for bx0, bx1 in sp:
                        stdscr.addstr(i, x, ln[x:bx0], dim)
                        stdscr.addstr(i, bx0, ln[bx0:bx1], curses.A_REVERSE)
                        x = bx1
                    stdscr.addstr(i, x, ln[x:w], dim)
        stdscr.refresh()
        ch = stdscr.getch()
        if ch == -1:
            continue
        if ch == curses.KEY_RESIZE:
            curses.update_lines_cols()
            stdscr.clear()  # full repaint at the new size
            continue
        if ch == curses.KEY_MOUSE:
            try:
                _id, mx, my, _z, bs = curses.getmouse()
            except curses.error:
                continue
            down = getattr(curses, "BUTTON5_PRESSED", 0)
            if bs & curses.BUTTON4_PRESSED:
                wheel(snap, ui, hits, mx, my, -1)
                continue
            if down and bs & down:
                wheel(snap, ui, hits, mx, my, 1)
                continue
            if not bs & (curses.BUTTON1_PRESSED | curses.BUTTON1_CLICKED | curses.BUTTON1_DOUBLE_CLICKED):
                continue
            eff = handle_click(snap, ui, hits, mx, my)
        else:
            if ch == 27:  # lone Esc arrives after the keypad timeout
                key = "esc"
            else:
                key = _keyname(ch, curses)
            if not key:
                continue
            eff = handle_key(snap, ui, key)
        emit_bridge(ui)
        if not eff:
            continue
        if eff[0] == "quit":
            return
        if eff[0] == "refresh":
            loader.start()
        elif eff[0] == "all":
            loader = Loader(loader.root, not loader.all)
            loader.start()
            ui["status"] = (
                "watching all projects" if loader.all else f"watching {loader.root} only"
            )
        elif eff[0] == "project":
            root = eff[1]
            loader = Loader(root, loader.all)
            loader.start()
            ui.update(colony=None, seat=None, pod=None, row=0, status=f"watching {root}")
        elif eff[0] == "stop":
            try:
                import atlas_dash_colony as dash

                st, body = dash.kill_member(_seat_root(snap, eff[1], root), eff[1])
                ui["status"] = (
                    f"stopped {eff[1]}"
                    if st == 200
                    else f"stop {eff[1]} refused: {body.get('error') or body.get('why') or st}"
                )
                loader.start()  # the snapshot shows the seat's new state
            except Exception as e:  # stop failure must not kill the TUI
                ui["status"] = f"stop failed: {e}"
        elif eff[0] == "steer":
            do_steer(snap, ui, eff, root)
        elif eff[0] in ("hold", "release"):
            do_hold(snap, ui, eff, root)
            loader.start()
        elif eff[0] == "broadcast":
            try:
                c = _find_colony(snap, ui["colony"]) or {}
                if not c.get("channel"):
                    ui["status"] = "no colony channel to broadcast on"
                else:
                    import atlas_todo

                    croot = os.path.realpath(c["project"]) if c.get("project") else root
                    atlas_todo.note(croot, "tui", eff[1], to="all", channel=c["channel"])
                    ui["status"] = f"sent to all · {_cname(c)}"
            except Exception as e:  # board write failure must not kill the TUI
                ui["status"] = f"send failed: {e}"
        elif eff[0] == "term":
            curses.endwin()
            try:
                err = attach(snap, eff[1], _model())
            except Exception as e:  # attach failure must not kill the TUI
                err = f"attach failed: {e}"
            stdscr.refresh()
            ui["status"] = err or f"returned from {eff[1]}"
            loader.start()
        elif eff[0] == "attach":
            curses.endwin()
            try:
                err = attach_target(eff[1], _model())
            except Exception as e:  # attach failure must not kill the TUI
                err = f"attach failed: {e}"
            stdscr.refresh()
            ui["status"] = err or f"returned from {eff[1]}"
        elif eff[0] == "kill":
            sess = eff[1]
            why = _kill_refusal(sess, os.environ)
            if why:
                ui["status"] = why
            else:
                r = _run_tmux(["tmux", "kill-session", "-t", sess])
                ui["status"] = f"killed {sess}" if r.returncode == 0 else f"kill {sess} failed"
            loader.start()
        elif eff[0] == "send":
            try:
                send(_seat_root(snap, eff[1], root), eff[1], eff[2], snap)
                s = _seat_of(snap, eff[1])
                ui["status"] = (
                    f"queued for {eff[1]}'s next tool call"
                    if s and not s.get("target")
                    else f"sent to {eff[1]}"
                )
            except Exception as e:  # board write failure must not kill the TUI
                ui["status"] = f"send failed: {e}"


def _attach_open_argv(env: Mapping[str, str]):
    """(argv, label) that opens a new visible terminal window attached to the atlas-tui
    session, chosen from TERM_PROGRAM on macOS; None when there is no known opener."""
    tp = env.get("TERM_PROGRAM")
    if tp == "iTerm.app":
        return (
            ["osascript", "-e", 'tell application "iTerm" to create window with default profile command "tmux attach -t atlas-tui"'],
            "iTerm",
        )
    if tp == "Apple_Terminal":
        return (
            ["osascript", "-e", 'tell application "Terminal" to do script "tmux attach -t atlas-tui"'],
            "Terminal",
        )
    if tp == "ghostty":
        return (["open", "-na", "Ghostty", "--args", "-e", "tmux", "attach", "-t", "atlas-tui"], "Ghostty")
    return None


def _lead_harness_safe(env: Mapping[str, str]) -> str:
    """Harness the lead runs under (atlas_mux._lead_harness); '' when the import is unavailable."""
    try:
        from atlas_mux import _lead_harness

        return _lead_harness(env)
    except Exception:
        return ""


def _run_tmux(argv: list[str]) -> subprocess.CompletedProcess:
    """One tmux call, output captured; tests inject a fake runner by patching subprocess.run."""
    return subprocess.run(argv, check=False, capture_output=True, text=True)


def _plugin_version() -> str:
    """Version of the plugin this script runs from ('?' when the manifest is unreadable)."""
    try:
        manifest = json.loads(
            (HERE.parent / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        return str(manifest.get("version") or "?")
    except (OSError, ValueError):
        return "?"


def launch(args) -> int:
    script = str(Path(__file__).resolve())
    cmd = [sys.executable, script, "--project", _root(args)] + (
        ["--all"] if args.all else []
    )
    line = shlex.join(cmd)
    if os.environ.get("TMUX"):
        r = _run_tmux(["tmux", "new-window", "-P", "-F", "#{window_id}", "-n", "atlas-tui", line])
        if r.stdout.strip():
            _run_tmux(["tmux", "set-window-option", "-t", r.stdout.strip(), "automatic-rename", "off"])
        print("opened Atlas Command Center in a new tmux window 'atlas-tui'")
    else:
        if _run_tmux(["tmux", "has-session", "-t", "atlas-tui"]).returncode == 0:
            # the detached session may run a process from an older, moved install:
            # replace what runs in it with the current script and project
            wins = (
                _run_tmux(["tmux", "list-windows", "-t", "atlas-tui", "-F", "#{window_name}"]).stdout
                or ""
            ).split()
            if "atlas-tui" in wins:
                _run_tmux(["tmux", "respawn-window", "-k", "-t", "atlas-tui:atlas-tui", line])
            else:
                _run_tmux(["tmux", "new-window", "-d", "-t", "atlas-tui", "-n", "atlas-tui", line])
            print(f"restarted the atlas-tui session with {_plugin_version()}")
        else:
            _run_tmux(["tmux", "new-session", "-d", "-s", "atlas-tui", "-n", "atlas-tui", line])
        _run_tmux(["tmux", "set-window-option", "-t", "atlas-tui:atlas-tui", "automatic-rename", "off"])
        # our own session: tmux only forwards clicks to the TUI with mouse on
        _run_tmux(["tmux", "set-option", "-t", "atlas-tui", "mouse", "on"])
        opener = _attach_open_argv(os.environ) if sys.platform == "darwin" else None
        if opener:
            argv, label = opener
            r = subprocess.run(argv, check=False, capture_output=True)
            if r.returncode == 0:
                print(f"opened a new {label} window attached to 'atlas-tui'")
            else:
                print("attach with: tmux attach -t atlas-tui")
        else:
            print("attach with: tmux attach -t atlas-tui")
        if _lead_harness_safe(os.environ) == "omp":
            print("inside omp: type /atlas-tui to open it in this session")
    return once(args)


def once(args) -> int:
    if args.fixture:
        try:
            snap = json.loads(Path(args.fixture).read_text())
        except (OSError, ValueError) as e:
            print(f"atlas_tui: cannot read fixture {args.fixture}: {e}", file=sys.stderr)
            return 1
    else:
        snap = _model().snapshot(_root(args), args.all)
    snap = normalize_snapshot(snap)
    ui = new_ui(section=args.view or "colony")
    if args.view == "topology" or args.colony or args.seat:
        c = args.colony or next(
            (
                s.get("colony")
                for s in snap.get("seats") or []
                if s.get("name") == args.seat
            ),
            None,
        )
        if c:
            _open_colony(snap, ui, c)
    if args.tab:
        ui["tab"] = args.tab
    if args.seat:
        _open_seat(snap, ui, args.seat)
        s = next(
            (x for x in snap.get("seats") or [] if x.get("name") == args.seat), None
        )
        if s and s.get("target") and not args.fixture:
            ui["seat_text"] = _model().capture(s["target"], 200, False)
    if ui["tab"] == "wall" and not args.fixture:
        refresh_wall(snap, ui)
    ui["cursor"] = SECTIONS.index(ui["section"])
    if not args.colony and not args.seat:
        focus_first_live(snap, ui)
    print("\n".join(render(snap, ui, args.width, args.height)))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Atlas Colony workspace (sessions, channel, peek, steer)")
    p.add_argument("--project")
    p.add_argument("--all", action="store_true")
    p.add_argument("--once", action="store_true")
    p.add_argument("--launch", action="store_true")
    p.add_argument("--width", type=int, default=160)
    p.add_argument("--height", type=int, default=48)
    p.add_argument("--view", choices=SECTIONS)
    p.add_argument("--seat")
    p.add_argument("--colony")
    p.add_argument("--tab", choices=TABS)
    p.add_argument("--fixture", help="snapshot JSON file (testing)")
    a = p.parse_args(argv)
    if a.launch:
        return launch(a)
    if a.once or a.fixture:
        return once(a)
    if not sys.stdout.isatty():
        return once(a)
    import curses

    curses.wrapper(loop, a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
