"""fix1728 panel: the tripwire `Denied:` rows and the routing rows are scoped to the current run.

A denial or a native call before the session's latest user prompt boundary (atlas_db.PROMPT_BOUNDARY_TOOL)
belongs to an earlier turn: it must not keep a row red for hours. One after the boundary still fails.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402
import sqlite3  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402
from pathlib import Path  # noqa: E402
from unittest import mock  # noqa: E402

import atlas_db  # noqa: E402
import atlas_gates  # noqa: E402

SESSION = "sess-fix-gates-pending"
BOUNDARY_TS = 1000.0


class GatesPendingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "atlas.db")
        env = mock.patch.dict(os.environ, {"ATLAS_DB": self.db, "ATLAS_HOME": self.tmp.name})
        env.start()
        self.addCleanup(env.stop)
        self.conn = sqlite3.connect(self.db)
        self.addCleanup(self.conn.close)
        atlas_db.init(self.conn)
        rid = self.conn.execute(
            "INSERT INTO runs (project_id, session_id, orchestrating, started_at) VALUES (1,?,1,?)",
            (SESSION, 1.0),
        ).lastrowid
        # the user prompt boundary the hooks write (atlas_db.mark_prompt_boundary), at a fixed time
        self.conn.execute(
            "INSERT INTO events (run_id, ts, tool, context, is_inline_op) VALUES (?,?,?,?,0)",
            (rid, BOUNDARY_TS, atlas_db.PROMPT_BOUNDARY_TOOL, "main"),
        )
        self.conn.commit()

    def _deny(self, ts):
        self.conn.execute(
            "INSERT INTO friction_events (session_id, category, weight, snippet, ts) "
            "VALUES (?, 'dispatch_denied:toolkit', 1, 'no TOOLS block', ?)",
            (SESSION, ts),
        )
        self.conn.commit()

    def _call(self, tid, tool, ts, denied=0):
        self.conn.execute(
            "INSERT INTO tool_calls (session_id, tool_use_id, tool_name, kind, ts, denied) VALUES (?,?,?,?,?,?)",
            (SESSION, tid, tool, "builtin", ts, denied),
        )
        self.conn.commit()

    def _trip(self):
        return self.gates_lines(atlas_gates.tripwire_group(SESSION))

    def _route(self):
        return self.gates_lines(atlas_gates.routing_group(SESSION))  # root None: strict count

    @staticmethod
    def gates_lines(g):
        return {ln["id"]: ln for ln in g["lines"]}

    def test_denial_before_boundary_is_not_a_failing_tripwire_row(self):
        self._deny(BOUNDARY_TS - 50)
        lines = self._trip()
        self.assertTrue(all(ln["ok"] for ln in lines.values()), lines)
        self.assertFalse(any(k.startswith("deny") for k in lines), lines)
        # the session total stays visible as plain detail text
        self.assertIn("1", lines["earlier-denials"]["detail"])

    def test_denial_after_boundary_fails_the_tripwire(self):
        self._deny(BOUNDARY_TS - 50)
        self._deny(BOUNDARY_TS + 5)
        lines = self._trip()
        deny = [ln for k, ln in lines.items() if k.startswith("deny")]
        self.assertEqual(len(deny), 1)
        self.assertFalse(deny[0]["ok"])
        self.assertEqual(deny[0]["label"], "Denied: toolkit")

    def test_routing_before_boundary_is_not_failing(self):
        self._call("t1", "Read", BOUNDARY_TS - 10, denied=1)
        self._call("t2", "Bash", BOUNDARY_TS - 9)
        lines = self._route()
        for k in ("native-Read", "native-Bash", "denied"):
            self.assertTrue(lines[k]["ok"], lines[k])
            self.assertIn("1 this session", lines[k]["detail"])

    def test_routing_after_boundary_fails(self):
        self._call("t1", "Read", BOUNDARY_TS - 10)
        self._call("t2", "Read", BOUNDARY_TS + 10, denied=1)
        self._call("t3", "Bash", BOUNDARY_TS + 11)
        lines = self._route()
        for k in ("native-Read", "native-Bash", "denied"):
            self.assertFalse(lines[k]["ok"], lines[k])
        self.assertTrue(lines["native-Read"]["detail"].startswith("1 "))


if __name__ == "__main__":
    unittest.main()
