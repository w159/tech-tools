import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import atlas_faults  # noqa: E402


class FaultsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)
        self.path = os.path.join(self.tmp.name, "hook-faults.jsonl")

    def test_record_and_load(self):
        atlas_faults.record("h", ValueError("boom"), "/x")
        lines = open(self.path).read().splitlines()
        self.assertEqual(len(lines), 1)
        rec = json.loads(lines[0])
        self.assertEqual(
            (rec["hook"], rec["error"], rec["type"], rec["cwd"]),
            ("h", "boom", "ValueError", "/x"),
        )
        self.assertIn("ts", rec)
        self.assertEqual(len(atlas_faults.load(0)), 1)
        self.assertEqual(atlas_faults.load(rec["ts"] + 10), [])

    def test_never_raises(self):
        with mock.patch.dict(os.environ, {"ATLAS_HOME": "/dev/null/x"}):
            atlas_faults.record("h", RuntimeError("x"))
            self.assertEqual(atlas_faults.load(0), [])

    def test_load_missing_and_garbage(self):
        self.assertEqual(atlas_faults.load(0), [])
        with open(self.path, "w") as f:
            f.write("not json\n" + json.dumps({"ts": 5, "hook": "a"}) + "\n")
        self.assertEqual(len(atlas_faults.load(0)), 1)

    def test_truncates_keeping_newest(self):
        big = "x" * 1000
        for i in range(3000):
            atlas_faults.record("h", RuntimeError(f"{i}:{big}"))
        self.assertLessEqual(os.path.getsize(self.path), atlas_faults.MAX_BYTES)
        recs = atlas_faults.load(0)
        self.assertTrue(recs[-1]["error"].startswith("2999:"))
        self.assertLess(len(recs), 3000)
        self.assertGreater(len(recs), 100)  # newest half retained, not wiped

    def test_hook_crash_leaves_one_line_and_exit_0(self):
        spec = importlib.util.spec_from_file_location(
            "todo_capture_t", os.path.join(HERE, "..", "hooks", "todo_capture.py")
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        payload = json.dumps(
            {
                "tool_name": "TodoWrite",
                "tool_input": {"todos": []},
                "cwd": "/p",
                "session_id": "s",
            }
        )
        out = io.StringIO()
        with (
            mock.patch.object(
                mod.atlas_todo, "mirror", side_effect=RuntimeError("forced")
            ),
            mock.patch("sys.stdin", io.StringIO(payload)),
            contextlib.redirect_stdout(out),
        ):
            rc = mod.main()
        self.assertEqual(rc, 0)
        self.assertEqual(out.getvalue(), "")
        recs = atlas_faults.load(0)
        self.assertEqual(len(recs), 1)
        self.assertEqual(
            (recs[0]["hook"], recs[0]["error"]), ("todo_capture", "forced")
        )

    def test_load_skips_bad_lines(self):
        good = json.dumps({"ts": 5.0, "hook": "a"})
        with open(self.path, "w") as f:
            f.write(good + "\n" + json.dumps({"ts": "x"}) + "\n[1]\nnot json\n" + good + "\n")
        self.assertEqual(len(atlas_faults.load(0)), 2)

    def test_truncate_failure_leaves_no_tmp(self):
        with open(self.path, "wb") as f:
            f.write(b"a\nb\nc\nd\n")
        with mock.patch("os.replace", side_effect=OSError("x")):
            with self.assertRaises(OSError):
                atlas_faults._truncate(self.path)
        self.assertFalse(os.path.exists(self.path + ".tmp"))


if __name__ == "__main__":
    unittest.main()
