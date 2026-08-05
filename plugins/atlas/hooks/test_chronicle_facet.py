import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "scripts")
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, HERE)

import atlas_db  # noqa: E402
import atlas_hook_guard  # noqa: E402
import chronicle_facet  # noqa: E402


class ChronicleFacetTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")

        self._orig_env_db = os.environ.get("ATLAS_DB")
        self._orig_env_off = os.environ.get("ATLAS_CHRONICLE")
        os.environ["ATLAS_DB"] = self.db

        # Isolate the guard's hookstate dir so this test never touches real
        # ~/.atlas state and never trips the circuit breaker across methods.
        self.hookstate = os.path.join(self.tmp, "hookstate")
        patcher = mock.patch.object(
            atlas_hook_guard, "_state_dir", lambda: self.hookstate
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self):
        self.conn.close()
        for name, orig in (
            ("ATLAS_DB", self._orig_env_db),
            ("ATLAS_CHRONICLE", self._orig_env_off),
        ):
            if orig is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = orig

    def _seed_session(self, session_id, run_id=None):
        """Seed the tables ingest_session.py would already have populated."""
        atlas_db.upsert_session_log(
            self.conn,
            session_id,
            project_id=self.pid,
            started_at=100,
            ended_at=130,
        )
        # 3 tool calls: 2 errors, 1 edit-family, 1 read-family.
        atlas_db.insert_tool_call(
            self.conn,
            session_id,
            {
                "message_uuid": "m1",
                "ts": 101,
                "tool_name": "Edit",
                "is_error": 0,
            },
        )
        atlas_db.insert_tool_call(
            self.conn,
            session_id,
            {
                "message_uuid": "m2",
                "ts": 102,
                "tool_name": "Read",
                "is_error": 0,
            },
        )
        atlas_db.insert_tool_call(
            self.conn,
            session_id,
            {
                "message_uuid": "m3",
                "ts": 103,
                "tool_name": "Bash",
                "is_error": 1,
            },
        )
        atlas_db.insert_message(
            self.conn,
            session_id,
            {"uuid": "u1", "ts": 100, "role": "user"},
        )
        atlas_db.insert_user_prompt(
            self.conn,
            session_id,
            {"uuid": "u1", "ts": 100, "text": "hi", "char_len": 2},
        )
        atlas_db.refresh_session_aggregates(self.conn, session_id)
        atlas_db.insert_signal(
            self.conn,
            session_id,
            {
                "message_uuid": "u1",
                "signal_type": "user_correction",
                "ts": 105,
                "weight": 1.5,
                "snippet": "Do X not Y",
            },
        )
        if run_id is not None:
            atlas_db.log_dispatch(self.conn, run_id, "atlas:implementer")
            self.conn.execute(
                "INSERT INTO metrics(run_id, verifier_coverage, wall_clock_s) "
                "VALUES(?,?,?)",
                (run_id, 0.5, 42.0),
            )
        self.conn.commit()

    def _run_main(self, payload):
        sys.stdin = io.StringIO(json.dumps(payload))
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        try:
            try:
                chronicle_facet.main()
            except SystemExit:
                pass
            return sys.stderr.getvalue(), sys.stdout.getvalue()
        finally:
            sys.stdin = sys.__stdin__
            sys.stderr = sys.__stderr__
            sys.stdout = sys.__stdout__

    # (a) facet row written with correct deterministic counts
    def test_facet_row_written_with_correct_counts(self):
        rid = atlas_db.start_run(self.conn, self.pid, "sess-a")
        self._seed_session("sess-a", run_id=rid)
        self._run_main({"session_id": "sess-a", "cwd": "/repo/atlas"})

        row = self.conn.execute(
            "SELECT tool_call_count, error_count, edit_count, read_count, "
            "correction_count, dispatch_count, verifier_coverage, wall_clock_s, "
            "gate_block_count FROM facets WHERE session_id=?",
            ("sess-a",),
        ).fetchone()
        self.assertIsNotNone(row)
        (
            tool_call_count,
            error_count,
            edit_count,
            read_count,
            correction_count,
            dispatch_count,
            verifier_coverage,
            wall_clock_s,
            gate_block_count,
        ) = row
        self.assertEqual(tool_call_count, 3)
        self.assertEqual(error_count, 1)
        self.assertEqual(edit_count, 1)
        self.assertEqual(read_count, 1)
        self.assertEqual(correction_count, 1)
        self.assertEqual(dispatch_count, 1)
        self.assertEqual(verifier_coverage, 0.5)
        self.assertEqual(wall_clock_s, 42.0)
        # gate_block_count has no data source yet -- NULL, never a fabricated 0.
        self.assertIsNone(gate_block_count)

    # (a2) un-ingested session (no session_logs row yet) writes NULL, not 0,
    # for every count that depends on the transcript mirror having run.
    def test_uningested_session_writes_null_not_zero(self):
        self._run_main({"session_id": "sess-never-ingested", "cwd": "/repo/atlas"})

        row = self.conn.execute(
            "SELECT message_count, edit_count, read_count, correction_count, "
            "dispatch_count, gate_block_count FROM facets WHERE session_id=?",
            ("sess-never-ingested",),
        ).fetchone()
        self.assertIsNotNone(row)
        for value in row:
            self.assertIsNone(value)

    # (b) re-firing updates rather than duplicates
    def test_refiring_updates_not_duplicates(self):
        rid = atlas_db.start_run(self.conn, self.pid, "sess-b")
        self._seed_session("sess-b", run_id=rid)
        self._run_main({"session_id": "sess-b", "cwd": "/repo/atlas"})

        # One more tool call arrives before the next Stop fires.
        atlas_db.insert_tool_call(
            self.conn,
            "sess-b",
            {"message_uuid": "m4", "ts": 110, "tool_name": "Write", "is_error": 0},
        )
        atlas_db.refresh_session_aggregates(self.conn, "sess-b")
        self.conn.commit()

        with mock.patch.object(atlas_hook_guard, "should_run", return_value=True):
            self._run_main({"session_id": "sess-b", "cwd": "/repo/atlas"})

        rows = self.conn.execute(
            "SELECT tool_call_count, edit_count FROM facets WHERE session_id=?",
            ("sess-b",),
        ).fetchall()
        self.assertEqual(len(rows), 1)  # updated, not duplicated
        self.assertEqual(rows[0][0], 4)
        self.assertEqual(rows[0][1], 2)  # Edit + Write

    # (c) fails open when DB is missing or unreadable
    def test_fails_open_when_db_missing(self):
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "does-not-exist.db")
        err, out = self._run_main({"session_id": "sess-c", "cwd": "/repo/atlas"})
        self.assertEqual(out, "")

    def test_fails_open_when_db_unreadable(self):
        os.environ["ATLAS_DB"] = self.tmp  # a directory, not a file
        err, out = self._run_main({"session_id": "sess-c", "cwd": "/repo/atlas"})
        self.assertEqual(out, "")

    # (d) respects ATLAS_CHRONICLE=off
    def test_off_env_disables_hook(self):
        os.environ["ATLAS_CHRONICLE"] = "off"
        rid = atlas_db.start_run(self.conn, self.pid, "sess-d")
        self._seed_session("sess-d", run_id=rid)
        self._run_main({"session_id": "sess-d", "cwd": "/repo/atlas"})
        row = self.conn.execute(
            "SELECT 1 FROM facets WHERE session_id=?", ("sess-d",)
        ).fetchone()
        self.assertIsNone(row)

    # (e) friction_events populated from seeded signals
    def test_friction_events_populated_from_signals(self):
        rid = atlas_db.start_run(self.conn, self.pid, "sess-e")
        self._seed_session("sess-e", run_id=rid)
        self._run_main({"session_id": "sess-e", "cwd": "/repo/atlas"})

        rows = self.conn.execute(
            "SELECT category, weight, snippet FROM friction_events WHERE session_id=?",
            ("sess-e",),
        ).fetchall()
        self.assertEqual(len(rows), 1)
        category, weight, snippet = rows[0]
        self.assertEqual(category, "user_correction")
        self.assertEqual(weight, 1.5)
        self.assertEqual(snippet, "Do X not Y")

    def test_friction_events_replaced_not_duplicated_on_refire(self):
        rid = atlas_db.start_run(self.conn, self.pid, "sess-e2")
        self._seed_session("sess-e2", run_id=rid)
        self._run_main({"session_id": "sess-e2", "cwd": "/repo/atlas"})
        with mock.patch.object(atlas_hook_guard, "should_run", return_value=True):
            self._run_main({"session_id": "sess-e2", "cwd": "/repo/atlas"})
        rows = self.conn.execute(
            "SELECT COUNT(*) FROM friction_events WHERE session_id=?", ("sess-e2",)
        ).fetchone()
        self.assertEqual(rows[0], 1)

    # (f) LLM-enriched columns left NULL
    def test_llm_enriched_columns_left_null(self):
        rid = atlas_db.start_run(self.conn, self.pid, "sess-f")
        self._seed_session("sess-f", run_id=rid)
        self._run_main({"session_id": "sess-f", "cwd": "/repo/atlas"})
        row = self.conn.execute(
            "SELECT enriched_at, underlying_goal, outcome, session_type, "
            "primary_success, friction_detail, brief_summary, "
            "goal_categories_json, friction_counts_json, user_satisfaction, "
            "claude_helpfulness FROM facets WHERE session_id=?",
            ("sess-f",),
        ).fetchone()
        self.assertTrue(all(v is None for v in row), row)

    def test_no_session_id_is_noop(self):
        err, out = self._run_main({"cwd": "/repo/atlas"})
        self.assertEqual(out, "")
        row = self.conn.execute("SELECT COUNT(*) FROM facets").fetchone()
        self.assertEqual(row[0], 0)

    def test_stop_hook_active_still_captures(self):
        # chronicle_facet is a "capture" hook: atlas_hook_guard.should_run
        # deliberately does NOT let stop_hook_active silence it (a completion_gate
        # block forcing stop_hook_active must not also starve the facet/telemetry
        # write for that session -- that was the gate-silences-capture bug).
        rid = atlas_db.start_run(self.conn, self.pid, "sess-g")
        self._seed_session("sess-g", run_id=rid)
        self._run_main(
            {"session_id": "sess-g", "cwd": "/repo/atlas", "stop_hook_active": True}
        )
        row = self.conn.execute(
            "SELECT 1 FROM facets WHERE session_id=?", ("sess-g",)
        ).fetchone()
        self.assertIsNotNone(row)


class OuterMainGuardTest(unittest.TestCase):
    """Cover the fail-open `if __name__ == '__main__'` guard, mirroring the
    equivalent test in the other Stop hooks."""

    def test_main_block_catches_exception_exits_zero(self):
        src_path = os.path.join(HERE, "chronicle_facet.py")
        with open(src_path) as f:
            source = f.read()

        guard_calls = mock.MagicMock()

        def _fake_exit(_code=0):
            guard_calls()
            raise RuntimeError("forced non-SystemExit to exercise outer except")

        g: dict = {"__name__": "__main__", "__file__": src_path}
        with (
            mock.patch("sys.exit", side_effect=_fake_exit),
            mock.patch("sys.stdin", io.StringIO("")),
            mock.patch("sys.stdout", io.StringIO()),
            mock.patch.dict(os.environ, {"ATLAS_CHRONICLE": "off"}, clear=False),
        ):
            # ATLAS_CHRONICLE=off makes main() hit its first sys.exit(0); the
            # patched sys.exit raises RuntimeError, which escapes main(), is
            # caught by the outer `except Exception`, whose sys.exit(0) raises
            # RuntimeError again and escapes exec. guard_calls fires twice,
            # proving the fail-open guard ran.
            with self.assertRaises(RuntimeError):
                exec(compile(source, src_path, "exec"), g)
        self.assertGreaterEqual(guard_calls.call_count, 2)


if __name__ == "__main__":
    unittest.main()
