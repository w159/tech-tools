"""check_paths must refuse paths that escape the project root, symlinks included."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _test_isolation  # noqa: E402,F401
import atlas_resolve  # noqa: E402


class CheckPathsSymlinkTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = os.path.join(self._tmp.name, "proj")
        self.outside = os.path.join(self._tmp.name, "outside")
        os.makedirs(os.path.join(self.root, "src"))
        os.makedirs(self.outside)
        Path(self.outside, "secret.txt").write_text("x")

    def test_symlink_escape_refused(self):
        os.symlink(self.outside, os.path.join(self.root, "link"))
        with self.assertRaises(ValueError):
            atlas_resolve.check_paths("link/secret.txt", self.root)

    def test_symlink_escape_refused_for_new_file_under_link(self):
        os.symlink(self.outside, os.path.join(self.root, "link"))
        with self.assertRaises(ValueError):
            atlas_resolve.check_paths("link/new/file.txt", self.root)

    def test_dotdot_still_refused(self):
        with self.assertRaises(ValueError):
            atlas_resolve.check_paths("../outside/secret.txt", self.root)

    def test_ordinary_path_accepted(self):
        self.assertEqual(
            atlas_resolve.check_paths("src,README.md", self.root), ["src", "README.md"]
        )

    def test_nonexistent_new_file_accepted(self):
        self.assertEqual(
            atlas_resolve.check_paths("src/new/file.py", self.root), ["src/new/file.py"]
        )

    def test_symlink_inside_root_accepted(self):
        os.symlink(os.path.join(self.root, "src"), os.path.join(self.root, "alias"))
        self.assertEqual(
            atlas_resolve.check_paths("alias/x.py", self.root), ["alias/x.py"]
        )

    def test_root_given_as_symlink_accepted(self):
        rootlink = os.path.join(self._tmp.name, "rootlink")
        os.symlink(self.root, rootlink)
        self.assertEqual(atlas_resolve.check_paths("src/a.py", rootlink), ["src/a.py"])


if __name__ == "__main__":
    unittest.main()
