import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_db  # noqa: E402
import atlas_maint  # noqa: E402


class DeniedBackfillTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dbp = os.path.join(self.tmp.name, "atlas.db")
        env = mock.patch.dict(os.environ, {"ATLAS_DB": self.dbp})
        env.start()
        self.addCleanup(env.stop)
        conn = atlas_db.connect(self.dbp)
        atlas_db.init(conn)
        conn.close()
        self.n = 0

    def _add(self, is_error, denied, snippet):
        self.n += 1
        conn = atlas_db.connect(self.dbp)
        conn.execute(
            "INSERT INTO tool_calls(session_id, tool_use_id, is_error, denied, error_snippet) "
            "VALUES('s', ?, ?, ?, ?)",
            ("t%d" % self.n, is_error, denied, snippet),
        )
        conn.commit()
        conn.close()
        return self.n

    def _denied(self, rid):
        conn = atlas_db.connect(self.dbp)
        try:
            return conn.execute("SELECT denied FROM tool_calls WHERE id=?", (rid,)).fetchone()[0]
        finally:
            conn.close()

    def test_flags_old_denies_only(self):
        deny = self._add(1, 0, "Atlas enforcement: blocked")
        real = self._add(1, 0, "Traceback: boom")
        nosnip = self._add(1, 0, None)
        ok = self._add(0, 0, "Atlas enforcement: blocked")
        already = self._add(1, 1, "Traceback: boom")  # never reset to 0
        out = atlas_maint._db_part(False, False)
        self.assertEqual(out["denied_backfilled"], 1)
        self.assertEqual(
            [self._denied(i) for i in (deny, real, nosnip, ok, already)], [1, 0, 0, 0, 1]
        )

    def test_idempotent(self):
        self._add(1, 0, "DENY - nope")
        self.assertEqual(atlas_maint._db_part(False, False)["denied_backfilled"], 1)
        self.assertEqual(atlas_maint._db_part(False, False)["denied_backfilled"], 0)

    def test_batches_commit_each(self):
        ids = [self._add(1, 0, "DENY - x") for _ in range(5)]
        with mock.patch.object(atlas_maint, "BACKFILL_BATCH", 2):
            out = atlas_maint._db_part(False, False)
        self.assertEqual(out["denied_backfilled"], 5)
        self.assertTrue(all(self._denied(i) == 1 for i in ids))

    def test_failure_reported_and_earlier_steps_kept(self):
        self._add(1, 0, "DENY - x")
        with mock.patch.object(
            atlas_maint, "_denied_backfill_batched", side_effect=__import__("sqlite3").OperationalError("locked")
        ):
            out = atlas_maint._db_part(False, False)
        self.assertIn("backfilled", out)
        self.assertEqual(out["denied_backfill_error"], "locked")
        self.assertNotIn("denied_backfilled", out)


if __name__ == "__main__":
    unittest.main()
