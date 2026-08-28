#!/usr/bin/env python3
"""Tests for multi-session atlas dashboard."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent


def _load():
    path = SCRIPTS / "atlas_dashboard.py"
    spec = importlib.util.spec_from_file_location("atlas_dashboard", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


class TestAtlasDashboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_snapshot_ok_and_has_connectors(self):
        snap = self.mod.snapshot()
        self.assertTrue(snap["ok"])
        self.assertEqual(snap["plugin"]["name"], "atlas")
        self.assertTrue(snap["plugin"]["version"])
        self.assertIn("sessions", snap)
        self.assertIn("projects", snap)
        self.assertEqual(len(snap["connectors"]), 10)
        self.assertTrue(str(snap.get("url", "")).startswith("http://"))

    def test_env_write_rejects_unknown_keys(self):
        res = self.mod.write_env_updates({"NOT_A_REAL_KEY": "x"})
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "keys_not_allowlisted")

    def test_env_write_allowlisted_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            troot = Path(tmp)
            (troot / ".env.example").write_text(
                "AUVIK_API_KEY=\nAUVIK_USERNAME=\n", encoding="utf-8"
            )
            with mock.patch.object(self.mod, "PLUGIN_ROOT", troot):
                res = self.mod.write_env_updates({"AUVIK_API_KEY": "test-value"})
                self.assertTrue(res["ok"], res)
                text = (troot / ".env").read_text(encoding="utf-8")
                self.assertIn("AUVIK_API_KEY=test-value", text)
                st = self.mod._env_file_status()
                self.assertIn("AUVIK_API_KEY", st["keys_set"])
                self.assertNotIn("test-value", json.dumps(st))

    def test_cli_status_exits_zero(self):
        import io
        from contextlib import redirect_stdout

        buf = io.StringIO()
        with redirect_stdout(buf):
            code = self.mod.main(["status"])
        self.assertEqual(code, 0)
        data = json.loads(buf.getvalue())
        self.assertTrue(data["ok"])

    def test_ui_html_has_session_switcher(self):
        html = self.mod.UI_HTML
        self.assertIn("id=\"project\"", html)
        self.assertIn("id=\"session\"", html)
        self.assertIn("/api/sessions/", html)

    def test_ensure_is_idempotent_when_port_open(self):
        with mock.patch.object(self.mod, "_port_open", return_value=True):
            with mock.patch.object(self.mod, "_read_pidfile", return_value=None):
                res = self.mod.ensure_daemon(17499)
        self.assertTrue(res["ok"])
        self.assertTrue(res["already_running"])


if __name__ == "__main__":
    unittest.main()
