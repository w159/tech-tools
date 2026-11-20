import fcntl
import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_maint  # noqa: E402

OLD = time.time() - 30 * 86400


def _touch(path, mtime=None, data="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(data)
    if mtime:
        os.utime(path, (mtime, mtime))


class MaintTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = os.path.join(self.tmp.name, "home")
        self.root = os.path.join(self.tmp.name, "proj")
        self.run = os.path.join(self.root, ".atlas", ".run")
        os.makedirs(self.run)
        os.makedirs(self.home)
        env = mock.patch.dict(
            os.environ,
            {"ATLAS_HOME": self.home, "HOME": self.tmp.name, "ATLAS_RUN_RETENTION_DAYS": "14"},
        )
        env.start()
        self.addCleanup(env.stop)

    def test_old_deleted_new_kept(self):
        _touch(os.path.join(self.run, "logs", "old.log"), OLD)
        _touch(os.path.join(self.run, "logs", "new.log"))
        _touch(os.path.join(self.run, "inbox", "a", "old"), OLD)
        _touch(os.path.join(self.run, "evidence", "old"), OLD)
        _touch(os.path.join(self.run, "todos.json"), OLD)
        s = atlas_maint.clean_project(self.root)
        self.assertEqual(s["files"], 2)
        self.assertFalse(os.path.exists(os.path.join(self.run, "logs", "old.log")))
        self.assertTrue(os.path.exists(os.path.join(self.run, "logs", "new.log")))
        self.assertTrue(os.path.exists(os.path.join(self.run, "evidence", "old")))
        self.assertTrue(os.path.exists(os.path.join(self.run, "todos.json")))

    def test_crew_dir_with_recent_file_kept(self):
        _touch(os.path.join(self.run, "crew", "keep", "a"), OLD)
        _touch(os.path.join(self.run, "crew", "keep", "sub", "b"))
        _touch(os.path.join(self.run, "crew", "gone", "a"), OLD)
        s = atlas_maint.clean_project(self.root)
        self.assertEqual(s["crew_dirs"], 1)
        self.assertTrue(os.path.isdir(os.path.join(self.run, "crew", "keep")))
        self.assertFalse(os.path.exists(os.path.join(self.run, "crew", "gone")))

    def test_symlink_not_followed(self):
        outside = os.path.join(self.tmp.name, "outside")
        _touch(os.path.join(outside, "old"), OLD)
        os.makedirs(os.path.join(self.run, "logs"))
        os.symlink(outside, os.path.join(self.run, "logs", "link"))
        os.makedirs(os.path.join(self.run, "crew"))
        os.symlink(outside, os.path.join(self.run, "crew", "lnk"))
        atlas_maint.clean_project(self.root)
        self.assertTrue(os.path.exists(os.path.join(outside, "old")))

    def test_dry_run_deletes_nothing(self):
        p = os.path.join(self.run, "logs", "old.log")
        _touch(p, OLD)
        _touch(os.path.join(self.run, "crew", "c", "a"), OLD)
        s = atlas_maint.clean_project(self.root, dry_run=True)
        self.assertEqual((s["files"], s["crew_dirs"]), (1, 1))
        self.assertTrue(os.path.exists(p))
        self.assertTrue(os.path.isdir(os.path.join(self.run, "crew", "c")))

    def test_refuses_home_and_missing_run(self):
        self.assertIn("refused", atlas_maint.clean_project(self.tmp.name))
        self.assertIn("refused", atlas_maint.clean_project(os.path.join(self.tmp.name, "nope")))
        self.assertIn("refused", atlas_maint.clean_project("/"))

    def test_retention_off(self):
        _touch(os.path.join(self.run, "logs", "old.log"), OLD)
        with mock.patch.dict(os.environ, {"ATLAS_RUN_RETENTION_DAYS": "0"}):
            self.assertIn("skipped", atlas_maint.clean_project(self.root))
        self.assertTrue(os.path.exists(os.path.join(self.run, "logs", "old.log")))

    def test_lock_held_exits_zero(self):
        fh = open(os.path.join(self.home, "maint.lock"), "w")
        fcntl.flock(fh, fcntl.LOCK_EX)
        self.addCleanup(fh.close)
        with mock.patch.object(atlas_maint, "_db_part") as db:
            self.assertEqual(atlas_maint.main(["--project", self.root]), 0)
            db.assert_not_called()

    def test_stamp_throttle(self):
        with mock.patch.object(atlas_maint, "_db_part", return_value={}) as db:
            atlas_maint.main(["--project", self.root])
            atlas_maint.main(["--project", self.root])
            self.assertEqual(db.call_count, 1)
            atlas_maint.main(["--project", self.root, "--force"])
            self.assertEqual(db.call_count, 2)
        stamp = json.load(open(os.path.join(self.home, "maint-stamp.json")))
        self.assertIn("db", stamp)
        self.assertIn(os.path.realpath(self.root), stamp["projects"])

    def test_main_dry_run_writes_no_stamp(self):
        with mock.patch.object(atlas_maint, "_db_part", return_value={}):
            atlas_maint.main(["--project", self.root, "--dry-run"])
        self.assertFalse(os.path.exists(os.path.join(self.home, "maint-stamp.json")))


if __name__ == "__main__":
    unittest.main()
