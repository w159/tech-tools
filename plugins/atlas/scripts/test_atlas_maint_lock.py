import os
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_db  # noqa: E402
import atlas_maint  # noqa: E402


class MaintLockTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dbp = os.path.join(self.tmp.name, "atlas.db")
        env = mock.patch.dict(os.environ, {"ATLAS_DB": self.dbp, "ATLAS_DB_RETENTION_DAYS": "30"})
        env.start()
        self.addCleanup(env.stop)
        conn = atlas_db.connect(self.dbp)
        atlas_db.init(conn)
        conn.execute("INSERT INTO projects(id, root) VALUES(1, '/p')") if self._has_projects(conn) else None
        old = time.time() - 90 * 86400
        # s0,s1 orchestrator; s2,s3 worker (sidechain only); s4 has no messages.
        for i in range(5):
            conn.execute(
                "INSERT INTO runs(project_id, session_id, kind) VALUES(1, ?, 'orchestrator')",
                ("s%d" % i,),
            )
        rows = [("s0", 0), ("s1", 0), ("s1", 1), ("s2", 1), ("s3", 1)]
        for n, (sid, side) in enumerate(rows):
            conn.execute(
                "INSERT INTO messages(session_id, uuid, ts, is_sidechain) VALUES(?,?,?,?)",
                (sid, "u%d" % n, old if n < 2 else time.time(), side),
            )
        conn.commit()
        conn.close()

    @staticmethod
    def _has_projects(conn):
        cols = [r[1] for r in conn.execute("PRAGMA table_info(projects)")]
        return "root" in cols

    def _probe(self, log, label):
        # A second writer with a short busy timeout must get the lock between steps.
        other = sqlite3.connect(self.dbp, timeout=0.05)
        try:
            other.execute("CREATE TABLE IF NOT EXISTS probe(x)")
            other.execute("INSERT INTO probe VALUES(1)")
            other.commit()
            log.append((label, True))
        except sqlite3.OperationalError:
            log.append((label, False))
        finally:
            other.close()

    def test_no_transaction_spans_steps_and_results_unchanged(self):
        log = []
        real_prune = atlas_db.prune_old
        real_close = atlas_db.close_unmeasurable_improvements
        real_chunk = atlas_maint._backfill_chunk

        def prune(*a, **k):
            self._probe(log, "before-prune")
            return real_prune(*a, **k)

        def chunk(*a, **k):
            self._probe(log, "before-chunk")
            return real_chunk(*a, **k)

        def close(*a, **k):
            self._probe(log, "before-close")
            return real_close(*a, **k)

        with mock.patch.object(atlas_db, "prune_old", prune), \
                mock.patch.object(atlas_db, "close_unmeasurable_improvements", close), \
                mock.patch.object(atlas_maint, "_backfill_chunk", chunk), \
                mock.patch.object(atlas_maint, "BACKFILL_BATCH", 2):
            out = atlas_maint._db_part(False, False, min_free_pages=10**9, min_free_ratio=1)
        self._probe(log, "after")

        self.assertTrue(all(ok for _, ok in log), log)
        self.assertGreater(len([1 for label, _ in log if label == "before-chunk"]), 1, log)
        self.assertEqual(out["pruned"]["messages"], 2)
        conn = sqlite3.connect(self.dbp)
        kinds = dict(conn.execute("SELECT session_id, kind FROM runs"))
        conn.close()
        self.assertEqual(
            kinds,
            {"s0": "orchestrator", "s1": "worker", "s2": "worker", "s3": "worker", "s4": "orchestrator"},
        )

    def test_failed_step_keeps_earlier_commits(self):
        def boom(*a, **k):
            raise RuntimeError("step failed")

        with mock.patch.object(atlas_db, "close_unmeasurable_improvements", boom):
            with self.assertRaises(RuntimeError):
                atlas_maint._db_part(False, False)
        conn = sqlite3.connect(self.dbp)
        n = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        kind = conn.execute("SELECT kind FROM runs WHERE session_id='s2'").fetchone()[0]
        conn.close()
        self.assertEqual(n, 3)
        self.assertEqual(kind, "worker")


if __name__ == "__main__":
    unittest.main()
