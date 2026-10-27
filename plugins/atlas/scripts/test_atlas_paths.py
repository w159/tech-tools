import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_paths  # noqa: E402


def mk(*parts):
    path = os.path.join(*parts)
    os.makedirs(path, exist_ok=True)
    return path


class ProjectRootTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = os.path.realpath(self._tmp.name)
        self.home = mk(self.tmp, "home")
        patcher = mock.patch.dict(os.environ, {"HOME": self.home})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def test_git_subdir_maps_to_git_root(self):
        root = mk(self.home, "proj")
        mk(root, ".git")
        sub = mk(root, "frontend", "src")
        self.assertEqual(atlas_paths.project_root(sub), root)

    def test_subdir_with_own_docs_still_maps_to_git_root(self):
        root = mk(self.home, "proj")
        mk(root, ".git")
        sub = mk(root, "admin-webapp")
        mk(sub, "docs")
        self.assertEqual(atlas_paths.project_root(sub), root)

    def test_start_inside_run_dir_maps_to_root(self):
        root = mk(self.home, "proj")
        mk(root, ".git")
        self.assertEqual(atlas_paths.project_root(mk(root, ".atlas", ".run")), root)

    def test_nested_atlas_run_maps_to_root(self):
        root = mk(self.home, "proj")
        mk(root, ".git")
        nested = mk(root, ".atlas", ".run", ".atlas", ".run")
        self.assertEqual(atlas_paths.project_root(nested), root)

    def test_home_atlas_is_never_a_root(self):
        mk(self.home, ".atlas")
        proj = mk(self.home, "proj")
        self.assertEqual(atlas_paths.project_root(proj), proj)

    def test_linked_worktree_maps_to_main_root(self):
        main = mk(self.home, "main")
        gitdir = mk(main, ".git", "worktrees", "wt1")
        with open(os.path.join(gitdir, "commondir"), "w") as fh:
            fh.write("../..\n")
        wt = mk(self.home, "wt1")
        with open(os.path.join(wt, ".git"), "w") as fh:
            fh.write("gitdir: %s\n" % gitdir)
        self.assertEqual(atlas_paths.project_root(mk(wt, "pkg")), main)

    def test_non_git_dir_with_own_atlas(self):
        proj = mk(self.home, "plain")
        mk(proj, ".atlas")
        self.assertEqual(atlas_paths.project_root(mk(proj, "sub")), proj)

    def test_sanitize_cuts_at_first_atlas_component(self):
        p = os.path.join(self.tmp, "p", ".atlas", ".run", ".atlas")
        self.assertEqual(atlas_paths.sanitize(p), os.path.join(self.tmp, "p"))


if __name__ == "__main__":
    unittest.main()
