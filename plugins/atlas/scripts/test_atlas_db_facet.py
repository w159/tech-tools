import os
import sys
import tempfile
import unittest

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db


class UpsertFacetCreatedAtTest(unittest.TestCase):
    def setUp(self):
        self.conn = atlas_db.connect(os.path.join(tempfile.mkdtemp(), "atlas.db"))
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def _created(self):
        return self.conn.execute(
            "select created_at from facets where session_id='s1'"
        ).fetchone()[0]

    def test_reupsert_without_created_at_preserves_it(self):
        atlas_db.upsert_facet(self.conn, "s1", created_at=1000.0, message_count=1)
        atlas_db.upsert_facet(self.conn, "s1", brief_summary="enriched")
        self.assertEqual(self._created(), 1000.0)
        row = self.conn.execute(
            "select message_count, brief_summary from facets"
        ).fetchone()
        self.assertEqual(tuple(row), (1, "enriched"))

    def test_insert_defaults_created_at_to_now(self):
        atlas_db.upsert_facet(self.conn, "s1", message_count=1)
        self.assertGreater(self._created(), 1e9)

    def test_explicit_created_at_is_stored_on_update(self):
        atlas_db.upsert_facet(self.conn, "s1", message_count=1)
        atlas_db.upsert_facet(self.conn, "s1", created_at=42.0)
        self.assertEqual(self._created(), 42.0)


if __name__ == "__main__":
    unittest.main()
