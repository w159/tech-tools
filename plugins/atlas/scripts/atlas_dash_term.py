"""Dashboard terminal bridge: colony snapshot/capture routes and a PTY websocket.

Stdlib only. The websocket is hand-rolled RFC 6455 (no extensions, no
subprotocols). Protocol on top: client text frames are JSON
{"t":"in","d":"<utf8>"} or {"t":"resize","cols":N,"rows":N}; server binary
frames are raw PTY bytes. kind=tui runs scripts/atlas_tui.py, kind=pane
attaches a grouped tmux view of one worker pane.
"""

from __future__ import annotations

import base64
import fcntl
import hashlib
import hmac
import json
import os
import pty
import re
import select
import shlex
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
import uuid
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_SESSIONS = 8
MAX_FRAME = 1 << 20
TARGET_RE = re.compile(r"^%[0-9]+\Z|^atlas-[A-Za-z0-9_-]+(:[A-Za-z0-9_.-]+)?\Z")

OP_CONT, OP_TEXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 0, 1, 2, 8, 9, 10

_slots = threading.BoundedSemaphore(MAX_SESSIONS)


# --- RFC 6455 framing ------------------------------------------------------------


class ProtocolError(Exception):
    pass


def accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()


def encode_frame(
    opcode: int, payload: bytes = b"", mask_key: bytes | None = None
) -> bytes:
    """One final frame. Servers send unmasked; pass mask_key to build client frames."""
    n = len(payload)
    head = bytes([0x80 | opcode])
    mbit = 0x80 if mask_key else 0
    if n < 126:
        head += bytes([mbit | n])
    elif n < 1 << 16:
        head += bytes([mbit | 126]) + struct.pack(">H", n)
    else:
        head += bytes([mbit | 127]) + struct.pack(">Q", n)
    if mask_key:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        head += mask_key
    return head + payload


class Decoder:
    """Incremental frame parser. feed() returns whole messages [(opcode, bytes)];
    fragmented data messages are reassembled, control frames may interleave."""

    def __init__(self, require_mask: bool = True):
        self.require_mask = require_mask
        self.buf = bytearray()
        self.frag_op: int | None = None
        self.frag = bytearray()

    def feed(self, data: bytes) -> list[tuple[int, bytes]]:
        self.buf += data
        out = []
        while True:
            msg = self._one()
            if msg is None:
                return out
            out.append(msg) if msg is not False else None

    def _one(self):
        b = self.buf
        if len(b) < 2:
            return None
        fin, op = bool(b[0] & 0x80), b[0] & 0x0F
        if b[0] & 0x70:
            raise ProtocolError("reserved bits set")
        masked, n, pos = bool(b[1] & 0x80), b[1] & 0x7F, 2
        if n == 126:
            if len(b) < 4:
                return None
            n, pos = struct.unpack(">H", bytes(b[2:4]))[0], 4
        elif n == 127:
            if len(b) < 10:
                return None
            n, pos = struct.unpack(">Q", bytes(b[2:10]))[0], 10
        if n > MAX_FRAME:
            raise ProtocolError("frame too large")
        if self.require_mask and not masked:
            raise ProtocolError("client frame not masked")
        key = b""
        if masked:
            if len(b) < pos + 4:
                return None
            key, pos = bytes(b[pos : pos + 4]), pos + 4
        if len(b) < pos + n:
            return None
        payload = bytes(b[pos : pos + n])
        del b[: pos + n]
        if masked:
            payload = bytes(c ^ key[i % 4] for i, c in enumerate(payload))
        if op >= 8:
            if not fin or n > 125:
                raise ProtocolError("bad control frame")
            return (op, payload)
        if op == OP_CONT:
            if self.frag_op is None:
                raise ProtocolError("unexpected continuation")
            self.frag += payload
            if len(self.frag) > MAX_FRAME:
                raise ProtocolError("message too large")
            if not fin:
                return False
            msg, self.frag_op, self.frag = (
                (self.frag_op, bytes(self.frag)),
                None,
                bytearray(),
            )
            return msg
        if op not in (OP_TEXT, OP_BIN) or self.frag_op is not None:
            raise ProtocolError("bad opcode")
        if fin:
            return (op, payload)
        self.frag_op, self.frag = op, bytearray(payload)
        return False


# --- routes ----------------------------------------------------------------------


def _model():
    import atlas_colony_model  # lazy: written by a sibling slice

    return atlas_colony_model


def _snapshot(ctx):
    q = ctx.query or {}
    try:
        m = _model()
    except ImportError as e:
        return 501, {"ok": False, "error": "model_unavailable", "why": str(e)}
    proj = q.get("project") or None
    all_projects = proj == "all" or str(q.get("all") or "").lower() in ("1", "true", "yes")
    return 200, m.snapshot(None if proj == "all" else proj, all_projects)


def _redact(text: str) -> str | None:
    try:
        import atlas_memory

        return atlas_memory.redact_secrets(text)
    except Exception:
        return None  # fail closed


def _capture(ctx):
    q = ctx.query or {}
    target = str(q.get("target") or "")
    if not TARGET_RE.match(target):
        return 400, {"ok": False, "error": "bad_target"}
    try:
        lines = max(1, min(int(q.get("lines") or 200), 2000))
    except ValueError:
        return 400, {"ok": False, "error": "lines must be an integer"}
    ansi = str(q.get("ansi", "1")).lower() not in ("0", "false", "no")
    try:
        text = _model().capture(target, lines, ansi)
    except ImportError as e:
        return 501, {"ok": False, "error": "model_unavailable", "why": str(e)}
    text = _redact(text or "")
    if text is None:
        return 503, {"ok": False, "error": "redaction unavailable"}
    return 200, {"ok": True, "target": target, "text": text}


ROUTES = [
    ("GET", r"/api/v2/term/snapshot", _snapshot),
    ("GET", r"/api/v2/term/capture", _capture),
]


# --- websocket PTY bridge --------------------------------------------------------


def _tui_argv(root: str | None) -> list[str]:
    override = os.environ.get("ATLAS_TERM_TUI_CMD")  # test hook
    if override:
        return shlex.split(override)
    tail = ["--all"] if root is None else ["--project", root]
    return [sys.executable, str(SCRIPTS_DIR / "atlas_tui.py"), *tail]


def _run_setup(cmds) -> None:
    for c in cmds:
        argv = shlex.split(c) if isinstance(c, str) else list(c)
        subprocess.run(argv, check=False, capture_output=True, timeout=10)


def _winsize(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _dim(v, default: int) -> int:
    try:
        return max(2, min(int(v), 1000))
    except (TypeError, ValueError):
        return default


def _reap(pid: int) -> None:
    for sig in (signal.SIGHUP, signal.SIGKILL):
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            try:
                if os.waitpid(pid, os.WNOHANG)[0]:
                    return
            except ChildProcessError:
                return
            time.sleep(0.02)
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


def _deny(handler, code: int, error: str) -> None:
    handler.close_connection = True
    handler._json(code, {"ok": False, "error": error})


def handle_ws(handler, query: dict, token: str) -> None:
    """Upgrade and bridge one PTY. Host/Origin were already checked by the dashboard
    guard; the token, request shape and target are validated here before any 101."""
    if not hmac.compare_digest((query.get("token") or "").encode(), token.encode()):
        return _deny(handler, 403, "bad_token")
    h = handler.headers
    key = (h.get("Sec-WebSocket-Key") or "").strip()
    try:
        ok_key = len(base64.b64decode(key, validate=True)) == 16
    except Exception:
        ok_key = False
    if (
        (h.get("Upgrade") or "").lower() != "websocket"
        or "upgrade" not in (h.get("Connection") or "").lower()
        or h.get("Sec-WebSocket-Version") != "13"
        or not ok_key
    ):
        return _deny(handler, 400, "bad_websocket_request")
    kind = query.get("kind")
    view_id = ""
    setup: list = []
    if kind == "tui":
        root = None  # empty / missing / "all" means every project
        if query.get("project") not in (None, "", "all"):
            root = os.path.realpath(query["project"])
            if not os.path.isdir(root):
                return _deny(handler, 400, "bad_project")
        argv = _tui_argv(root)
    elif kind == "pane":
        target = query.get("target") or ""
        if not TARGET_RE.match(target):
            return _deny(handler, 400, "bad_target")
        try:
            view_id = uuid.uuid4().hex[:8]
            setup, argv = _model().attach_argv(target, view_id)
        except ImportError:
            return _deny(handler, 501, "model_unavailable")
    else:
        return _deny(handler, 400, "bad_kind")
    if not _slots.acquire(blocking=False):
        return _deny(handler, 503, "too_many_sessions")

    pid, master = -1, -1
    try:
        if setup:
            _run_setup(setup)
        cols, rows = _dim(query.get("cols"), 80), _dim(query.get("rows"), 24)
        # No LINES/COLUMNS: ncurses lets them override the tty size, so the TUI never followed a resize.
        # ncurses' xterm-256color `rep` (CSI Nb) emits a stray \x01 for multibyte glyphs (every ━ rule run),
        # so the curses TUI gets a terminfo without rep; screen-256color is otherwise xterm.js-compatible.
        env = {**os.environ, "TERM": "screen-256color" if kind == "tui" else "xterm-256color"}
        env.pop("LINES", None)
        env.pop("COLUMNS", None)
        pid, master = pty.fork()
        if pid == 0:  # child: only exec, never return into the server
            try:
                _winsize(0, cols, rows)  # before exec, so first paint already sees the real size
                os.execvpe(argv[0], argv, env)
            finally:
                os._exit(127)
        _winsize(master, cols, rows)
        sock = handler.connection
        handler.close_connection = True
        sock.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Accept: {accept_key(key)}\r\n\r\n"
            ).encode()
        )
        _pump(sock, master)
    finally:
        if pid > 0:
            _reap(pid)
        if master >= 0:
            os.close(master)
        if view_id:
            try:
                _model().cleanup_view(view_id)
            except Exception:
                pass
        _slots.release()


def _pump(sock, master: int) -> None:
    dec = Decoder()
    sock.settimeout(10)
    try:
        while True:
            r, _, _ = select.select([sock, master], [], [], 1.0)
            if master in r:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b""
                if not data:  # child exited
                    sock.sendall(encode_frame(OP_CLOSE, struct.pack(">H", 1000)))
                    return
                sock.sendall(encode_frame(OP_BIN, data))
            if sock in r:
                chunk = sock.recv(65536)
                if not chunk:
                    return
                for op, payload in dec.feed(chunk):
                    if op == OP_CLOSE:
                        sock.sendall(encode_frame(OP_CLOSE, payload[:2]))
                        return
                    if op == OP_PING:
                        sock.sendall(encode_frame(OP_PONG, payload))
                    elif op == OP_BIN:
                        os.write(master, payload)
                    elif op == OP_TEXT:
                        _client_msg(master, payload)
    except (ProtocolError, OSError):
        try:
            sock.sendall(encode_frame(OP_CLOSE, struct.pack(">H", 1002)))
        except OSError:
            pass


def _client_msg(master: int, payload: bytes) -> None:
    try:
        msg = json.loads(payload.decode("utf-8"))
        kind = msg["t"]
    except (ValueError, KeyError, TypeError):
        return  # ignore malformed client text
    if kind == "in" and isinstance(msg.get("d"), str):
        os.write(master, msg["d"].encode("utf-8"))
    elif kind == "resize":
        _winsize(master, _dim(msg.get("cols"), 80), _dim(msg.get("rows"), 24))
