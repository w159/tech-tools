"""Audit 2 script fixes: dashboard stop kill errors, B904 chaining, wait elapsed time, ATLAS_GIT_AUTOCLEAN row."""

import contextlib
import io
import json
import os
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
HOOKS = PLUGIN / "hooks"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HOOKS))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_control  # noqa: E402
import atlas_dashboard  # noqa: E402
import atlas_mux  # noqa: E402


class StopDaemonKillErrorTests(unittest.TestCase):
    def test_listener_kill_failure_is_reported(self):
        with (
            mock.patch.object(atlas_dashboard, "_read_pidfile", return_value={}),
            mock.patch.object(atlas_dashboard, "_port_open", return_value=True),
            mock.patch.object(atlas_dashboard, "_daemon_db_ok", return_value=True),
            mock.patch.object(atlas_dashboard, "_clear_pidfile"),
            mock.patch.object(atlas_dashboard.subprocess, "check_output", return_value="987654\n"),
            mock.patch.object(atlas_dashboard.os, "kill", side_effect=PermissionError("denied")) as kill,
            mock.patch.object(atlas_dashboard.time, "sleep"),
        ):
            out = atlas_dashboard.stop_daemon(port=59999)
        kill.assert_called_once()
        self.assertTrue(out["ok"])
        self.assertFalse(out["stopped"])
        self.assertEqual(len(out["kill_errors"]), 1)
        self.assertIn("987654", out["kill_errors"][0])
        self.assertIn("denied", out["kill_errors"][0])


class WaitElapsedTests(unittest.TestCase):
    def test_elapsed_is_the_teams_wall_time_not_the_wait_time(self):
        created = time.time() - 1000
        rec = {
            "team_id": "tfake",
            "created": created,
            "transport": "claude-bg",
            "members": [{"name": "a"}, {"name": "b"}],
        }
        notes = [
            {"owner": "a", "ts": created + 110, "text": "exit 0"},
            {"owner": "b", "ts": created + 203, "text": "exit 0"},
        ]
        buf = io.StringIO()
        with (
            mock.patch.object(atlas_mux, "_load_team", return_value=rec),
            mock.patch.object(atlas_mux.atlas_todo, "notes", return_value=notes),
            mock.patch.object(atlas_mux, "_record_wait"),
            contextlib.redirect_stdout(buf),
        ):
            code = atlas_mux.main(["wait", "--json", "--team", "tfake", "--root", str(HERE), "--timeout", "5", "--poll", "0.01"])
        out = json.loads(buf.getvalue())
        self.assertEqual(code, 0)
        self.assertEqual(out["elapsed_s"], 203.0)
        self.assertIn("finished after 203.0s", atlas_mux._brief_wait(out))


class GitAutocleanRowTests(unittest.TestCase):
    def test_row_exists_and_is_documented(self):
        rows = {k["key"]: k for g in atlas_control.behavior_state()["groups"] for k in g["knobs"]}
        self.assertIn("ATLAS_GIT_AUTOCLEAN", rows)
        self.assertTrue(rows["ATLAS_GIT_AUTOCLEAN"]["description"])
        self.assertTrue(rows["ATLAS_GIT_AUTOCLEAN"]["description"].isascii())


if __name__ == "__main__":
    unittest.main()
