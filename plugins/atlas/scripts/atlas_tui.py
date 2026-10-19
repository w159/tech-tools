#!/usr/bin/env python3
"""Atlas Command Center: curses TUI over atlas_colony_model.snapshot().

`render(snapshot, ui_state, width, height) -> list[str]` is a pure function used by both
the curses loop and `--once`. `handle_key` / `run_command` mutate ui_state and return an
effect tuple (("quit",), ("refresh",), ("term", seat), ("send", seat, text)) for the loop.
Stdlib only. Layout mirrors the OpenRig native TUI captures.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

LEFT = 32
COMPACT_LEFT = 24  # explorer width below COMPACT_W columns
COMPACT_W = 100
MIN_W, MIN_H = 60, 18
SECTIONS = ["topology", "specs", "projects", "terminals", "feed", "system"]
TABS = ["table", "recent", "overview", "graph", "health"]
RT = {"claude": "cl", "omp": "omp", "codex": "cx"}
RT_GLYPH = {"claude": "><", "omp": ">_", "codex": "#>"}
DOT = {"working": "●", "idle": "·", "blocked": "!", "finished": "✓", "dead": "✗"}
HINTS = "↑↓ move · ←→ pane · ⏎ open · : command · / filter · t term · ? help · q quit"
COMMANDS = [
    ("colony <id>", "open a colony"),
    ("seat <name>", "live view of a seat's tmux pane"),
    ("term <seat>", "attach the seat's tmux pane (C-b d returns)"),
    ("send <seat> <text>", "post a board note to a seat"),
    (": <section>", "topology|specs|projects|terminals|feed|system"),
    ("/ <text>", "filter the current view"),
    ("tab <table|recent|overview|graph|health>", "switch right-pane tab"),
    ("refresh", "re-read the snapshot"),
    ("back", "go up one level"),
    ("help", "this list"),
    ("quit", "leave"),
]
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")


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
        "status": "",
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
    return next((c for c in _colonies(snap) if c.get("id") == cid), None)


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


# ---------------------------------------------------------------- explorer
def explorer_rows(snap, ui) -> list:
    """[(text, kind, key)] for the left tree; kind in section|colony|pod|sub."""
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
                        "    " + ("┗━" if last else "┣━") + " ▦ " + str(c.get("id")),
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
        if sec == "feed" and ui.get("section") == "feed":
            for label, key in (
                ("Needs attention", "needs"),
                ("Updates", "updates"),
                ("Back", None),
            ):
                rows.append(("   " + label, "sub", key))
    return rows


def _explorer_lines(rows, ui, h, lw=LEFT) -> list:
    cur = max(0, min(ui["cursor"], len(rows) - 1))
    top = max(0, min(cur - h + 1, len(rows) - h)) if len(rows) > h else 0
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
    return bar + f"   colony {ui['colony']}"


def _compact_now(text: str, w: int) -> str:
    """`tool path/to/file.py:1-50` -> `tool file.py:1-50`; a still-too-long range row keeps its tail, which is what changes."""
    m = re.match(r"^(\S+)\s+(?:\S*/)?(\S+:\d+(?:-\d+)?)$", text)
    if m:
        text = f"{m.group(1)} {m.group(2)}"
    if len(text) > w and re.search(r":\d+(?:-\d+)?$", text):
        return "…" + text[-(w - 1) :] if w > 1 else text[-w:]
    return text


def _table(snap, ui, w) -> list:
    seats = _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
    allseats = _seats(snap, ui["colony"])
    wide = w >= 119  # narrower panes drop RT/MODEL/CTX/WORK so NOW keeps the room
    pw, sw, rw, mw, stw, ww = (8, 15, 4, 17, 13, 15) if wide else (6, 11, 0, 0, 7, 0)
    nw = max(8, w - (pw + sw + rw + mw + 3 + stw + 1 + ww + 9) - 7) if wide else max(8, w - (pw + 1 + sw + 1 + stw + 1 + 1 + 1) - 7)
    hdr = (
        f"{'POD':<{pw}} {'SEAT':<{sw}} {'RT':<{rw}} {'MODEL':<{mw}} {'CTX':<3} {'STATE':<{stw}} {'Q':<1} {'WORK':<{ww}} {'NOW':<{nw}} ACTIONS"
        if wide
        else f"{'POD':<{pw}} {'SEAT':<{sw}} {'STATE':<{stw}} {'Q':<1} {'NOW':<{nw}} ACTIONS"
    )
    bad = [s for s in allseats if _attention(s)]
    tm = (snap.get("system") or {}).get("tmux") or {}
    if not allseats:
        health = "EMPTY FOR COLONY · no seats served; not a healthy verdict"
    elif bad:
        health = "ATTENTION · " + ", ".join(f"{s['name']} {s.get('state')}" for s in bad)
    else:
        health = f"OK · {len(allseats)} seats reporting · tmux {'ok' if tm.get('ok') else 'DOWN'}"
    flt = ui.get("filter", "")
    out = [
        "  ▪ CONFIG · colony settings  (open ▸)",
        f"HEALTH  {health}",
        f"/ {flt}" if flt else "/ filter agents…",
        hdr,
        "━" * w,
    ]
    row = max(0, min(ui.get("row", 0), len(seats) - 1))
    prev = None
    for i, s in enumerate(seats):
        st = s.get("state") or "unknown"
        pod = str(s.get("pod") or "")
        if prev is not None and pod != prev:
            out.append("┈" * w)
        mark = "▶" if i == row and ui.get("focus") == "pane" else " "
        q = int(s.get("queue") or 0)
        now = _compact_now(str(s.get("now") or "—"), nw)
        dotseat = _fit(DOT.get(st, "?") + " " + str(s.get("name")), sw)
        pcell = _fit(pod if pod != prev else "", pw)
        act = "term ▸" if s.get("target") else "—"
        if wide:
            out.append(
                f"{pcell}{mark}{dotseat} {_fit(RT.get(s.get('runtime'), '?'), rw)} {_fit(str(s.get('model') or '—'), mw)} {'—':<3} "
                f"{_fit(st, stw)} {q or '·'} {_fit(str(s.get('work') or '—'), ww)} {_fit(now, nw)} {act}"
            )
        else:
            out.append(f"{pcell}{mark}{dotseat} {_fit(st, stw)} {q or '·'} {_fit(now, nw)} {act}")
        prev = pod
    if not seats:
        out.append("no seats match")
    working = sum(1 for s in allseats if s.get("state") == "working")
    q = sum(int(s.get("queue") or 0) for s in allseats)
    out.append(f"{len(allseats)} seats · {working} working · {len(bad)} need attention · {q} open rows")
    return out + _recent_block(snap, ui, w, 5)


def _recent_block(snap, ui, w, n=None) -> list:
    c = _find_colony(snap, ui["colony"]) or {}
    ch = c.get("channel")
    ev = [e for e in snap.get("feed") or [] if not ch or e.get("channel") == ch]
    ev = [e for e in ev if _match(_ev(e), ui.get("filter", ""))]
    ev = ev[-n:] if n else ev
    out = [
        ("  ── RECENT · colony " + str(ui["colony"]) + " ").ljust(w, "─"),
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
        f"OVERVIEW · {c.get('label') or ui['colony']}",
        f"  task       {c.get('task') or '—'}",
        f"  session    {c.get('session') or '—'} ({c.get('transport') or '?'})",
        f"  channel    {c.get('channel') or '—'}",
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
            l1 = f"{DOT.get(s.get('state'), '?')} {s.get('name')}"
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
    title = f"╔═ ▦ COLONY {ui['colony']} "
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


def _seat_view(snap, ui, h) -> list:
    s = next((x for x in snap.get("seats") or [] if x.get("name") == ui["seat"]), None)
    if not s:
        return [f"SEAT {ui['seat']} · not found"]
    head = [
        f"SEAT {s['name']} · {s.get('runtime')} · {DOT.get(s.get('state'), '?')} {s.get('state')}",
        f"  colony {s.get('colony')} · pod {s.get('pod')} · target {s.get('target') or '—'} · t = attach",
    ]
    txt = ui.get("seat_text") or ""
    lines = [
        ANSI.sub("", ln).rstrip()
        for ln in (txt.splitlines() if isinstance(txt, str) else txt)
    ]
    if not s.get("target"):
        lines = [f"  no tmux pane for this seat (log: {s.get('log_path') or '—'})"]
    room = max(1, h - len(head) - 1)
    end = len(lines) - max(0, ui.get("seat_scroll", 0))
    shown = lines[max(0, end - room) : max(0, end)]
    return head + [""] + shown


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
    elif sec == "projects":
        out = ["PROJECTS", ""]
        out += [
            l
            for l in (
                f"  {p.get('name'):<24} {p.get('channels')} channels  {p.get('root')}"
                for p in snap.get("projects") or []
            )
            if _match(l, flt)
        ]
    elif sec == "terminals":
        out = [
            "TERMINALS · atlas tmux sessions",
            "",
            f"  {'SESSION':<28} WIN PANE ATT SEATS",
        ]
        for t in snap.get("terminals") or []:
            n = len(
                [
                    s
                    for s in snap.get("seats") or []
                    if str(s.get("target") or "").startswith(str(t.get("session")))
                ]
            ) or len(
                [c for c in _colonies(snap) if c.get("session") == t.get("session")]
            )
            line = f"  {t.get('session'):<28} {t.get('windows'):>3} {t.get('panes'):>4} {t.get('attached'):>3} {n}"
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
            "loading colonies…" if snap.get("loading") else f"{n} colonies · select one in Explorer",
            "Bright ▦ live agents · gray ▦ none · ? unknown",
        ]
    return out


def right_lines(snap, ui, w, h) -> list:
    if ui.get("seat"):
        return _seat_view(snap, ui, h)
    if ui["section"] == "topology" and ui.get("colony"):
        t = ui["tab"]
        body = {
            "table": lambda: _table(snap, ui, w),
            "recent": lambda: _recent_block(snap, ui, w),
            "overview": lambda: _overview(snap, ui),
            "graph": lambda: _graph(snap, ui, w),
            "health": lambda: _health(snap, ui["colony"]),
        }[t]()
        return [_tabbar(ui, snap)] + ([] if t in ("table", "recent") else [""]) + body
    return _list_view(snap, ui, h)


# ---------------------------------------------------------------- frame
def _title(snap, ui) -> str:
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
        "HELP · Command bar, common tasks & CLI",
        "At cmd ▸ type then Enter; Tab completes. <arg> required, [arg] optional.",
        "CLI in your terminal: atlas_tui.py --once · --view <section> · --seat <name> · --launch",
        "Keys: ↑↓ move · ←→ pane · ⏎ open · Esc back · : command · / filter · t term · q quit",
        "",
    ]
    for i, (c, d) in enumerate(cmds):
        out.append(("› " if i == sel else "  ") + f"{c:<44} {d}")
    return out


def render(snap: dict, ui: dict, width: int, height: int) -> list:
    width, height = max(width, 40), max(height, 8)
    snap = snap or {}
    mode = ui.get("mode", "")
    if mode == "help":
        top = f"help ▸ {ui['buf']}▊  · type to find a command"
    elif mode in ("cmd", "filter"):
        top = f"cmd ▸ {'/' if mode == 'filter' else ''}{ui['buf']}▊"
    else:
        top = f"cmd ▸ ▊  Tab complete · ? help · last {_clock(snap)}"
        if ui.get("filter"):
            top += f" · filter /{ui['filter']}"
    lines = [_fit(top, width)]
    foot = [
        _fit(HINTS, width),
        _fit(
            ui.get("status")
            or f"[{snap.get('host') or 'atlas'}] {_title(snap, ui).lower()}"
            + (f" · {snap.get('host')} → {ui['colony']}" if ui.get("colony") and not ui.get("seat") else ""),
            width,
        ),
    ]
    bodyh = height - 1 - 1 - 1 - 2  # cmd, header rule, bottom rule, hints+status
    if mode == "help":
        hl = _help_lines(ui)
        body = [_fit(x, width) for x in (hl + [""] * bodyh)[: bodyh + 2]]
        return (lines + body)[: height - 2] + foot
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


# ---------------------------------------------------------------- input
def _clamp(snap, ui):
    ui["cursor"] = max(0, min(ui["cursor"], len(explorer_rows(snap, ui)) - 1))
    n = len(_seats(snap, ui.get("colony"), ui.get("pod"), ui.get("filter", "")))
    ui["row"] = max(0, min(ui.get("row", 0), max(0, n - 1)))


def _open_seat(snap, ui, name) -> str:
    if not any(s.get("name") == name for s in snap.get("seats") or []):
        ui["status"] = f"no seat {name}"
        return ""
    ui["seat"], ui["seat_scroll"], ui["seat_text"], ui["focus"] = name, 0, "", "pane"
    return name


def _open_colony(snap, ui, cid):
    if not _find_colony(snap, cid):
        ui["status"] = f"no colony {cid}"
        return
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
    elif cmd == "send" and len(args) == 2:
        if not any(s.get("name") == args[0] for s in snap.get("seats") or []):
            ui["status"] = f"no seat {args[0]}"
            return None
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


def handle_key(snap, ui, key: str):
    """key: 'up','down','left','right','enter','esc','tab','backspace','pgup','pgdn' or a printable char."""
    mode = ui.get("mode", "")
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
    elif key == "t":
        return _seat_target(snap, ui)
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
        ui["focus"] = "pane" if key == "right" else "explorer"
    elif key in ("up", "down", "pgup", "pgdn"):
        d = -1 if key in ("up", "pgup") else 1
        step = 10 if key in ("pgup", "pgdn") else 1
        if ui["focus"] == "explorer":
            ui["cursor"] += d * step
        elif in_seat:
            ui["seat_scroll"] = max(
                0, ui.get("seat_scroll", 0) - d * step
            )  # up = older output
        elif ui.get("colony") and ui["tab"] == "table":
            ui["row"] = ui.get("row", 0) + d * step
        else:
            ui["pane_scroll"] = max(0, ui.get("pane_scroll", 0) + d * step)
    elif key == "enter":
        if (
            ui["focus"] == "pane"
            and not in_seat
            and ui.get("colony")
            and ui["tab"] == "table"
        ):
            seats = _seats(snap, ui["colony"], ui.get("pod"), ui.get("filter", ""))
            if seats:
                _open_seat(
                    snap,
                    ui,
                    seats[max(0, min(ui.get("row", 0), len(seats) - 1))]["name"],
                )
        elif ui["focus"] == "explorer" and rows:
            r = rows[max(0, min(ui["cursor"], len(rows) - 1))]
            if r[1] == "section":
                ui.update(section=r[2], colony=None, seat=None, sub=None, pane_scroll=0)
            elif r[1] == "colony":
                _open_colony(snap, ui, r[2])
            elif r[1] == "pod":
                _open_colony(snap, ui, r[2][0])
                ui.update(pod=r[2][1], focus="explorer")
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
    vid = f"tui{os.getpid()}"
    try:
        setup, argv = m.attach_argv(s["target"], vid)
        for cmd in _norm_setup(setup):
            subprocess.run(
                cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        subprocess.run(argv, check=False)
    finally:
        try:
            m.cleanup_view(vid)
        except Exception:
            pass
    return ""


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
    ui = new_ui()
    ui["status"] = "loading colonies…"
    snap = {"loading": True}
    loader = Loader(root, args.all)
    loader.start()
    first = True
    last_snap = last_cap = 0.0
    curses.curs_set(0)
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
            ui["status"] = f"snapshot failed: {res}"
            last_snap = now
        elif res is not None:
            snap, last_snap = res, now
            if first:
                first = False
                ui["status"] = ""
                focus_first_live(snap, ui)
        if now - last_snap >= 2:
            loader.start()
        if ui.get("seat") and now - last_cap >= 1:
            s = next(
                (x for x in snap.get("seats") or [] if x.get("name") == ui["seat"]),
                None,
            )
            if s and s.get("target"):
                ui["seat_text"] = _model().capture(s["target"], 200, False)
            last_cap = now
        h, w = stdscr.getmaxyx()
        if h < MIN_H or w < MIN_W:
            frame = [f"terminal too small ({w}x{h}); need {MIN_W}x{MIN_H}"]
        else:
            frame = render(snap, ui, w, h)
        stdscr.erase()
        for i, ln in enumerate(frame[:h]):
            try:
                stdscr.addstr(i, 0, ln[: w - 1] if i == h - 1 else ln[:w])
            except curses.error:
                pass
        stdscr.refresh()
        ch = stdscr.getch()
        if ch == -1:
            continue
        if ch == curses.KEY_RESIZE:
            curses.update_lines_cols()
            stdscr.clear()  # full repaint at the new size
            continue
        if ch == 27:  # lone Esc arrives after the keypad timeout
            key = "esc"
        else:
            key = _keyname(ch, curses)
        if not key:
            continue
        eff = handle_key(snap, ui, key)
        if not eff:
            continue
        if eff[0] == "quit":
            return
        if eff[0] == "refresh":
            loader.start()
        elif eff[0] == "term":
            curses.endwin()
            err = attach(snap, eff[1], _model())
            stdscr.refresh()
            ui["status"] = err or f"returned from {eff[1]}"
            loader.start()
        elif eff[0] == "send":
            try:
                send(root, eff[1], eff[2], snap)
                ui["status"] = f"sent to {eff[1]}"
            except Exception as e:  # board write failure must not kill the TUI
                ui["status"] = f"send failed: {e}"


def launch(args) -> int:
    script = str(Path(__file__).resolve())
    cmd = [sys.executable, script, "--project", _root(args)] + (
        ["--all"] if args.all else []
    )
    line = shlex.join(cmd)
    if os.environ.get("TMUX"):
        r = subprocess.run(["tmux", "new-window", "-P", "-F", "#{window_id}", "-n", "atlas-tui", line],
                           check=False, capture_output=True, text=True)
        if r.stdout.strip():
            subprocess.run(["tmux", "set-window-option", "-t", r.stdout.strip(), "automatic-rename", "off"], check=False)
        print("opened Atlas Command Center in a new tmux window 'atlas-tui'")
    else:
        subprocess.run(
            ["tmux", "new-session", "-d", "-s", "atlas-tui", "-n", "atlas-tui", line], check=False
        )
        subprocess.run(["tmux", "set-window-option", "-t", "atlas-tui:atlas-tui", "automatic-rename", "off"], check=False)
        print("attach with: tmux attach -t atlas-tui")
    return once(args)


def once(args) -> int:
    if args.fixture:
        snap = json.loads(Path(args.fixture).read_text())
    else:
        snap = _model().snapshot(_root(args), args.all)
    ui = new_ui(section=args.view or "topology")
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
    ui["cursor"] = SECTIONS.index(ui["section"])
    if not args.colony and not args.seat:
        focus_first_live(snap, ui)
    print("\n".join(render(snap, ui, args.width, args.height)))
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Atlas Command Center")
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
