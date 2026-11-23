#!/usr/bin/env python3
"""Board writers must not create .atlas under a root that is not a project."""

import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_todo  # noqa: E402


class StrayRootTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_mark_finished_skips_missing_dir(self):
        gone = os.path.join(self.tmp, "gone")
        self.assertEqual(atlas_todo.mark_finished(gone, "w1", 0), 0)
        self.assertFalse(os.path.exists(gone))

    def test_board_write_skips_missing_dir(self):
        gone = os.path.join(self.tmp, "gone")
        atlas_todo.save(gone, atlas_todo.empty_board(gone))
        with atlas_todo._file_lock(atlas_todo.board_path(gone)):
            pass
        self.assertFalse(os.path.exists(gone))

    def test_home_is_never_a_project(self):
        home = os.path.join(self.tmp, "home")
        os.mkdir(home)
        os.mkdir(os.path.join(home, ".git"))
        with mock.patch.dict(os.environ, {"HOME": home}):
            self.assertFalse(atlas_todo._state_root_ok(home))
            atlas_todo.save(home, atlas_todo.empty_board(home))
            self.assertEqual(atlas_todo.mark_finished(home, "w1", 0), 0)
            with atlas_todo._file_lock(atlas_todo.board_path(home)):
                pass
        self.assertFalse(os.path.exists(os.path.join(home, ".atlas")))

    def test_unwritable_root_skips_quietly(self):
        proj = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(proj, ".atlas", ".run"))
        with mock.patch("os.access", return_value=False):
            self.assertEqual(atlas_todo.mark_finished(proj, "w1", 0), 0)
            atlas_todo.save(proj, atlas_todo.empty_board(proj))
        self.assertFalse(os.path.exists(os.path.join(proj, ".atlas", ".run", "todos.json")))

    def test_fresh_git_repo_still_writes(self):
        proj = os.path.join(self.tmp, "repo")
        os.makedirs(os.path.join(proj, ".git"))
        atlas_todo.save(proj, atlas_todo.empty_board(proj))
        self.assertTrue(atlas_todo.board_path(proj).exists())


if __name__ == "__main__":
    unittest.main()
