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


if __name__ == "__main__":
    unittest.main()
