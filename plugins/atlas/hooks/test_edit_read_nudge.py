"""edit_read_nudge: edit after ctx_read-only read nudges; builtin read silences it."""

import os as _o
import sys as _s

_s.path.insert(
    0, _o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "..", "scripts")
)
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


W = tempfile.mkdtemp()
for _n in ("a.py", "b.py", "notes:2024"):
    open(os.path.join(W, _n), "w").close()


def _fire(tool, path, sid, event):
    path = path.replace("/w/", W + "/")
    p = {
        "session_id": sid,
        "tool_name": tool,
        "cwd": W,
        "hook_event_name": event,
        "tool_input": {"path": path},
    }
    out = io.StringIO()
    with (
        mock.patch.object(sys, "stdin", io.StringIO(json.dumps(p))),
        mock.patch.object(sys, "stdout", out),
    ):
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
        self.assertIn('read path="%s/a.py:N-M" before edit' % W, out)
        self.assertIn("does not credit ctx_read", out)

    def test_nudge_records_the_unread_reason_once(self):
        home = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}):
            _fire("mcp__lean-ctx__ctx_read", "/w/b.py", "s9", "PostToolUse")
            self.assertTrue(_fire("edit", "/w/b.py", "s9", "PreToolUse"))
            self.assertEqual(
                _fire("edit", "/w/b.py", "s9", "PreToolUse"), ""
            )  # repeat: not emitted
            _fire("read", "/w/a.py", "s9", "PostToolUse")
            _fire("edit", "/w/a.py", "s9", "PreToolUse")  # no nudge
        lines = (
            open(os.path.join(home, "analytics", "events.jsonl")).read().splitlines()
        )
        self.assertEqual(
            [json.loads(x)["k"] for x in lines], ["hook.edit_read_nudge.context.unread"]
        )

    def test_builtin_read_silences(self):
        _fire("mcp__lean-ctx__ctx_read", "/w/a.py", "s2", "PostToolUse")
        _fire("read", "/w/a.py:1-20", "s2", "PostToolUse")
        self.assertEqual(_fire("edit", "/w/a.py", "s2", "PreToolUse"), "")

    def test_colon_digits_in_real_filename_not_mangled(self):
        n = edit_read_nudge._norm(
            {"cwd": W, "tool_input": {"path": os.path.join(W, "notes:2024")}}
        )
        self.assertEqual(n, os.path.join(W, "notes:2024"))

    def test_selector_stripped_only_when_stripped_path_exists(self):
        sel = edit_read_nudge._norm({"cwd": W, "tool_input": {"path": "a.py:1-20"}})
        self.assertEqual(sel, os.path.join(W, "a.py"))
        gone = edit_read_nudge._norm({"cwd": W, "tool_input": {"path": "nope.py:5"}})
        self.assertEqual(gone, os.path.join(W, "nope.py:5"))

    def test_unread_file_silent(self):
        self.assertEqual(_fire("edit", "/w/b.py", "s3", "PreToolUse"), "")


def _main(payload):
    """Run main() on a payload; return (exit code, stdout)."""
    out = io.StringIO()
    with (
        mock.patch.object(sys, "stdin", io.StringIO(json.dumps(payload))),
        mock.patch.object(sys, "stdout", out),
    ):
        rc = edit_read_nudge.main()
    return rc, out.getvalue()


class NormTest(unittest.TestCase):
    def test_non_path_targets_yield_none(self):
        for ti in (
            {},
            {"path": ""},
            {"path": 5},
            {"file_path": ["a"]},
            {"path": "https://example.com/a.py"},
            {"file_path": "xd://dev/a"},
        ):
            self.assertIsNone(edit_read_nudge._norm({"cwd": W, "tool_input": ti}), ti)
        self.assertIsNone(edit_read_nudge._norm({"cwd": W}))
        self.assertIsNone(edit_read_nudge._norm({"cwd": W, "tool_input": None}))

    def test_file_path_wins_over_path_and_is_normalised(self):
        n = edit_read_nudge._norm(
            {"cwd": W, "tool_input": {"file_path": "sub/../a.py", "path": "b.py"}}
        )
        self.assertEqual(n, os.path.join(W, "a.py"))

    def test_absolute_path_ignores_cwd(self):
        n = edit_read_nudge._norm(
            {"cwd": "/elsewhere", "tool_input": {"path": os.path.join(W, "a.py")}}
        )
        self.assertEqual(n, os.path.join(W, "a.py"))

    def test_missing_cwd_falls_back_to_process_cwd(self):
        with mock.patch.object(os, "getcwd", return_value=W):
            n = edit_read_nudge._norm({"tool_input": {"path": "a.py"}})
        self.assertEqual(n, os.path.join(W, "a.py"))

    def test_selector_forms_stripped_when_target_exists(self):
        for sel in ("a.py:1-20", "a.py:5", "a.py:1,3", "a.py:+4", "a.py:10-"):
            self.assertEqual(
                edit_read_nudge._norm({"cwd": W, "tool_input": {"path": sel}}),
                os.path.join(W, "a.py"),
                sel,
            )

    def test_non_numeric_suffix_not_stripped(self):
        n = edit_read_nudge._norm({"cwd": W, "tool_input": {"path": "a.py:abc"}})
        self.assertEqual(n, os.path.join(W, "a.py:abc"))


class MainContractTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        env = mock.patch.dict(os.environ, {"ATLAS_HOOKSTATE_DIR": self.dir})
        env.start()
        self.addCleanup(env.stop)

    def _state_files(self):
        return [f for f in os.listdir(self.dir) if not f.endswith(".lock")]

    def _p(self, tool, path="a.py", sid="m1", **kw):
        p = {
            "session_id": sid,
            "tool_name": tool,
            "cwd": W,
            "tool_input": {"path": path},
        }
        p.update(kw)
        return p

    def test_main_always_returns_zero(self):
        cases = [
            self._p("edit", sid=None),  # no session
            self._p("edit", sid=""),
            self._p("edit", path=""),  # no target
            self._p("read"),  # record a read
            self._p("mcp__lean-ctx__ctx_read"),  # record a ctx read
            self._p("edit"),  # nudge branch
            self._p("edit"),  # repeat, suppressed
            self._p("bash"),  # unrelated tool
            {"cwd": W},  # empty payload
        ]
        for c in cases:
            rc, _ = _main(c)
            self.assertEqual(rc, 0, c)

    def test_missing_session_or_target_records_and_emits_nothing(self):
        _main(self._p("mcp__lean-ctx__ctx_read", sid=None))
        _main(self._p("mcp__lean-ctx__ctx_read", path="", sid="m1"))
        rc, out = _main(self._p("edit", sid="m1"))
        self.assertEqual((rc, out), (0, ""))
        self.assertEqual(self._state_files(), [])

    def test_multiedit_nudges_like_edit(self):
        _main(self._p("ctx_read"))
        _, out = _main(self._p("MultiEdit"))
        self.assertIn("does not credit ctx_read", out)

    def test_tool_name_case_insensitive_and_ctx_suffix(self):
        _main(self._p("Read"))  # builtin, capital R
        _main(self._p("mcp__lean-ctx__CTX_READ"))  # ctx, mixed case
        _, out = _main(self._p("EDIT"))
        self.assertEqual(out, "")  # builtin read silences

    def test_unrelated_tool_never_records(self):
        _main(self._p("bash"))
        _main(self._p("grep"))
        _main(self._p("readme"))  # not endswith ctx_read, not read
        self.assertEqual(self._state_files(), [])

    def test_reads_are_per_session(self):
        _main(self._p("ctx_read", sid="one"))
        _, out_other = _main(self._p("edit", sid="two"))
        _, out_same = _main(self._p("edit", sid="one"))
        self.assertEqual(out_other, "")
        self.assertIn("a.py", out_same)

    def test_read_recorded_once_and_per_path(self):
        _main(self._p("ctx_read"))
        _main(self._p("ctx_read"))
        _main(self._p("ctx_read", path="b.py"))
        import atlas_hook_guard

        state = atlas_hook_guard._load_state("m1")
        self.assertEqual(
            state["reads"]["ctx"], [os.path.join(W, "a.py"), os.path.join(W, "b.py")]
        )
        self.assertNotIn("builtin", state["reads"])

    def test_edit_does_not_record_a_read(self):
        _main(self._p("edit"))
        self.assertEqual(self._state_files(), [])


if __name__ == "__main__":
    unittest.main()
