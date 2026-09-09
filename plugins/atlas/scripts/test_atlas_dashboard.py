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
        self.assertIn("Connector credentials", self.mod.UI_HTML)
        self.assertIn("data-save-connector", self.mod.UI_HTML)
        self.assertIn("connector-grid", self.mod.UI_HTML)
        self.assertIn("repeat(3, minmax(0, 1fr))", self.mod.UI_HTML)
        self.assertIn("min-height:320px", self.mod.UI_HTML)
        self.assertIn("overflow-x:hidden", self.mod.UI_HTML)
        self.assertIn("align-items:end", self.mod.UI_HTML)
        self.assertIn("Command Center", self.mod.UI_HTML)
        self.assertIn("/assets/mark.svg", self.mod.UI_HTML)
        self.assertNotIn("_maybe_refresh_open_sessions", self.mod.UI_HTML)
        self.assertFalse(hasattr(self.mod, "_maybe_refresh_open_sessions"))

    def test_ui_exposes_configuration_and_ecosystem(self):
        ui = self.mod.UI_HTML
        for marker in (
            'data-tab="behavior"',
            'data-tab="ecosystem"',
            'id="behaviorGroups"',
            'id="behaviorAdvanced"',
            'id="pluginGrid"',
            'id="mcpGrid"',
            'id="capabilityGrid"',
            'id="ecoBindings"',
            "data-test-connector",
            "data-toggle-connector",
            "data-toggle-plugin",
            "data-toggle-mcp",
            'id="bulkImport"',
            'id="mcpAdd"',
            "/api/behavior",
            "/api/ecosystem",
            "/api/mcp/toggle",
            "/api/plugins/toggle",
            "/api/connectors/test",
            "/api/connectors/import",
        ):
            self.assertIn(marker, ui, marker)
        # Third-party manifest text is escaped before it reaches innerHTML.
        self.assertIn("const esc =", ui)
        # Every tab in the nav has a matching panel and title.
        for tab in (
            "overview",
            "live",
            "settings",
            "behavior",
            "ecosystem",
            "findings",
        ):
            self.assertIn(f'id="tab-{tab}"', ui)
            self.assertIn(f"{tab}:'", ui)

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

    def test_ensure_idempotent_when_ok(self):
        with (
            mock.patch.object(self.mod, "_port_open", return_value=True),
            mock.patch.object(self.mod, "_daemon_db_ok", return_value=True),
            mock.patch.object(self.mod, "_health_payload", return_value={"pid": 1}),
        ):
            res = self.mod.ensure_daemon(17499)
        self.assertTrue(res["ok"])
        self.assertTrue(res["already_running"])


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
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())

    def test_ui_has_work_and_agents_tabs(self):
        ui = self.mod.UI_HTML
        for marker in (
            'id="tab-work"',
            'id="tab-agents"',
            'data-tab="work"',
            'data-tab="agents"',
            'id="todoRows"',
            'id="workCounts"',
            'id="agentPick"',
            'id="agentBody"',
            "/api/todo",
            "/api/agents",
            "/api/memory",
        ):
            self.assertIn(marker, ui, marker)
        for tab in ("work", "agents"):
            self.assertIn(f"{tab}:'", ui)

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


if __name__ == "__main__":
    unittest.main()
