#!/usr/bin/env python3
"""Colony model: one read-only snapshot of every colony, seat and tmux pane, shared by the
Atlas Command Center TUI (atlas_tui.py) and the dashboard terminal workspace (atlas_dash_term.py).

    snapshot(root, all_projects)   the dict both UIs render (shape: docs/colony-model.md contract C1)
    capture(target, lines, ansi)   a pane's text, "" when tmux is missing or the pane is gone
    pane_state(text, runtime)      "working" | "idle" | "blocked" | "unknown" from the pane's text
    attach_argv(target, view_id)   (setup argv list, attach argv) for a grouped, disposable tmux view
    cleanup_view(view_id)          kill that view session

Stdlib only. Never raises on a missing tmux/herdr/db: the matching fields just read empty.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_todo  # noqa: E402

PLUGIN_DIR = SCRIPTS_DIR.parent
FEED_MAX = 200
NOW_MAX = 120
FINISHED_GRACE_S = 300  # a colony whose seats all exited stays listed (finished) this long
TEAM_GRACE_S = 180  # a just-spawned team record is listed this long while its panes come up
OPEN = ("pending", "in_progress")
TMUX_TIMEOUT = 5
HARNESSES = ("claude", "omp", "codex")
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")

# --- pane_state -----------------------------------------------------------------------------------
# Markers per harness TUI, plus atlas_panefeed's own feed (every `atlas_mux run-worker` pane renders it,
# whatever the harness): a spinner + "working" status row, then "✔ DONE" / "✖ FAILED" when it ends.
BLOCKED = re.compile(r"Do you want to|❯ 1\. Yes|\(y/n\)", re.I)
FEED_BUSY = re.compile(r"[⣾⣽⣻⢿⡿⣟⣯⣷] working")
FEED_DONE = re.compile(r"[✔✖] (?:DONE|FAILED)")
_RT = {  # runtime -> (busy, idle)
    "claude": (re.compile(r"esc to interrupt"), re.compile(r"^\s*[>❯] ", re.M)),
    "codex": (re.compile(r"Working \(.*esc to interrupt"), re.compile(r"^\s*› ", re.M)),
    "omp": (re.compile(r"Working…"), re.compile(r"^❯", re.M)),
}


def strip_ansi(text: str) -> str:
    return _ANSI.sub("", text)


def pane_state(text: str, runtime: str) -> str:
    """Classify a pane from its last lines. Blocked beats busy beats idle; a finished feed is idle."""
    tail = "\n".join(strip_ansi(text or "").splitlines()[-40:])
    if not tail.strip():
        return "unknown"
    if BLOCKED.search(tail):
        return "blocked"
    rts = [_RT[runtime]] if runtime in _RT else list(_RT.values())
    if FEED_BUSY.search(tail) or any(b.search(tail) for b, _ in rts):
        return "working"
    if FEED_DONE.search(tail) or any(i.search(tail) for _, i in rts):
        return "idle"
    return "unknown"


# --- tmux -----------------------------------------------------------------------------------------
def _tmux(*args: str) -> tuple[int, str]:
    try:
        r = subprocess.run(
            ["tmux", *args], capture_output=True, text=True, timeout=TMUX_TIMEOUT
        )
    except (OSError, subprocess.SubprocessError):
        return 127, ""
    return r.returncode, r.stdout


def _f(v, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _i(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def capture(target: str, lines: int = 200, ansi: bool = True) -> str:
    argv = ["capture-pane", "-p", "-J"] + (["-e"] if ansi else [])
    rc, out = _tmux(*argv, "-S", f"-{max(1, _i(lines, 200))}", "-t", target)
    return out if rc == 0 else ""


def attach_argv(target: str, view_id: str) -> tuple[list[list[str]], list[str]]:
    """Setup commands (tmux argv lists, run in order) and the attach argv for a grouped view session
    `atlas-view-<id>`: it shares the worker's windows but has its own current window, so attaching never
    moves anyone else's view. The attach argv sets `destroy-unattached` once attached, so a view whose client
    drops is reaped even if cleanup_view never runs."""
    view = f"atlas-view-{view_id}"
    if target.startswith("%"):
        rc, out = _tmux(
            "display-message", "-p", "-t", target, "#{session_name}\t#{window_id}"
        )
        session, _, window = out.strip().partition("\t")
        if rc != 0 or not session:
            session, window = target, ""  # tmux then rejects the unknown target itself
    else:
        session, _, window = target.partition(":")
    setup = [["tmux", "new-session", "-d", "-t", session, "-s", view]]
    if window:
        setup.append(["tmux", "select-window", "-t", f"{view}:{window}"])
    if target.startswith("%"):
        setup.append(["tmux", "select-pane", "-t", target])
    if target.startswith(
        "%"
    ):  # zoom (once) so the view shows only that worker in a tiled team window
        setup.append(
            [
                "tmux",
                "if-shell",
                "-F",
                "-t",
                target,
                "#{window_zoomed_flag}",
                "",
                f"resize-pane -Z -t {target}",
            ]
        )
    # destroy-unattached applies only after attach: set on a detached session tmux destroys it at once
    return setup, [
        "tmux",
        "attach-session",
        "-t",
        view,
        ";",
        "set-option",
        "-t",
        view,
        "destroy-unattached",
        "on",
    ]


def cleanup_view(view_id: str) -> None:
    _tmux("kill-session", "-t", f"atlas-view-{view_id}")


def _panes() -> list[dict]:
    keys = (
        "pane_id",
        "session_name",
        "window_name",
        "pane_pid",
        "pane_dead",
        "pane_dead_status",
        "@atlas_worker",
        "@atlas_role",
        "pane_current_command",
        "pane_current_path",
        "pane_dead_time",
    )
    rc, out = _tmux("list-panes", "-a", "-F", "\t".join("#{%s}" % k for k in keys))
    if rc != 0:
        return []
    rows = [
        dict(zip(keys, (ln.split("\t") + [""] * len(keys))[: len(keys)]))
        for ln in out.splitlines()
    ]
    return [
        r
        for r in rows
        if r["session_name"].startswith("atlas-")
        and not r["session_name"].startswith("atlas-view-")
    ]


# --- sources --------------------------------------------------------------------------------------
def _json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _teams(root: str) -> list[dict]:
    d = Path(root) / ".atlas" / ".run" / "teams"
    recs = []
    for p in sorted(d.glob("*.json")):
        r = _json(p)
        if isinstance(r, dict) and r.get("team_id"):
            try:
                r["_mtime"] = p.stat().st_mtime
            except OSError:
                pass
            recs.append(r)
    return sorted(recs, key=lambda r: r.get("created") or 0)


def _registry(root: str) -> dict:
    data = _json(Path(root) / ".atlas" / ".run" / "channels.json")
    chans = data.get("channels") if isinstance(data, dict) else None
    return chans if isinstance(chans, dict) else {}


def _first_line(text) -> str:
    return next((ln.strip() for ln in str(text or "").splitlines() if ln.strip()), "")


def _pid_gone(pid) -> bool:
    """True when pid is a recorded process that no longer exists (a seat with no pane that exited)."""
    pid = _i(pid)
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except OSError:
        return False
    return False


_DEAD_SEEN: dict = {}  # pane_id -> first time a snapshot saw it dead (when tmux has no dead time)


def _ended_fallback(seat: dict, pane: dict | None, team: dict | None, now: float) -> float:
    """End time of a seat whose channel entry has no ended_at (crash, kill --run, claude-bg exit):
    the latest of the pane's dead time, the worker log mtime and the team record mtime."""
    cands = [_f((team or {}).get("_mtime"))]
    try:
        cands.append(Path(seat["log_path"]).stat().st_mtime if seat["log_path"] else 0.0)
    except OSError:
        pass
    if pane and pane["pane_dead"] == "1":
        cands.append(_f(pane.get("pane_dead_time")) or _DEAD_SEEN.setdefault(pane["pane_id"], now))
    return max(cands)


def _log_info(path: Path) -> tuple[str, str]:
    """(runtime, model) from the worker log's first line: `$ claude ... --model X`."""
    try:
        with path.open(encoding="utf-8", errors="replace") as f:
            first = f.readline()
    except OSError:
        return "unknown", ""
    if not first.startswith("$ "):
        return "unknown", ""
    try:
        words = shlex.split(first[2:])
    except ValueError:
        words = first[2:].split()
    rt = next(
        (os.path.basename(w) for w in words if os.path.basename(w) in HARNESSES),
        "unknown",
    )
    model = ""
    for i, w in enumerate(words):
        if w in ("--model", "-m") and i + 1 < len(words):
            model = words[i + 1]
        elif w.startswith("--model="):
            model = w[8:]
    return rt, model


def _clock(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _last_line(text: str) -> str:
    lines = [ln.strip() for ln in strip_ansi(text).splitlines() if ln.strip()]
    return lines[-1][:NOW_MAX] if lines else ""


# A harness's tool-call row: an optional bullet, then `tool_name args` or `Tool(args)`; or the panefeed's
# `HH:MM:SS  tool  args` row (its `think` rows are narration, not a tool).
_ACTIVITY = re.compile(
    r"^[\s│┃]*(?:[●⏺•▸→⎿✔]\s*)?((?:ctx_\w+|[Rr]ead|[Bb]ash|[Gg]rep|[Gg]lob|[Ee]dit|[Ww]rite|[Ff]ind|[Ss]earch|[Tt]ask|[Ww]eb\w*)\b[( :].*\S)"
    r"|^\s*\d\d:\d\d:\d\d\s+(?!think\b)(\S+\s+\S.*\S)"
)


def _pane_activity(text: str) -> str:
    """The seat's latest tool/activity row from its live pane ('' when none is visible)."""
    for ln in reversed(strip_ansi(text or "").splitlines()[-60:]):
        if m := _ACTIVITY.match(ln):
            return " ".join((m.group(1) or m.group(2)).split())[:NOW_MAX]
    return ""


def _specs() -> list[dict]:
    out = []
    for p in sorted((PLUGIN_DIR / "agents").glob("*.md")):
        try:
            head = p.read_text(encoding="utf-8").split("---")[1]
        except (OSError, IndexError):
            continue
        m = re.search(r'^description:\s*"?(.*?)"?\s*$', head, re.M)
        out.append(
            {"kind": "agent", "name": p.stem, "description": m.group(1) if m else ""}
        )
    matrix = _json(PLUGIN_DIR / "contracts" / "scope-matrix.json") or {}
    for cls, efforts in (matrix.get("classes") or {}).items():
        out.append({"kind": "team", "name": cls, "efforts": list(efforts)})
    return out


def _projects(root: str, all_projects: bool) -> list[dict]:
    roots = [root]
    if all_projects:
        try:
            import atlas_db

            conn = atlas_db.connect()
            try:
                roots += [
                    r[0]
                    for r in conn.execute(
                        "SELECT root_path FROM projects ORDER BY last_seen DESC"
                    )
                ]
            finally:
                conn.close()
        except Exception:
            pass
    seen, out = set(), []
    for r in roots:
        if r in seen or not Path(r).is_dir():
            continue
        seen.add(r)
        out.append({"root": r, "name": Path(r).name, "channels": len(_registry(r))})
    return out


_STATIC: dict = {}  # name -> (expires, value); specs and harness availability barely change
STATIC_TTL_S = 60


def _static(name: str, fn):
    hit = _STATIC.get(name)
    if hit and hit[0] > time.time():
        return hit[1]
    val = fn()
    _STATIC[name] = (time.time() + STATIC_TTL_S, val)
    return val


def _installed() -> dict:
    rc, ver = _tmux("-V")
    try:
        import atlas_seats

        herdr = bool(atlas_seats.agents()["reachable"])
    except Exception:
        herdr = False
    return {
        "tmux": {"ok": rc == 0, "version": ver.strip()},
        "herdr": {"ok": herdr},
        "rig": {"ok": bool(shutil.which("rig"))},
        "harnesses": {h: bool(shutil.which(h)) for h in HARNESSES},
    }


def _system() -> dict:
    port = _i(os.environ.get("ATLAS_DASHBOARD_PORT"), 7421)
    url = f"http://127.0.0.1:{port}/"
    try:
        socket.create_connection(("127.0.0.1", port), timeout=0.3).close()
        dash = True
    except OSError:
        dash = False
    inst = _static("installed", _installed)
    return {
        "tmux": inst["tmux"],
        "dashboard": {"ok": dash, "url": url},
        "herdr": inst["herdr"],
        "rig": inst["rig"],
        "harnesses": inst["harnesses"],
    }


def _terminals(panes_all: list[dict]) -> list[dict]:
    rc, out = _tmux(
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_windows}\t#{session_attached}",
    )
    res = []
    for ln in out.splitlines() if rc == 0 else []:
        name, wins, att = (ln.split("\t") + ["0", "0"])[:3]
        if name.startswith("atlas-") and not name.startswith("atlas-view-"):
            res.append(
                {
                    "session": name,
                    "windows": _i(wins),
                    "attached": _i(att),
                    "panes": sum(1 for p in panes_all if p["session_name"] == name),
                }
            )
    return res


_NOTES: dict = {}  # board file path -> ((mtime_ns, size), tail records)
NOTE_TAIL_LINES = 200  # the feed shows FEED_MAX; the per-seat "now" needs only each file's last note
NOTE_TAIL_BYTES = 256 * 1024


def _tail_notes(path: Path) -> list[dict]:
    """Last NOTE_TAIL_LINES notes of one board file, re-read only when its mtime/size changed."""
    try:
        st = path.stat()
        key = (st.st_mtime_ns, st.st_size)
        hit = _NOTES.get(path)
        if hit and hit[0] == key:
            return hit[1]
        with path.open("rb") as f:
            start = max(0, st.st_size - NOTE_TAIL_BYTES)
            f.seek(start)
            lines = f.read().split(b"\n")
    except OSError:
        return []
    if start:
        lines = lines[1:]  # first line is cut mid-record
    recs = []
    for raw in lines[-NOTE_TAIL_LINES - 1 :]:
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        if isinstance(rec, dict):
            recs.append(rec)
    recs = recs[-NOTE_TAIL_LINES:]
    _NOTES[path] = (key, recs)
    return recs


def _board_files(root: str) -> list[tuple[int, Path]]:
    d = atlas_todo.notes_dir(root)
    return [(p.stat().st_mtime_ns, p) for p in d.glob(f"*{atlas_todo.NOTE_FILE_SUFFIX}")]


def _recent_notes(files: list[tuple[int, Path]]) -> list[dict]:
    """Notes of the most recently written board files, until FEED_MAX are in hand, ts-sorted.
    shortcut: a quiet file's older notes can miss the feed window, fine for a 200-line feed."""
    recs: list[dict] = []
    for _, p in sorted(files, key=lambda f: f[0], reverse=True):
        recs += _tail_notes(p)
        if len(recs) >= FEED_MAX:
            break
    recs.sort(key=lambda r: (atlas_todo._note_ts_key(r), atlas_todo._note_seq(r)))
    return recs


def _within(path: str, root: str) -> bool:
    path = os.path.realpath(path) if path else ""
    return bool(path) and (path == root or path.startswith(root.rstrip("/") + "/"))


def _owner(path: str, roots: list[str]) -> str:
    """Deepest known project root containing path, else path itself (an unregistered project)."""
    hits = [r for r in roots if _within(path, r)]
    return max(hits, key=len) if hits else path


def _active(root: str, panes_all: list[dict]) -> bool:
    """A project worth scanning: it has team records or a live pane running inside it."""
    return (Path(root) / ".atlas" / ".run" / "teams").is_dir() or any(
        _within(p["pane_current_path"], root) for p in panes_all
    )



_STOP = frozenset("a an and the of to in on for with from by only is are be as at it this that into over then please".split())
_EXT = re.compile(r"\.(?:py|ts|tsx|js|jsx|md|json|sh|yml|yaml)\b")


def _slug(text: str, fallback: str = "") -> str:
    """A 3-word human slug of a task ('Read-only: read atlas_tui.py in 10 chunks' -> read-atlas-tui)."""
    words: list[str] = []
    for w in re.findall(r"[a-z0-9]+", _EXT.sub(" ", str(text or "").lower())):
        if w not in _STOP and not w.isdigit() and w not in words:
            words.append(w)
        if len(words) == 3:
            break
    return "-".join(words)[:32].strip("-") or fallback


def _role_label(role: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", str(role or "").lower().removeprefix("atlas:")).strip("-") or "worker"


def _role_title(role: str, specs: list[dict]) -> str:
    """One-line role description from agents/<role>.md, at most 40 chars."""
    desc = next((s["description"] for s in specs if s["kind"] == "agent" and s["name"] == _role_label(role)), "")
    return desc if len(desc) <= 40 else desc[:39].rstrip() + "…"


def _source_label(src: dict, channel: str) -> str:
    """`from <harness> session <session> · lead <lead> · <project>`, empty parts omitted, else `channel <channel>`."""
    parts = [
        f"from {src['harness']}" + (f" session {src['session']}" if src["session"] else "")
        if src["harness"]
        else (f"from session {src['session']}" if src["session"] else ""),
        f"lead {src['lead']}" if src["lead"] else "",
        src["project"],
    ]
    parts = [x for x in parts if x]
    return " · ".join(parts) if parts else (f"channel {channel}" if channel else "")


def _name_colonies(colonies: dict, teams: list[dict]) -> None:
    """Give every colony a unique human `name`, a `title` and a `source`, in place. Oldest first so a name
    never changes when a later colony shares its slug (the later one gets the -2 suffix)."""
    rec = {t["team_id"]: t for t in teams}
    taken: set[str] = set()
    for c in sorted(colonies.values(), key=lambda c: (_f(c.get("created")), c["id"])):
        t = rec.get(c["id"]) or {}
        base = t.get("name") or _slug(c.get("task") or "", _slug(c["id"].replace("_", "-")) or "colony")
        name, n = base, 2
        while name in taken:
            name, n = f"{base}-{n}", n + 1
        taken.add(name)
        src = t.get("source")
        if not isinstance(src, dict):
            src = {}
        chan = str(c.get("channel") or "")
        c["name"] = name
        c["title"] = (c.get("task") or "")[:60]
        c["source"] = {
            "project": src.get("project") or Path(c.get("project") or "").name,
            "lead": src.get("lead") or t.get("lead") or (chan.rsplit("/", 1)[-1] if "/" in chan else ""),
            "harness": src.get("harness") or "",
            "session": src.get("session") or "",
        }
        c["source"]["label"] = _source_label(c["source"], chan)


def _address_seats(seats: list[dict], colonies: dict, teams: list[dict], specs: list[dict]) -> None:
    """Set each seat's `address` (<role>[-<n>]@<colony name>; n only when the role repeats, in spawn order
    then name) and `role_title`, in place."""
    spawn = {m["name"]: i for t in teams for i, m in enumerate(t.get("members") or [])}
    by_role: dict = {}
    for s in sorted(seats, key=lambda s: (spawn.get(s["name"], 10**6), s["name"])):
        by_role.setdefault((s["colony"], _role_label(s["role"])), []).append(s)
    for (cid, role), group in by_role.items():
        for i, s in enumerate(group, 1):
            s["address"] = f"{role}{'-' + str(i) if len(group) > 1 else ''}@{colonies[cid]['name']}"
            s["role_title"] = _role_title(role, specs)


# --- snapshot -------------------------------------------------------------------------------------
def snapshot(root: str | None = None, all_projects: bool = False) -> dict:
    root = os.path.realpath(root or os.getcwd())
    now = time.time()
    projects = _projects(root, all_projects)
    roots = [root] + [p["root"] for p in projects if p["root"] != root]
    panes_all = _panes()

    members: dict = {}  # name -> {role, channel, entry}
    team_of: dict = {}
    proj_of: dict = {}  # seat name / team_id -> owning project root
    teams, items, board = [], [], []
    for r in roots:
        if all_projects and r != root and not _active(r, panes_all):
            continue
        rteams = _teams(r)
        teams += rteams
        for c in _registry(r).values():
            for m in c.get("members") or []:
                if m.get("name") and m.get("role") != "lead" and m["name"] not in members:
                    members[m["name"]] = {
                        "role": m.get("role") or "worker",
                        "entry": m,
                        "channel": c.get("name"),
                    }
                    proj_of[m["name"]] = r
        for t in rteams:
            proj_of[t["team_id"]] = r
            for m in t.get("members") or []:
                team_of.setdefault(m["name"], t)
                proj_of.setdefault(m["name"], r)
                members.setdefault(
                    m["name"],
                    {
                        "role": m.get("role") or "worker",
                        "entry": {},
                        "channel": t.get("channel"),
                    },
                )
                members[m["name"]]["role"] = m.get("role") or members[m["name"]]["role"]
        items += [i for i in atlas_todo.load(r).get("items", []) if not i.get("archived")]
        try:
            board += _board_files(r)
        except OSError:
            pass
    notes = _recent_notes(board)
    session_team = {f"atlas-{t['team_id']}": t for t in teams}

    # seats: tmux panes first (they carry the live facts), then registry/team members with no pane
    seats: dict = {}
    for p in panes_all:
        name = p["@atlas_worker"] or (
            p["window_name"] if p["window_name"] in members else ""
        )
        if not name or not (all_projects or name in members):
            continue
        seats[name] = {
            "pane": p,
            "role": p["@atlas_role"]
            or (members.get(name) or {}).get("role")
            or "worker",
        }
    for name, m in members.items():
        seats.setdefault(name, {"pane": None, "role": m["role"]})

    last_note = {str(n.get("owner")): n for n in notes}
    for name in seats:  # a live seat's last note may sit in a file older than the feed window
        if name not in last_note:
            f = atlas_todo.notes_dir(proj_of.get(name) or root) / f"{name}{atlas_todo.NOTE_FILE_SUFFIX}"
            if tail := _tail_notes(f):
                last_note[name] = tail[-1]

    colonies: dict = {}
    for t in teams:
        colonies[t["team_id"]] = {
            "id": t["team_id"],
            "project": proj_of.get(t["team_id"], root),
            "label": f"{t['team_id']} · {t.get('class', '?')}/{t.get('effort', '?')}",
            "session": f"atlas-{t['team_id']}",
            "transport": t.get("transport") or "tmux",
            "task": _first_line(t.get("task")),
            "channel": t.get("channel") or "",
            "created": t.get("created"),
            "pods": [],
        }

    out_seats = []
    for name, s in seats.items():
        p, m = s["pane"], members.get(name) or {"entry": {}, "channel": ""}
        entry = m["entry"]
        team = team_of.get(name) or (session_team.get(p["session_name"]) if p else None)
        if team:
            cid = team["team_id"]
        elif p:
            cid = p["session_name"][len("atlas-") :]
        else:
            cid = str(m.get("channel") or "colony").rsplit("/", 1)[-1]
        if cid not in colonies:
            colonies[cid] = {
                "id": cid,
                "label": cid,
                "session": p["session_name"] if p else "",
                "project": proj_of.get(name) or _owner((p or {}).get("pane_current_path") or root, roots),
                "transport": "tmux" if p else "claude-bg",
                "task": "",
                "channel": str(m.get("channel") or ""),
                "created": None,
                "pods": [],
            }
        log = Path(proj_of.get(name) or root) / ".atlas" / ".run" / "logs" / f"{name}.log"
        runtime, model = _log_info(log)
        if runtime == "unknown" and p and p["pane_current_command"] in HARNESSES:
            runtime = p["pane_current_command"]
        target = p["pane_id"] if p else ""
        text = capture(target, 60, ansi=False) if p and p["pane_dead"] != "1" else ""
        exit_code = entry.get("exit_code")
        if (
            exit_code is None
            and p
            and p["pane_dead"] == "1"
            and p["pane_dead_status"].lstrip("-").isdigit()
        ):
            exit_code = _i(p["pane_dead_status"])
        note = last_note.get(name)
        if exit_code is not None:
            state = "finished" if exit_code == 0 else "dead"
        elif p and p["pane_dead"] == "1":
            state = "dead"
        elif not p:
            state = "dead" if _pid_gone(entry.get("pid")) else "unknown"
        else:
            state = pane_state(text, runtime)
            if (
                state == "unknown"
            ):  # a live pane that matches no marker is a running process, not a mystery
                state = "working"
            if state == "working" and note and note.get("kind") == "blocked":
                state = "blocked"
        mine = [i for i in items if i.get("owner") == name and i.get("status") in OPEN]
        try:
            mtime = log.stat().st_mtime
        except OSError:
            mtime = 0.0
        active = max(
            mtime, _f(note["ts"]) if note else 0.0, _f(entry.get("joined"))
        )
        pid = _i(p["pane_pid"]) if p and p["pane_pid"].isdigit() else entry.get("pid")
        out_seats.append(
            {
                "name": name,
                "colony": cid,
                "project": colonies[cid].get("project") or root,
                "pod": s["role"],
                "role": s["role"],
                "runtime": runtime,
                "model": model,
                "state": state,
                "exit_code": exit_code,
                "target": target,
                "pid": pid,
                "queue": len(mine),
                "work": (
                    f"{mine[0].get('id')} "
                    + " ".join(str(mine[0].get("content") or "").split())
                )[:NOW_MAX]
                if mine
                else "",
                "now": _pane_activity(text)
                or (
                    " ".join(str(note["text"]).split())[:NOW_MAX]
                    if note and note.get("text")
                    else _last_line(text)
                ),
                "log_path": str(log) if log.is_file() else "",
                "last_active": active or None,
                "lead": atlas_todo.is_lead_name(name),
            }
        )
    _name_colonies(colonies, teams)
    _address_seats(out_seats, colonies, teams, _static("specs", _specs))
    # Only colonies with work in progress: a live pane that is working/idle/blocked, or a team
    # record younger than TEAM_GRACE_S whose panes are not up yet. Finished/dead/pane-less is history.
    live = {s["colony"] for s in out_seats if s["target"] and s["state"] not in ("dead", "finished")}
    fresh = {
        t["team_id"]
        for t in teams
        if t.get("state") not in ("archived", "reaped")
        and now - _f(t.get("created")) < TEAM_GRACE_S
        and not any(s["target"] for s in out_seats if s["colony"] == t["team_id"])
    }
    reaped = {t["team_id"] for t in teams if t.get("state") in ("archived", "reaped")}
    ended: dict = {}
    team_by_id = {t["team_id"]: t for t in teams}
    for s_ in out_seats:
        e = _f((members.get(s_["name"]) or {"entry": {}})["entry"].get("ended_at"))
        if not e and s_["state"] in ("finished", "dead"):
            e = _ended_fallback(s_, seats[s_["name"]]["pane"], team_by_id.get(s_["colony"]), now)
        ended[s_["colony"]] = max(ended.get(s_["colony"], 0.0), e)
    done = {
        cid
        for cid in colonies
        if cid not in live
        and cid not in reaped
        and 0 < now - ended.get(cid, 0.0) < FINISHED_GRACE_S
        and all(s_["state"] in ("finished", "dead") for s_ in out_seats if s_["colony"] == cid)
    }
    keep = live | fresh | done
    for cid, c in colonies.items():
        c["finished"] = cid in done
    colonies = {k: v for k, v in colonies.items() if k in keep}
    out_seats = [s for s in out_seats if s["colony"] in keep]
    for seat in out_seats:
        pods = colonies[seat["colony"]]["pods"]
        pod = next((x for x in pods if x["id"] == seat["pod"]), None)
        if pod is None:
            pods.append(pod := {"id": seat["pod"], "seats": []})
        pod["seats"].append(seat["name"])

    feed = [
        {
            "ts": n.get("ts"),
            "seq": n.get("seq"),
            "from": n.get("owner"),
            "to": n.get("to") or "all",
            "kind": n.get("kind") or "note",
            "text": str(n.get("text") or ""),
            "channel": n.get("channel") or "",
        }
        for n in notes[-FEED_MAX:]
    ]
    return {
        "ok": True,
        "host": socket.gethostname().split(".")[0],
        "clock": _clock(now),
        "project": root,
        "colonies": list(colonies.values()),
        "seats": out_seats,
        "feed": feed,
        "needs": [f for f in feed if f["kind"] == "blocked" or f["to"] == "human"],
        "specs": _static("specs", _specs),
        "projects": projects,
        "terminals": _terminals(panes_all),
        "system": _system(),
    }


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Print the colony snapshot")
    ap.add_argument("--root")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    print(json.dumps(snapshot(a.root, a.all), indent=None if a.json else 2))
