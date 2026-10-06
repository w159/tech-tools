#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, os, tempfile, unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent


def _load():
    path = SCRIPTS / "atlas_dashboard.py"
    spec = importlib.util.spec_from_file_location("atlas_dashboard", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestAtlasDashboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_snapshot_canonical_and_filtered(self):
        snap = self.mod.snapshot()
        self.assertTrue(snap["ok"])
        self.assertTrue(str(snap["db_path"]).endswith("atlas.db"))
        self.assertNotIn("/var/folders/", snap["db_path"])
        self.assertLessEqual(len(snap.get("projects") or []), self.mod.MAX_PROJECTS)
        self.assertLessEqual(len(snap.get("sessions") or []), self.mod.MAX_SESSIONS)
        for s in snap.get("sessions") or []:
            if s.get("is_live"):
                # live requires recent tools/events fields present
                self.assertTrue(
                    (s.get("recent_tool_calls") or 0) + (s.get("recent_events") or 0)
                    > 0
                )
        self.assertFalse(hasattr(self.mod, "UI_HTML"))
        self.assertFalse(hasattr(self.mod, "_maybe_refresh_open_sessions"))

    def test_legacy_api_surface_still_routed(self):
        """The pages the old embedded UI drove are still served by the same paths."""
        src = (SCRIPTS / "atlas_dashboard.py").read_text(encoding="utf-8")
        for marker in (
            "/api/behavior",
            "/api/ecosystem",
            "/api/mcp/toggle",
            "/api/plugins/toggle",
            "/api/connectors/test",
            "/api/connectors/import",
            "/api/connectors/export",
            "/api/todo",
            "/api/agents",
            "/api/memory",
            "/api/status",
            "/api/runs",
            "/api/findings",
            "/api/sessions",
            "/api/projects",
        ):
            self.assertIn(marker, src, marker)

    def test_v2_modules_mounted(self):
        self.assertTrue(self.mod.V2_ROUTES)
        mounted = {rx.pattern for _m, rx, _f in self.mod.V2_ROUTES}
        for path in (
            "/api/v2/colony",
            "/api/v2/irc",
            "/api/v2/todos",
            "/api/v2/colony/send",
        ):
            self.assertIn(path, mounted, path)
        self.assertNotIn("atlas_dash_colony", self.mod.V2_MOUNT_ERRORS)

    def test_api_routes_answer(self):
        """Boot the real handler and exercise every read endpoint."""
        import threading
        import urllib.request
        from http.server import ThreadingHTTPServer

        httpd = ThreadingHTTPServer((self.mod.LOOPBACK, 0), self.mod.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(httpd.shutdown)
        base = f"http://{self.mod.LOOPBACK}:{httpd.server_address[1]}"
        try:
            for path, key in (
                ("/api/behavior", "groups"),
                ("/api/ecosystem", "plugins"),
                ("/api/connectors", "connectors"),
                ("/api/connectors/export", "text"),
            ):
                with urllib.request.urlopen(base + path, timeout=10) as resp:
                    self.assertEqual(resp.status, 200, path)
                    payload = json.loads(resp.read().decode())
                self.assertTrue(payload["ok"], path)
                self.assertIn(key, payload)
        finally:
            httpd.server_close()

    def test_connector_env_resolves_user_config_placeholders(self):
        with tempfile.TemporaryDirectory() as tmp:
            troot = Path(tmp)
            (troot / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "auvik": {
                                "env": {
                                    "CFG_AUVIK_REGION": "${user_config.auvik_region}"
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            with (
                mock.patch.object(self.mod, "PLUGIN_ROOT", troot),
                mock.patch.object(
                    self.mod,
                    "_plugin_config_options",
                    return_value={"auvik_region": "eu1"},
                ),
                mock.patch.object(self.mod, "_env_file_values", return_value={}),
            ):
                self.assertEqual(
                    self.mod._connector_env("auvik"), {"CFG_AUVIK_REGION": "eu1"}
                )

    def test_secret_values_never_leave_the_server(self):
        for connector in self.mod._connector_status():
            for field in connector["fields"]:
                if field["sensitive"]:
                    self.assertEqual(field.get("value"), "", field["env_key"])

    def test_env_write_rejects_unknown(self):
        res = self.mod.write_env_updates({"NOT_A_REAL_KEY": "x"})
        self.assertFalse(res["ok"])

    def test_settings_write_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            troot = Path(tmp)
            (troot / ".env.example").write_text("AUVIK_API_KEY=\n", encoding="utf-8")
            (troot / ".claude-plugin").mkdir()
            (troot / ".claude-plugin" / "plugin.json").write_text(
                json.dumps(
                    {
                        "name": "atlas",
                        "userConfig": {
                            "auvik_api_key": {"title": "Auvik key", "sensitive": True}
                        },
                    }
                ),
                encoding="utf-8",
            )
            (troot / ".mcp.json").write_text(
                json.dumps(
                    {
                        "mcpServers": {
                            "auvik": {
                                "env": {
                                    "CFG_AUVIK_API_KEY": "${user_config.auvik_api_key}"
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            settings = troot / "settings.json"
            settings.write_text("{}", encoding="utf-8")
            with (
                mock.patch.object(self.mod, "PLUGIN_ROOT", troot),
                mock.patch.object(self.mod, "_settings_path", return_value=settings),
            ):
                res = self.mod.write_settings_updates({"auvik_api_key": "secret-value"})
                self.assertTrue(res["ok"], res)
                data = json.loads(settings.read_text())
                self.assertEqual(
                    data["pluginConfigs"]["atlas@tech-tools"]["options"][
                        "auvik_api_key"
                    ],
                    "secret-value",
                )
                st = self.mod._connector_status()
                blob = json.dumps(st)
                self.assertNotIn("secret-value", blob)

    def test_label_prefers_folder(self):
        lab = self.mod._label_for(
            {
                "project_name": "gwh-firstrespondersapp",
                "session_id": "abcdef12-xxxx",
                "cwd": "/x/gwh-firstrespondersapp",
                "is_live": True,
                "last_activity_at": None,
            }
        )
        self.assertIn("gwh-firstrespondersapp", lab)
        self.assertIn("LIVE", lab)

    def _plugin_version(self) -> str:
        manifest = SCRIPTS.parent / ".claude-plugin" / "plugin.json"
        return json.loads(manifest.read_text(encoding="utf-8"))["version"]

    def _run_ensure(self, health: dict):
        """Run ensure_daemon against a fake daemon; return (result, stop, popen).

        The fake daemon answers until stop_daemon runs; nothing touches the real
        ~/.atlas pidfile or log and no process is spawned.
        """
        state = {"stopped": False}
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)

        def fake_stop():
            state["stopped"] = True
            return {"ok": True}

        with (
            mock.patch.object(
                self.mod, "_port_open", lambda *a, **k: not state["stopped"]
            ),
            mock.patch.object(self.mod, "_daemon_db_ok", return_value=True),
            mock.patch.object(self.mod, "_health_payload", return_value=health),
            mock.patch.object(self.mod, "stop_daemon", side_effect=fake_stop) as stop,
            mock.patch.object(self.mod.subprocess, "Popen") as popen,
            mock.patch.object(self.mod.time, "sleep"),
            mock.patch.object(self.mod, "_write_pidfile"),
            mock.patch.object(self.mod, "STATE_DIR", Path(tmp.name)),
            mock.patch.object(self.mod, "LOG_PATH", Path(tmp.name) / "dashboard.log"),
        ):
            popen.return_value.pid = 4242
            res = self.mod.ensure_daemon(17499)
        return res, stop, popen

    def test_ensure_idempotent_when_ok(self):
        res, stop, popen = self._run_ensure(
            {"pid": 1, "version": self._plugin_version()}
        )
        self.assertTrue(res["ok"])
        self.assertTrue(res["already_running"])
        stop.assert_not_called()
        popen.assert_not_called()

    def test_ensure_replaces_daemon_from_older_plugin_version(self):
        """A daemon with no or an older version is restarted, not reused.

        The script path is deliberately ignored: harnesses install the plugin at
        different paths, so comparing it would make each one kill the other's
        healthy daemon.
        """
        for health in (
            {"pid": 1},
            {"pid": 1, "version": None},
            {"pid": 1, "version": ""},
            {"pid": 1, "version": "not-a-version"},
            {"pid": 1, "version": "0.0.1"},
            {"pid": 1, "version": "9.7.0"},
            {"pid": 1, "version": "9.7.0", "script": str(Path(__file__).resolve())},
        ):
            with self.subTest(health=health):
                res, stop, popen = self._run_ensure(health)
                stop.assert_called_once()
                popen.assert_called_once()
                self.assertFalse(res.get("already_running"))

    def test_ensure_keeps_daemon_at_same_or_newer_version(self):
        """Equal or newer versions are reused whatever script path they report."""
        current = self._plugin_version()
        major, *rest = current.split(".")
        for version in (current, f"{int(major) + 1}.0.0", f"{current}.1"):
            with self.subTest(version=version):
                res, stop, popen = self._run_ensure(
                    {
                        "pid": 1,
                        "version": version,
                        "script": "/elsewhere/atlas_dashboard.py",
                    }
                )
                self.assertTrue(res["already_running"])
                stop.assert_not_called()
                popen.assert_not_called()

    def test_version_tuple_parsing(self):
        vt = self.mod._version_tuple
        self.assertEqual(vt("10.1.2"), (10, 1, 2))
        self.assertEqual(vt("10.1.x"), (10, 1, 0))
        self.assertEqual(vt("10.1.2-rc1"), (10, 1, 2))
        self.assertGreater(vt("10.10.0"), vt("10.9.9"))
        for bad in (None, "", "  ", "abc", "0.0.0", 10, ["10"]):
            self.assertIsNone(vt(bad), bad)

    def test_health_reports_plugin_version(self):
        """The real handler's /api/health carries the plugin.json version."""
        import threading
        from http.server import ThreadingHTTPServer

        httpd = ThreadingHTTPServer((self.mod.LOOPBACK, 0), self.mod.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        url = f"http://{self.mod.LOOPBACK}:{httpd.server_address[1]}/api/health"
        with urllib.request.urlopen(url, timeout=10) as resp:
            payload = json.loads(resp.read().decode())
        self.assertEqual(payload["version"], self._plugin_version())


class WorkBoardApiTest(unittest.TestCase):
    """The Work tab and Agents tab run on the durable board and agent overrides."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.db = os.path.join(self.tmp.name, "atlas.db")
        self._prev_db_env = os.environ.get("ATLAS_DASHBOARD_DB")
        os.environ["ATLAS_DASHBOARD_DB"] = self.db
        self.addCleanup(self._restore_db_env)
        import atlas_db

        conn = atlas_db.connect(self.db)
        atlas_db.init(conn)
        self.pid = atlas_db.register_project(conn, self.root)
        conn.commit()
        conn.close()

    def _restore_db_env(self):
        if self._prev_db_env is None:
            os.environ.pop("ATLAS_DASHBOARD_DB", None)
        else:
            os.environ["ATLAS_DASHBOARD_DB"] = self._prev_db_env

    def _server(self):
        import threading
        import urllib.request
        from http.server import ThreadingHTTPServer

        httpd = ThreadingHTTPServer((self.mod.LOOPBACK, 0), self.mod.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.shutdown)
        self.addCleanup(httpd.server_close)
        return "http://%s:%d" % (self.mod.LOOPBACK, httpd.server_address[1])

    def _get(self, base, path):
        import urllib.request

        with urllib.request.urlopen(base + path, timeout=10) as resp:
            return json.loads(resp.read().decode())

    def _post(self, base, path, body):
        import urllib.request

        req = urllib.request.Request(
            base + path,
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "X-Atlas-Token": self.mod.DASH_TOKEN,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())

    def test_work_board_routes_present(self):
        src = (SCRIPTS / "atlas_dashboard.py").read_text(encoding="utf-8")
        for marker in ("/api/todo", "/api/agents", "/api/memory"):
            self.assertIn(marker, src, marker)

    def test_health_url_reports_the_bound_port(self):
        """/api/health must name the port actually served, not DEFAULT_PORT."""
        base = self._server()
        port = int(base.rsplit(":", 1)[1])
        self.assertNotEqual(port, self.mod.DEFAULT_PORT)
        for path in ("/api/health", "/health"):
            d = self._get(base, path)
            self.assertTrue(d["ok"], path)
            self.assertEqual(
                d["url"], "http://%s:%d/" % (self.mod.LOOPBACK, port), path
            )

    def test_todo_roundtrip(self):
        import atlas_todo

        base = self._server()
        atlas_todo.mirror(
            self.root,
            [
                {"content": "ship it", "status": "in_progress"},
                {"content": "docs", "status": "completed"},
            ],
            "sess-x",
        )
        d = self._get(base, "/api/todo?project_id=%d" % self.pid)
        self.assertTrue(d["ok"])
        self.assertEqual(d["counts"]["needed"], 2)
        self.assertEqual(d["counts"]["remaining"], 1)
        self.assertEqual(d["counts"]["complete"], 1)
        item = next(i for i in d["items"] if i["content"] == "ship it")
        r = self._post(
            base,
            "/api/todo",
            {
                "project_id": self.pid,
                "action": "complete",
                "id": item["id"],
                "owner": "dashboard",
            },
        )
        self.assertTrue(r["ok"], r)
        board = atlas_todo.load(self.root)
        got = next(i for i in board["items"] if i["content"] == "ship it")
        self.assertEqual(got["status"], "completed")

        r2 = self._post(
            base,
            "/api/todo",
            {"project_id": self.pid, "action": "reopen", "id": item["id"]},
        )
        self.assertTrue(r2["ok"], r2)
        board = atlas_todo.load(self.root)
        got = next(i for i in board["items"] if i["content"] == "ship it")
        self.assertEqual(got["status"], "pending")

    def test_todo_add_is_manual_origin(self):
        import atlas_todo

        base = self._server()
        r = self._post(
            base,
            "/api/todo",
            {"project_id": self.pid, "action": "add", "content": "human note"},
        )
        self.assertTrue(r["ok"], r)
        board = atlas_todo.load(self.root)
        note = next(i for i in board["items"] if i["content"] == "human note")
        self.assertEqual(note["origin"], "manual")

    def test_todo_unknown_project_is_400(self):
        base = self._server()
        with self.assertRaises(urllib.error.HTTPError):
            self._get(base, "/api/todo?project_id=999999")

    def test_agents_list_and_content(self):
        base = self._server()
        d = self._get(base, "/api/agents?project_id=%d" % self.pid)
        self.assertTrue(d["ok"])
        names = [a["name"] for a in d["agents"]]
        self.assertIn("verifier", names)
        c = self._get(base, "/api/agents/verifier?project_id=%d" % self.pid)
        self.assertTrue(c["ok"])
        self.assertEqual(c["source"], "plugin")
        self.assertTrue(c["content"].lstrip().startswith("---"))

    def test_agent_save_writes_override_and_reset_removes_it(self):
        import atlas_todo

        base = self._server()
        body = "---\nname: verifier\ndescription: test override\n---\n\nBody.\n"
        r = self._post(
            base,
            "/api/agents",
            {
                "project_id": self.pid,
                "action": "save",
                "name": "verifier",
                "content": body,
            },
        )
        self.assertTrue(r["ok"], r)
        over = os.path.join(self.root, ".claude", "agents", "verifier.md")
        self.assertTrue(os.path.isfile(over))
        c = self._get(base, "/api/agents/verifier?project_id=%d" % self.pid)
        self.assertEqual(c["source"], "override")
        self.assertEqual(c["content"], body)
        d = self._get(base, "/api/agents?project_id=%d" % self.pid)
        row = next(a for a in d["agents"] if a["name"] == "verifier")
        self.assertTrue(row["overridden"])
        r2 = self._post(
            base,
            "/api/agents",
            {"project_id": self.pid, "action": "reset", "name": "verifier"},
        )
        self.assertTrue(r2["ok"], r2)
        self.assertFalse(os.path.isfile(over))

    def test_agent_save_requires_frontmatter(self):
        base = self._server()
        r = self._post(
            base,
            "/api/agents",
            {
                "project-level": None,
                "project_id": self.pid,
                "action": "save",
                "name": "verifier",
                "content": "no frontmatter",
            },
        )
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "frontmatter_required")

    def test_agent_save_rejects_pathy_names(self):
        base = self._server()
        for bad in ("../evil", "a/b", ".hidden"):
            r = self._post(
                base,
                "/api/agents",
                {
                    "project_id": self.pid,
                    "action": "save",
                    "name": bad,
                    "content": "---\nx: y\n---\n",
                },
            )
            self.assertFalse(r["ok"], bad)
            self.assertEqual(r["error"], "invalid_name", bad)


class SecurityGuardTest(unittest.TestCase):
    """Central guard: Host 403, non-JSON 415, Origin 403, token 401, traversal 404."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer

        self.static = tempfile.TemporaryDirectory()
        self.addCleanup(self.static.cleanup)
        root = Path(self.static.name)
        (root / "css").mkdir()
        (root / "index.html").write_text(
            '<html><head><meta name="atlas-token" content="__ATLAS_TOKEN__"></head></html>'
        )
        (root / "css" / "a.css").write_text("body{}")
        (root / ".secret").write_text("nope")
        outside = root.parent / "outside.txt"
        outside.write_text("outside")
        self.addCleanup(lambda: outside.unlink(missing_ok=True))
        patcher = mock.patch.object(self.mod, "STATIC_DIR", root)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.httpd = ThreadingHTTPServer((self.mod.LOOPBACK, 0), self.mod.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.port = self.httpd.server_address[1]

    def _req(self, method, path, body=None, headers=None, host=None):
        import http.client

        conn = http.client.HTTPConnection(self.mod.LOOPBACK, self.port, timeout=10)
        hdrs = {"Host": host or "%s:%d" % (self.mod.LOOPBACK, self.port)}
        hdrs.update(headers or {})
        conn.putrequest(method, path, skip_host=True)
        for k, v in hdrs.items():
            conn.putheader(k, v)
        data = json.dumps(body).encode() if body is not None else None
        if data is not None:
            conn.putheader("Content-Length", str(len(data)))
        conn.endheaders(data)
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        return resp.status, raw

    def _tok(self, **extra):
        return {
            "Content-Type": "application/json",
            "X-Atlas-Token": self.mod.DASH_TOKEN,
            **extra,
        }

    def test_index_injects_token(self):
        status, raw = self._req("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(self.mod.DASH_TOKEN.encode(), raw)
        self.assertNotIn(b"__ATLAS_TOKEN__", raw)

    def test_index_without_placeholder_still_gets_token(self):
        (Path(self.static.name) / "index.html").write_text("<html><head></head></html>")
        status, raw = self._req("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(self.mod.DASH_TOKEN.encode(), raw)

    def test_static_asset_and_traversal(self):
        self.assertEqual(self._req("GET", "/ui/css/a.css"), (200, b"body{}"))
        for bad in (
            "/ui/../outside.txt",
            "/ui/%2e%2e/outside.txt",
            "/ui/css/../../outside.txt",
            "/ui/.secret",
            "/ui/missing.js",
            "/ui/..%5coutside.txt",
        ):
            self.assertEqual(self._req("GET", bad)[0], 404, bad)

    def test_bad_host_is_403_on_every_route(self):
        for path in ("/", "/api/health", "/api/behavior", "/api/v2/colony"):
            self.assertEqual(self._req("GET", path, host="evil.example")[0], 403, path)
        self.assertEqual(self._req("GET", "/api/health", host="127.0.0.1:1")[0], 403)

    def test_localhost_host_is_accepted(self):
        status, _ = self._req("GET", "/api/health", host="localhost:%d" % self.port)
        self.assertEqual(status, 200)

    def test_non_json_post_is_415(self):
        for ctype in ("text/plain", "application/x-www-form-urlencoded", ""):
            hdrs = {"X-Atlas-Token": self.mod.DASH_TOKEN}
            if ctype:
                hdrs["Content-Type"] = ctype
            status, _ = self._req("POST", "/api/v2/todos", {}, hdrs)
            self.assertEqual(status, 415, ctype)

    def test_foreign_origin_is_403(self):
        for origin in ("http://evil.example", "http://127.0.0.1:1", "null"):
            status, _ = self._req("POST", "/api/v2/todos", {}, self._tok(Origin=origin))
            self.assertEqual(status, 403, origin)

    def test_same_origin_passes_the_guard(self):
        origin = "http://%s:%d" % (self.mod.LOOPBACK, self.port)
        status, _ = self._req("POST", "/api/v2/todos", {}, self._tok(Origin=origin))
        self.assertNotIn(status, (401, 403, 415))

    def test_missing_or_wrong_token_is_401_on_all_mutations(self):
        json_only = {"Content-Type": "application/json"}
        wrong = {**json_only, "X-Atlas-Token": "wrong"}
        for path in (
            "/api/v2/todos",
            "/api/todo",
            "/api/behavior",
            "/api/connectors/env",
        ):
            self.assertEqual(self._req("POST", path, {}, json_only)[0], 401, path)
            self.assertEqual(self._req("POST", path, {}, wrong)[0], 401, path)

    def test_sensitive_gets_need_token_and_health_does_not(self):
        for path in (
            "/api/v2/colony/capture?run=r&name=n",
            "/api/v2/colony/agent?run=r&name=n",
            "/api/v2/irc",
            "/api/v2/stream",
        ):
            self.assertEqual(self._req("GET", path)[0], 401, path)
        self.assertEqual(self._req("GET", "/api/health")[0], 200)

    def test_query_token_only_honoured_on_stream(self):
        tok = self.mod.DASH_TOKEN
        self.assertEqual(self._req("GET", "/api/v2/irc?token=" + tok)[0], 401)

    def test_non_sensitive_gets_need_no_token(self):
        self.assertEqual(self._req("GET", "/api/behavior")[0], 200)
        self.assertEqual(self._req("GET", "/api/v2/colony")[0], 200)

    def test_options_grants_no_cors(self):
        import http.client

        conn = http.client.HTTPConnection(self.mod.LOOPBACK, self.port, timeout=10)
        conn.request("OPTIONS", "/api/v2/todos")
        resp = conn.getresponse()
        resp.read()
        conn.close()
        self.assertIsNone(resp.getheader("Access-Control-Allow-Origin"))

    def test_invalid_json_and_non_object_bodies_are_400(self):
        import http.client

        for payload in (b"{not json", b"[1,2]"):
            conn = http.client.HTTPConnection(self.mod.LOOPBACK, self.port, timeout=10)
            conn.request("POST", "/api/v2/todos", payload, self._tok())
            resp = conn.getresponse()
            resp.read()
            conn.close()
            self.assertEqual(resp.status, 400, payload)


class SettingsDataTest(unittest.TestCase):
    """Connector usage/health, agent roster, fixture projects and omp roles."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load()
        cls.ctl = cls.mod.atlas_control

    def _conn(self, with_denied=True):
        import sqlite3

        conn = sqlite3.connect(":memory:")
        conn.execute(
            "CREATE TABLE tool_calls (id INTEGER PRIMARY KEY, ts REAL, kind TEXT, server TEXT,"
            " is_error INTEGER"
            + (", denied INTEGER DEFAULT 0" if with_denied else "")
            + ")"
        )
        return conn

    def test_connector_usage_counts_errors_and_excludes_denied(self):
        conn = self._conn()
        now = 2_000_000.0
        rows = [(now - 10, "mcp", "ninjaone", 0, 0)] * 8 + [
            (now - 10, "mcp", "ninjaone", 1, 0),
            (now - 10, "mcp", "ninjaone", 1, 0),
            (now - 10, "mcp", "ninjaone", 1, 1),  # denied: policy, not a failure
            (now - 40 * 86400, "mcp", "ninjaone", 1, 0),  # outside the window
            (now - 5, "mcp", "falcon-mcp", 0, 0),  # legacy server name
            (now - 5, "builtin", "ninjaone", 1, 0),  # not an MCP call
        ]
        conn.executemany(
            "INSERT INTO tool_calls(ts,kind,server,is_error,denied) VALUES(?,?,?,?,?)",
            rows,
        )
        usage = self.ctl.connector_usage(conn, now=now)
        n = usage["ninjaone"]
        self.assertEqual((n["calls"], n["errors"], n["calls_total"]), (10, 2, 11))
        self.assertEqual(n["error_rate"], 0.2)
        self.assertEqual(n["last_used"], now - 10)
        self.assertIn("falcon", usage)  # alias merged
        self.assertNotIn("falcon-mcp", usage)

    def test_connector_usage_without_denied_column_or_table(self):
        conn = self._conn(with_denied=False)
        conn.execute(
            "INSERT INTO tool_calls(ts,kind,server,is_error) VALUES(1,'mcp','x',1)"
        )
        self.assertEqual(self.ctl.connector_usage(conn, now=10.0)["x"]["errors"], 1)
        import sqlite3

        self.assertEqual(self.ctl.connector_usage(sqlite3.connect(":memory:")), {})
        self.assertEqual(self.ctl.connector_usage(None), {})

    def test_connector_health_definition(self):
        h = self.ctl.connector_health
        self.assertEqual(h(True, False, {}), "disabled")
        self.assertEqual(
            h(False, True, {"calls": 99, "error_rate": 1.0}), "unconfigured"
        )
        self.assertEqual(h(True, True, {"calls": 10, "error_rate": 0.25}), "degraded")
        self.assertEqual(h(True, True, {"calls": 9, "error_rate": 1.0}), "ok")
        self.assertEqual(h(True, True, {"calls": 12, "error_rate": 0.1}), "ok")
        self.assertEqual(h(True, True, {}), "idle")

    def test_connector_status_carries_usage_and_health(self):
        for c in self.mod._connector_status():
            self.assertIn(
                c["health"], {"ok", "idle", "degraded", "unconfigured", "disabled"}
            )
            for k in (
                "calls",
                "calls_total",
                "errors",
                "error_rate",
                "last_used",
                "window_days",
            ):
                self.assertIn(k, c["usage"])

    def test_health_connectors_uses_the_settings_definition(self):
        import atlas_dash_insights as ins

        rows = [
            {
                "name": "a",
                "health": "unconfigured",
                "usage": {"last_used": None, "errors": 0, "calls": 0},
            },
            {
                "name": "b",
                "health": "degraded",
                "usage": {"last_used": 5.0, "errors": 6, "calls": 10},
            },
            {
                "name": "c",
                "health": "ok",
                "usage": {"last_used": 9.0, "errors": 0, "calls": 3},
            },
        ]
        with mock.patch.object(ins, "CONNECTOR_STATUS_PROVIDER", lambda: rows):
            with (
                tempfile.TemporaryDirectory() as tmp,
                mock.patch.dict(os.environ, {"ATLAS_HOME": tmp}),
            ):
                ctx = type(
                    "C",
                    (),
                    {
                        "query": {},
                        "db": lambda s: None,
                        "project_root": lambda s, p: None,
                    },
                )()
                _, body = ins.route_health(ctx)
        sub = next(s for s in body["subsystems"] if s["id"] == "connectors")
        self.assertEqual(sub["status"], "warn")
        self.assertIn("2 of 3", sub["detail"])
        self.assertIn("b: degraded (6/10 calls failed)", sub["evidence"])

    def test_fixture_projects_are_filtered(self):
        f = self.ctl.is_fixture_project
        # The checkout itself is a real, non-scratch directory (the OS temp dir is scratch).
        real = SCRIPTS.parent
        with tempfile.TemporaryDirectory() as tmp:
            wt = Path(tmp) / "proj" / ".claude" / "worktrees" / "x"
            wt.mkdir(parents=True)
            repo = Path(tmp) / "scratch" / "repo"
            repo.mkdir(parents=True)
            self.assertFalse(f(str(real)))
            self.assertTrue(f(str(wt)))
            self.assertTrue(f(str(repo)))
        self.assertTrue(f("/"))
        self.assertTrue(f("/tmp/atlas-demo/repo"))
        self.assertTrue(f("/definitely/not/here"))
        self.assertFalse(f("/definitely/not/here", must_exist=False))

    def test_agents_payload_has_models_omp_chain_and_dispatch_stats(self):
        import sqlite3

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "agents").mkdir()
            (root / "omp" / "agents").mkdir(parents=True)
            (root / "agents" / "implementer.md").write_text(
                "---\nname: implementer\nmodel: sonnet\neffort: low\n---\nbody\n"
            )
            (root / "omp" / "agents" / "implementer.md").write_text(
                '---\n# GENERATED\nname: "implementer"\nthinkingLevel: low\n'
                'model: ["@atlas-worker","@smol"]\n---\n'
            )
            now = 3_000_000.0
            conn = sqlite3.connect(":memory:")
            conn.execute(
                "CREATE TABLE dispatches (id INTEGER PRIMARY KEY, run_id INT, ts REAL, agent_type TEXT, model TEXT, wave_id INT)"
            )
            conn.executemany(
                "INSERT INTO dispatches(run_id,ts,agent_type) VALUES(1,?,?)",
                [
                    (now - 60, "atlas:implementer"),
                    (now - 60, "implementer"),
                    (now - 30 * 86400, "atlas:implementer"),
                ],
            )
            conn.row_factory = None
            with (
                mock.patch.object(self.mod, "PLUGIN_ROOT", root),
                mock.patch.object(self.mod, "_db", lambda: (conn, ":memory:")),
                mock.patch.object(self.mod.time, "time", lambda: now),
            ):
                payload = self.mod._agents_payload(None)
        (agent,) = payload["agents"]
        self.assertEqual((agent["model"], agent["effort"]), ("sonnet", "low"))
        self.assertEqual(agent["omp"]["model_chain"], ["@atlas-worker", "@smol"])
        self.assertEqual(agent["omp"]["tier"], "atlas-worker")
        self.assertEqual(agent["omp"]["effort"], "low")
        d = agent["dispatches"]
        self.assertEqual((d["total"], d["last7d"]), (3, 2))
        self.assertEqual(d["last_used"], now - 60)

    def test_omp_model_roles_reports_what_resolves(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config.yml"
            cfg.write_text(
                "modelRoles:\n  smol: anthropic/sonnet:off\n  default: anthropic/opus:medium\n"
                "  atlas-worker: ollama/x:cloud:low\n  tiny: a/b\nother:\n  k: v\n"
            )
            res = self.ctl.omp_model_roles(cfg)
            by = {r["role"]: r for r in res["roles"]}
            self.assertTrue(by["atlas-worker"]["resolves"])
            self.assertEqual(by["atlas-worker"]["model"], "ollama/x:cloud:low")
            self.assertFalse(by["atlas-verifier"]["resolves"])
            self.assertEqual(by["atlas-verifier"]["falls_back_to"], "default")
            self.assertEqual(by["atlas-mechanic"]["falls_back_to"], "smol")
            self.assertEqual([o["role"] for o in res["other"]], ["tiny"])
            missing = self.ctl.omp_model_roles(Path(tmp) / "nope.yml")
            self.assertFalse(missing["exists"])

    def test_behavior_lists_the_omp_env_flags_and_roles(self):
        state = self.ctl.behavior_state()
        keys = {k["key"] for g in state["groups"] for k in g["knobs"]}
        for k in (
            "ATLAS_BRIDGE_HOOK_TIMEOUT_S",
            "ATLAS_WORKER_MAX_TOKENS",
            "ATLAS_HOOK_BRIDGE",
            "ATLAS_ADVISOR_GATE",
        ):
            self.assertIn(k, keys)
        self.assertNotIn(
            "ATLAS_WORKER_MAX_TOKENS_DEFAULT", keys
        )  # a TS constant, not env
        self.assertIn("roles", state["omp"])


if __name__ == "__main__":
    unittest.main()
