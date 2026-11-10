#!/usr/bin/env python3
"""atlas_dashboard: extra behavior tests for helpers, pidfile/daemon probes,
response helpers, loop bodies and the CLI entry point."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import http.client
import io
import json
import os
import socket
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import atlas_dashboard as d
import atlas_db


class Tmp(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.tmp = Path(os.path.realpath(t.name))


class ConnectorConfigTest(Tmp):
    def test_connector_env_path_follows_armada_root_else_plugin_root(self):
        with mock.patch.object(d, "_armada_root", return_value=None):
            self.assertEqual(d._connector_env_path(), d.PLUGIN_ROOT / ".env")
        with mock.patch.object(d, "_armada_root", return_value=self.tmp):
            self.assertEqual(d._connector_env_path(), self.tmp / ".env")

    def test_user_config_schema_rows(self):
        uc = {
            "full_key": {"title": "Full", "description": "desc", "sensitive": 1,
                         "required": True, "default": "dflt"},
            "bare_key": {},
            "skipped": "not a dict",
        }
        seen = []

        def key_is_set(key, env_key, opts, env_present, marks):
            seen.append((key, env_key))
            return (key == "full_key", "env" if key == "full_key" else None)

        with mock.patch.object(d, "_all_user_config", return_value=uc), \
                mock.patch.object(d, "_plugin_config_options", return_value={}), \
                mock.patch.object(d, "_env_file_present_keys", return_value=set()), \
                mock.patch.object(d, "_load_cred_marks", return_value={}), \
                mock.patch.object(d, "_key_is_set", key_is_set):
            rows = d._user_config_schema()
        self.assertEqual(seen, [("full_key", "FULL_KEY"), ("bare_key", "BARE_KEY")])
        self.assertEqual(rows, [
            {"key": "full_key", "title": "Full", "description": "desc",
             "sensitive": True, "required": True, "default": "dflt",
             "is_set": True, "source": "env"},
            {"key": "bare_key", "title": "bare_key", "description": "",
             "sensitive": False, "required": False, "default": "",
             "is_set": False, "source": None},
        ])

    def test_connector_usage_map_passes_through_and_closes_connection(self):
        conn = mock.Mock()
        with mock.patch.object(d, "_db", return_value=(conn, "p")), \
                mock.patch.object(d.atlas_control, "connector_usage",
                                  return_value={"falcon": {"calls": 3}}) as cu:
            self.assertEqual(d._connector_usage_map(), {"falcon": {"calls": 3}})
        cu.assert_called_once_with(conn)
        conn.close.assert_called_once_with()

    def test_connector_usage_map_closes_even_on_error(self):
        conn = mock.Mock()
        with mock.patch.object(d, "_db", return_value=(conn, "p")), \
                mock.patch.object(d.atlas_control, "connector_usage",
                                  side_effect=RuntimeError("x")):
            with self.assertRaises(RuntimeError):
                d._connector_usage_map()
        conn.close.assert_called_once_with()

    def test_connector_usage_map_without_db_is_empty(self):
        with mock.patch.object(d, "_db", side_effect=OSError("no db")):
            self.assertEqual(d._connector_usage_map(), {})

    def test_is_junk_project_delegates_to_control(self):
        with mock.patch.object(d.atlas_control, "is_fixture_project",
                               return_value=True) as f:
            self.assertIs(d._is_junk_project("/x"), True)
            f.assert_called_once_with("/x")
        with mock.patch.object(d.atlas_control, "is_fixture_project", return_value=False):
            self.assertIs(d._is_junk_project("/x"), False)


class SessionQueriesTest(Tmp):
    def setUp(self):
        super().setUp()
        self.conn = atlas_db.connect(str(self.tmp / "a.db"))
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)
        self.now = time.time()
        c = self.conn
        c.execute("INSERT INTO projects(id,root_path,name) VALUES(1,'/p/proj','proj')")
        c.execute("INSERT INTO session_logs(session_id,project_id,transcript_path,cwd,"
                  "model,started_at,ended_at) VALUES('S1',1,?, '/p/proj','m1',?,?)",
                  (str(self.tmp / "t.jsonl"), self.now - 100, self.now - 50))
        c.execute("INSERT INTO runs(id,project_id,session_id,started_at,task_summary,"
                  "kind,orchestrating) VALUES(7,1,'S1',?, 'do it','orchestrator',1)",
                  (self.now - 90,))
        c.execute("INSERT INTO runs(id,project_id,session_id,started_at,task_summary) "
                  "VALUES(8,1,'S2',?,'run only')", (self.now - 80,))
        c.execute("INSERT INTO metrics(run_id,inline_ops,dispatches) VALUES(7,4,2)")
        c.execute("INSERT INTO facets(session_id,outcome,brief_summary) "
                  "VALUES('S1','success','brief')")
        for i in range(105):
            c.execute("INSERT INTO tool_calls(session_id,tool_use_id,tool_name,kind,ts)"
                      " VALUES('S1',?,?,?,?)", (f"t{i}", "Bash", "shell", self.now - 1000 + i))
        for i in range(35):
            c.execute("INSERT INTO user_prompts(session_id,uuid,ts,text,char_len) "
                      "VALUES('S1',?,?,?,?)", (f"u{i}", self.now - 500 + i,
                                                "x" * (300 if i == 34 else 5), 5))
        for i in range(85):
            c.execute("INSERT INTO events(run_id,ts,tool,context,is_inline_op) "
                      "VALUES(7,?,'Edit','c',1)", (self.now - 400 + i,))
        for i in range(55):
            c.execute("INSERT INTO dispatches(run_id,ts,agent_type,model,wave_id) "
                      "VALUES(7,?,'impl','m','w')", (self.now - 300 + i,))
        c.commit()

    def test_session_detail_from_session_log_with_limits_and_order(self):
        out = d._session_detail(self.conn, "S1")
        s = out["session"]
        self.assertEqual(s["session_id"], "S1")
        self.assertEqual(s["project_name"], "proj")
        self.assertEqual(s["run_id"], 7)
        self.assertEqual(s["inline_ops"], 4)
        self.assertEqual(s["outcome"], "success")
        self.assertEqual(s["brief_summary"], "brief")
        self.assertIn("is_live", s)
        self.assertEqual(len(out["tools"]), 100)
        self.assertEqual(out["tools"][0]["ts"], max(t["ts"] for t in out["tools"]))
        self.assertEqual(len(out["prompts"]), 30)
        newest = out["prompts"][0]["text"]
        self.assertEqual(newest, "x" * 280 + "…")
        self.assertEqual(out["prompts"][1]["text"], "xxxxx")
        self.assertEqual(len(out["events"]), 80)
        self.assertEqual(len(out["dispatches"]), 50)
        self.assertEqual(out["dispatches"][0]["agent_type"], "impl")
        self.assertEqual(set(out), {"session", "tools", "prompts", "events", "dispatches"})

    def test_session_detail_falls_back_to_run_row(self):
        out = d._session_detail(self.conn, "S2")
        s = out["session"]
        self.assertEqual(s["session_id"], "S2")
        self.assertEqual(s["run_id"], 8)
        self.assertEqual(s["project_root"], "/p/proj")
        self.assertEqual(s["cwd"], "/p/proj")
        self.assertEqual(s["task_summary"], "run only")
        self.assertEqual((out["tools"], out["prompts"], out["events"], out["dispatches"]),
                         ([], [], [], []))

    def test_session_detail_unknown_session(self):
        out = d._session_detail(self.conn, "nope")
        self.assertIsNone(out["session"])
        self.assertEqual(out["tools"], [])

    def test_transcript_not_found(self):
        self.assertEqual(d._session_transcript(self.conn, "nope"),
                         (404, {"ok": False, "error": "session_not_found"}))

    def test_transcript_unavailable_file(self):
        code, body = d._session_transcript(self.conn, "S1")
        self.assertEqual(code, 404)
        self.assertEqual(body, {"ok": False, "error": "transcript_unavailable",
                                "path": str(self.tmp / "t.jsonl")})

    def test_transcript_without_path_is_unavailable(self):
        self.conn.execute("INSERT INTO session_logs(session_id) VALUES('S3')")
        self.conn.commit()
        code, body = d._session_transcript(self.conn, "S3")
        self.assertEqual((code, body["error"], body["path"]), (404, "transcript_unavailable", ""))

    def test_transcript_returns_text_and_tails_big_files(self):
        p = self.tmp / "t.jsonl"
        p.write_text("héllo wörld\n", encoding="utf-8")
        code, body = d._session_transcript(self.conn, "S1")
        self.assertEqual(code, 200)
        self.assertEqual(body, {"ok": True, "path": str(p), "size": p.stat().st_size,
                                "truncated": False, "text": "héllo wörld\n"})
        p.write_bytes(b"0123456789")
        with mock.patch.object(d, "TRANSCRIPT_TAIL_BYTES", 4):
            code, body = d._session_transcript(self.conn, "S1")
        self.assertEqual((code, body["text"], body["truncated"], body["size"]),
                         (200, "6789", True, 10))
        with mock.patch.object(d, "TRANSCRIPT_TAIL_BYTES", 10):
            code, body = d._session_transcript(self.conn, "S1")
        self.assertEqual((body["text"], body["truncated"]), ("0123456789", False))

    def test_transcript_invalid_utf8_is_replaced(self):
        (self.tmp / "t.jsonl").write_bytes(b"ok\xff")
        self.assertEqual(d._session_transcript(self.conn, "S1")[1]["text"], "ok�")


class ProcessProbesTest(Tmp):
    def test_pid_alive(self):
        self.assertTrue(d._pid_alive(os.getpid()))
        self.assertFalse(d._pid_alive(0))
        self.assertFalse(d._pid_alive(-5))
        with mock.patch.object(d.os, "kill", side_effect=ProcessLookupError) as k:
            self.assertFalse(d._pid_alive(4242))
            k.assert_called_once_with(4242, 0)

    def test_port_open(self):
        s = socket.socket()
        s.bind((d.LOOPBACK, 0))
        s.listen(1)
        self.addCleanup(s.close)
        port = s.getsockname()[1]
        self.assertTrue(d._port_open(d.LOOPBACK, port))
        s.close()
        self.assertFalse(d._port_open(d.LOOPBACK, port))

    def serve_health(self, body, status=200):
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(status)
                self.end_headers()
                self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())

            def log_message(self, *a):
                pass
        srv = HTTPServer((d.LOOPBACK, 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        return srv.server_address[1]

    def test_health_payload(self):
        port = self.serve_health({"ok": True, "version": "1.2.3"})
        self.assertEqual(d._health_payload(port), {"ok": True, "version": "1.2.3"})

    def test_health_payload_failures_are_none(self):
        s = socket.socket()
        s.bind((d.LOOPBACK, 0))
        port = s.getsockname()[1]
        s.close()
        self.assertIsNone(d._health_payload(port, timeout=0.5))
        self.assertIsNone(d._health_payload(self.serve_health(b"not json")))
        self.assertIsNone(d._health_payload(self.serve_health({}, status=500)))

    def test_daemon_db_ok_compares_realpaths(self):
        want = self.tmp / "want.db"
        want.write_text("")
        link = self.tmp / "link.db"
        link.symlink_to(want)
        with mock.patch.object(d, "dashboard_db_path", return_value=str(want)):
            self.assertTrue(d._daemon_db_ok(self.serve_health({"db_path": str(link)})))
            self.assertFalse(d._daemon_db_ok(
                self.serve_health({"db_path": str(self.tmp / "other.db")})))
            self.assertFalse(d._daemon_db_ok(self.serve_health({"db_path": ""})))
            self.assertFalse(d._daemon_db_ok(self.serve_health({})))
            self.assertFalse(d._daemon_db_ok(self.serve_health(b"garbage")))

    def test_daemon_db_ok_dead_port(self):
        s = socket.socket()
        s.bind((d.LOOPBACK, 0))
        port = s.getsockname()[1]
        s.close()
        self.assertFalse(d._daemon_db_ok(port))


class PidfileTest(Tmp):
    def test_write_pidfile_creates_missing_state_dir_and_records_fields(self):
        state = self.tmp / "deep" / "state"
        with mock.patch.object(d, "STATE_DIR", state):
            before = time.time()
            d._write_pidfile(1234, 7777, "/db/a.db")
            rec = json.loads((state / "dashboard-7777.pid").read_text(encoding="utf-8"))
        self.assertEqual(rec["pid"], 1234)
        self.assertEqual(rec["port"], 7777)
        self.assertEqual(rec["host"], d.LOOPBACK)
        self.assertEqual(rec["db_path"], "/db/a.db")
        self.assertEqual(rec["script"], str(Path(d.__file__).resolve()))
        self.assertTrue(before <= rec["started_at"] <= time.time())
        self.assertTrue((state / "dashboard-7777.pid").read_text().endswith("}\n"))


class ProjectRootTest(Tmp):
    def test_ctx_db_returns_connection_from_db_helper(self):
        conn = object()
        with mock.patch.object(d, "_db", return_value=(conn, "p")):
            self.assertIs(d._Ctx({}, {}, ()).db(), conn)

    def test_ctx_basics(self):
        c = d._Ctx({"a": "1"}, {"b": 2}, ("g",))
        self.assertEqual((c.query, c.json(), c.groups), ({"a": "1"}, {"b": 2}, ("g",)))

    def test_ctx_project_root(self):
        c = d._Ctx({}, {}, ())
        for blank in (None, "", "all"):
            self.assertIsNone(c.project_root(blank))
        with mock.patch.object(d, "_project_root", return_value="/r") as pr:
            self.assertEqual(c.project_root("12"), "/r")
            pr.assert_called_once_with("12")
        self.assertEqual(c.project_root(str(self.tmp)), os.path.realpath(self.tmp))
        self.assertIsNone(c.project_root(str(self.tmp / "missing")))
        self.assertIsNone(c.project_root("relative/dir"))


class LoopbackHostTest(unittest.TestCase):
    def test_loopback_detection(self):
        for h in ("localhost", "127.0.0.1", "127.9.9.9", "::1"):
            self.assertIs(d._is_loopback_host(h), True, h)
        for h in ("0.0.0.0", "192.168.1.5", "example.com", "", "::", "10.0.0.1",
                  "LOCALHOST"):
            self.assertIs(d._is_loopback_host(h), False, h)


class FakeHandler:
    """Drive Handler's response helpers without a socket."""

    def __init__(self):
        self.status = None
        self.headers = {}
        self.wfile = io.BytesIO()
        self.ended = False

    def send_response(self, code):
        self.status = code

    def send_header(self, k, v):
        self.headers[k] = v

    def end_headers(self):
        self.ended = True


class ResponseHelperTest(Tmp):
    def call(self, name, *args):
        h = FakeHandler()
        # _bytes is reached through self by the asset helpers
        h._bytes = lambda *a, **k: d.Handler._bytes(h, *a, **k)
        getattr(d.Handler, name)(h, *args)
        return h

    def test_html(self):
        h = self.call("_html", 201, "<p>é</p>")
        self.assertEqual(h.status, 201)
        self.assertEqual(h.wfile.getvalue(), "<p>é</p>".encode("utf-8"))
        self.assertEqual(h.headers, {"Content-Type": "text/html; charset=utf-8",
                                     "Content-Length": str(len("<p>é</p>".encode())),
                                     "Cache-Control": "no-store"})
        self.assertTrue(h.ended)

    def test_bytes_default_and_custom_cache(self):
        h = self.call("_bytes", 200, b"abc", "text/x")
        self.assertEqual((h.status, h.wfile.getvalue()), (200, b"abc"))
        self.assertEqual(h.headers, {"Content-Type": "text/x", "Content-Length": "3",
                                     "Cache-Control": "public, max-age=3600"})
        h = self.call("_bytes", 404, b"", "text/x", "no-store")
        self.assertEqual((h.status, h.headers["Cache-Control"]), (404, "no-store"))

    def test_asset_mark_is_inline_svg(self):
        h = self.call("_asset_mark")
        self.assertEqual(h.status, 200)
        self.assertEqual(h.headers["Content-Type"], "image/svg+xml; charset=utf-8")
        body = h.wfile.getvalue()
        self.assertTrue(body.startswith(b"<svg"))
        self.assertEqual(h.headers["Content-Length"], str(len(body)))

    def test_asset_hero_prefers_png_then_falls_back_to_svg(self):
        root = self.tmp / "plug"
        scripts_parent = root / "a" / "b"
        scripts_parent.mkdir(parents=True)
        with mock.patch.object(d, "PLUGIN_ROOT", scripts_parent):
            h = self.call("_asset_hero")
            self.assertEqual(h.headers["Content-Type"], "image/svg+xml; charset=utf-8")
            self.assertIn(b"linearGradient", h.wfile.getvalue())
            img = root / "img"
            img.mkdir()
            (img / "command-center-hero.png").write_bytes(b"PNGDATA")
            h = self.call("_asset_hero")
            self.assertEqual(h.headers["Content-Type"], "image/png")
            self.assertEqual(h.wfile.getvalue(), b"PNGDATA")
            self.assertEqual(h.headers["Content-Length"], "7")
            self.assertEqual(h.headers["Cache-Control"], "public, max-age=3600")

    def test_asset_hero_skips_oversized_file_and_uses_second_candidate(self):
        root = self.tmp / "plug"
        scripts_parent = root / "a" / "b"
        scripts_parent.mkdir(parents=True)
        img = root / "img"
        img.mkdir()
        big = img / "command-center-hero.png"
        big.write_bytes(b"x" * 10)
        (img / "readme-hero-banner.png").write_bytes(b"BANNER")
        real_stat = Path.stat

        def fake_stat(self_, *a, **k):
            st = real_stat(self_, *a, **k)
            if self_.name == "command-center-hero.png":
                return mock.Mock(st_size=3_500_000, st_mode=st.st_mode)
            return st
        with mock.patch.object(d, "PLUGIN_ROOT", scripts_parent), \
                mock.patch.object(Path, "stat", fake_stat):
            h = self.call("_asset_hero")
        self.assertEqual(h.wfile.getvalue(), b"BANNER")

    def test_asset_hero_jpeg_suffix(self):
        root = self.tmp / "plug"
        pr = root / "a" / "b"
        pr.mkdir(parents=True)
        (pr / "img").mkdir()
        (pr / "img" / "command-center-hero.png").write_bytes(b"x")
        # the third candidate is PLUGIN_ROOT/img/command-center-hero.png (a .png)
        with mock.patch.object(d, "PLUGIN_ROOT", pr):
            h = self.call("_asset_hero")
        self.assertEqual(h.headers["Content-Type"], "image/png")


class HttpVerbTest(Tmp):
    def setUp(self):
        super().setUp()
        root = self.tmp / "static"
        root.mkdir()
        (root / "index.html").write_text("<html><head></head>hello</html>")
        (root / "a.css").write_text("body{}")
        p = mock.patch.object(d, "STATIC_DIR", root)
        p.start()
        self.addCleanup(p.stop)
        self.httpd = ThreadingHTTPServer((d.LOOPBACK, 0), d.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.port = self.httpd.server_address[1]

    def req(self, method, path, headers=None, body=None):
        conn = http.client.HTTPConnection(d.LOOPBACK, self.port, timeout=10)
        hdrs = {"Host": f"{d.LOOPBACK}:{self.port}"}
        hdrs.update(headers or {})
        conn.request(method, path, body=body, headers=hdrs)
        r = conn.getresponse()
        data = r.read()
        out = (r.status, dict(r.getheaders()), data)
        conn.close()
        return out

    def test_options_is_204_with_allow_and_no_cors(self):
        status, headers, body = self.req("OPTIONS", "/api/v2/todos")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Allow"], "GET, HEAD, POST, PUT, DELETE")
        self.assertEqual(body, b"")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_head_static_has_headers_and_no_body(self):
        status, headers, body = self.req("HEAD", "/ui/a.css")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Length"], "6")
        self.assertEqual(body, b"")
        status, headers, body = self.req("HEAD", "/")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")

    def test_head_unknown_path_is_404(self):
        status, _, _ = self.req("HEAD", "/api/nothing-here")
        self.assertEqual(status, 404)

    def test_head_guard_rejects_bad_host(self):
        status, _, _ = self.req("HEAD", "/ui/a.css", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)

    def test_put_goes_through_the_mutation_guard(self):
        status, _, _ = self.req("PUT", "/api/v2/todos", body=b"{}",
                                headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)
        status, _, _ = self.req("PUT", "/api/v2/todos", body=b"{}",
                                headers={"Content-Type": "application/json"})
        self.assertEqual(status, 401)
        status, _, raw = self.req("PUT", "/api/v2/todos", body=b"{}",
                                  headers={"Content-Type": "application/json",
                                           "X-Atlas-Token": d.DASH_TOKEN})
        self.assertNotIn(status, (401, 403, 415))

    def test_asset_routes(self):
        status, headers, body = self.req("GET", "/assets/mark.svg")
        self.assertEqual((status, headers["Content-Type"]),
                         (200, "image/svg+xml; charset=utf-8"))
        self.assertTrue(body.startswith(b"<svg"))
        status, headers, body = self.req("GET", "/assets/logo.svg")
        self.assertEqual(status, 200)
        status, headers, body = self.req("GET", "/assets/hero.png")
        self.assertEqual(status, 200)
        self.assertIn(headers["Content-Type"], ("image/png", "image/svg+xml; charset=utf-8"))


class LoopBodiesTest(Tmp):
    class _Stop(Exception):
        pass

    def test_reap_loop_ticks_then_sleeps_interval(self):
        calls = []
        with mock.patch.object(d, "reap_tick", lambda: calls.append("tick")), \
                mock.patch.object(d.time, "sleep",
                                  side_effect=[None, self._Stop()]) as sl:
            with self.assertRaises(self._Stop):
                d._reap_loop()
        self.assertEqual(calls, ["tick", "tick"])
        sl.assert_called_with(d.REAP_INTERVAL_S)

    def test_self_heal_loop_execs_when_target_found(self):
        target = Path("/x/scripts/atlas_dashboard.py")
        with mock.patch.object(d.time, "sleep") as sl, \
                mock.patch.object(d, "_self_heal_target", return_value=target), \
                mock.patch.object(d, "_self_heal_exec",
                                  side_effect=self._Stop()) as ex:
            with self.assertRaises(self._Stop):
                d._self_heal_loop()
        sl.assert_called_once_with(d.HEAL_CHECK_S)
        ex.assert_called_once_with(target)

    def test_self_heal_loop_survives_scan_errors_and_idles_without_target(self):
        results = [RuntimeError("scan"), None]

        def target():
            r = results.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        sleeps = [None, None, self._Stop()]
        with mock.patch.object(d.time, "sleep", side_effect=sleeps), \
                mock.patch.object(d, "_self_heal_target", side_effect=target), \
                mock.patch.object(d, "_self_heal_exec") as ex, \
                self.assertLogs("atlas.dashboard", level="WARNING") as logs:
            with self.assertRaises(self._Stop):
                d._self_heal_loop()
        ex.assert_not_called()
        self.assertIn("self-heal check failed: RuntimeError('scan')", logs.output[0])

    def test_own_install_roots_dedupes_and_orders(self):
        argv0 = "/opt/inst1/scripts/atlas_dashboard.py"
        with mock.patch.object(d.sys, "argv", [argv0]), \
                mock.patch.object(d, "__file__", "/opt/inst2/scripts/atlas_dashboard.py"):
            self.assertEqual(d._own_install_roots(), [Path("/opt/inst1"), Path("/opt/inst2")])
        with mock.patch.object(d.sys, "argv", [argv0]), mock.patch.object(d, "__file__", argv0):
            self.assertEqual(d._own_install_roots(), [Path("/opt/inst1")])

    def test_cache_install_scripts_lists_matching_installs(self):
        home = self.tmp
        omp = home / ".omp" / "plugins" / "cache" / "plugins"
        good = omp / "tech-tools___atlas___1.0.0"
        (good / "scripts").mkdir(parents=True)
        (good / "scripts" / "atlas_dashboard.py").write_text("")
        (omp / "tech-tools___atlas___0.9.0").mkdir()  # no script
        (omp / "other-plugin").mkdir()
        cl = home / ".claude" / "plugins" / "cache" / "mkt" / "atlas" / "2.0.0"
        (cl / "scripts").mkdir(parents=True)
        (cl / "scripts" / "atlas_dashboard.py").write_text("")
        with mock.patch.object(Path, "home", return_value=home):
            got = d._cache_install_scripts()
        self.assertEqual(sorted(got), sorted([
            str(good / "scripts" / "atlas_dashboard.py"),
            str(cl / "scripts" / "atlas_dashboard.py")]))

    def test_cache_install_scripts_empty_when_no_caches(self):
        with mock.patch.object(Path, "home", return_value=self.tmp):
            self.assertEqual(d._cache_install_scripts(), [])

    def test_ui_missing_hint_uses_newest_cache_install(self):
        old = self.tmp / "tech-tools___atlas___1.2.0" / "scripts" / "atlas_dashboard.py"
        new = self.tmp / "tech-tools___atlas___1.10.0" / "scripts" / "atlas_dashboard.py"
        with mock.patch.object(d, "_self_heal_target", return_value=None), \
                mock.patch.object(d, "_cache_install_scripts",
                                  return_value=[str(old), str(new)]):
            self.assertEqual(d._ui_missing_hint(), f"python3 {new} ensure")


class ServeTest(Tmp):
    def setUp(self):
        super().setUp()
        p = mock.patch.object(d, "STATE_DIR", self.tmp / "state")
        p.start()
        self.addCleanup(p.stop)
        e = mock.patch.dict(os.environ, {"ATLAS_DB": "", "ATLAS_DASHBOARD_DB": ""})
        e.start()
        self.addCleanup(e.stop)

    def test_serve_wires_pidfile_signals_threads_and_blocks_on_httpd(self):
        httpd = mock.Mock()
        handlers = {}
        threads = []

        class T:
            def __init__(self, target=None, daemon=None, name=None):
                threads.append((target, daemon, name))

            def start(self):
                threads[-1] = threads[-1] + ("started",)
        import atlas_selffix
        with mock.patch.object(d, "_Server", return_value=httpd) as srv, \
                mock.patch.object(d, "dashboard_db_path", return_value="/db/x.db"), \
                mock.patch.object(d.signal, "signal",
                                  lambda sig, fn: handlers.setdefault(sig, fn)), \
                mock.patch.object(d.atexit, "register") as reg, \
                mock.patch.object(d.threading, "Thread", T), \
                mock.patch.object(atlas_selffix, "start_scheduler") as sched, \
                mock.patch.object(d, "_guard_shared_port", return_value=None), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            d.serve(d.LOOPBACK, 18123)
            pidfile = d.STATE_DIR / "dashboard-18123.pid"
            self.assertEqual(json.loads(pidfile.read_text())["pid"], os.getpid())
            self.assertEqual(os.environ["ATLAS_DB"], "/db/x.db")
            self.assertEqual(os.environ["ATLAS_DASHBOARD_DB"], "/db/x.db")
            srv.assert_called_once_with((d.LOOPBACK, 18123), d.Handler)
            httpd.serve_forever.assert_called_once_with()
            sched.assert_called_once_with()
            self.assertIs(d._HTTPD, httpd)
            reg.assert_called_once_with(d._clear_pidfile, os.getpid(), 18123)
            self.assertEqual({t[2] for t in threads}, {"atlas-reap", "atlas-selfheal"})
            self.assertTrue(all(t[1] is True and t[3] == "started" for t in threads))
            self.assertEqual(set(handlers), {d.signal.SIGTERM, d.signal.SIGINT})
            self.assertIn("db=/db/x.db", err.getvalue())
            self.assertIn(d.dashboard_url(18123), err.getvalue())
            with self.assertRaises(SystemExit) as cm:
                handlers[d.signal.SIGTERM](d.signal.SIGTERM, None)
            self.assertEqual(cm.exception.code, 0)
            self.assertFalse(pidfile.exists())

    def test_serve_refuses_when_guard_trips(self):
        with mock.patch.object(d, "_guard_shared_port", return_value="temp env"), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            with self.assertRaises(SystemExit) as cm:
                d.serve(d.LOOPBACK, d.SHARED_PORT)
        self.assertEqual(cm.exception.code, 1)
        self.assertIn(f"refusing to serve on :{d.SHARED_PORT}: temp env", err.getvalue())


class MainTest(Tmp):
    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = d.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_status_dumps_snapshot_json(self):
        with mock.patch.object(d, "snapshot", return_value={"ok": True, "n": 1}):
            rc, out, _ = self.run_main(["status"])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out), {"ok": True, "n": 1})
        self.assertTrue(out.endswith("\n"))

    def test_url_prints_only_when_port_open(self):
        with mock.patch.object(d, "_port_open", return_value=True) as po:
            rc, out, _ = self.run_main(["url"])
        po.assert_called_once_with(d.LOOPBACK, d.DEFAULT_PORT)
        self.assertEqual((rc, out), (0, d.dashboard_url(d.DEFAULT_PORT) + "\n"))
        with mock.patch.object(d, "_port_open", return_value=False):
            rc, out, _ = self.run_main(["url"])
        self.assertEqual((rc, out), (1, ""))

    def test_ensure_exit_code_follows_result(self):
        with mock.patch.object(d, "ensure_daemon", return_value={"ok": True, "port": 9}) as e:
            rc, out, _ = self.run_main(["ensure", "--port", "9"])
        e.assert_called_once_with(9)
        self.assertEqual((rc, json.loads(out)), (0, {"ok": True, "port": 9}))
        with mock.patch.object(d, "ensure_daemon", return_value={"ok": False}):
            rc, out, _ = self.run_main(["ensure"])
        self.assertEqual(rc, 1)

    def test_stop_prints_result_and_exits_zero(self):
        with mock.patch.object(d, "stop_daemon", return_value={"stopped": True}) as s:
            rc, out, _ = self.run_main(["stop", "--port", "5"])
        s.assert_called_once_with(5)
        self.assertEqual((rc, json.loads(out)), (0, {"stopped": True}))

    def test_missing_command_is_usage_error(self):
        with self.assertRaises(SystemExit) as cm:
            self.run_main([])
        self.assertEqual(cm.exception.code, 2)

    def test_serve_refuses_remote_host_without_flag(self):
        with mock.patch.object(d, "serve") as sv:
            rc, out, err = self.run_main(["serve", "--host", "0.0.0.0"])
        self.assertEqual(rc, 1)
        sv.assert_not_called()
        self.assertIn("refusing to bind non-loopback host '0.0.0.0'", err)
        self.assertIn("--allow-remote", err)

    def test_serve_remote_allowed_with_flag(self):
        with mock.patch.object(d, "serve") as sv, \
                mock.patch.object(d, "_port_open", return_value=False):
            rc, _, _ = self.run_main(["serve", "--host", "0.0.0.0", "--port", "9",
                                      "--allow-remote"])
        self.assertEqual(rc, 0)
        sv.assert_called_once_with("0.0.0.0", 9)

    def test_serve_reuses_healthy_running_daemon(self):
        with mock.patch.object(d, "serve") as sv, \
                mock.patch.object(d, "_port_open", return_value=True), \
                mock.patch.object(d, "_daemon_db_ok", return_value=True), \
                mock.patch.object(d, "stop_daemon") as stop:
            rc, out, _ = self.run_main(["serve", "--port", "9"])
        self.assertEqual((rc, out), (0, d.dashboard_url(9) + "\n"))
        sv.assert_not_called()
        stop.assert_not_called()

    def test_serve_replaces_daemon_on_wrong_db(self):
        with mock.patch.object(d, "serve") as sv, \
                mock.patch.object(d, "_port_open", return_value=True), \
                mock.patch.object(d, "_daemon_db_ok", return_value=False), \
                mock.patch.object(d, "stop_daemon") as stop, \
                mock.patch.object(d.time, "sleep"):
            rc, _, _ = self.run_main(["serve", "--port", "9"])
        stop.assert_called_once_with(9)
        sv.assert_called_once_with(d.LOOPBACK, 9)
        self.assertEqual(rc, 0)

    def test_serve_foreground_skips_the_running_check(self):
        with mock.patch.object(d, "serve") as sv, \
                mock.patch.object(d, "_port_open", return_value=True), \
                mock.patch.object(d, "stop_daemon") as stop:
            rc, _, _ = self.run_main(["serve", "--port", "9", "--foreground"])
        stop.assert_not_called()
        sv.assert_called_once_with(d.LOOPBACK, 9)
        self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
