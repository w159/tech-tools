"""format_after_edit: URI-path import fallback, missing-formatter state file, duplicate file dedupe."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import datetime
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import format_after_edit  # noqa: E402


class UriPathTest(unittest.TestCase):
    def test_scheme_path_is_uri_and_plain_path_is_not(self):
        self.assertTrue(format_after_edit._is_uri_path("agent://worker/1"))
        self.assertFalse(format_after_edit._is_uri_path("/tmp/a.py"))

    def test_uri_check_failure_fails_open_to_file(self):
        import atlas_db

        with mock.patch.object(atlas_db, "is_uri_path", side_effect=RuntimeError("x")):
            self.assertFalse(format_after_edit._is_uri_path("agent://worker/1"))


class NoteMissingTest(unittest.TestCase):
    def test_state_file_is_indent_one_json_keyed_by_formatter_and_root(self):
        home = tempfile.mkdtemp()
        proj = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"ATLAS_HOME": home}):
            format_after_edit._note_missing("ruff", proj)
        key = "ruff|" + os.path.realpath(proj)
        want = {key: datetime.date.today().isoformat()}
        text = open(os.path.join(home, "formatter_missing.json")).read()
        self.assertEqual(json.loads(text), want)
        self.assertEqual(text, json.dumps(want, indent=1))


class DuplicateFilesTest(unittest.TestCase):
    def test_listed_file_equal_to_main_file_is_formatted_once(self):
        tmp = tempfile.mkdtemp()
        main_f = os.path.join(tmp, "a.py")
        other = os.path.join(tmp, "b.py")
        for p in (main_f, other):
            open(p, "w").write("x = 1\n")
        payload = {
            "tool_name": "apply_patch",
            "cwd": tmp,
            "tool_input": {"file_path": main_f, "files": [main_f, other, 7]},
        }
        seen = []
        with (
            mock.patch.object(
                format_after_edit,
                "_format_one",
                side_effect=lambda d: seen.append(d["tool_input"]["file_path"]) or 0,
            ),
            mock.patch.object(
                format_after_edit.atlas_hook_guard, "load_payload", return_value=payload
            ),
        ):
            self.assertEqual(format_after_edit.main(), 0)
        self.assertEqual(seen, [other, main_f])


class PyConfigWalkTest(unittest.TestCase):
    def test_no_marker_anywhere_returns_false_at_filesystem_root(self):
        tmp = tempfile.mkdtemp()
        visited = []

        def pred(d):
            visited.append(d)
            return False

        self.assertFalse(format_after_edit._py_config("a.py", tmp, pred))
        self.assertEqual(visited[0], tmp)
        self.assertEqual(visited[-1], os.path.dirname(visited[-1]))  # reached "/"

    def test_stops_at_git_root_without_checking_above(self):
        root = tempfile.mkdtemp()
        os.makedirs(os.path.join(root, ".git"))
        sub = os.path.join(root, "pkg")
        os.makedirs(sub)
        above = os.path.dirname(root)
        self.assertFalse(
            format_after_edit._py_config("a.py", sub, lambda d: d == above)
        )

    def test_finds_marker_in_ancestor_and_resolves_relative_path_against_cwd(self):
        root = tempfile.mkdtemp()
        sub = os.path.join(root, "pkg")
        os.makedirs(sub)
        self.assertTrue(
            format_after_edit._py_config("a.py", sub, lambda d: d == root)
        )
        self.assertTrue(
            format_after_edit._py_config("a.py", sub, lambda d: d == sub)
        )


if __name__ == "__main__":
    unittest.main()
