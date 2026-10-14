"""Branded live feed for tmux worker panes (Catppuccin-Mocha truecolor).

`claude -p` prints nothing until it finishes, so the pane looks dead. The worker runs claude with
`--output-format stream-json --verbose`; atlas_mux feeds each line to a Feed, which keeps a sticky
header (gradient bar, goal, channel and peers), one row per event (timestamp, tool chip, unwrapped
argument) and a sticky status line. On a terminal the whole pane is repainted in place, every row cut
to the pane width (never wrapped); piped (logs, tests) the rows are printed in order instead.
"""

from __future__ import annotations

import collections
import json
import os
import re
import shlex
import shutil
import sys
import threading
import time
from pathlib import Path

ESC = "\x1b["
RST = ESC + "0m"


def _hx(s: str) -> tuple:
    return tuple(int(s[i : i + 2], 16) for i in (1, 3, 5))


PANEL, PANEL2, TXT, MUT, DIM = _hx("#11111b"), _hx("#181825"), _hx("#cdd6f4"), _hx("#6c7086"), _hx("#45475a")
VIOLET, TEAL, SKY, BLUE, GREEN = _hx("#cba6f7"), _hx("#94e2d5"), _hx("#89dceb"), _hx("#89b4fa"), _hx("#a6e3a1")
PEACH, RED, YEL, PINK, BASE = _hx("#fab387"), _hx("#f38ba8"), _hx("#f9e2af"), _hx("#f5c2e7"), _hx("#1e1e2e")
SPIN = "⣾⣽⣻⢿⡿⣟⣯⣷"
EIGHTHS = " ▏▎▍▌▋▊▉█"
CHIP_W = 10
# new work = input + output + cache writes; cache reads are re-sent context, shown apart once large
_NEW_KEYS = ("input_tokens", "output_tokens", "cache_creation_input_tokens")
CACHED_SHOWN = 10_000
MAX_CALLS = 64  # call-time history kept per lane (omp/channel-view.ts MAX_CALLS)
# tool input fields worth showing, first match wins
_ARG_KEYS = ("file_path", "path", "command", "pattern", "query", "description", "url", "prompt")


def fg(c) -> str:
    return ESC + "38;2;%d;%d;%dm" % c


def bg(c) -> str:
    return ESC + "48;2;%d;%d;%dm" % c


def lerp(a, b, t: float) -> tuple:
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def seg(text: str, f=None, b=None, bold: bool = False) -> tuple:
    return (text, f, b, bold)


def paint(segs, width: int) -> str:
    """Segments left to right, cut and padded to exactly `width` cells in the panel color. Every cell
    is written: capture-pane drops EL-cleared cells, so an EL-filled bar captured short. The live
    feed places each row with CUP, so a full row never wraps (checked: capture-pane -J keeps it
    separate)."""
    out, left = [], width
    for text, f, b, bold in segs:
        if left <= 0:
            break
        text = text.replace("\t", " ")[:left]
        left -= len(text)
        out.append((ESC + "1m" if bold else "") + (fg(f) if f else "") + bg(b or PANEL) + text + RST)
    return "".join(out) + bg(PANEL) + " " * left + RST


def gradient_bar(left: str, right: str, width: int, a=GREEN, b=TEAL) -> str:
    """Exactly `width` cells of gradient title bar, `left` text at the start and `right` flush right
    when it fits."""
    cols = width
    cells = list((" " + left)[:cols].ljust(cols))
    tail = right + " "
    if len(left) + len(tail) + 2 <= cols:
        cells[cols - len(tail) :] = tail
    span = max(1, cols - 1)
    return "".join(bg(lerp(a, b, i / span)) + fg(BASE) + ESC + "1m" + ch for i, ch in enumerate(cells)) + RST


def chip(label: str, color) -> tuple:
    return seg(" %-*s " % (CHIP_W, label[:CHIP_W]), BASE, color, True)


# ---- argument unwrapping ----------------------------------------------------------------------------------------------
_VAR_RE = re.compile(r"\$\{?([A-Za-z_]\w*)\}?")
_ASSIGN_RE = re.compile(r"^[A-Za-z_]\w*=")
_NOISE_FLAGS = {"--root", "--channel", "--owner"}
_KEYWORDS = ("do ", "then ", "else ", "{ ", "( ")
_SETUP = {"cd", "pushd", "export", "set", "source", "."}  # shown only when nothing else runs
_SKIP = re.compile(r"^(done|fi|esac|\}|\)|for |while |if |case )")


def _statements(cmd: str) -> list:
    """Split a shell string on ; && || and newlines outside quotes. ponytail: no heredoc or
    subshell awareness; the result is display-only."""
    out, cur, quote, i = [], "", None, 0
    while i < len(cmd):
        ch = cmd[i]
        if quote:
            quote = None if ch == quote else quote
        elif ch in "'\"":
            quote = ch
        elif ch in ";\n" or cmd[i : i + 2] in ("&&", "||"):
            out.append(cur)
            cur, i = "", i + (1 if ch in ";\n" else 2)
            continue
        cur += ch
        i += 1
    return [s.strip() for s in [*out, cur] if s.strip()]


def _words(stmt: str) -> list:
    try:
        return shlex.split(stmt)
    except ValueError:
        return stmt.split()


def _unwrap_lean_ctx(cmd: str) -> str:
    words = _words(cmd.strip())
    if len(words) >= 3 and os.path.basename(words[0]) == "lean-ctx" and words[1] == "-c":
        return words[2]
    return cmd


def _strip_keyword(stmt: str) -> str:
    for kw in _KEYWORDS:
        if stmt.startswith(kw):
            return stmt[len(kw) :].strip()
    return stmt


def _expand(stmt: str, env: dict) -> str:
    return _VAR_RE.sub(lambda m: env.get(m.group(1), m.group(0)), stmt)


def _record_assignments(words: list, env: dict) -> list:
    """Consume leading NAME=value words into env; the command words that remain."""
    while words and _ASSIGN_RE.match(words[0]):
        key, _, value = words.pop(0).partition("=")
        env[key] = value
    return words


def _display(words: list) -> str:
    """Words without the board noise flags, absolute paths shortened to their basename."""
    shown, skip = [], False
    for w in words:
        if skip:
            skip = False
        elif w in _NOISE_FLAGS:
            skip = True
        else:
            w = os.path.basename(w.rstrip("/")) if w.startswith("/") and "/" in w[1:] else w
            shown.append(shlex.quote(w) if " " in w else w)
    return " ".join(shown)


def _note(words: list) -> tuple | None:
    """(to, message) when the words run `atlas_todo.py note --to X msg`, else None."""
    if "note" not in words or "--help" in words or "--to" not in words:
        return None
    if not any(w.endswith("atlas_todo.py") for w in words):
        return None
    after = words[words.index("note") + 1 :]
    to, rest, i = "", [], 0
    while i < len(after):
        if after[i] == "|" or re.match(r"^\d?>", after[i]):
            break  # a pipe or redirect ends the note's own arguments
        if after[i].startswith("--"):
            to = after[i + 1] if after[i] == "--to" and i + 1 < len(after) else to
            i += 2
            continue
        rest.append(after[i])
        i += 1
    return (to, " ".join(rest)) if to else None


def unwrap_shell(cmd: str) -> tuple:
    """(the first meaningful command for display, [(to, msg) for each peer note]).

    Strips a `lean-ctx -c '...'` wrapper and `S=...;` env-prefix statements, expands the
    variables they set, and drops the board flags (--root/--channel/--owner) from note calls."""
    env: dict = {}
    loops: dict = {}  # `for p in a b` -> {"p": ["a", "b"]}, so `--to $p` names each peer
    first, setup, notes = "", "", []
    for stmt in _statements(_unwrap_lean_ctx(cmd)):
        stmt = _strip_keyword(stmt)
        loop = re.match(r"for (\w+) in (.+)", stmt)
        if loop:
            loops[loop.group(1)] = _words(_expand(loop.group(2), env))
        if _SKIP.match(stmt):
            continue
        words = _record_assignments(_words(_expand(stmt, env)), env)
        if not words:
            continue
        note = _note(words)
        if note:
            to, msg = note
            targets = loops.get(to[1:], [to]) if to.startswith("$") else [to]
            notes += [(t, msg) for t in targets]
            words = words[: words.index("note") + 1] + ["--to", ",".join(targets)]
        if words[0] in _SETUP:
            setup = setup or _display(words)
            continue
        first = first or _display(words)
    return first or setup, notes


def _short_path(path: str) -> str:
    parts = [p for p in str(path).rstrip("/").split("/") if p]
    return "/".join(parts[-2:]) if str(path).startswith("/") else str(path)


def _file_arg(inp: dict) -> str:
    path = str(inp.get("file_path") or inp.get("path") or inp.get("notebook_path") or "")
    base = os.path.basename(path.rstrip("/")) or path
    span = re.match(r"lines:(\d+)-(\d+)", str(inp.get("mode") or ""))
    off, lim = inp.get("offset"), inp.get("limit")
    if span:
        return f"{base}:{span.group(1)}-{span.group(2)}"
    if isinstance(off, int):
        return f"{base}:{off}-{off + lim}" if isinstance(lim, int) else f"{base}:{off}"
    return base


def short_tool(name: str) -> str:
    return str(name or "tool").rsplit("__", 1)[-1]


def tool_color(name: str):
    n = short_tool(name).lower()
    if "edit" in n or "write" in n or "patch" in n:
        return PEACH
    if n in ("bash", "shell") or "shell" in n or "exec" in n:
        return VIOLET
    if n in ("task", "agent") or "web" in n or "fetch" in n:
        return SKY
    return GREEN


def tool_arg(name: str, inp: dict) -> str:
    n = short_tool(name).lower()
    if inp.get("command") and ("bash" in n or "shell" in n):
        return unwrap_shell(str(inp["command"]))[0]
    if inp.get("pattern") and inp.get("path"):
        return f"{inp['pattern']}  in {_short_path(inp['path'])}"
    if any(inp.get(k) for k in ("file_path", "notebook_path")) or ("path" in inp and "read" in n):
        return _file_arg(inp)
    arg = next((str(inp[k]) for k in _ARG_KEYS if inp.get(k)), "")
    return (arg.strip().splitlines() or [""])[0]


# ---- rows -------------------------------------------------------------------------------------------------------------
def _stamp(now: float | None) -> tuple:
    return seg(" " + time.strftime("%H:%M:%S", time.localtime(now)) + " ", DIM)


def _row(now, label: str, color, arg: str) -> list:
    return [_stamp(now), chip(label, color), seg(" " + arg, TXT)]


def _tool_rows(block: dict, now) -> list:
    name = short_tool(block.get("name"))
    inp = block.get("input") if isinstance(block.get("input"), dict) else {}
    rows = [_row(now, name, tool_color(name), tool_arg(name, inp))]
    if inp.get("command"):
        for to, msg in unwrap_shell(str(inp["command"]))[1]:
            rows.append(_row(now, "peer", PINK, f"→ {to}: {msg}"))
    return rows


def _block_rows(block: dict, now) -> list:
    if block.get("type") == "tool_use":
        return _tool_rows(block, now)
    text = str(block.get("text") or "").strip()
    if block.get("type") == "text" and text:
        return [_row(now, "think", MUT, text.splitlines()[0])]
    return []


def _result_row(event: dict, now) -> list:
    bad = event.get("is_error") or event.get("subtype") != "success"
    secs = (event.get("duration_ms") or 0) / 1000
    label, color = ("✖ result", RED) if bad else ("✔ result", GREEN)
    return [_stamp(now), chip(label, color), seg(f" {secs:.1f}s · exit {1 if bad else 0}", color, None, True)]


def _omp_tool_block(event: dict) -> dict:
    """The claude-shaped tool_use block for an omp `tool_execution_start` event."""
    return {"type": "tool_use", "name": event.get("toolName"), "input": event.get("args")}


def event_rows(event: dict, now: float | None = None) -> list:
    """Segment rows for one event: claude stream-json, or omp `--mode json` (paint() them at the pane width)."""
    kind = event.get("type")
    if kind == "assistant" or (kind == "message_end" and (event.get("message") or {}).get("role") == "assistant"):
        content = (event.get("message") or {}).get("content") or []
        return [r for b in content if isinstance(b, dict) for r in _block_rows(b, now)]
    if kind == "result":
        return [_result_row(event, now)]
    if kind == "tool_execution_start":
        return _block_rows(_omp_tool_block(event), now)
    return []


def render_event(event: dict, width: int | None = None) -> list:
    width = width or shutil.get_terminal_size((100, 30)).columns
    return [paint(r, width) for r in event_rows(event)]


def result_text(event: dict) -> str:
    """Final report: claude's `result`, or the last assistant message's text on omp's `agent_end`."""
    if event.get("type") != "agent_end":
        return str(event.get("result") or "")
    for msg in reversed(event.get("messages") or []):
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            blocks = [b for b in msg.get("content") or [] if isinstance(b, dict) and b.get("type") == "text"]
            return "\n".join(str(b.get("text") or "") for b in blocks)
    return ""


def parse_line(raw: str) -> dict | None:
    """The JSON event on a stream line, or None for plain text (warnings, non-stream harnesses)."""
    try:
        event = json.loads(raw)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None


# ---- header and status ------------------------------------------------------------------------------------------------
def goal_of(prompt: str) -> str:
    """First line of the brief's `# Task` section, else of the whole prompt."""
    parts = re.split(r"(?m)^# Task\n", prompt, maxsplit=1)
    text = parts[-1]
    return next((ln.strip() for ln in text.splitlines() if ln.strip()), "")


def peers_of(prompt: str) -> list:
    line = next((ln for ln in prompt.splitlines() if ln.startswith("Peers: ")), "")
    names = [p.strip().rstrip(".") for p in line[len("Peers: ") :].split(",")]
    return [n for n in names if n and n != "(none)"]


# header gradient per worker role (substring match: "completeness-critic" is a critic)
_ROLE_GRADIENT = (("explorer", TEAL, SKY), ("implementer", PEACH, YEL), ("verifier", GREEN, TEAL), ("critic", VIOLET, PINK))


def role_gradient(role: str) -> tuple:
    return next(((a, b) for key, a, b in _ROLE_GRADIENT if key in str(role).lower()), (GREEN, TEAL))


def header(name: str, role: str, team: str, channel: str, goal: str, width: int = 0, peers=()) -> str:
    """Three painted header rows (gradient bar, goal, channel + peers) and a blank one."""
    width = width or shutil.get_terminal_size((100, 30)).columns
    chan = "#" + (channel.rsplit("/", 1)[-1] or "-") if channel else "#-"
    first = (goal.strip().splitlines() or [""])[0]
    rows = [
        gradient_bar(f"◢◤ ATLAS  {name}", f"{role} · wave {team}", width, *role_gradient(role)),
        paint([seg(" goal ", MUT), seg(first, TXT)], width),
        paint([seg(f" {chan}", VIOLET, None, True), seg("  peers: " + (" · ".join(peers) or "none"), VIOLET)], width),
        paint([], width),
    ]
    return "\n".join(rows)


def _clock(secs: float) -> str:
    secs = int(secs)
    return f"{secs // 60}m{secs % 60:02d}s" if secs >= 60 else f"{secs}s"


def _tokens(n: int) -> str:
    return f"{n / 1000:.1f}k tok" if n >= 1000 else f"{n} tok"


def progress_bar(frac: float, width: int, a=GREEN, b=TEAL) -> list:
    cells, out = max(0.0, min(1.0, frac)) * width, []
    for i in range(width):
        c = lerp(a, b, i / max(1, width - 1))
        ch = "█" if i < int(cells) else (EIGHTHS[int((cells - int(cells)) * 8)] if i == int(cells) else " ")
        out.append(seg(ch, c if ch.strip() else DIM, PANEL2))
    return out


def status_row(state: str, tick: int, elapsed: float, tools: int, tokens: int, width: int, cached: int = 0) -> str:
    """'run' -> spinner + gradient bar; 'done' / 'fail' -> the final green / red verdict. `tokens` is new
    work; `cached` (cache reads) is appended dim only when large."""
    stats = f"{_clock(elapsed)} · {tools} tools · {_tokens(tokens)}"
    tail = [seg(f" · {cached / 1000:.1f}k cached", DIM)] if cached >= CACHED_SHOWN else []
    if state == "done":
        return paint([seg(" ✔ DONE ", BASE, GREEN, True), seg("· " + stats, GREEN, None, True), *tail], width)
    if state == "fail":
        return paint([seg(" ✖ FAILED ", BASE, RED, True), seg("· " + stats, RED, None, True), *tail], width)
    # ponytail: no real progress signal exists; the bar fills asymptotically with the tool count
    frac = 1 - 0.9**tools
    bar = progress_bar(frac, max(8, min(30, width // 4)))
    return paint([seg(f" {SPIN[tick % len(SPIN)]} working ", GREEN, None, True), *bar, seg("  " + stats, MUT), *tail], width)


# ---- the live pane ----------------------------------------------------------------------------------------------------
class Feed:
    """One worker pane. live=True repaints the terminal in place (sticky header and status, a 4 Hz
    ticker for the spinner and clock, the size re-read on every paint so a resize reflows);
    live=False prints rows in order."""

    def __init__(self, name="", role="", team="", channel="", prompt="", out=None, live=None, calls_file=None):
        self.out = out or sys.stdout
        self.live = bool(self.out.isatty()) if live is None else live
        self.head = (name, role, team, channel, goal_of(prompt), peers_of(prompt))
        self.rows: collections.deque = collections.deque(maxlen=400)
        self.t0, self.tools, self.tick, self.state = time.time(), 0, 0, "run"
        self.usage: dict = {}
        self.lock = threading.Lock()
        self.painted_size: tuple | None = None
        self.calls_file = calls_file  # <name>.tool.json: claude workers' call times for the omp widget sparkline

    def _size(self) -> tuple:
        size = shutil.get_terminal_size((100, 30))
        return max(20, size.columns), max(6, size.lines)

    def _header(self, width: int) -> str:
        name, role, team, channel, goal, peers = self.head
        return header(name, role, team, channel, goal, width, peers)

    def _status(self, width: int) -> str:
        new, cached = (sum(u[i] for u in self.usage.values()) for i in (0, 1))
        return status_row(self.state, self.tick, time.time() - self.t0, self.tools, new, width, cached)

    def start(self) -> None:
        width, _ = self._size()
        if not self.live:
            self._write(self._header(width) + "\n")
            return
        self._write(ESC + "?25l")
        with self.lock:
            self._paint()
        threading.Thread(target=self._ticker, daemon=True).start()

    def _ticker(self) -> None:
        while self.state == "run":
            time.sleep(0.25)
            with self.lock:
                self.tick += 1
                if self.state == "run":
                    self._paint()

    def _paint(self, spare: int = 0) -> None:
        """Repaint every row of the pane (caller holds the lock). The frame is drawn `spare` rows
        low: when the worker exits, tmux's remain-on-exit scrolls the pane up one line to print its
        message on the last row, which lands the header back on row 1."""
        width, height = self._size()
        head = self._header(width).split("\n")
        room = max(0, height - len(head) - 2 - spare)
        body = [paint(r, width) for r in list(self.rows)[-room:]] if room else []
        gap = room - len(body)
        # a dim spacer under the newest row marks where the feed grows; the status stays at the bottom
        filler = ([paint([seg(" · · ·", DIM)], width)] if gap else []) + [paint([], width)] * max(0, gap - 1)
        lines = [paint([], width)] * spare + head + body + filler
        lines += [paint([], width), self._status(width)]
        out = "".join(f"{ESC}{i + 1};1H{ln}" for i, ln in enumerate(lines[:height]))
        if self.painted_size != (width, height):
            # a resize reflows old rows into wrapped lines; clearing the screen drops them and their wrap flags
            out = ESC + "2J" + out
            self.painted_size = (width, height)
        self._write(out)

    def _write(self, text: str) -> None:
        self.out.write(text)
        self.out.flush()

    def _add(self, rows: list) -> None:
        with self.lock:
            self.rows.extend(rows)
            if self.live:
                self._paint()
            else:
                width = self._size()[0]
                self._write("".join(paint(r, width) + "\n" for r in rows))

    def _count(self, event: dict) -> None:
        msg = event.get("message") or {}
        blocks = msg.get("content") or []
        # one per tool_use row plus one per peer-note row, so the count matches the rows shown
        self.tools += sum(len(_tool_rows(b, None)) for b in blocks if isinstance(b, dict) and b.get("type") == "tool_use")
        usage = msg.get("usage") or {}
        new = sum(v for k, v in usage.items() if k in _NEW_KEYS and isinstance(v, int))
        cached = usage.get("cache_read_input_tokens")
        cached = cached if isinstance(cached, int) else 0
        if new or cached:
            # stream-json repeats a message's usage once per content block: keyed by id, counted once
            self.usage[msg.get("id") or len(self.usage)] = (new, cached)

    def _record_calls(self, event: dict) -> None:
        """Append one timestamp per claude tool_use to calls_file, keeping its other keys (the omp recorder's).
        Best effort: a lane without a sparkline is better than a feed that dies."""
        blocks = (event.get("message") or {}).get("content") or []
        n = sum(1 for b in blocks if isinstance(b, dict) and b.get("type") == "tool_use")
        if not (n and self.calls_file):
            return
        try:
            try:
                rec = json.loads(Path(self.calls_file).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                rec = {}
            rec = rec if isinstance(rec, dict) else {}
            calls = [t for t in rec.get("calls", []) if isinstance(t, (int, float))] + [time.time()] * n
            rec["calls"] = calls[-MAX_CALLS:]
            tmp = Path(str(self.calls_file) + ".tmp")
            tmp.write_text(json.dumps(rec), encoding="utf-8")
            os.replace(tmp, self.calls_file)
        except OSError:
            pass

    def _count_omp(self, event: dict) -> None:
        """omp `--mode json`: one tool per tool_execution_start; usage rides each assistant message_end."""
        if event.get("type") == "tool_execution_start":
            self.tools += len(_tool_rows(_omp_tool_block(event), None))
        msg = event.get("message") or {}
        usage = msg.get("usage") or {}
        if event.get("type") == "message_end" and msg.get("role") == "assistant" and usage:
            new = sum(usage.get(k) or 0 for k in ("input", "output", "cacheWrite"))
            self.usage[len(self.usage)] = (new, usage.get("cacheRead") or 0)

    def event(self, event: dict) -> None:
        if event.get("type") == "assistant":
            self._count(event)
            self._record_calls(event)
        else:
            self._count_omp(event)
        self._add(event_rows(event))

    def text(self, line: str, color=TXT) -> None:
        self._add([[seg(" " + line, color)]])

    def report(self, body: str) -> None:
        """The worker's final report: a `report` chip on the first line, the rest indented under it."""
        lines = [ln for ln in body.splitlines() if ln.strip() and not ln.lstrip().startswith("```")]
        if not lines:
            return
        indent = seg(" " * (len(" 00:00:00 ") + CHIP_W + 2), MUT)
        rows = [[_stamp(None), chip("report", TEAL), seg(" " + lines[0], TXT, None, True)]]
        self._add(rows + [[indent, seg(" " + ln, MUT)] for ln in lines[1:]])

    def finish(self, code: int) -> None:
        with self.lock:
            self.state = "done" if code == 0 else "fail"
            if self.live:
                self._paint(spare=1)
                self._write(ESC + "?25h")
            else:
                self._write(self._status(self._size()[0]) + "\n")
