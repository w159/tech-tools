"""Single shared dashboard: reuse when healthy, log rotation, quiet health probes, BrokenPipe."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_dashboard as d  # noqa: E402


class EnsureReuseTests(unittest.TestCase):
    def _ensure(self, health):
        with (
            mock.patch.object(d, "_guard_shared_port", return_value=None),
            mock.patch.object(d, "_port_open", return_value=True),
            mock.patch.object(d, "_patient_health", return_value=health),
            mock.patch.object(d, "_daemon_db_ok", return_value=True),
            mock.patch.object(d, "stop_daemon") as stop,
            mock.patch.object(d.subprocess, "Popen") as popen,
        ):
            return d.ensure_daemon(7999), stop, popen

    def test_healthy_daemon_is_reused_not_relaunched(self):
        h = {"pid": 4242, "version": "999.0.0", "db_path": d.dashboard_db_path()}
        res, stop, popen = self._ensure(h)
        self.assertTrue(res["already_running"])
        self.assertEqual(res["pid"], 4242)
        stop.assert_not_called()
        popen.assert_not_called()

    def test_older_daemon_is_replaced(self):
        h = {"pid": 4242, "version": "0.0.1", "db_path": d.dashboard_db_path()}
        res, stop, _ = self._ensure(h)
        stop.assert_called_once()
        self.assertFalse(res.get("already_running", False))


class LogTests(unittest.TestCase):
    def test_big_log_rotates_to_dot_one(self):
        with tempfile.TemporaryDirectory() as t:
            log = Path(t) / "dashboard.log"
            log.write_bytes(b"x" * (d.LOG_ROTATE_BYTES + 1))
            with mock.patch.object(d, "LOG_PATH", log):
                d._open_log().close()
            self.assertEqual(log.stat().st_size, 0)
            self.assertEqual(log.with_name("dashboard.log.1").stat().st_size, d.LOG_ROTATE_BYTES + 1)

    def _logged(self, line_fmt, *args):
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            d.Handler.log_message(object(), line_fmt, *args)
        return buf.getvalue()

    def test_health_200_not_logged(self):
        for path in ("/api/health", "/api/v2/health"):
            self.assertEqual(self._logged('"%s" %s %s', f"GET {path} HTTP/1.1", "200", "-"), "")

    def test_other_lines_logged_with_timestamp(self):
        out = self._logged('"%s" %s %s', "GET /api/v2/irc HTTP/1.1", "401", "-")
        self.assertRegex(out, r"^\[atlas-dashboard\] \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d \"GET /api/v2/irc")
        self.assertNotEqual(self._logged('"%s" %s %s', "GET /api/health HTTP/1.1", "500", "-"), "")


class BrokenPipeTests(unittest.TestCase):
    def test_json_swallows_client_hangup(self):
        h = mock.Mock()
        h.wfile.write.side_effect = BrokenPipeError
        d.Handler._json(h, 200, {"ok": True})  # must not raise


if __name__ == "__main__":
    unittest.main()
