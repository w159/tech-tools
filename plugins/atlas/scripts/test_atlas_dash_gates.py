#!/usr/bin/env python3
"""Tests for the read-only /api/v2/gates route."""

import sqlite3
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_dash_gates as g  # noqa: E402

ROOT = "/tmp/proj-a"
LINES = [{"id": "a", "label": "Evidence captured", "ok": True}, {"id": "b", "label": "Verified finding recorded", "ok": False, "fix": "x"}]


class Ctx:
    def __init__(self, conn, **query):
        self.conn, self.query = conn, query

    def db(self):
        return self.conn

    def project_root(self, p):
        return p if p else None


def make_conn():
    c = sqlite3.connect(":memory:")
    c.executescript(
        """
        CREATE TABLE projects(id INTEGER PRIMARY KEY, root_path TEXT);
        CREATE TABLE session_logs(session_id TEXT, project_id INT, cwd TEXT, transcript_path TEXT);
        CREATE TABLE runs(id INTEGER PRIMARY KEY, session_id TEXT, project_id INT, started_at REAL, orchestrating INT);
        INSERT INTO projects VALUES (1, '/tmp/proj-a');
        INSERT INTO session_logs VALUES ('s-live', 1, '/tmp/proj-a', '/tmp/t.jsonl');
        INSERT INTO runs VALUES (1, 's-old', 1, 100, 1), (2, 's-new', 1, 200, 1), (3, 's-plain', 1, 300, 0);
        """
    )
    return c


class GatesRoute(unittest.TestCase):
    def setUp(self):
        self.conn = make_conn()

    def test_gates_requires_session_or_project(self):
        st, body = g.h_gates(Ctx(self.conn))
        self.assertEqual((st, body["error"]), (400, "session_or_project_required"))
        self.assertFalse(body["ok"])

    def test_gates_unknown_session(self):
        st, body = g.h_gates(Ctx(self.conn, session="nope"))
        self.assertEqual((st, body["error"]), (404, "session_not_found"))

    def test_gates_unknown_project(self):
        st, body = g.h_gates(Ctx(self.conn, project="/tmp/other"))
        self.assertEqual((st, body["error"]), (404, "no_session_for_project"))

    def test_gates_passthrough(self):
        with mock.patch.object(g.atlas_gates, "completion_group", return_value={"lines": LINES}) as cg:
            st, body = g.h_gates(Ctx(self.conn, session="s-live"))
        self.assertEqual(st, 200)
        self.assertTrue(body["ok"])
        self.assertEqual((body["session"], body["lines"]), ("s-live", LINES))
        self.assertNotIn("error", body)
        cg.assert_called_once_with("s-live", Path(ROOT), "/tmp/t.jsonl")

    def test_gates_gate_off_error_passthrough(self):
        with mock.patch.object(g.atlas_gates, "completion_group", return_value={"lines": [], "error": "gate is off"}):
            st, body = g.h_gates(Ctx(self.conn, session="s-live"))
        self.assertEqual((st, body["ok"], body["error"]), (200, True, "gate is off"))

    def test_gates_project_resolves_latest_orchestrating_session(self):
        with mock.patch.object(g.atlas_gates, "completion_group", return_value={"lines": LINES}) as cg:
            st, body = g.h_gates(Ctx(self.conn, project=ROOT))
        self.assertEqual((st, body["session"], body["project"]), (200, "s-new", ROOT))
        self.assertEqual(cg.call_args.args[0], "s-new")


if __name__ == "__main__":
    unittest.main()
