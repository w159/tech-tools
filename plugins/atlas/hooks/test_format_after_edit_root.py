#!/usr/bin/env python3
"""format_after_edit with payload cwd "/" must not format files outside a project."""

import os as _os
import sys as _sys

_sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import format_after_edit  # noqa: E402


class RootCwdTests(unittest.TestCase):
    def test_cwd_slash_formats_nothing(self):
        with tempfile.TemporaryDirectory() as home:
            f = os.path.join(home, "elsewhere", "a.py")
            os.makedirs(os.path.dirname(f))
            open(f, "w").write("x=1\n")
            payload = {"tool_name": "Edit", "tool_input": {"file_path": f}, "cwd": "/"}
            ran = []
            with mock.patch.dict(os.environ, {"HOME": home}), \
                 mock.patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                 mock.patch.object(format_after_edit.shutil, "which", return_value="/usr/bin/ruff"), \
                 mock.patch.object(format_after_edit.subprocess, "run", side_effect=lambda *a, **k: ran.append(a) or mock.Mock(returncode=0, stderr="")):
                self.assertEqual(format_after_edit.main(), 0)
            self.assertEqual(ran, [])


if __name__ == "__main__":
    unittest.main()
