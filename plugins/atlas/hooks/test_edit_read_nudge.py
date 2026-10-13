"""edit_read_nudge: edit after ctx_read-only read nudges; builtin read silences it."""

import os as _o
import sys as _s

_s.path.insert(0, _o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import edit_read_nudge  # noqa: E402


def _fire(tool, path, sid, event):
    p = {"session_id": sid, "tool_name": tool, "cwd": "/w", "hook_event_name": event,
         "tool_input": {"path": path}}
    out = io.StringIO()
    with mock.patch.object(sys, "stdin", io.StringIO(json.dumps(p))), \
            mock.patch.object(sys, "stdout", out):
        edit_read_nudge.main()
    v = out.getvalue()
    return json.loads(v)["hookSpecificOutput"]["additionalContext"] if v else ""


class EditReadNudgeTest(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.env = mock.patch.dict(os.environ, {"ATLAS_HOOKSTATE_DIR": d})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_ctx_read_only_nudges(self):
        _fire("mcp__lean-ctx__ctx_read", "/w/a.py", "s1", "PostToolUse")
        out = _fire("edit", "/w/a.py", "s1", "PreToolUse")
        self.assertIn('read path="/w/a.py:N-M" before edit', out)
        self.assertIn("does not credit ctx_read", out)

    def test_builtin_read_silences(self):
        _fire("mcp__lean-ctx__ctx_read", "/w/a.py", "s2", "PostToolUse")
        _fire("read", "/w/a.py:1-20", "s2", "PostToolUse")
        self.assertEqual(_fire("edit", "/w/a.py", "s2", "PreToolUse"), "")

    def test_unread_file_silent(self):
        self.assertEqual(_fire("edit", "/w/b.py", "s3", "PreToolUse"), "")


if __name__ == "__main__":
    unittest.main()
