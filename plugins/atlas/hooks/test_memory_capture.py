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
import memory_capture  # noqa: E402


class MemoryCaptureScopeTest(unittest.TestCase):
    """H4: signals recorded under a session_id other than the literal Stop hook
    session_id (the orchestrating run's own session, or a subagent session in
    the orchestrating run's project) must still be seen at Stop time."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")

    def tearDown(self):
        self.conn.close()

    def test_signals_under_orchestrating_run_seen_at_stop(self):
        # The orchestrating run records signals under ITS session_id.
        rid = atlas_db.start_run(self.conn, self.pid, "orch-sess")
        self.conn.execute(
            "UPDATE runs SET orchestrating=1, started_at=100 WHERE id=?", (rid,)
        )
        self.conn.commit()
        atlas_db.insert_signal(
            self.conn,
            "orch-sess",
            {
                "message_uuid": "m1",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "Do not X, do Y instead",
            },
        )
        self.conn.commit()

        # The Stop hook fires for a DIFFERENT session in the same project
        # (a subagent session that has no run of its own).
        atlas_db.upsert_session_log(
            self.conn,
            "stop-sess",
            project_id=self.pid,
            started_at=120,
            ended_at=130,
        )
        self.conn.commit()

        # Currently _should_capture queries only the literal "stop-sess" and
        # misses the signal under "orch-sess" -> returns False (the >95% miss).
        should, reason = memory_capture._should_capture(self.conn, "stop-sess")
        self.assertTrue(should, f"expected capture, got: {reason}")

        # The fact must actually be extracted, not just detected.
        mem_facts, _proj = memory_capture._extract_facts(
            self.conn, "stop-sess", "/repo/atlas"
        )
        self.assertTrue(
            any("Do not X" in f for f in mem_facts),
            f"expected the user-correction fact in {mem_facts}",
        )

    def test_literal_session_path_still_works(self):
        """The happy path (signal under the literal Stop session_id) must not
        regress: _should_capture still returns True when the run's own session
        has the signal."""
        rid = atlas_db.start_run(self.conn, self.pid, "happy-sess")
        self.conn.execute(
            "UPDATE runs SET orchestrating=1, started_at=100 WHERE id=?", (rid,)
        )
        self.conn.commit()
        atlas_db.insert_signal(
            self.conn,
            "happy-sess",
            {
                "message_uuid": "m2",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "Use Z not W",
            },
        )
        self.conn.commit()
        should, _ = memory_capture._should_capture(self.conn, "happy-sess")
        self.assertTrue(should)
        mem_facts, _ = memory_capture._extract_facts(
            self.conn, "happy-sess", "/repo/atlas"
        )
        self.assertTrue(any("Use Z not W" in f for f in mem_facts), mem_facts)


class MemoryCaptureAddFailureTest(unittest.TestCase):
    """M6: if atlas_memory.add raises (broken module, write error), the failure
    must be observable on stderr or via an additionalContext marker, not
    silently swallowed by a bare `except Exception: sys.exit(0)`."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")
        # Happy path setup: a user_correction under the literal Stop session_id
        # so _should_capture returns True and _extract_facts yields a fact.
        rid = atlas_db.start_run(self.conn, self.pid, "fail-sess")
        self.conn.execute(
            "UPDATE runs SET orchestrating=1, started_at=100 WHERE id=?", (rid,)
        )
        self.conn.commit()
        atlas_db.insert_signal(
            self.conn,
            "fail-sess",
            {
                "message_uuid": "m3",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "Prefer alpha over beta",
            },
        )
        self.conn.commit()
        self.conn.close()

        # Point the hook at our temp DB.
        self._orig_env = os.environ.get("ATLAS_DB")
        os.environ["ATLAS_DB"] = self.db

        # Hold the real atlas_memory.add so we can restore after patching.
        import atlas_memory

        self._atlas_memory = atlas_memory
        self._orig_add = atlas_memory.add

    def tearDown(self):
        self._atlas_memory.add = self._orig_add
        if self._orig_env is None:
            os.environ.pop("ATLAS_DB", None)
        else:
            os.environ["ATLAS_DB"] = self._orig_env

    def _run_main(self, payload):
        sys.stdin = io.StringIO(json.dumps(payload))
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        try:
            try:
                memory_capture.main()
            except SystemExit:
                pass
            return sys.stderr.getvalue(), sys.stdout.getvalue()
        finally:
            sys.stdin = sys.__stdin__
            sys.stderr = sys.__stderr__
            sys.stdout = sys.__stdout__

    def test_atlas_memory_add_failure_surfaced(self):
        # Simulate a broken atlas_memory.add (disk full / module write error).
        def boom(target, content):
            raise RuntimeError("disk full")

        self._atlas_memory.add = boom

        err, out = self._run_main({"session_id": "fail-sess", "cwd": "/repo/atlas"})
        combined = err + out

        # The hook must stay fail-open (exit 0, no crash) but the failure must
        # be observable somewhere — stderr message or additionalContext marker.
        self.assertTrue(
            "disk full" in combined or "memory_capture fail-open" in combined,
            f"expected atlas_memory.add failure surfaced, "
            f"got stderr={err!r} stdout={out!r}",
        )


class MemoryCaptureMainPathTest(unittest.TestCase):
    """In-process coverage of main() paths: capture-success, the no-lesson and
    non-orchestrating skips, the empty/bad-transcript skips, env-gating, the
    no-DB / connect-error skips, and the M6 fail-open stderr surfacing."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")
        self.conn.close()

        self._orig_env_db = os.environ.get("ATLAS_DB")
        self._orig_env_cap = os.environ.get("ATLAS_MEMORY_CAPTURE")
        os.environ["ATLAS_DB"] = self.db

        import atlas_memory

        self._atlas_memory = atlas_memory
        self._orig_add = atlas_memory.add

    def tearDown(self):
        self._atlas_memory.add = self._orig_add
        for name, orig in (
            ("ATLAS_DB", self._orig_env_db),
            ("ATLAS_MEMORY_CAPTURE", self._orig_env_cap),
        ):
            if orig is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = orig

    def _run_main(self, stdin_str):
        sys.stdin = io.StringIO(stdin_str)
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        try:
            try:
                memory_capture.main()
            except SystemExit:
                pass
            return sys.stderr.getvalue(), sys.stdout.getvalue()
        finally:
            sys.stdin = sys.__stdin__
            sys.stderr = sys.__stderr__
            sys.stdout = sys.__stdout__

    def _seed_run(self, session_id, started_at=100, orchestrating=1):
        conn = atlas_db.connect(self.db)
        rid = atlas_db.start_run(conn, self.pid, session_id)
        conn.execute(
            "UPDATE runs SET orchestrating=?, started_at=? WHERE id=?",
            (orchestrating, started_at, rid),
        )
        conn.commit()
        return conn, rid

    @staticmethod
    def _add_ok(target, content):
        return {"success": True}

    @staticmethod
    def _add_fail(target, content):
        return {"success": False}

    def test_off_env_disables_capture(self):
        os.environ["ATLAS_MEMORY_CAPTURE"] = "off"
        err, out = self._run_main(json.dumps({"session_id": "x", "cwd": "/r"}))
        self.assertEqual(out, "")
        self.assertEqual(err, "")

    def test_empty_stdin_skips_no_session(self):
        err, out = self._run_main("")
        self.assertEqual(out, "")

    def test_invalid_json_skips_no_session(self):
        err, out = self._run_main("not-json{")
        self.assertEqual(out, "")

    def test_stdin_read_exception_skips(self):
        class _BoomStdin:
            def read(self):
                raise IOError("stream closed")

        sys.stdin = _BoomStdin()
        sys.stderr = io.StringIO()
        sys.stdout = io.StringIO()
        try:
            try:
                memory_capture.main()
            except SystemExit:
                pass
            self.assertEqual(sys.stdout.getvalue(), "")
        finally:
            sys.stdin = sys.__stdin__
            sys.stderr = sys.__stderr__
            sys.stdout = sys.__stdout__

    def test_no_db_file_skips(self):
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "nope.db")
        err, out = self._run_main(json.dumps({"session_id": "s", "cwd": "/r"}))
        self.assertEqual(out, "")

    def test_connect_error_skips(self):
        # ATLAS_DB points at a directory: exists, but sqlite3 cannot open it.
        os.environ["ATLAS_DB"] = self.tmp
        err, out = self._run_main(json.dumps({"session_id": "s", "cwd": "/r"}))
        self.assertEqual(out, "")

    def test_no_lesson_skip_with_run(self):
        conn, _ = self._seed_run("skip-sess")
        conn.commit()
        conn.close()
        err, out = self._run_main(
            json.dumps({"session_id": "skip-sess", "cwd": "/repo/atlas"})
        )
        self.assertEqual(out, "")

    def test_signal_present_no_facts_skips(self):
        conn, _ = self._seed_run("nofact-sess")
        atlas_db.insert_signal(
            conn,
            "nofact-sess",
            {
                "message_uuid": "m",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "   ",
            },
        )
        conn.commit()
        conn.close()
        err, out = self._run_main(
            json.dumps({"session_id": "nofact-sess", "cwd": "/repo/atlas"})
        )
        self.assertEqual(out, "")

    def test_capture_success_memory_fact(self):
        conn, _ = self._seed_run("ok-sess")
        atlas_db.insert_signal(
            conn,
            "ok-sess",
            {
                "message_uuid": "m",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "Prefer alpha over beta",
            },
        )
        conn.commit()
        conn.close()
        self._atlas_memory.add = self._add_ok
        err, out = self._run_main(
            json.dumps({"session_id": "ok-sess", "cwd": "/repo/atlas"})
        )
        self.assertIn("additionalContext", out)
        self.assertIn("captured 1 memory fact", out)

    def test_capture_success_project_fact(self):
        conn, rid = self._seed_run("proj-sess")
        atlas_db.record_improvement(
            conn, rid, "parallelism", "1", "4", "raise wave size"
        )
        conn.commit()
        conn.close()
        self._atlas_memory.add = self._add_ok
        err, out = self._run_main(
            json.dumps({"session_id": "proj-sess", "cwd": "/repo/atlas"})
        )
        self.assertIn("additionalContext", out)
        self.assertIn("1 project fact", out)

    def test_add_returns_failure_no_context(self):
        conn, _ = self._seed_run("failret-sess")
        atlas_db.insert_signal(
            conn,
            "failret-sess",
            {
                "message_uuid": "m",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "Use Z not W",
            },
        )
        conn.commit()
        conn.close()
        self._atlas_memory.add = self._add_fail
        err, out = self._run_main(
            json.dumps({"session_id": "failret-sess", "cwd": "/repo/atlas"})
        )
        self.assertEqual(out, "")

    def test_fail_open_stderr_write_exception_swallowed(self):
        # add raises AND stderr.write raises: the inner except must swallow so
        # the hook still exits 0 (fail-open), not propagate.
        conn, _ = self._seed_run("stderr-sess")
        atlas_db.insert_signal(
            conn,
            "stderr-sess",
            {
                "message_uuid": "m",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": "Prefer alpha",
            },
        )
        conn.commit()
        conn.close()

        def boom(target, content):
            raise RuntimeError("disk full")

        class _BadStderr:
            def write(self, _s):
                raise IOError("stderr broken")

        self._atlas_memory.add = boom
        sys.stdin = io.StringIO(
            json.dumps({"session_id": "stderr-sess", "cwd": "/repo/atlas"})
        )
        sys.stderr = _BadStderr()
        sys.stdout = io.StringIO()
        try:
            try:
                memory_capture.main()
            except SystemExit:
                pass
            # Fail-open: no additionalContext, no exception escaped.
            self.assertEqual(sys.stdout.getvalue(), "")
        finally:
            sys.stdin = sys.__stdin__
            sys.stderr = sys.__stderr__
            sys.stdout = sys.__stdout__


class MemoryCaptureHelpersCoverageTest(unittest.TestCase):
    """Cover _resolve_scope orbit + DB-error collapse, _should_capture
    improvements-recorded and DB-error branches, and every _extract_facts
    block (assumption admissions, improvements, tool errors) including the
    per-block sqlite3.Error swallow paths."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")

    def tearDown(self):
        self.conn.close()

    def _seed_run(self, session_id, started_at=100, orchestrating=1):
        rid = atlas_db.start_run(self.conn, self.pid, session_id)
        self.conn.execute(
            "UPDATE runs SET orchestrating=?, started_at=? WHERE id=?",
            (orchestrating, started_at, rid),
        )
        self.conn.commit()
        return rid

    def test_resolve_scope_orbit_picks_up_session_logs(self):
        rid = self._seed_run("orch-sess")
        # Two other sessions in the same project started during the run.
        atlas_db.upsert_session_log(
            self.conn, "orbit-sess", project_id=self.pid, started_at=120, ended_at=130
        )
        atlas_db.upsert_session_log(
            self.conn, "stop-sess", project_id=self.pid, started_at=120, ended_at=130
        )
        self.conn.commit()
        session_ids, run_ids = memory_capture._resolve_scope(self.conn, "stop-sess")
        self.assertIn("orbit-sess", session_ids)
        self.assertIn("orch-sess", session_ids)
        self.assertIn("stop-sess", session_ids)
        self.assertIn(rid, run_ids)

    def test_resolve_scope_db_error_collapses_to_literal(self):
        closed = atlas_db.connect(self.db)
        closed.close()
        session_ids, run_ids = memory_capture._resolve_scope(closed, "x")
        self.assertEqual(session_ids, {"x"})
        self.assertEqual(run_ids, set())

    def test_should_capture_improvements_recorded(self):
        rid = self._seed_run("imp-sess")
        atlas_db.record_improvement(
            self.conn, rid, "parallelism", "1", "4", "bigger waves"
        )
        self.conn.commit()
        should, reason = memory_capture._should_capture(self.conn, "imp-sess")
        self.assertTrue(should)
        self.assertEqual(reason, "improvements recorded")

    def test_should_capture_db_error(self):
        closed = atlas_db.connect(self.db)
        closed.close()
        should, reason = memory_capture._should_capture(closed, "x")
        self.assertFalse(should)
        self.assertEqual(reason, "DB error")

    def test_extract_assumption_admission(self):
        self._seed_run("adm-sess")
        atlas_db.insert_signal(
            self.conn,
            "adm-sess",
            {
                "message_uuid": "m",
                "signal_type": "assumption_admission",
                "weight": 1.0,
                "snippet": "Assumed X was safe",
            },
        )
        self.conn.commit()
        mem_facts, _proj = memory_capture._extract_facts(
            self.conn, "adm-sess", "/repo/atlas"
        )
        self.assertTrue(any("Assumption to avoid" in f for f in mem_facts), mem_facts)

    def test_extract_improvements(self):
        rid = self._seed_run("imp2-sess")
        atlas_db.record_improvement(
            self.conn, rid, "parallelism", "1", "4", "raise wave size"
        )
        self.conn.commit()
        _mem, proj_facts = memory_capture._extract_facts(
            self.conn, "imp2-sess", "/repo/atlas"
        )
        self.assertTrue(any("parallelism" in f for f in proj_facts), proj_facts)

    def test_extract_tool_error_patterns(self):
        """Tool error patterns are captured only for non-trivial tools with ≥3 failures."""
        self._seed_run("tool-sess")
        # Insert 3 Write errors (non-trivial tool, ≥3 threshold)
        for i in range(3):
            atlas_db.insert_tool_call(
                self.conn,
                "tool-sess",
                {
                    "message_uuid": f"m{i}",
                    "ts": i + 1,
                    "tool_name": "Write",
                    "is_error": 1,
                },
            )
        self.conn.commit()
        mem_facts, _proj = memory_capture._extract_facts(
            self.conn, "tool-sess", "/repo/atlas"
        )
        self.assertTrue(any("Tool 'Write'" in f for f in mem_facts), mem_facts)

    def test_extract_tool_error_trivial_tool_skipped(self):
        """Bash errors are NOT captured — Bash is a trivial tool where single
        failures are normal during development."""
        self._seed_run("tool-sess")
        for i in range(5):
            atlas_db.insert_tool_call(
                self.conn,
                "tool-sess",
                {
                    "message_uuid": f"m{i}",
                    "ts": i + 1,
                    "tool_name": "Bash",
                    "is_error": 1,
                },
            )
        self.conn.commit()
        mem_facts, _proj = memory_capture._extract_facts(
            self.conn, "tool-sess", "/repo/atlas"
        )
        self.assertFalse(any("Tool 'Bash'" in f for f in mem_facts), mem_facts)

    def test_extract_facts_closed_conn_swallows_block_errors(self):
        # Closed conn: _resolve_scope collapses, then each query block raises
        # sqlite3.Error and is swallowed -> empty facts, no crash.
        closed = atlas_db.connect(self.db)
        closed.close()
        mem_facts, proj_facts = memory_capture._extract_facts(
            closed, "x", "/repo/atlas"
        )
        self.assertEqual(mem_facts, [])
        self.assertEqual(proj_facts, [])

    def test_extract_improvements_table_missing_swallowed(self):
        # run present (run_ids non-empty) but improvements query fails -> swallowed.
        self._seed_run("noimp-sess")
        self.conn.execute("DROP TABLE improvements")
        self.conn.commit()
        _mem, proj_facts = memory_capture._extract_facts(
            self.conn, "noimp-sess", "/repo/atlas"
        )
        self.assertEqual(proj_facts, [])



class OuterMainGuardTest(unittest.TestCase):
    """Cover the fail-open `if __name__ == '__main__'` guard: an exception
    escaping main() must be swallowed and the process exit 0 (mirrors the
    existing auto_skill guard test)."""

    def test_main_block_catches_exception_exits_zero(self):
        src_path = os.path.join(HERE, "memory_capture.py")
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
            mock.patch.dict(
                os.environ, {"ATLAS_MEMORY_CAPTURE": "off"}, clear=False
            ),
        ):
            # ATLAS_MEMORY_CAPTURE=off makes main() hit its first sys.exit(0);
            # the patched sys.exit raises RuntimeError, which escapes main(),
            # is caught by the outer `except Exception`, whose sys.exit(0)
            # raises RuntimeError again and escapes exec. guard_calls fires
            # twice, proving the fail-open guard ran.
            with self.assertRaises(RuntimeError):
                exec(compile(source, src_path, "exec"), g)
        self.assertGreaterEqual(guard_calls.call_count, 2)


if __name__ == "__main__":
    unittest.main()
