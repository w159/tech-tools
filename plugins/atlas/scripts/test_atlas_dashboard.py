#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, tempfile, unittest
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


if __name__ == "__main__":
    unittest.main()
