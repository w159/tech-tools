"""Extra chronicle_facet tests: run-id fallback, signal mirroring edge cases, explicit db path and every
exit code of main()/the __main__ guard."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
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


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)
        self.pid = atlas_db.register_project(self.conn, "/repo/atlas")
        env = mock.patch.dict(os.environ, {"ATLAS_DB": self.db})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("ATLAS_CHRONICLE", None)
        hs = os.path.join(self.tmp, "hookstate")
        p = mock.patch.object(atlas_hook_guard, "_state_dir", lambda: hs)
        p.start()
        self.addCleanup(p.stop)

    def _session(self, sid):
        atlas_db.upsert_session_log(self.conn, sid, project_id=self.pid, started_at=1, ended_at=2)
        self.conn.commit()

    def _signal(self, sid, kind, weight=1.0, snippet="s", ts=5, uuid="u"):
        atlas_db.insert_signal(
            self.conn, sid, {"message_uuid": uuid, "signal_type": kind, "ts": ts, "weight": weight, "snippet": snippet}
        )
        self.conn.commit()

    def _main(self, payload=None, stdin=None):
        """Run main(); return (exit code or None, stderr)."""
        raw = stdin if stdin is not None else json.dumps(payload if payload is not None else {})
        err = io.StringIO()
        code = "no-exit"
        with mock.patch("sys.stdin", io.StringIO(raw)), mock.patch("sys.stderr", err), mock.patch("sys.stdout", io.StringIO()):
            try:
                chronicle_facet.main()
            except SystemExit as e:
                code = e.code
        return code, err.getvalue()


class RunIdFallbackTest(Base):
    def test_closed_run_still_supplies_dispatch_and_metrics(self):
        self._session("s1")
        rid = atlas_db.start_run(self.conn, self.pid, "s1")
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        atlas_db.log_dispatch(self.conn, rid, "atlas:verifier")
        self.conn.execute("INSERT INTO metrics(run_id, verifier_coverage, wall_clock_s) VALUES(?,?,?)", (rid, 0.25, 9.0))
        self.conn.execute("UPDATE runs SET ended_at=? WHERE id=?", (50, rid))
        self.conn.commit()
        self.assertIsNone(atlas_db.current_run_id(self.conn, "s1"))
        f = chronicle_facet._compute_facet_fields(self.conn, "s1")
        self.assertEqual((f["dispatch_count"], f["verifier_coverage"], f["wall_clock_s"]), (2, 0.25, 9.0))

    def test_open_run_wins_over_latest_closed_one(self):
        self._session("s2")
        old = atlas_db.start_run(self.conn, self.pid, "s2")
        atlas_db.log_dispatch(self.conn, old, "a")
        self.conn.execute("UPDATE runs SET ended_at=? WHERE id=?", (50, old))
        self.conn.commit()
        new = atlas_db.start_run(self.conn, self.pid, "s2")
        for _ in range(3):
            atlas_db.log_dispatch(self.conn, new, "a")
        self.conn.commit()
        self.assertEqual(chronicle_facet._compute_facet_fields(self.conn, "s2")["dispatch_count"], 3)

    def test_no_run_means_null_not_zero_and_run_without_metrics(self):
        self._session("s3")
        f = chronicle_facet._compute_facet_fields(self.conn, "s3")
        self.assertIsNone(f["dispatch_count"])
        self.assertIsNone(f["verifier_coverage"])
        self.assertIsNone(f["wall_clock_s"])
        atlas_db.start_run(self.conn, self.pid, "s3")
        f = chronicle_facet._compute_facet_fields(self.conn, "s3")
        self.assertEqual(f["dispatch_count"], 0)
        self.assertIsNone(f["wall_clock_s"])


class CountsTest(Base):
    def test_edit_and_read_families_and_other_sessions_excluded(self):
        self._session("c1")
        self._session("c2")
        names = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Read", "Grep", "Glob", "Bash"]
        for i, n in enumerate(names):
            atlas_db.insert_tool_call(self.conn, "c1", {"message_uuid": f"m{i}", "ts": i, "tool_name": n, "is_error": 0})
        atlas_db.insert_tool_call(self.conn, "c2", {"message_uuid": "x", "ts": 1, "tool_name": "Edit", "is_error": 0})
        self._signal("c1", "user_correction", uuid="u1")
        self._signal("c1", "user_correction", uuid="u2")
        self._signal("c1", "unverified_claim")
        self._signal("c2", "user_correction")
        self.assertEqual(chronicle_facet._edit_read_counts(self.conn, "c1"), (4, 3))
        f = chronicle_facet._compute_facet_fields(self.conn, "c1")
        self.assertEqual((f["edit_count"], f["read_count"], f["correction_count"], f["gate_block_count"]), (4, 3, 2, 0))
        self.assertEqual(f["project_id"], self.pid)

    def test_gate_blocks_counted_per_session(self):
        self._session("g1")
        self._session("g2")
        for _ in range(2):
            atlas_db.record_friction(self.conn, "g1", "gate_block", weight=1.0, snippet="b", ts=1)
        atlas_db.record_friction(self.conn, "g1", "user_correction", weight=1.0, snippet="b", ts=1)
        atlas_db.record_friction(self.conn, "g2", "gate_block", weight=1.0, snippet="b", ts=1)
        self.conn.commit()
        self.assertEqual(chronicle_facet._gate_block_count(self.conn, "g1"), 2)
        self.assertEqual(chronicle_facet._gate_block_count(self.conn, "nobody"), 0)


class SyncFrictionTest(Base):
    def test_unknown_signal_types_skipped_without_dropping_later_ones(self):
        self._session("f1")
        self._signal("f1", "mystery", ts=1)
        self._signal("f1", "user_correction", weight=1.5, snippet="fix", ts=2)
        self._signal("f1", "unverified_claim", weight=0.5, snippet="maybe", ts=3)
        chronicle_facet._sync_friction_events(self.conn, "f1")
        rows = sorted(self.conn.execute("SELECT category, weight, snippet, ts FROM friction_events WHERE session_id='f1'"))
        self.assertEqual(rows, [("friction", 0.5, "maybe", 3), ("user_correction", 1.5, "fix", 2)])

    def test_zero_weight_defaults_to_one(self):
        self._session("f2")
        self._signal("f2", "error_report", weight=0, snippet="e")
        chronicle_facet._sync_friction_events(self.conn, "f2")
        self.assertEqual(self.conn.execute("SELECT category, weight FROM friction_events WHERE session_id='f2'").fetchall(), [("error_report", 1.0)])

    def test_mirror_replaces_only_owned_categories_and_only_this_session(self):
        self._session("f3")
        self._session("f4")
        atlas_db.record_friction(self.conn, "f3", "gate_block", weight=1.0, snippet="keep", ts=1)
        atlas_db.record_friction(self.conn, "f3", "memory_drop", weight=1.0, snippet="keep", ts=1)
        atlas_db.record_friction(self.conn, "f3", "user_correction", weight=1.0, snippet="stale", ts=1)
        atlas_db.record_friction(self.conn, "f4", "user_correction", weight=1.0, snippet="other", ts=1)
        self.conn.commit()
        self._signal("f3", "assumption_admission", weight=2.0, snippet="fresh")
        chronicle_facet._sync_friction_events(self.conn, "f3")
        got = sorted(self.conn.execute("SELECT category, snippet FROM friction_events WHERE session_id='f3'"))
        self.assertEqual(got, [("assumption_admission", "fresh"), ("gate_block", "keep"), ("memory_drop", "keep")])
        self.assertEqual(self.conn.execute("SELECT snippet FROM friction_events WHERE session_id='f4'").fetchone()[0], "other")

    def test_mapping_is_complete_for_known_signals(self):
        self.assertEqual(
            chronicle_facet.FRICTION_CATEGORY_BY_SIGNAL,
            {
                "user_correction": "user_correction",
                "assumption_admission": "assumption_admission",
                "error_report": "error_report",
                "unverified_claim": "friction",
            },
        )


class RefreshTest(Base):
    def test_explicit_db_path_is_used_over_env(self):
        other = os.path.join(self.tmp, "other.db")
        c2 = atlas_db.connect(other)
        atlas_db.init(c2)
        atlas_db.upsert_session_log(c2, "r1", project_id=None, started_at=1, ended_at=2)
        atlas_db.insert_signal(c2, "r1", {"message_uuid": "u", "signal_type": "user_correction", "ts": 1, "weight": 1.5, "snippet": "x"})
        c2.commit()
        c2.close()
        chronicle_facet.refresh("r1", other)
        c3 = atlas_db.connect(other)
        self.addCleanup(c3.close)
        self.assertEqual(c3.execute("SELECT correction_count FROM facets WHERE session_id='r1'").fetchone()[0], 1)
        self.assertEqual(c3.execute("SELECT COUNT(*) FROM friction_events").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM facets").fetchone()[0], 0)

    def test_default_path_comes_from_env(self):
        self._session("r2")
        chronicle_facet.refresh("r2")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM facets WHERE session_id='r2'").fetchone()[0], 1)

    def test_connection_closed_even_on_error(self):
        fake = mock.MagicMock()
        with mock.patch.object(atlas_db, "connect", return_value=fake), mock.patch.object(
            chronicle_facet, "_compute_facet_fields", side_effect=RuntimeError("boom")
        ):
            with self.assertRaises(RuntimeError):
                chronicle_facet.refresh("r3", "x.db")
        fake.close.assert_called_once()


class MainExitCodesTest(Base):
    def test_off_env_exits_zero_case_insensitive_and_writes_nothing(self):
        self._session("m1")
        for val in ("off", "OFF", "Off"):
            with mock.patch.dict(os.environ, {"ATLAS_CHRONICLE": val}):
                code, _ = self._main({"session_id": "m1"})
            self.assertEqual(code, 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM facets").fetchone()[0], 0)
        with mock.patch.dict(os.environ, {"ATLAS_CHRONICLE": "on"}):
            self.assertEqual(self._main({"session_id": "m1"})[0], 0)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM facets").fetchone()[0], 1)

    def test_missing_session_id_and_non_dict_payload_exit_zero(self):
        for raw in ('{"cwd": "/x"}', '{"session_id": ""}', "[1, 2]", "not json", ""):
            self.assertEqual(self._main(stdin=raw)[0], 0, raw)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM facets").fetchone()[0], 0)

    def test_guard_refusal_exits_zero_without_writing(self):
        self._session("m2")
        with mock.patch.object(atlas_hook_guard, "should_run", return_value=False) as sr:
            code, _ = self._main({"session_id": "m2"})
        self.assertEqual(code, 0)
        self.assertEqual(sr.call_args[0][1], "chronicle_facet")
        self.assertEqual(sr.call_args[1], {"kind": "capture"})
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM facets").fetchone()[0], 0)

    def test_missing_db_exits_zero_and_creates_nothing(self):
        gone = os.path.join(self.tmp, "gone.db")
        with mock.patch.dict(os.environ, {"ATLAS_DB": gone}):
            code, err = self._main({"session_id": "m3"})
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        self.assertFalse(os.path.exists(gone))

    def test_error_is_recorded_reported_and_exits_zero(self):
        self._session("m4")
        with mock.patch.object(chronicle_facet, "refresh", side_effect=RuntimeError("kaput")), mock.patch.object(
            chronicle_facet.atlas_faults, "record"
        ) as rec:
            code, err = self._main({"session_id": "m4"})
        self.assertEqual(code, 0)
        self.assertIn("[atlas] chronicle_facet fail-open: kaput", err)
        self.assertEqual(rec.call_args[0][0], "chronicle_facet")
        self.assertIsInstance(rec.call_args[0][1], RuntimeError)

    def test_unwritable_stderr_does_not_change_exit(self):
        class Bad:
            def write(self, _):
                raise OSError("closed")

        with mock.patch.object(chronicle_facet, "refresh", side_effect=RuntimeError("x")), mock.patch.object(
            chronicle_facet.atlas_faults, "record"
        ), mock.patch("sys.stdin", io.StringIO('{"session_id": "m5"}')), mock.patch("sys.stderr", Bad()):
            with self.assertRaises(SystemExit) as cm:
                chronicle_facet.main()
        self.assertEqual(cm.exception.code, 0)

    def test_success_calls_refresh_with_resolved_db_path(self):
        self._session("m6")
        with mock.patch.object(chronicle_facet, "refresh") as rf:
            code, _ = self._main({"session_id": "m6"})
        self.assertEqual(code, 0)
        rf.assert_called_once_with("m6", self.db)


class ModuleGuardTest(unittest.TestCase):
    def _exec(self, env):
        path = os.path.join(HERE, "chronicle_facet.py")
        with open(path) as f:
            src = f.read()
        codes = []

        def fake_exit(code=None):
            codes.append(code)
            raise RuntimeError("forced")

        g = {"__name__": "__main__", "__file__": path}
        with mock.patch("sys.exit", side_effect=fake_exit), mock.patch("sys.stdin", io.StringIO("")), mock.patch(
            "sys.stdout", io.StringIO()
        ), mock.patch.dict(os.environ, env), mock.patch.object(sys, "path", list(sys.path)):
            with self.assertRaises(RuntimeError):
                exec(compile(src, path, "exec"), g)
        return codes

    def test_guard_exit_codes_are_zero_and_fault_recorded(self):
        with mock.patch("atlas_faults.record") as rec:
            codes = self._exec({"ATLAS_CHRONICLE": "off"})
        self.assertEqual(codes, [0, 0])
        self.assertEqual(rec.call_args[0][0], "chronicle_facet")

    def test_scripts_dir_goes_first_on_sys_path(self):
        path = os.path.join(HERE, "chronicle_facet.py")
        with open(path) as f:
            src = f.read()
        fake = ["/first", "/second"]
        with mock.patch.object(sys, "path", fake):
            exec(compile(src, path, "exec"), {"__name__": "chronicle_facet_pathprobe", "__file__": path})
            head = list(sys.path[:2])
        self.assertTrue(head[0].endswith(os.path.join("hooks", "..", "scripts")), head)
        self.assertEqual(head[1], "/first")


if __name__ == "__main__":
    unittest.main()
