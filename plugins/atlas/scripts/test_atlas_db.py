import os, tempfile, unittest
import atlas_db


class AtlasDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.path)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_init_is_idempotent(self):
        atlas_db.init(self.conn)  # second call must not raise
        names = {
            r[0]
            for r in self.conn.execute(
                "select name from sqlite_master where type='table'"
            )
        }
        self.assertTrue(
            {"projects", "runs", "events", "dispatches", "metrics", "improvements"}
            <= names
        )

    def test_register_project_is_stable_by_path(self):
        a = atlas_db.register_project(self.conn, "/repo/x", "x", "python")
        b = atlas_db.register_project(self.conn, "/repo/x")
        self.assertEqual(a, b)  # same path -> same id

    def test_inline_ops_reset_on_dispatch(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        for _ in range(3):
            atlas_db.log_event(self.conn, rid, "Read", "main", 1, "a.py")
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 3)
        atlas_db.log_dispatch(self.conn, rid, "atlas:explorer")
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 0)
        atlas_db.log_event(self.conn, rid, "Grep", "main", 1)
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 1)

    def test_finalize_and_run_metrics(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        atlas_db.log_event(self.conn, rid, "Read", "main", 1)
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        atlas_db.finalize_run(self.conn, rid, wall_clock_s=42.0)
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m["inline_ops"], 1)
        self.assertEqual(m["dispatches"], 1)
        self.assertEqual(m["wall_clock_s"], 42.0)

    def test_record_improvement_and_trends(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        atlas_db.finalize_run(self.conn, rid)
        atlas_db.record_improvement(
            self.conn, rid, "parallelism", "0 waves", ">=3 waves", "fan out the audit"
        )
        rows = self.conn.execute("select count(*) from improvements").fetchone()
        self.assertEqual(rows[0], 1)
        self.assertGreaterEqual(len(atlas_db.trends(self.conn)), 1)

    def test_derive_run_metrics_from_mirror(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-d")
        atlas_db.upsert_session_log(
            self.conn, "sess-d", project_id=pid, started_at=100.0, ended_at=160.0
        )
        # main-thread context peak = 1000 + 200; a sidechain msg must be ignored
        atlas_db.insert_message(
            self.conn,
            "sess-d",
            {
                "uuid": "m1",
                "role": "assistant",
                "is_sidechain": 0,
                "input_tokens": 1000,
                "cache_read_tokens": 200,
            },
        )
        atlas_db.insert_message(
            self.conn,
            "sess-d",
            {
                "uuid": "m2",
                "role": "assistant",
                "is_sidechain": 1,
                "input_tokens": 9999,
                "cache_read_tokens": 9999,
            },
        )
        # two implementer dispatches, one verifier -> coverage 0.5
        atlas_db.insert_tool_call(
            self.conn,
            "sess-d",
            {
                "tool_use_id": "t1",
                "kind": "agent",
                "target": "atlas:implementer",
                "ts": 100.0,
            },
        )
        atlas_db.insert_tool_call(
            self.conn,
            "sess-d",
            {
                "tool_use_id": "t2",
                "kind": "agent",
                "target": "atlas:implementer",
                "ts": 101.0,
            },
        )
        atlas_db.insert_tool_call(
            self.conn,
            "sess-d",
            {
                "tool_use_id": "t3",
                "kind": "agent",
                "target": "atlas:verifier",
                "ts": 102.0,
            },
        )
        self.conn.commit()
        d = atlas_db.derive_run_metrics(self.conn, rid, "sess-d")
        self.assertEqual(d["est_context_tokens"], 1200)  # sidechain excluded
        self.assertEqual(d["verifier_coverage"], 0.5)
        self.assertEqual(d["in_flight_peak"], 3)  # all 3 within 10s
        self.assertEqual(d["parallel_waves"], 1)
        self.assertEqual(d["wall_clock_s"], 60.0)
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m["est_context_tokens"], 1200)
        self.assertIsNone(m["recall_hits"])  # never auto-derived

    def test_finalize_defaults_wall_clock_from_started_at(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-w")
        atlas_db.finalize_run(self.conn, rid)  # no wall_clock_s passed
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertIsNotNone(m["wall_clock_s"])  # was NULL on every historical run
        self.assertGreaterEqual(m["wall_clock_s"], 0.0)

    def test_latest_run_id_resolves_after_finalize(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-l")
        atlas_db.finalize_run(self.conn, rid)  # closes the run (ended_at set)
        self.assertIsNone(atlas_db.current_run_id(self.conn, "sess-l"))  # closed
        self.assertEqual(
            atlas_db.latest_run_id(self.conn, "sess-l"), rid
        )  # still found

    def test_derive_does_not_clobber_finalized_wall_clock(self):
        # Regression: finalize_run sets the authoritative wall clock; a later
        # derive_run_metrics (transcript-span based, often 0) must NOT overwrite it.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-wc")
        atlas_db.finalize_run(self.conn, rid, wall_clock_s=123.0)
        atlas_db.upsert_session_log(
            self.conn, "sess-wc", project_id=pid, started_at=100.0, ended_at=100.0
        )  # zero-span transcript -> derived wall = 0.0
        self.conn.commit()
        atlas_db.derive_run_metrics(self.conn, rid, "sess-wc")
        self.assertEqual(atlas_db.run_metrics(self.conn, rid)["wall_clock_s"], 123.0)

    def test_derive_fills_wall_clock_when_unset(self):
        # The fallback still works: a backfill-only run (never finalized) gets the
        # transcript-span wall clock from derive.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-bf")
        atlas_db.upsert_session_log(
            self.conn, "sess-bf", project_id=pid, started_at=100.0, ended_at=160.0
        )
        self.conn.commit()
        atlas_db.derive_run_metrics(self.conn, rid, "sess-bf")
        self.assertEqual(atlas_db.run_metrics(self.conn, rid)["wall_clock_s"], 60.0)

    def test_trends_exposes_full_metric_set(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-t")
        atlas_db.finalize_run(self.conn, rid)
        row = atlas_db.trends(self.conn)[0]
        for col in (
            "parallel_waves",
            "in_flight_peak",
            "est_context_tokens",
            "verifier_coverage",
        ):
            self.assertIn(col, row)  # documented dimensions must be selectable


if __name__ == "__main__":
    unittest.main()
