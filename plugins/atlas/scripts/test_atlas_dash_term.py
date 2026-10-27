"""Tests for atlas_dash_term: RFC6455 framing, ws auth, PTY bridge end to end."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import atlas_dash_term as T  # noqa: E402

MASK = b"\x01\x02\x03\x04"


def masked(op, payload, fin=True, key=MASK):
    f = bytearray(T.encode_frame(op, payload, key))
    if not fin:
        f[0] &= 0x7F
    return bytes(f)


class FramingTests(unittest.TestCase):
    def test_accept_key_rfc_example(self):
        self.assertEqual(
            T.accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        )

    def test_roundtrip_lengths_and_masking(self):
        for n in (0, 5, 125, 126, 70000):
            payload = os.urandom(n)
            wire = T.encode_frame(T.OP_BIN, payload, MASK)
            self.assertNotEqual(wire[-n:] if n else b"", payload if n > 3 else b"x")
            self.assertEqual(T.Decoder().feed(wire), [(T.OP_BIN, payload)])

    def test_server_frames_unmasked(self):
        wire = T.encode_frame(T.OP_TEXT, b"hi")
        self.assertEqual(wire, b"\x81\x02hi")
        self.assertEqual(T.Decoder(require_mask=False).feed(wire), [(T.OP_TEXT, b"hi")])
        with self.assertRaises(T.ProtocolError):
            T.Decoder().feed(wire)  # clients must mask

    def test_byte_at_a_time(self):
        wire = masked(T.OP_TEXT, b"hello")
        d, out = T.Decoder(), []
        for b in wire:
            out += d.feed(bytes([b]))
        self.assertEqual(out, [(T.OP_TEXT, b"hello")])

    def test_fragmentation_with_interleaved_ping(self):
        wire = (
            masked(T.OP_TEXT, b"foo", fin=False)
            + masked(T.OP_PING, b"p")
            + masked(T.OP_CONT, b"bar", fin=False)
            + masked(T.OP_CONT, b"baz")
        )
        self.assertEqual(
            T.Decoder().feed(wire), [(T.OP_PING, b"p"), (T.OP_TEXT, b"foobarbaz")]
        )

    def test_close_and_bad_frames(self):
        self.assertEqual(
            T.Decoder().feed(masked(T.OP_CLOSE, struct.pack(">H", 1000))),
            [(T.OP_CLOSE, b"\x03\xe8")],
        )
        with self.assertRaises(T.ProtocolError):
            T.Decoder().feed(masked(T.OP_CONT, b"x"))  # continuation w/o start
        with self.assertRaises(T.ProtocolError):
            T.Decoder().feed(masked(T.OP_PING, b"x" * 126))  # oversized control
        with self.assertRaises(T.ProtocolError):
            T.Decoder().feed(bytes([0xC1, 0x80]) + MASK)  # RSV1 set

    def test_target_regex(self):
        for ok in ("%12", "atlas-run1", "atlas-run_1:worker.1", "atlas-a:b-c"):
            self.assertTrue(T.TARGET_RE.match(ok), ok)
        for bad in (
            "",
            "12",
            "%",
            "%1a",
            "other",
            "atlas-",
            "atlas-a:",
            "atlas-a b",
            "atlas-a;rm",
            "%1\n",
        ):
            self.assertFalse(T.TARGET_RE.match(bad), bad)

    def test_capture_route_rejects_bad_target(self):
        ctx = types.SimpleNamespace(query={"target": "x;y"}, groups=())
        self.assertEqual(T._capture(ctx)[0], 400)


# --- end to end ------------------------------------------------------------------


class ClientMsgTests(unittest.TestCase):
    def test_bin_writes_raw_bytes_and_ignores_non_latin1(self):
        r, w = os.pipe()
        try:
            T._client_msg(w, '{"t":"bin","d":"\\u001b[M \\u00e9!"}'.encode())
            T._client_msg(
                w, '{"t":"bin","d":"\\u20ac"}'.encode()
            )  # not a byte: dropped, no crash
            self.assertEqual(os.read(r, 64), b"\x1b[M \xe9!")
        finally:
            os.close(r)
            os.close(w)


class WsClient:
    def __init__(self, port, path, headers=None):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=10)
        h = {
            "Host": f"127.0.0.1:{port}",
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": base64.b64encode(os.urandom(16)).decode(),
            "Sec-WebSocket-Version": "13",
            "Origin": f"http://127.0.0.1:{port}",
        }
        h.update(headers or {})
        h = {k: v for k, v in h.items() if v is not None}
        req = (
            f"GET {path} HTTP/1.1\r\n"
            + "".join(f"{k}: {v}\r\n" for k, v in h.items())
            + "\r\n"
        )
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        self.head, _, rest = buf.partition(b"\r\n\r\n")
        self.key = h["Sec-WebSocket-Key"]
        self.dec = T.Decoder(require_mask=False)
        self.msgs = self.dec.feed(rest) if rest and self.status == 101 else []

    @property
    def status(self):
        return int(self.head.split(b" ")[1])

    def send(self, op, payload):
        self.sock.sendall(T.encode_frame(op, payload, os.urandom(4)))

    def read_until(self, needle: bytes, timeout=10.0):
        got, end = b"", time.monotonic() + timeout
        while time.monotonic() < end:
            for op, p in self.msgs:
                if op == T.OP_BIN:
                    got += p
            self.msgs = []
            if needle in got:
                return got
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                continue
            if not chunk:
                break
            self.msgs = self.dec.feed(chunk)
        raise AssertionError(f"{needle!r} not seen in {got!r}")

    def close(self):
        self.sock.close()


def tmux(env, *args):
    return subprocess.run(
        ["tmux", *args], env=env, capture_output=True, text=True, timeout=10
    )


def wait_for(cond, timeout=8.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.1)
    return False


class InProcessDashboard(unittest.TestCase):
    """Real Handler on a free port, isolated tmux server (TMUX_TMPDIR), fake model."""

    @classmethod
    def setUpClass(cls):
        import atlas_dashboard as D

        cls.D = D
        cls.tmpdir = tempfile.mkdtemp(prefix="atl", dir="/tmp")
        cls.saved_env = {
            k: os.environ.get(k) for k in ("TMUX_TMPDIR", "TMUX", "ATLAS_TERM_TUI_CMD")
        }
        os.environ["TMUX_TMPDIR"] = cls.tmpdir
        os.environ.pop("TMUX", None)
        cls.env = dict(os.environ)
        cls.saved_model = sys.modules.get("atlas_colony_model")
        m: Any = types.ModuleType("atlas_colony_model")
        m.attach_argv = lambda target, vid: (
            [
                [
                    "tmux",
                    "new-session",
                    "-d",
                    "-t",
                    target.split(":")[0],
                    "-s",
                    f"atlas-view-{vid}",
                ]
            ],
            ["tmux", "attach", "-t", f"atlas-view-{vid}"],
        )
        m.cleanup_view = lambda vid: subprocess.run(
            ["tmux", "kill-session", "-t", f"atlas-view-{vid}"], capture_output=True
        )
        m.capture = lambda target, lines=200, ansi=True: (
            "pane text sk-ant-api03-" + "A" * 30
        )
        sys.modules["atlas_colony_model"] = m
        cls.httpd = D._Server(("127.0.0.1", 0), D.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        subprocess.run(["tmux", "kill-server"], env=cls.env, capture_output=True)
        if cls.saved_model is None:
            sys.modules.pop("atlas_colony_model", None)
        else:
            sys.modules["atlas_colony_model"] = cls.saved_model
        for k, v in cls.saved_env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        shutil.rmtree(cls.tmpdir, ignore_errors=True)

    def ws_path(self, **q):
        """WS path. An explicit token= is sent as-is (legacy, must be refused);
        otherwise a ticket is planted directly so request-shape validation still
        runs inside handle_ws (the ticket route itself would pre-validate)."""
        if "token" not in q:
            t = "test-" + os.urandom(8).hex()
            with T._ticket_lock:
                T._tickets[t] = (
                    time.monotonic() + T.TICKET_TTL_S,
                    {k: v for k, v in q.items() if v is not None},
                )
            return f"/api/v2/term/ws?ticket={t}"
        return "/api/v2/term/ws?" + "&".join(
            f"{k}={v}" for k, v in q.items() if v is not None
        )

    # auth
    def assert_denied(self, path, headers=None, code=403):
        c = WsClient(self.port, path, headers)
        try:
            self.assertEqual(c.status, code, c.head)
            self.assertNotIn(b"101", c.head.split(b"\r\n")[0])
            self.assertNotIn(b"Sec-WebSocket-Accept", c.head)
        finally:
            c.close()

    def test_bad_token(self):
        self.assert_denied(self.ws_path(kind="tui", token="nope"))
        self.assert_denied("/api/v2/term/ws?kind=tui")

    def test_bad_host(self):
        self.assert_denied(self.ws_path(kind="tui"), {"Host": "evil.example:80"})

    def test_foreign_origin(self):
        self.assert_denied(self.ws_path(kind="tui"), {"Origin": "http://evil.example"})

    def test_bad_requests_are_400(self):
        self.assert_denied(self.ws_path(kind="bogus"), code=400)
        self.assert_denied(self.ws_path(kind="pane", target="x;y"), code=400)
        self.assert_denied(
            self.ws_path(kind="tui"), {"Sec-WebSocket-Key": "short"}, code=400
        )
        self.assert_denied(self.ws_path(kind="tui"), {"Upgrade": None}, code=400)

    def test_http_routes_need_token(self):
        base = f"http://127.0.0.1:{self.port}/api/v2/term/capture?target=%251"
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(base)
        self.assertEqual(e.exception.code, 401)
        req = urllib.request.Request(base, headers={"X-Atlas-Token": self.D.DASH_TOKEN})
        import json

        body = json.load(urllib.request.urlopen(req))
        self.assertTrue(body["ok"])
        self.assertNotIn("sk-ant-api03", body["text"])  # redacted

    # tui
    def test_tui_pty_roundtrip_and_cleanup(self):
        os.environ["ATLAS_TERM_TUI_CMD"] = "sh -c 'echo ready-$((40+2)); exec cat'"
        c = WsClient(self.port, self.ws_path(kind="tui", cols=100, rows=30))
        try:
            self.assertEqual(c.status, 101, c.head)
            self.assertIn(T.accept_key(c.key).encode(), c.head)
            c.read_until(b"ready-42")
            c.send(T.OP_TEXT, b'{"t":"resize","cols":90,"rows":20}')
            c.send(T.OP_PING, b"x")
            c.send(T.OP_TEXT, b'{"t":"in","d":"hello-tui\\r"}')
            c.read_until(b"hello-tui")
            c.send(T.OP_CLOSE, struct.pack(">H", 1000))
        finally:
            c.close()
            os.environ.pop("ATLAS_TERM_TUI_CMD", None)
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))

    def test_tui_child_sees_requested_size_at_first_paint_and_no_rep_term(self):
        os.environ["ATLAS_TERM_TUI_CMD"] = (
            "sh -c 'echo size-$(stty size)-$TERM-${LINES:-x}; exec cat'"
        )
        c = WsClient(self.port, self.ws_path(kind="tui", cols=100, rows=30))
        try:
            c.read_until(b"size-30 100-screen-256color-x")
            c.send(T.OP_CLOSE, struct.pack(">H", 1000))
        finally:
            c.close()
            os.environ.pop("ATLAS_TERM_TUI_CMD", None)

    def test_tui_all_projects_spawns_with_all_flag(self):
        os.environ.pop("ATLAS_TERM_TUI_CMD", None)
        seen = []
        real = T._tui_argv
        T._tui_argv = lambda root: (
            seen.append(root),
            ["sh", "-c", "echo up; exec cat"],
        )[1]
        try:
            for proj in (None, "", "all"):
                c = WsClient(self.port, self.ws_path(kind="tui", project=proj))
                try:
                    self.assertEqual(c.status, 101, (proj, c.head))
                    c.read_until(b"up")
                    c.send(T.OP_CLOSE, struct.pack(">H", 1000))
                finally:
                    c.close()
                self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))
        finally:
            T._tui_argv = real
        self.assertEqual(seen, [None, None, None])
        self.assertEqual(real(None)[-1], "--all")
        self.assertNotIn("--project", real(None))
        self.assertEqual(real("/x")[-2:], ["--project", "/x"])

    def test_tui_unknown_project_is_400(self):
        self.assert_denied(
            self.ws_path(kind="tui", project="/no/such/dir-xyz"), code=400
        )
        self.assert_denied(self.ws_path(kind="tui", project="nope"), code=400)

    def test_pane_ignores_project(self):
        self.assert_denied(
            self.ws_path(kind="pane", target="x;y", project="all"), code=400
        )

    def test_snapshot_all_projects(self):
        calls = []
        m: Any = sys.modules["atlas_colony_model"]
        m.snapshot = lambda root=None, all_projects=False: (
            calls.append((root, all_projects)),
            {"ok": True},
        )[1]
        T._snap_cache.clear()
        for q in ({"project": "all"}, {"all": "1"}, {"project": "/p"}):
            T._snapshot(types.SimpleNamespace(query=q, groups=()))
        # project=all and all=1 share one cache key, so the model runs once for them
        self.assertEqual(calls, [(None, True), ("/p", False)])

    def test_snapshot_single_flight_and_ttl(self):
        calls = []
        m: Any = sys.modules["atlas_colony_model"]

        def slow(root=None, all_projects=False):
            calls.append(1)
            time.sleep(0.2)
            return {"ok": True}

        m.snapshot = slow
        T._snap_cache.clear()
        ctx = types.SimpleNamespace(query={"all": "1"}, groups=())
        ts = [threading.Thread(target=T._snapshot, args=(ctx,)) for _ in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual(len(calls), 1)
        T._snapshot(ctx)  # within the TTL: no rebuild
        self.assertEqual(len(calls), 1)
        T._snap_cache[(None, True)] = (time.monotonic() - T.SNAPSHOT_TTL - 1, {})
        T._snapshot(ctx)  # expired: rebuilds
        self.assertEqual(len(calls), 2)

    # pane
    @unittest.skipUnless(shutil.which("tmux"), "tmux missing")
    def test_pane_attach_echo_and_cleanup(self):
        sess = f"atlas-test-{os.getpid()}"
        self.assertEqual(
            tmux(
                self.env,
                "new-session",
                "-d",
                "-s",
                sess,
                "-x",
                "120",
                "-y",
                "30",
                "cat",
            ).returncode,
            0,
        )
        c = WsClient(
            self.port, self.ws_path(kind="pane", target=sess, cols=120, rows=30)
        )
        try:
            self.assertEqual(c.status, 101, c.head)
            self.assertTrue(
                wait_for(lambda: "atlas-view-" in tmux(self.env, "ls").stdout)
            )
            time.sleep(0.5)
            c.send(T.OP_TEXT, b'{"t":"in","d":"echo-me-123\\r"}')
            c.read_until(b"echo-me-123")
            c.send(T.OP_CLOSE, struct.pack(">H", 1000))
        finally:
            c.close()
        self.assertTrue(
            wait_for(lambda: "atlas-view-" not in tmux(self.env, "ls").stdout),
            "grouped view session leaked",
        )
        self.assertIn(sess, tmux(self.env, "ls").stdout)  # worker session untouched
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))
        # abrupt socket drop also cleans up
        c = WsClient(self.port, self.ws_path(kind="pane", target=sess))
        self.assertEqual(c.status, 101)
        self.assertTrue(wait_for(lambda: "atlas-view-" in tmux(self.env, "ls").stdout))
        c.close()
        self.assertTrue(
            wait_for(lambda: "atlas-view-" not in tmux(self.env, "ls").stdout)
        )
        tmux(self.env, "kill-session", "-t", sess)

    def test_session_cap(self):
        os.environ["ATLAS_TERM_TUI_CMD"] = "cat"
        clients = []
        try:
            for _ in range(T.MAX_SESSIONS):
                c = WsClient(self.port, self.ws_path(kind="tui"))
                self.assertEqual(c.status, 101)
                clients.append(c)
            self.assert_denied(self.ws_path(kind="tui"), code=503)
        finally:
            for c in clients:
                c.close()
            os.environ.pop("ATLAS_TERM_TUI_CMD", None)
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))

    # --- W1-U1: tickets, shell seats, idle, first frame, seats, route table -------

    def post(self, path, body, token=True):
        import json

        h = {"Content-Type": "application/json"}
        if token:
            h["X-Atlas-Token"] = self.D.DASH_TOKEN
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(body).encode(),
            headers=h,
            method="POST",
        )
        try:
            return 200, json.load(urllib.request.urlopen(req))
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def ticket_path(self, **body):
        code, out = self.post("/api/v2/term/ticket", body)
        self.assertEqual(code, 200, out)
        self.assertEqual(out["expires_in"], 30)
        return f"/api/v2/term/ws?ticket={out['ticket']}"

    def test_ticket_requires_token_and_valid_kind(self):
        self.assertEqual(
            self.post("/api/v2/term/ticket", {"kind": "tui"}, token=False)[0], 401
        )
        self.assertEqual(self.post("/api/v2/term/ticket", {"kind": "bogus"})[0], 400)
        self.assertEqual(
            self.post("/api/v2/term/ticket", {"kind": "pane", "target": "x;y"})[0], 400
        )
        self.assertEqual(
            self.post(
                "/api/v2/term/ticket", {"kind": "shell", "cwd": "/no/such/dir-xyz"}
            )[0],
            400,
        )

    def test_ticket_is_single_use(self):
        os.environ["ATLAS_TERM_TUI_CMD"] = "sh -c 'echo tkt-ready; exec cat'"
        try:
            path = self.ticket_path(kind="tui", cols=100, rows=30)
            c = WsClient(self.port, path)  # no token= at all
            try:
                self.assertEqual(c.status, 101, c.head)
                c.read_until(b"tkt-ready")
                c.send(T.OP_CLOSE, struct.pack(">H", 1000))
            finally:
                c.close()
            self.assert_denied(path, code=403)  # burned
        finally:
            os.environ.pop("ATLAS_TERM_TUI_CMD", None)
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))

    def test_expired_ticket_is_denied(self):
        path = self.ticket_path(kind="tui")
        t = path.split("ticket=")[1]
        T._tickets[t] = (time.monotonic() - 1, T._tickets[t][1])
        self.assert_denied(path, code=403)

    def test_legacy_query_token_is_rejected(self):
        self.assert_denied(self.ws_path(kind="tui", token=self.D.DASH_TOKEN))

    def test_shell_pty_roundtrip_cwd_and_term(self):
        d = os.path.realpath(tempfile.mkdtemp(prefix="atlsh", dir="/tmp"))
        saved = os.environ.get("SHELL")
        os.environ["SHELL"] = "/bin/sh"
        try:
            c = WsClient(
                self.port, self.ticket_path(kind="shell", cwd=d, cols=100, rows=30)
            )
            try:
                self.assertEqual(c.status, 101, c.head)
                c.send(
                    T.OP_TEXT,
                    b'{"t":"in","d":"echo ok-$((20+1)) $TERM $COLUMNS; pwd\\r"}',
                )
                got = c.read_until(d.encode())
                self.assertIn(b"ok-21 xterm-256color 100", got)
                c.send(T.OP_CLOSE, struct.pack(">H", 1000))
            finally:
                c.close()
        finally:
            os.environ.pop("SHELL", None) if saved is None else os.environ.__setitem__(
                "SHELL", saved
            )
            shutil.rmtree(d, ignore_errors=True)
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))

    def test_shell_argv_fallback(self):
        saved = os.environ.get("SHELL")
        try:
            os.environ["SHELL"] = "/no/such/shell"
            self.assertEqual(
                T._shell_argv(),
                ["/bin/zsh" if os.access("/bin/zsh", os.X_OK) else "/bin/sh", "-l"],
            )
            os.environ.pop("SHELL")
            self.assertEqual(T._shell_argv()[1], "-l")
        finally:
            os.environ.pop("SHELL", None) if saved is None else os.environ.__setitem__(
                "SHELL", saved
            )

    def test_idle_timeout_closes_with_reason_and_frees_slot(self):
        os.environ["ATLAS_TERM_TUI_CMD"] = "cat"
        os.environ["ATLAS_TERM_IDLE_S"] = "1"
        c = WsClient(self.port, self.ws_path(kind="tui"))
        try:
            self.assertEqual(c.status, 101)
            closes, end = [], time.monotonic() + 10
            while not closes and time.monotonic() < end:
                try:
                    chunk = c.sock.recv(65536)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                closes = [p for op, p in c.dec.feed(chunk) if op == T.OP_CLOSE]
            self.assertEqual(closes, [struct.pack(">H", 1000) + b"idle"])
        finally:
            c.close()
            os.environ.pop("ATLAS_TERM_TUI_CMD", None)
            os.environ.pop("ATLAS_TERM_IDLE_S", None)
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))

    def test_first_frame_within_one_second_of_upgrade(self):
        os.environ["ATLAS_TERM_TUI_CMD"] = (
            "sleep 5"  # silent child: only the server can speak
        )
        c = WsClient(self.port, self.ws_path(kind="tui"))
        try:
            self.assertEqual(c.status, 101)
            c.read_until(b"\x1b[?25l", timeout=1.0)
        finally:
            c.close()
            os.environ.pop("ATLAS_TERM_TUI_CMD", None)
        self.assertTrue(wait_for(lambda: T._slots._value == T.MAX_SESSIONS))

    def fake_snapshot(self):
        m: Any = sys.modules["atlas_colony_model"]
        base = {
            "colony": "c1",
            "project": "/p",
            "pod": "x",
            "target": "",
            "last_active": None,
        }
        m.snapshot = lambda root=None, all_projects=False: {
            "ok": True,
            "host": "mac",
            "clock": {"iso": "now"},
            "colonies": [
                {
                    "id": "c1",
                    "name": "alpha",
                    "label": "c1",
                    "project": "/p",
                    "created": 100.0,
                }
            ],
            "seats": [  # worker listed before the lead on purpose
                {
                    **base,
                    "name": "impl",
                    "address": "implementer@alpha",
                    "role": "implementer",
                    "runtime": "omp",
                    "state": "working",
                    "target": "%3",
                    "last_active": 5.0,
                },
                {
                    **base,
                    "name": "lead-1",
                    "address": "lead@alpha",
                    "role": "lead",
                    "runtime": "claude",
                    "state": "working",
                    "lead": True,
                },
                {
                    **base,
                    "name": "ver",
                    "address": "verifier@alpha",
                    "role": "verifier",
                    "runtime": "codex",
                    "state": "dead",
                    "target": "%9",
                },
            ],
        }
        T._snap_cache.clear()

    def test_seats_shape_order_ended_and_shell_seats(self):
        self.fake_snapshot()
        status, out = T._seats(
            types.SimpleNamespace(query={"project": "/p"}, groups=())
        )
        self.assertEqual(status, 200)
        self.assertTrue(out["ok"])
        self.assertEqual((out["machine"], out["clock"]), ("mac", {"iso": "now"}))
        colony, host = out["spaces"][0], out["spaces"][-1]
        self.assertEqual(
            (colony["id"], colony["name"], colony["kind"]), ("c1", "alpha", "colony")
        )
        self.assertEqual(
            [s["address"] for s in colony["seats"]],
            ["lead@alpha", "implementer@alpha", "verifier@alpha", "shell@alpha"],
        )
        lead, impl, ended, sh = colony["seats"]
        self.assertEqual(
            (lead["runtime"], lead["kind"], lead["target"]), ("claude", "pane", None)
        )
        self.assertEqual(
            lead["attach_hint"], "start claude inside tmux or herdr to stream this seat"
        )
        self.assertNotIn("attach_hint", impl)
        self.assertEqual(
            (impl["runtime"], impl["target"], impl["pane"], impl["state"]),
            ("omp", "%3", "%3", "working"),
        )
        self.assertEqual(
            (impl["project"], impl["last_activity"], impl["started_at"]),
            ("/p", 5.0, 100.0),
        )
        self.assertEqual(
            (ended["runtime"], ended["state"], ended["target"]),
            ("codex", "ended", None),
        )
        self.assertEqual(
            (sh["runtime"], sh["kind"], sh["cwd"], sh["name"]),
            ("shell", "shell", "/p", "shell"),
        )
        self.assertEqual(host["kind"], "host")
        self.assertEqual(
            [(s["address"], s["kind"]) for s in host["seats"]],
            [("shell@host", "shell"), ("tui@host", "tui")],
        )
        self.assertEqual(host["seats"][0]["cwd"], os.path.expanduser("~"))
        for s in colony["seats"] + host["seats"]:
            for k in (
                "address",
                "name",
                "role",
                "runtime",
                "state",
                "pane",
                "target",
                "kind",
                "project",
                "cwd",
                "started_at",
                "last_activity",
            ):
                self.assertIn(k, s)

    def test_seats_http_route_needs_token(self):
        import json

        self.fake_snapshot()
        base = f"http://127.0.0.1:{self.port}/api/v2/term/seats?project=%2Fp"
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(base)
        self.assertEqual(e.exception.code, 401)
        req = urllib.request.Request(base, headers={"X-Atlas-Token": self.D.DASH_TOKEN})
        body = json.load(urllib.request.urlopen(req))
        self.assertEqual(body["spaces"][0]["seats"][0]["address"], "lead@alpha")

    def test_every_do_get_v2_literal_is_in_the_route_table(self):
        import inspect

        D = self.D
        if not D.V2_ROUTES:
            D._mount_v2_routes()
        literals = set(
            re.findall(r'"(/api/v2/[^"]+)"', inspect.getsource(D.Handler.do_GET))
        )
        self.assertIn("/api/v2/term/ws", literals)
        missing = [
            p
            for p in literals
            if p not in D.V2_RAW_GET
            and not any(m == "GET" and rx.fullmatch(p) for m, rx, _ in D.V2_ROUTES)
        ]
        self.assertEqual(missing, [])
        self.assertTrue(
            any(rx.fullmatch("/api/v2/term/seats") for _, rx, _ in D.V2_ROUTES)
        )
        self.assertTrue(
            any(
                m == "POST" and rx.fullmatch("/api/v2/term/ticket")
                for m, rx, _ in D.V2_ROUTES
            )
        )


class RealServeTests(unittest.TestCase):
    """The actual `atlas_dashboard.py serve` process with a temp ATLAS_HOME."""

    def _start(self, home, env):
        """Start `serve` on a free port; only accept it when OUR child answers
        /api/health (a port grabbed by another suite's server is retried)."""
        import json

        for _ in range(5):
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
            p = subprocess.Popen(
                [
                    sys.executable,
                    str(HERE / "atlas_dashboard.py"),
                    "serve",
                    "--port",
                    str(port),
                    "--foreground",
                ],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            end = time.monotonic() + 30
            while time.monotonic() < end and p.poll() is None:
                try:
                    h = json.load(
                        urllib.request.urlopen(
                            f"http://127.0.0.1:{port}/api/health", timeout=2
                        )
                    )
                    if h.get("pid") == p.pid:
                        return p, port
                    break  # someone else owns the port
                except OSError:
                    time.sleep(0.2)
            p.terminate()
            p.wait(timeout=10)
        self.fail("dashboard did not start on any free port")

    def test_serve_tui_ws(self):
        home = tempfile.mkdtemp(prefix="atlhome")
        env = {
            **os.environ,
            "ATLAS_HOME": home,
            "ATLAS_TERM_TUI_CMD": "sh -c 'echo serve-ready; exec cat'",
        }
        p, port = self._start(home, env)
        try:
            html = (
                urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5)
                .read()
                .decode()
            )
            m = re.search(r'name="atlas-token" content="([^"]+)"', html)
            assert m is not None
            token = m.group(1)
            legacy = WsClient(port, f"/api/v2/term/ws?kind=tui&token={token}")
            self.assertEqual(legacy.status, 403, "query token must be rejected")
            legacy.close()
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/v2/term/ticket",
                data=json.dumps({"kind": "tui"}).encode(),
                headers={
                    "Content-Type": "application/json",
                    "X-Atlas-Token": token,
                    "Host": f"127.0.0.1:{port}",
                },
                method="POST",
            )
            ticket = json.load(urllib.request.urlopen(req, timeout=5))["ticket"]
            c = WsClient(port, f"/api/v2/term/ws?ticket={ticket}")
            try:
                self.assertEqual(c.status, 101, c.head)
                c.read_until(b"serve-ready")
                c.send(T.OP_TEXT, b'{"t":"in","d":"ping-serve\\r"}')
                c.read_until(b"ping-serve")
            finally:
                c.close()
            bad = WsClient(port, "/api/v2/term/ws?kind=tui&token=bad")
            self.assertEqual(bad.status, 403)
            bad.close()
        finally:
            p.terminate()
            p.wait(timeout=10)
            shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
