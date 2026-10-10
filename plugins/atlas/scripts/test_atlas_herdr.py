"""Single-instance guarantees for atlas_herdr.ensure() (health-ok never spawns, N concurrent callers spawn once),
the pinned-herdr check, the per-user build of the vendored web UI, and worker-pane creation over a fake herdr socket."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_dash_herd  # noqa: E402
import atlas_dash_work  # noqa: E402
import atlas_herdr  # noqa: E402
import atlas_mux  # noqa: E402


class EnsureTests(unittest.TestCase):
    def setUp(self):
        self.saved = {
            k: getattr(atlas_herdr, k)
            for k in (
                "_health",
                "_is_vendored",
                "_procs",
                "_spawn",
                "_bun",
                "_server_up",
                "_prepare",
                "_mirror_stale",
                "install_check",
                "PLUGIN_ROOT",
                "HEALTH_WAIT_S",
            )
        }
        atlas_herdr._mirror_stale = lambda: (
            False
        )  # these tests are about spawning, not staleness
        root = Path(tempfile.mkdtemp()) / "plugin"
        (root / "scripts").mkdir(parents=True)
        (root / "scripts" / "plugin.ts").write_text("")
        atlas_herdr.PLUGIN_ROOT = root
        atlas_herdr.HEALTH_WAIT_S = 3.0
        atlas_herdr._bun = lambda: "/bin/true"
        self.up = False
        self.spawns = 0
        self.mu = threading.Lock()

        def spawn():
            with self.mu:
                self.spawns += 1
            time.sleep(0.3)  # widen the race window
            self.up = True
            return True, ""

        atlas_herdr._health = lambda: self.up
        atlas_herdr._is_vendored = lambda base=None: (
            True
        )  # whoever is healthy here is the vendored build
        atlas_herdr._server_up = lambda: True
        atlas_herdr._procs = lambda owned=False: []
        atlas_herdr._spawn = spawn
        atlas_herdr._prepare = lambda: (True, "built")
        atlas_herdr.install_check = lambda: {"ok": True}

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(atlas_herdr, k, v)

    def test_healthy_means_zero_spawns(self):
        self.up = True
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "reused"))
        self.assertEqual(self.spawns, 0)

    def test_concurrent_callers_spawn_once(self):
        results = []

        def call():
            results.append(atlas_herdr.ensure())

        ts = [threading.Thread(target=call) for _ in range(12)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(self.spawns, 1)
        self.assertTrue(all(r["ok"] for r in results))
        self.assertEqual(sorted({r["action"] for r in results}), ["reused", "started"])

    def test_existing_process_waits_never_spawns(self):
        atlas_herdr._procs = lambda owned=False: [(1, 0, "managed", "00:05")]
        threading.Timer(0.5, lambda: setattr(self, "up", True)).start()
        r = atlas_herdr.ensure()
        self.assertEqual(r["action"], "waited")
        self.assertEqual(self.spawns, 0)

    def test_not_installed_and_no_bun_are_actionable(self):
        atlas_herdr._prepare = lambda: (False, "vendored herdr-web-ui is missing")
        r = atlas_herdr.ensure()
        self.assertFalse(r["ok"])
        self.assertTrue(r["why"] and r["do"])
        self.assertEqual(self.spawns, 0)
        atlas_herdr._bun = lambda: None
        r = atlas_herdr.ensure()
        self.assertFalse(r["ok"])
        self.assertIn("bun", r["why"])
        self.assertEqual(self.spawns, 0)


class StaleMirrorTests(unittest.TestCase):
    """A healthy vendored server on a stale mirror is rebuilt (before stopping) and restarted; ours only."""

    KEYS = (
        "_health",
        "_is_vendored",
        "_procs",
        "_spawn",
        "_stop",
        "_bun",
        "_server_up",
        "_prepare",
        "_stamp",
        "install_check",
        "PLUGIN_ROOT",
        "HEALTH_WAIT_S",
    )

    def setUp(self):
        self.saved = {k: getattr(atlas_herdr, k) for k in self.KEYS}
        self.env_home = os.environ.get("ATLAS_HOME")
        os.environ["ATLAS_HOME"] = tempfile.mkdtemp()
        self.root = Path(tempfile.mkdtemp()) / "plugin"
        self.root.mkdir(parents=True)
        atlas_herdr.PLUGIN_ROOT = self.root
        atlas_herdr.HEALTH_WAIT_S = 2.0
        atlas_herdr._bun = lambda: "/bin/true"
        atlas_herdr._stamp = lambda: "new"
        (self.root / ".atlas-build").write_text("old\n")
        self.events: list[str] = []
        self.up = True
        self.build = (True, "built")

        def prepare():
            self.events.append("prepare")
            if self.build[0]:
                (self.root / ".atlas-build").write_text("new\n")
            return self.build

        def stop(port=None):
            self.events.append("stop")
            self.up = False
            return True, ""

        def spawn(port=None):
            self.events.append("start")
            self.up = True
            return True, ""

        atlas_herdr._health = lambda: self.up
        atlas_herdr._is_vendored = lambda base=None: True
        atlas_herdr._server_up = lambda: True
        atlas_herdr._procs = lambda owned=False: []
        atlas_herdr.install_check = lambda: {"ok": True}
        atlas_herdr._prepare, atlas_herdr._stop, atlas_herdr._spawn = (
            prepare,
            stop,
            spawn,
        )

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(atlas_herdr, k, v)
        if self.env_home is None:
            os.environ.pop("ATLAS_HOME", None)
        else:
            os.environ["ATLAS_HOME"] = self.env_home

    def test_stale_mirror_builds_then_restarts_once(self):
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "restarted"), r)
        self.assertEqual(r["reason"], "stale_mirror")
        self.assertEqual(self.events, ["prepare", "stop", "start"])  # build BEFORE stop

    def test_matching_stamp_is_reused_without_any_work(self):
        (self.root / ".atlas-build").write_text("new\n")
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "reused"), r)
        self.assertNotIn("reason", r)
        self.assertEqual(self.events, [])

    def test_build_failure_leaves_the_server_running(self):
        self.build = (False, "`run build` failed: boom")
        r = atlas_herdr.ensure()
        self.assertFalse(r["ok"])
        self.assertIn("boom", r["why"])
        self.assertEqual(self.events, ["prepare"])
        self.assertTrue(self.up)

    def test_upstream_process_is_never_stopped(self):
        # only an upstream-owned process exists (owned=True filters it out): ensure() still never reaches a
        # process-level stop, and the vendored restart goes through _stop (plugin.ts in OUR mirror) only
        import subprocess

        up = "/h/.config/herdr/plugins/github/devswha.herdr-web-ui-abc/server"
        ps = f"  10 1 05:00 bun {up}/managed.ts\n"
        atlas_herdr._procs = self.saved["_procs"]
        killed, real_run, real_kill = [], subprocess.run, os.kill
        subprocess.run = lambda *a, **k: subprocess.CompletedProcess(a, 0, ps, "")
        os.kill = lambda pid, sig: killed.append(pid)
        try:
            r = atlas_herdr.ensure()
        finally:
            subprocess.run, os.kill = real_run, real_kill
        self.assertEqual(r["action"], "restarted", r)
        self.assertEqual(killed, [])
        self.assertEqual(atlas_herdr._managed(), [])

    def test_stop_runs_plugin_ts_in_the_mirror_with_the_plugin_env(self):
        import subprocess

        atlas_herdr._stop = self.saved["_stop"]
        calls = []
        real = subprocess.run
        subprocess.run = lambda argv, **k: (
            calls.append((argv, k)) or subprocess.CompletedProcess(argv, 0, "", "")
        )
        try:
            ok_, _ = atlas_herdr._stop()
        finally:
            subprocess.run = real
        argv, kw = calls[0]
        self.assertTrue(ok_)
        self.assertEqual(argv[1:], ["scripts/plugin.ts", "stop"])
        self.assertEqual(kw["cwd"], str(self.root))
        self.assertEqual(kw["env"]["HERDR_PLUGIN_ROOT"], str(self.root))
        self.assertIn("HERDR_PLUGIN_STATE_DIR", kw["env"])


class ProcsTests(unittest.TestCase):
    P = "/h/.config/herdr/plugins/github/devswha.herdr-web-ui-abc/server"

    def test_only_real_bun_instances_counted(self):
        c = atlas_herdr._classify
        self.assertEqual(c(f"/opt/bun/bin/bun {self.P}/managed.ts"), "managed")
        self.assertEqual(c(f"node {self.P}/supervisor.ts --x"), "supervisor")
        for cmd in (
            f"bash -c 'pgrep -f {self.P}/managed.ts'",
            f"/bin/zsh -c 'bun {self.P}/managed.ts'",
            f"pgrep -f {self.P}/managed.ts",
            "bun /tmp/other/server/managed.ts",  # not under a herdr-web-ui dir
            f"bun {self.P}/managed.tsx",
        ):
            self.assertIsNone(c(cmd), cmd)

    def test_procs_ignores_wrappers_and_self(self):
        import subprocess

        ps = (
            f"  10     1 05:00 bun {self.P}/managed.ts\n"
            f"  11    10 05:00 bun {self.P}/supervisor.ts\n"
            f"  12     1 00:01 bash -c 'pgrep -f server/managed.ts {self.P}/managed.ts'\n"
            f"  {__import__('os').getpid()}     1 00:01 bun {self.P}/managed.ts\n"
        )
        real = subprocess.run
        subprocess.run = lambda *a, **k: subprocess.CompletedProcess(a, 0, ps, "")
        try:
            self.assertEqual(
                atlas_herdr._procs(),
                [(10, 1, "managed", "05:00"), (11, 10, "supervisor", "05:00")],
            )
        finally:
            subprocess.run = real


class RouteTests(unittest.TestCase):
    def test_routes_shape(self):
        got = {(m, p) for m, p, _ in atlas_dash_herd.ROUTES}
        for want in (
            ("GET", r"^/api/v2/herd$"),
            ("GET", r"^/api/v2/herd/status$"),
            ("GET", r"^/api/v2/herd/agents$"),
            ("GET", r"^/api/v2/herd/colony$"),
            ("POST", r"^/api/v2/herd/agents/([A-Za-z0-9:_.-]{1,64})/prompt$"),
            ("POST", r"^/api/v2/herd/ensure$"),
            ("POST", r"^/api/v2/herd/panes$"),
            ("POST", r"^/api/v2/herd/panes/([A-Za-z0-9:_.-]{1,64})/kill$"),
        ):
            self.assertIn(want, got)

    def test_mounted_and_ensure_is_token_gated(self):
        import atlas_dashboard as d

        self.assertNotIn("atlas_dash_herd", d.V2_MOUNT_ERRORS)
        self.assertTrue(
            any(rx.pattern == r"^/api/v2/herd/ensure$" for _, rx, _ in d.V2_ROUTES)
        )
        self.assertIsNone(d._SENSITIVE_GET.match("/api/v2/herd"))  # GET: status only
        self.assertTrue(
            any(
                m == "POST" and rx.match("/api/v2/herd/agents/wB:p1/prompt")
                for m, rx, _ in d.V2_ROUTES
            )
        )


import json  # noqa: E402
import os  # noqa: E402
import socket  # noqa: E402

AGENT_LIST = {
    "type": "agent_list",
    "agents": [
        {
            "pane_id": "wB:p1",
            "workspace_id": "wB",
            "tab_id": "wB:t1",
            "agent": "omp",
            "agent_status": "idle",
            "cwd": "/p/a",
            "focused": True,
            "state_change_seq": 3,
            "terminal_title_stripped": "t1",
            "agent_session": {"value": "/Users/x/.omp/agent/sessions/secret.jsonl"},
        },
        {
            "pane_id": "wC:p2",
            "workspace_id": "wC",
            "agent": "claude",
            "agent_status": "working",
            "cwd": "/p/b",
            "completion_seq": 7,
        },
    ],
}
WS_LIST = {
    "type": "workspace_list",
    "workspaces": [
        {
            "workspace_id": "wB",
            "label": "alpha",
            "focused": True,
            "agent_status": "idle",
            "pane_count": 1,
        }
    ],
}


class FakeHerdr:
    """AF_UNIX server: one newline-delimited JSON request per connection, like herdr.

    handler(method, params) -> raw bytes to write (or None for silence)."""

    def __init__(self, handler):
        self.dir = tempfile.mkdtemp(prefix="hs", dir="/tmp")
        self.path = os.path.join(self.dir, "h.sock")
        self.handler, self.calls = handler, []
        self.srv = socket.socket(socket.AF_UNIX)
        self.srv.bind(self.path)
        self.srv.listen(8)
        self.stop = False
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()

    def _loop(self):
        while not self.stop:
            try:
                c, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(c,), daemon=True).start()

    def _serve(self, c):
        with c:
            buf = b""
            while b"\n" not in buf:
                d = c.recv(4096)
                if not d:
                    return
                buf += d
            req = json.loads(buf)
            self.calls.append((req["method"], req["params"]))
            out = self.handler(req["method"], req["params"])
            if out is not None:
                c.sendall(out)
            else:
                time.sleep(1.0)  # hang past the client's timeout

    def close(self):
        self.stop = True
        self.srv.close()


def ok(result):
    return json.dumps({"id": "atlas", "result": result}).encode() + b"\n"


def standard(method, params):
    if method == "agent.list":
        return ok(AGENT_LIST)
    if method == "workspace.list":
        return ok(WS_LIST)
    if method == "ping":
        return ok({"type": "pong"})
    if method == "agent.prompt":
        return ok({"type": "prompt_sent", "target": params["target"]})
    return (
        json.dumps({"id": "atlas", "error": {"code": "x", "message": "nope"}}).encode()
        + b"\n"
    )


class SockBase(unittest.TestCase):
    handler = staticmethod(standard)

    def setUp(self):
        self.fake = FakeHerdr(type(self).handler)
        self.old_env = os.environ.get("HERDR_SOCKET_PATH")
        os.environ["HERDR_SOCKET_PATH"] = self.fake.path
        atlas_herdr._status_cache = None

    def tearDown(self):
        self.fake.close()
        if self.old_env is None:
            os.environ.pop("HERDR_SOCKET_PATH", None)
        else:
            os.environ["HERDR_SOCKET_PATH"] = self.old_env


class SocketClientTests(SockBase):
    def test_list_parsing_and_no_session_path_leak(self):
        snap = atlas_herdr.agents()
        self.assertTrue(snap["reachable"])
        a = {r["pane_id"]: r for r in snap["agents"]}
        self.assertEqual(a["wB:p1"]["status"], "idle")
        self.assertEqual(a["wB:p1"]["workspace"], "alpha")
        self.assertEqual(a["wC:p2"]["completion_seq"], 7)
        self.assertEqual(a["wC:p2"]["workspace"], "")  # unlabelled workspace survives
        self.assertTrue(
            a["wB:p1"]["deep_link"].endswith("/?pane=wB%3Ap1&machine=local")
        )
        self.assertNotIn("secret.jsonl", json.dumps(snap))

    def test_dash_agents_counts(self):
        code, body = atlas_dash_herd._agents(None)
        self.assertEqual(code, 200)
        self.assertEqual((body["counts"]["idle"], body["counts"]["working"]), (1, 1))


class ServerDown(unittest.TestCase):
    def test_missing_socket_is_fast_and_graceful(self):
        os.environ["HERDR_SOCKET_PATH"] = "/nonexistent/h.sock"
        try:
            t = time.monotonic()
            snap = atlas_herdr.agents()
            self.assertLess(time.monotonic() - t, 0.1)
            self.assertEqual(
                (snap["reachable"], snap["reason"], snap["agents"]),
                (False, "socket_missing", []),
            )
            code, body = atlas_dash_herd._agents(None)
            self.assertEqual((code, body["herdr"]["reachable"]), (200, False))
        finally:
            os.environ.pop("HERDR_SOCKET_PATH")

    def test_stale_socket_file_refuses_connection(self):
        d = tempfile.mkdtemp(prefix="hs", dir="/tmp")
        p = os.path.join(d, "dead.sock")
        s = socket.socket(socket.AF_UNIX)
        s.bind(p)
        s.close()  # file remains, nobody listening
        os.environ["HERDR_SOCKET_PATH"] = p
        try:
            self.assertEqual(atlas_herdr.agents()["reason"], "connect_failed")
        finally:
            os.environ.pop("HERDR_SOCKET_PATH")

    def test_ensure_never_spawns_when_server_down(self):
        saved = atlas_herdr._health, atlas_herdr._spawn, atlas_herdr._server_up
        calls = []
        atlas_herdr._health = lambda: False
        atlas_herdr._server_up = lambda: False
        atlas_herdr._spawn = lambda: calls.append(1) or (True, "")
        try:
            out = atlas_herdr.ensure()
        finally:
            atlas_herdr._health, atlas_herdr._spawn, atlas_herdr._server_up = saved
        self.assertFalse(out["ok"])
        self.assertIn("herdr server", out["why"])
        self.assertEqual(calls, [])


class MalformedTests(SockBase):
    handler = staticmethod(lambda m, p: b"{not json\n")

    def test_malformed_json(self):
        with self.assertRaises(atlas_herdr.HerdrSockError) as cm:
            atlas_herdr.rpc("agent.list")
        self.assertEqual(cm.exception.reason, "malformed")
        self.assertEqual(atlas_herdr.agents()["reason"], "malformed")


class TimeoutTests(SockBase):
    handler = staticmethod(lambda m, p: None)

    def test_timeout_is_bounded(self):
        t = time.monotonic()
        with self.assertRaises(atlas_herdr.HerdrSockError) as cm:
            atlas_herdr.rpc("agent.list", timeout=0.15)
        self.assertEqual(cm.exception.reason, "timeout")
        self.assertLess(time.monotonic() - t, 0.6)


class RpcErrorTests(SockBase):
    def test_error_envelope(self):
        with self.assertRaises(atlas_herdr.HerdrSockError) as cm:
            atlas_herdr.rpc("bogus.method")
        self.assertEqual(
            (cm.exception.reason, cm.exception.detail), ("rpc_error", "nope")
        )


class _Ctx:
    def __init__(self, pane, body):
        self.groups, self._b = (pane,), body

    def json(self):
        return self._b


class PromptTests(SockBase):
    def prompt(self, pane, body):
        return atlas_dash_herd._prompt(_Ctx(pane, body))

    def sent(self):
        return [c for c in self.fake.calls if c[0] == "agent.prompt"]

    def test_idle_agent_gets_prompt_and_response_is_returned(self):
        code, body = self.prompt("wB:p1", {"text": "hello"})
        self.assertEqual(code, 200)
        self.assertEqual(body["result"]["type"], "prompt_sent")
        self.assertEqual(
            self.sent(), [("agent.prompt", {"target": "wB:p1", "text": "hello"})]
        )

    def test_unknown_pane_rejected_nothing_sent(self):
        for pane in ("wZ:p9", "wB:p1; rm -rf /", "$(id)"):
            code, _ = self.prompt(pane, {"text": "x"})
            self.assertEqual(code, 404, pane)
        self.assertEqual(self.sent(), [])

    def test_non_idle_refused(self):
        code, body = self.prompt("wC:p2", {"text": "x"})
        self.assertEqual(code, 409)
        self.assertIn("working", body["why"])
        self.assertEqual(self.sent(), [])

    def test_bad_text_rejected(self):
        for text in (None, "", "   ", 5, "x" * (atlas_herdr.PROMPT_MAX + 1)):
            self.assertEqual(
                self.prompt("wB:p1", {"text": text})[0], 400, repr(text)[:20]
            )
        self.assertEqual(self.prompt("wB:p1", None)[0], 400)
        self.assertEqual(self.sent(), [])

    def test_server_down_is_503(self):
        os.environ["HERDR_SOCKET_PATH"] = "/nonexistent/h.sock"
        self.assertEqual(self.prompt("wB:p1", {"text": "x"})[0], 503)

    def test_requires_token_via_real_handler(self):
        import http.client
        import atlas_dashboard as d

        srv = d.ThreadingHTTPServer(("127.0.0.1", 0), d.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1])
            c.request(
                "POST",
                "/api/v2/herd/agents/wB:p1/prompt",
                json.dumps({"text": "x"}),
                {"Content-Type": "application/json"},
            )
            r = c.getresponse()
            r.read()
            self.assertIn(r.status, (401, 403))
            self.assertEqual(self.sent(), [])
        finally:
            c.close()
            srv.shutdown()
            srv.server_close()


class StatusCacheTests(unittest.TestCase):
    def test_status_cached_and_state_distinguishes_server_down(self):
        saved = {
            k: getattr(atlas_herdr, k) for k in ("_procs", "_health_info", "_server_up")
        }
        n = {"ps": 0}

        def procs(owned=False):
            n["ps"] += 1
            return []

        atlas_herdr._procs = procs
        atlas_herdr._health_info = lambda base=None: (
            None
        )  # web UI 502s when herdr is down
        atlas_herdr._server_up = lambda: False
        atlas_herdr._status_cache = None
        try:
            s = atlas_herdr.status()
            for _ in range(5):
                atlas_herdr.status()
            self.assertEqual(n["ps"], 1)
            self.assertEqual(
                (s["state"], s["herdr_server"], s["healthy"]),
                ("server_down", False, False),
            )
            atlas_herdr._status_cache = None
            atlas_herdr._server_up = lambda: True
            self.assertEqual(atlas_herdr.status()["state"], "web_ui_down")
        finally:
            for k, v in saved.items():
                setattr(atlas_herdr, k, v)
            atlas_herdr._status_cache = None


class PaneHandler:
    """FakeHerdr handler modelling workspace/tab/pane creation like herdr 0.9.x (result shapes per the docs)."""

    def __init__(self):
        self.workspaces = {}  # label -> id
        self.panes = {}  # pane_id -> label
        self.n = 0

    def __call__(self, method, params):
        if method == "ping":
            return ok({"type": "pong", "version": "0.9.3", "protocol_version": 22})
        if method == "workspace.list":
            return ok(
                {
                    "type": "workspace_list",
                    "workspaces": [
                        {"workspace_id": i, "label": l}
                        for l, i in self.workspaces.items()
                    ],
                }
            )
        if method == "pane.list":
            ws = params.get("workspace_id")
            return ok(
                {
                    "type": "pane_list",
                    "panes": [
                        {"pane_id": p, "tab_id": f"{p}t", "label": l}
                        for p, l in self.panes.items()
                        if p.startswith(ws + ":")
                    ],
                }
            )
        if method in ("workspace.create", "tab.create"):
            self.n += 1
            if method == "workspace.create":
                ws = f"w{self.n}"
                self.workspaces[params["label"]] = ws
            else:
                ws = params["workspace_id"]
            pane = f"{ws}:p{self.n}"
            self.panes[pane] = ""
            return ok(
                {
                    "type": "x",
                    "workspace": {"workspace_id": ws},
                    "tab": {"tab_id": f"{ws}:t{self.n}"},
                    "root_pane": {"pane_id": pane},
                }
            )
        if method == "pane.rename":
            self.panes[params["pane_id"]] = params["label"]
            return ok({"type": "pane_info"})
        if method == "pane.send_input":
            return ok({"type": "ok"})
        if method == "pane.get":
            if params["pane_id"] in self.panes:
                return ok({"type": "pane_info"})
        if method == "pane.close":
            self.panes.pop(params["pane_id"], None)
            return ok({"type": "ok"})
        if method == "workspace.close":
            for l, i in list(self.workspaces.items()):
                if i == params["workspace_id"]:
                    del self.workspaces[l]
                    for p in [p for p in self.panes if p.startswith(i + ":")]:
                        del self.panes[p]
            return ok({"type": "ok"})
        return standard(method, params)


class PaneTests(SockBase):
    def setUp(self):
        type(self).handler = staticmethod(PaneHandler())
        super().setUp()

    def sent(self):
        return [p for m, p in self.fake.calls if m == "pane.send_input"]

    def test_first_worker_creates_workspace_next_gets_tab_and_command_is_typed(self):
        a = atlas_herdr.create_pane(
            "w-a",
            "exec env ATLAS_WORKER_NAME=w-a x",
            cwd="/p",
            run="r1",
            env={"K": "V"},
        )
        b = atlas_herdr.create_pane("w-b", "exec y", cwd="/p", run="r1")
        self.assertTrue(a["ok"] and b["ok"], (a, b))
        methods = [m for m, _ in self.fake.calls if m.endswith(".create")]
        self.assertEqual(methods, ["workspace.create", "tab.create"])
        ws_call = next(p for m, p in self.fake.calls if m == "workspace.create")
        self.assertEqual(
            (ws_call["label"], ws_call["cwd"], ws_call["env"], ws_call["focus"]),
            ("atlas-r1", "/p", {"K": "V"}, False),  # never steals focus
        )
        self.assertEqual(
            self.sent()[0],
            {
                "pane_id": a["pane_id"],
                "text": "exec env ATLAS_WORKER_NAME=w-a x",
                "keys": ["enter"],
            },
        )
        self.assertEqual(
            sorted(p["label"] for p in atlas_herdr.list_panes("r1")), ["w-a", "w-b"]
        )

    def test_duplicate_name_refused_nothing_created(self):
        atlas_herdr.create_pane("dup", "x", cwd="/p", run="r2")
        n = len([1 for m, _ in self.fake.calls if m.endswith(".create")])
        r = atlas_herdr.create_pane("dup", "x", cwd="/p", run="r2")
        self.assertFalse(r["ok"])
        self.assertIn("name_taken", r["reason"])
        self.assertEqual(
            n, len([1 for m, _ in self.fake.calls if m.endswith(".create")])
        )

    def test_close_refuses_non_colony_panes_and_close_run_closes_all(self):
        a = atlas_herdr.create_pane("a", "x", cwd="/p", run="r3")
        self.assertFalse(atlas_herdr.close_pane("w99:p1")["ok"])
        self.assertNotIn("pane.close", [m for m, _ in self.fake.calls])
        self.assertTrue(atlas_herdr.pane_live(a["pane_id"]))
        out = atlas_herdr.close_run("r3")
        self.assertEqual((out["ok"], out["closed"]), (True, ["a"]))
        self.assertFalse(atlas_herdr.pane_live(a["pane_id"]))
        self.assertEqual(atlas_herdr.close_run("r3")["closed"], [])

    def test_server_down_is_a_failed_result_not_an_exception(self):
        os.environ["HERDR_SOCKET_PATH"] = "/nonexistent/h.sock"
        r = atlas_herdr.create_pane("a", "x", cwd="/p")
        self.assertFalse(r["ok"])
        self.assertIn("socket_missing", r["reason"])

    def test_cli_create_pane_quotes_the_command(self):
        out = atlas_herdr._create_pane_cli(
            [
                "--name",
                "cli",
                "--cwd",
                "/p",
                "--run",
                "r4",
                "--env",
                "A=b",
                "--",
                "echo",
                "hi there",
            ]
        )
        self.assertTrue(out["ok"], out)
        self.assertEqual(self.sent()[0]["text"], "echo 'hi there'")
        self.assertFalse(
            atlas_herdr._create_pane_cli(["--name", "x"])["ok"]
        )  # no command

    def test_colony_route_reports_status_and_panes(self):
        atlas_herdr.create_pane("a", "x", cwd="/p", run="r5")
        code, body = atlas_dash_herd._colony_route(None)
        self.assertEqual(code, 200)
        self.assertEqual([p["label"] for p in body["panes"]], ["a"])
        self.assertIn("colony_url", body)
        k = atlas_dash_herd._kill_pane(_Ctx(body["panes"][0]["pane_id"], None))
        self.assertEqual(k[0], 200)
        self.assertEqual(atlas_dash_herd._kill_pane(_Ctx("w99:p9", None))[0], 404)


class InstallCheckTests(unittest.TestCase):
    def check(self, installed, pin=None):
        saved = atlas_herdr._herdr_version, atlas_herdr._pin
        atlas_herdr._herdr_version = lambda: installed
        atlas_herdr._pin = lambda: (
            pin or {"version": "0.9.3", "install_url": "https://h"}
        )
        try:
            return atlas_herdr.install_check()
        finally:
            atlas_herdr._herdr_version, atlas_herdr._pin = saved

    def test_older_than_pin_fails_with_actionable_message(self):
        r = self.check("0.9.2")
        self.assertFalse(r["ok"])
        self.assertIn("older than the pinned 0.9.3", r["why"])
        self.assertIn("upgrade herdr", r["do"])

    def test_equal_newer_and_double_digit_versions_pass(self):
        for v in ("0.9.3", "0.9.10", "0.10.0", "1.0"):
            self.assertTrue(self.check(v)["ok"], v)
        self.assertFalse(
            self.check("0.9.9", {"version": "0.9.10"})["ok"]
        )  # not string order

    def test_missing_binary_and_missing_pin(self):
        r = self.check(None)
        self.assertFalse(r["ok"])
        self.assertIn("not installed", r["why"])
        self.assertFalse(self.check("0.9.3", {"x": 1})["ok"])

    def test_ensure_refuses_to_spawn_when_older_than_pin(self):
        saved = {
            k: getattr(atlas_herdr, k)
            for k in ("install_check", "_health", "_spawn", "_server_up")
        }
        calls = []
        atlas_herdr._health = lambda: False
        atlas_herdr._server_up = lambda: True
        atlas_herdr._spawn = lambda: calls.append(1) or (True, "")
        atlas_herdr.install_check = lambda: {"ok": False, "why": "old", "do": "upgrade"}
        try:
            r = atlas_herdr.ensure()
        finally:
            for k, v in saved.items():
                setattr(atlas_herdr, k, v)
        self.assertEqual((r["ok"], r["why"], r["do"]), (False, "old", "upgrade"))
        self.assertEqual(calls, [])

    def test_real_pin_file_is_valid(self):
        pin = atlas_herdr._pin()
        self.assertTrue(atlas_herdr._vtuple(pin["version"]))
        self.assertEqual(len(pin["sha"]), 40)


class PrepareTests(unittest.TestCase):
    """_prepare mirrors the vendored tree into a per-user dir and builds there; never inside the plugin tree."""

    def setUp(self):
        self.saved = {
            k: getattr(atlas_herdr, k)
            for k in ("COLONY_SRC", "PLUGIN_ROOT", "_bun", "_run")
        }
        tmp = Path(tempfile.mkdtemp())
        self.src, self.dst = tmp / "src", tmp / "home" / "colony" / "herdr-web-ui"
        (self.src / "scripts").mkdir(parents=True)
        (self.src / "scripts" / "plugin.ts").write_text("")
        (self.src / "package.json").write_text("{}")
        (self.src / "bun.lock").write_text("lock-1")
        atlas_herdr.COLONY_SRC, atlas_herdr.PLUGIN_ROOT = self.src, self.dst
        atlas_herdr._bun = lambda: "/bin/bun"
        self.ran = []

        def run(argv, cwd, timeout):
            self.ran.append((argv[:3], str(cwd)))
            if argv[1:3] == ["run", "build"]:
                (cwd / "dist").mkdir(exist_ok=True)
                (cwd / "dist" / "index.html").write_text("x")
            if argv[1] == "install":
                (cwd / "node_modules").mkdir(exist_ok=True)
            if argv[0] == "rsync":
                import shutil

                shutil.copytree(self.src, self.dst, dirs_exist_ok=True)
            return True, ""

        atlas_herdr._run = run

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(atlas_herdr, k, v)

    def test_first_run_installs_frozen_and_builds_only_in_the_user_dir(self):
        ok_, why = atlas_herdr._prepare()
        self.assertTrue(ok_, why)
        verbs = [a for a, _ in self.ran]
        self.assertEqual(
            verbs,
            [
                ["rsync", "-a", "--delete"],
                ["/bin/bun", "install", "--frozen-lockfile"],
                ["/bin/bun", "run", "build"],
            ],
        )
        for argv, cwd in self.ran[1:]:
            self.assertEqual(cwd, str(self.dst))  # never the vendored tree
        self.assertFalse((self.src / "node_modules").exists())
        self.assertFalse((self.src / "dist").exists())

    def test_second_run_is_a_noop_until_the_lockfile_changes(self):
        atlas_herdr._prepare()
        self.ran.clear()
        self.assertEqual(atlas_herdr._prepare(), (True, "built"))
        self.assertEqual(self.ran, [])
        (self.src / "bun.lock").write_text("lock-2")
        atlas_herdr._prepare()
        self.assertEqual(len(self.ran), 3)

    def test_build_failure_is_reported_and_not_stamped(self):
        atlas_herdr._run = lambda argv, cwd, timeout: (
            (False, "boom") if argv[1:2] == ["install"] else (True, "")
        )
        ok_, why = atlas_herdr._prepare()
        self.assertFalse(ok_)
        self.assertIn("boom", why)
        self.assertFalse((self.dst / ".atlas-build").exists())

    def test_vendored_tree_missing_is_actionable(self):
        atlas_herdr.COLONY_SRC = self.src / "nope"
        ok_, why = atlas_herdr._prepare()
        self.assertFalse(ok_)
        self.assertIn("vendored herdr-web-ui is missing", why)

    def _tree(self):
        for rel in ("src/app.ts", "server/main.ts", "public/index.css"):
            (self.src / rel).parent.mkdir(exist_ok=True)
            (self.src / rel).write_text("v1")

    def test_stamp_tracks_src_server_public_edits(self):
        self._tree()
        for rel in ("src/app.ts", "server/main.ts", "public/index.css"):
            before = atlas_herdr._stamp()
            (self.src / rel).write_text("v2-" + rel)
            self.assertNotEqual(before, atlas_herdr._stamp(), rel)
            self.assertEqual(atlas_herdr._stamp(), atlas_herdr._stamp())

    def test_stamp_ignores_build_output_and_junk(self):
        self._tree()
        before = atlas_herdr._stamp()
        for rel in (
            "node_modules/x/i.js",
            "dist/index.html",
            ".git/HEAD",
            "evidence/a.png",
            ".DS_Store",
            ".atlas-build",
        ):
            (self.src / rel).parent.mkdir(parents=True, exist_ok=True)
            (self.src / rel).write_text("noise")
        self.assertEqual(before, atlas_herdr._stamp())

    def test_src_edit_rebuilds_once_and_unchanged_tree_not_at_all(self):
        self._tree()
        atlas_herdr._prepare()
        self.ran.clear()
        atlas_herdr._prepare()
        self.assertEqual(self.ran, [])
        (self.src / "src" / "app.ts").write_text("v2")
        atlas_herdr._prepare()
        self.assertEqual([a[1] for a, _ in self.ran], ["-a", "install", "run"])
        self.ran.clear()
        atlas_herdr._prepare()
        self.assertEqual(self.ran, [])


import http.server  # noqa: E402


class FakeWeb:
    """Loopback HTTP listener standing in for a herdr-web-ui on a spare port (17981-17989 only).

    kind='upstream': /api/health ok JSON, /atlas/api/health -> the SPA's text/html (no gateway).
    kind='vendored': /api/health ok JSON, /atlas/api/health -> 401 JSON {error} (gateway, auth on)."""

    def __init__(self, port: int, kind: str):
        outer = self
        self.hits: list[str] = []

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                outer.hits.append(self.path)
                if self.path == "/api/health":
                    body, ctype, code = (
                        b'{"ok":true,"auth":{"required":true}}',
                        "application/json",
                        200,
                    )
                elif self.path == "/atlas/api/health" and kind == "vendored":
                    body, ctype, code = (
                        b'{"error":{"code":"unauthorized"}}',
                        "application/json",
                        401,
                    )
                else:
                    body, ctype, code = b"<!doctype html>", "text/html", 200
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


CONF, FB1, FB2 = (
    17981,
    17982,
    17983,
)  # stand-ins for 7317 and the first two fallback ports


class UpstreamConflictTests(SockBase):
    """An upstream herdr-web-ui holding the configured port is never reused or touched: the vendored build is
    started (fake spawner: no real bun) on a fallback port, which is recorded and then honoured."""

    KEYS = (
        "DEFAULT_PORT",
        "FALLBACK_PORTS",
        "PLUGIN_ROOT",
        "_spawn",
        "_prepare",
        "_bun",
        "_server_up",
        "install_check",
        "_procs",
        "_mirror_stale",
        "HEALTH_WAIT_S",
    )

    def setUp(self):
        super().setUp()
        self.saved = {k: getattr(atlas_herdr, k) for k in self.KEYS}
        atlas_herdr._mirror_stale = lambda: False  # about ports/upstream, not staleness
        self.env = {
            k: os.environ.get(k)
            for k in ("ATLAS_HOME", "HERDR_WEB_URL", "HERDR_WEB_STATE_DIR")
        }
        self.home = tempfile.mkdtemp()
        os.environ["ATLAS_HOME"] = self.home
        os.environ["HERDR_WEB_STATE_DIR"] = (
            tempfile.mkdtemp()
        )  # no upstream plugin-port record
        os.environ.pop("HERDR_WEB_URL", None)
        atlas_herdr.DEFAULT_PORT = CONF
        atlas_herdr.FALLBACK_PORTS = (FB1, FB2)
        atlas_herdr.HEALTH_WAIT_S = 3.0
        atlas_herdr._bun = lambda: "/bin/true"
        atlas_herdr._server_up = lambda: True
        atlas_herdr.install_check = lambda: {"ok": True}
        atlas_herdr._prepare = lambda: (True, "built")
        atlas_herdr._procs = lambda owned=False: []
        self.webs: list[FakeWeb] = []
        self.spawned: list = []

        def spawn(port=None):
            self.spawned.append(port)
            self.webs.append(FakeWeb(port or CONF, "vendored"))
            return True, ""

        atlas_herdr._spawn = spawn
        atlas_herdr._status_cache = None
        atlas_herdr._refresh_url()

    def tearDown(self):
        for w in self.webs:
            w.close()
        for k, v in self.saved.items():
            setattr(atlas_herdr, k, v)
        for k, v in self.env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        atlas_herdr._status_cache = None
        atlas_herdr._refresh_url()
        super().tearDown()

    def listen(self, port, kind):
        w = FakeWeb(port, kind)
        self.webs.append(w)
        return w

    def port_file(self):
        return Path(self.home) / "colony" / "port"

    def test_upstream_on_port_starts_vendored_on_fallback_and_records_it(self):
        up = self.listen(CONF, "upstream")
        st = atlas_herdr.status()  # read-only: reports the conflict, starts nothing
        self.assertEqual(self.spawned, [])
        self.assertTrue(st["upstream_plugin_on_port"])
        self.assertFalse(st["healthy"] or st["vendored_running"])
        self.assertEqual(st["colony_url"], f"http://127.0.0.1:{FB1}")
        cmds = st["takeover"]
        takeover = " | ".join(cmds)
        stop = takeover.index(
            "herdr plugin action invoke stop --plugin devswha.herdr-web-ui"
        )
        disable = takeover.index("herdr plugin disable devswha.herdr-web-ui")
        self.assertLess(
            stop, disable
        )  # disabled plugins refuse `stop` (plugin_disabled)
        self.assertTrue(cmds[0].startswith("herdr plugin action invoke stop"))
        self.assertTrue(cmds[1].startswith("herdr plugin disable"))
        self.assertTrue(cmds[2].startswith("rm -f "))
        self.assertIn("atlas_herdr.py ensure", cmds[3])
        self.assertIn("apply --yes --replace", cmds[4])
        self.assertIn("plugin_disabled", st["takeover_note"])
        self.assertIn("scripts/plugin.ts stop", st["takeover_note"])
        atlas_herdr._status_cache = None
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "started"), r)
        self.assertEqual(self.spawned, [FB1])  # explicit PORT, first free fallback
        self.assertEqual(r["colony_url"], f"http://127.0.0.1:{FB1}")
        self.assertTrue(r["upstream_plugin_on_port"])
        self.assertEqual(self.port_file().read_text().strip(), str(FB1))
        # the upstream listener was only ever read, on the two health paths
        self.assertEqual(set(up.hits), {"/api/health", "/atlas/api/health"})
        atlas_herdr._status_cache = None
        st = atlas_herdr.status()
        self.assertTrue(st["healthy"] and st["vendored_running"], st)
        self.assertEqual(st["colony_url"], f"http://127.0.0.1:{FB1}")
        self.assertEqual(st["url"], st["colony_url"])

    def test_vendored_already_on_configured_port_is_reused(self):
        self.listen(CONF, "vendored")
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "reused"), r)
        self.assertNotIn("upstream_plugin_on_port", r)
        self.assertEqual(self.spawned, [])
        self.assertFalse(self.port_file().exists())
        st = atlas_herdr.status()
        self.assertTrue(st["vendored_running"])
        self.assertFalse(st["upstream_plugin_on_port"])
        self.assertNotIn("takeover", st)

    def test_persisted_port_is_honoured_and_reused_without_spawn(self):
        self.listen(CONF, "upstream")
        self.listen(FB2, "vendored")
        self.port_file().parent.mkdir(parents=True)
        self.port_file().write_text(f"{FB2}\n")
        atlas_herdr._refresh_url()
        self.assertEqual(atlas_herdr._url(), f"http://127.0.0.1:{FB2}")
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "reused"), r)
        self.assertEqual(r["colony_url"], f"http://127.0.0.1:{FB2}")
        self.assertEqual(self.spawned, [])
        atlas_herdr._status_cache = None
        st = atlas_herdr.status()
        self.assertEqual(st["colony_url"], f"http://127.0.0.1:{FB2}")
        self.assertTrue(st["vendored_running"])

    def test_busy_first_fallback_is_skipped(self):
        self.listen(CONF, "upstream")
        self.listen(FB1, "upstream")  # something else already holds the first fallback
        r = atlas_herdr.ensure()
        self.assertEqual((r["ok"], r["action"]), (True, "started"), r)
        self.assertEqual(self.spawned, [FB2])

    def test_no_free_fallback_is_actionable_and_spawns_nothing(self):
        self.listen(CONF, "upstream")
        self.listen(FB1, "upstream")
        self.listen(FB2, "upstream")
        r = atlas_herdr.ensure()
        self.assertFalse(r["ok"])
        self.assertIn("fallback", r["why"])
        self.assertEqual(self.spawned, [])
        self.assertFalse(self.port_file().exists())

    def test_failed_start_does_not_leave_a_dead_port_recorded(self):
        self.listen(CONF, "upstream")
        atlas_herdr._spawn = lambda port=None: (False, "boom")
        atlas_herdr.HEALTH_WAIT_S = 0.3
        r = atlas_herdr.ensure()
        self.assertFalse(r["ok"])
        self.assertFalse(self.port_file().exists())
        self.assertEqual(atlas_herdr._url(), f"http://127.0.0.1:{CONF}")

    def test_upstream_processes_are_not_the_colonys(self):
        # _procs(owned=True) must ignore a bun running the user's upstream plugin, and so must reap/_managed
        import subprocess

        up = "/h/.config/herdr/plugins/github/devswha.herdr-web-ui-abc/server"
        mine = f"{atlas_herdr.PLUGIN_ROOT}/server"
        ps = f"  10 1 05:00 bun {up}/managed.ts\n  20 1 01:00 bun {mine}/managed.ts\n"
        atlas_herdr._procs = self.saved["_procs"]
        real = subprocess.run
        subprocess.run = lambda *a, **k: subprocess.CompletedProcess(a, 0, ps, "")
        try:
            self.assertEqual([p[0] for p in atlas_herdr._procs()], [10, 20])
            self.assertEqual([p[0] for p in atlas_herdr._procs(owned=True)], [20])
            self.assertEqual([p[0] for p in atlas_herdr._managed()], [20])
            self.assertEqual(
                atlas_herdr.reap()["killed"], []
            )  # one colony process: nothing to reap
        finally:
            subprocess.run = real


class SavedPortTests(unittest.TestCase):
    def test_saved_fallback_port_wins_over_default_and_env_url_wins_over_both(self):
        d = tempfile.mkdtemp()
        (Path(d) / "plugin-port").write_text("17317\n")
        old = {k: os.environ.get(k) for k in ("HERDR_WEB_STATE_DIR", "HERDR_WEB_URL")}
        try:
            os.environ["HERDR_WEB_STATE_DIR"] = d
            os.environ.pop("HERDR_WEB_URL", None)
            self.assertEqual(atlas_herdr._url(), "http://127.0.0.1:17317")
            os.environ["HERDR_WEB_URL"] = "http://localhost:9999"
            self.assertEqual(atlas_herdr._url(), "http://localhost:9999")
            os.environ["HERDR_WEB_URL"] = (
                "http://evil.example:80"  # non-loopback ignored
            )
            self.assertEqual(atlas_herdr._url(), "http://127.0.0.1:17317")
            (Path(d) / "plugin-port").write_text("garbage")
            os.environ.pop("HERDR_WEB_URL")
            self.assertEqual(atlas_herdr._url(), "http://127.0.0.1:7317")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_vendored_tree_and_pin_exist(self):
        self.assertTrue((atlas_herdr.COLONY_SRC / "scripts" / "plugin.ts").is_file())
        self.assertTrue(atlas_herdr.PIN_FILE.is_file())
        self.assertFalse(
            str(atlas_herdr.PLUGIN_ROOT).startswith(str(atlas_herdr.ATLAS_PLUGIN))
        )


class ClaudeBgAgentsTests(unittest.TestCase):
    """S6: GET /api/v2/herd/agents merges claude-bg workers (atlas_mux._claude_workers) into the
    herdr agent rows when the mux transport is claude-bg, tagged source=claude-bg; with no bg rows
    the body is byte-identical to the herdr-only body, and a failed agents-json read adds nothing."""

    TRANSPORT_ENV = "ATLAS_COLONY_TRANSPORT"

    class BgCtx:
        """Minimal request ctx: explicit project, no db."""

        def __init__(self, root):
            self.query = {"project": "p"}
            self._root = root

        def db(self):
            import sqlite3

            raise sqlite3.Error("no db in bg tests")

        def project_root(self, _name):
            return self._root

    def setUp(self):
        self.old_transport = os.environ.get(self.TRANSPORT_ENV)
        self.old_workers = atlas_mux._claude_workers
        self.old_junk = atlas_dash_work._junk_root
        self.root = tempfile.mkdtemp(prefix="s6bg", dir="/tmp")
        os.environ[self.TRANSPORT_ENV] = "claude-bg"
        atlas_dash_work._junk_root = lambda real: (
            False
        )  # tempdir project roots stay in canon
        atlas_herdr._status_cache = None

    def tearDown(self):
        atlas_mux._claude_workers = self.old_workers
        atlas_dash_work._junk_root = self.old_junk
        if self.old_transport is None:
            os.environ.pop(self.TRANSPORT_ENV, None)
        else:
            os.environ[self.TRANSPORT_ENV] = self.old_transport
        atlas_herdr._status_cache = None

    def body(self):
        code, body = atlas_dash_herd._agents(self.BgCtx(self.root))
        self.assertEqual(code, 200)
        body = dict(body)
        body.pop("fetched_ms")  # timing is not part of the contract
        return body

    def test_bg_worker_rows_merge_with_source_tag(self):
        atlas_mux._claude_workers = lambda root: [
            {"name": "dash-s6-probe", "dead": 0, "pid": "s6a1", "state": "working"}
        ]
        body = self.body()
        rows = [r for r in body["agents"] if r.get("source") == "claude-bg"]
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["pane_id"], "bg:s6a1")
        self.assertEqual(row["label"], "dash-s6-probe")
        self.assertEqual(row["title"], "dash-s6-probe")
        self.assertEqual(row["status"], "working")
        self.assertEqual(row["agent"], "claude")
        self.assertEqual(row["cwd"], os.path.realpath(self.root))
        self.assertEqual(body["counts"]["working"], 1)

    def test_no_bg_rows_leaves_body_byte_identical_to_herdr_only(self):
        atlas_mux._claude_workers = lambda root: []
        os.environ[self.TRANSPORT_ENV] = "herdr"
        gated_off = self.body()
        os.environ[self.TRANSPORT_ENV] = "claude-bg"
        gated_on = self.body()
        self.assertEqual(
            json.dumps(gated_off, sort_keys=True), json.dumps(gated_on, sort_keys=True)
        )
        self.assertEqual(
            set(gated_on),
            {"ok", "herdr", "web_ui", "counts", "workspaces", "tabs", "agents"},
        )

    def test_failed_agents_json_read_adds_no_rows_and_no_keys(self):
        atlas_mux._claude_workers = lambda root: None  # claude missing / garbage output
        body = self.body()
        self.assertFalse(any(r.get("source") for r in body["agents"]))
        os.environ[self.TRANSPORT_ENV] = "herdr"
        self.assertEqual(
            json.dumps(self.body(), sort_keys=True),
            json.dumps(body, sort_keys=True),
        )

    def test_herdr_transport_never_merges_bg_rows(self):
        atlas_mux._claude_workers = lambda root: [
            {"name": "sneaky", "dead": 0, "pid": "s6b2", "state": "working"}
        ]
        os.environ[self.TRANSPORT_ENV] = "herdr"
        body = self.body()
        self.assertFalse(any(r.get("source") for r in body["agents"]))


if __name__ == "__main__":
    unittest.main()
