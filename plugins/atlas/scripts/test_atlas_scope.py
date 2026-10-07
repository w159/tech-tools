import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_scope  # noqa: E402

REPO = str(Path(__file__).resolve().parents[3])


class GatesArmedTest(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ)
        self.env.start()
        os.environ.pop("ATLAS_GATES", None)
        self.addCleanup(self.env.stop)

    def _home_dir(self):
        d = tempfile.mkdtemp(dir=str(Path.home()), prefix=".atlas-scope-test-")
        self.addCleanup(shutil.rmtree, d, True)
        return d

    def test_tmp_paths_false(self):
        for p in (
            "/tmp/x",
            "/private/tmp/x",
            "/var/folders/ab/cd",
            tempfile.gettempdir(),
        ):
            self.assertFalse(atlas_scope.gates_armed(p), p)

    def test_tmp_false_even_with_marker(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        os.mkdir(os.path.join(d, ".git"))
        self.assertFalse(atlas_scope.gates_armed(d))

    def test_repo_dir_true(self):
        self.assertTrue(atlas_scope.gates_armed(REPO))
        self.assertTrue(atlas_scope.gates_armed(os.path.join(REPO, "plugins", "atlas")))

    def test_no_marker_under_home_false(self):
        self.assertFalse(atlas_scope.gates_armed(self._home_dir()))

    def test_marker_in_ancestor_under_home_true(self):
        d = self._home_dir()
        Path(d, "package.json").write_text("{}")
        sub = os.path.join(d, "a", "b")
        os.makedirs(sub)
        self.assertTrue(atlas_scope.gates_armed(sub))

    def test_home_itself_false(self):
        self.assertFalse(atlas_scope.gates_armed(str(Path.home())))

    def _db(self, root, dispatches):
        import atlas_db

        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        os.environ["ATLAS_DB"] = os.path.join(d, "atlas.db")
        conn = atlas_db.connect()
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, root)
        run = conn.execute("INSERT INTO runs(project_id) VALUES(?)", (pid,)).lastrowid
        for _ in range(dispatches):
            atlas_db.log_dispatch(conn, run, "implementer")
        conn.commit()
        conn.close()

    def test_db_history_arms_markerless_dir(self):
        d = os.path.realpath(self._home_dir())
        self.assertFalse(atlas_scope.gates_armed(d))
        self._db(d, 1)
        self.assertTrue(atlas_scope.gates_armed(d))

    def test_db_project_without_dispatch_stays_unarmed(self):
        d = os.path.realpath(self._home_dir())
        self._db(d, 0)
        self.assertFalse(atlas_scope.gates_armed(d))

    def test_db_history_never_arms_home_or_tmp(self):
        home = os.path.realpath(str(Path.home()))
        self._db(home, 1)
        self.assertFalse(atlas_scope.gates_armed(home))
        self._db("/tmp/x", 1)
        self.assertFalse(atlas_scope.gates_armed("/tmp/x"))

    def test_db_error_is_ignored(self):
        d = self._home_dir()
        os.environ["ATLAS_DB"] = os.path.join(d, "bad.db")
        Path(os.environ["ATLAS_DB"]).write_text("not sqlite")
        self.assertFalse(atlas_scope.gates_armed(d))

    def test_env_overrides(self):
        os.environ["ATLAS_GATES"] = "always"
        self.assertTrue(atlas_scope.gates_armed("/tmp/x"))
        os.environ["ATLAS_GATES"] = "off"
        self.assertFalse(atlas_scope.gates_armed(REPO))

    def test_exception_returns_true(self):
        with mock.patch("os.path.realpath", side_effect=OSError("boom")):
            self.assertTrue(atlas_scope.gates_armed("/tmp/x"))


if __name__ == "__main__":
    unittest.main()
