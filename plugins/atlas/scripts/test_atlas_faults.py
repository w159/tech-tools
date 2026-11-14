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

    def test_guard_fault_row_carries_plugin_version(self):
        import atlas_hook_guard

        manifest = os.path.join(HERE, "..", ".claude-plugin", "plugin.json")
        want = json.load(open(manifest))["version"]
        atlas_hook_guard.fault("h", "boom", "/x")
        self.assertEqual(atlas_faults.load(0)[0]["plugin_version"], want)

    def test_unreadable_manifest_omits_version_and_row_without_it_loads(self):
        with mock.patch("json.load", side_effect=ValueError("bad")):
            self.assertIsNone(atlas_faults._plugin_version())
            atlas_faults.record("h", ValueError("boom"), "/x")
        rec = atlas_faults.load(0)[0]
        self.assertNotIn("plugin_version", rec)
        self.assertEqual(rec["error"], "boom")

    def test_never_raises(self):
        with mock.patch.dict(os.environ, {"ATLAS_HOME": "/dev/null/x"}):
            atlas_faults.record("h", RuntimeError("x"))
            self.assertEqual(atlas_faults.load(0), [])

    def test_pytest_skips_default_home_but_not_redirected_home(self):
        env = {"PYTEST_CURRENT_TEST": "t (call)", "HOME": self.tmp.name}
        with mock.patch.dict(os.environ, env):
            os.environ.pop("ATLAS_HOME", None)
            atlas_faults.record("h", RuntimeError("x"))
            self.assertFalse(
                os.path.exists(
                    os.path.join(self.tmp.name, ".atlas", "hook-faults.jsonl")
                )
            )
            os.environ["ATLAS_HOME"] = self.tmp.name
            atlas_faults.record("h", RuntimeError("x"))
            self.assertEqual(len(atlas_faults.load(0)), 1)

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
            f.write(
                good
                + "\n"
                + json.dumps({"ts": "x"})
                + "\n[1]\nnot json\n"
                + good
                + "\n"
            )
        self.assertEqual(len(atlas_faults.load(0)), 2)

    def test_truncate_failure_leaves_no_tmp(self):
        with open(self.path, "wb") as f:
            f.write(b"a\nb\nc\nd\n")
        with mock.patch("os.replace", side_effect=OSError("x")):
            with self.assertRaises(OSError):
                atlas_faults._truncate(self.path)
        self.assertFalse(os.path.exists(self.path + ".tmp"))


class FaultCounterTest(unittest.TestCase):
    """fault.<component>.<errclass> goes through atlas_analytics_hot; only closed-set text reaches a key."""

    def _record(self, hook, exc):
        hot = mock.MagicMock()
        with tempfile.TemporaryDirectory() as home, mock.patch.dict(
            sys.modules, {"atlas_analytics_hot": hot}
        ), mock.patch.dict(os.environ, {"ATLAS_HOME": home}):
            atlas_faults.record(hook, exc, "/x")
        return [c.args[0] for c in hot.record.call_args_list]

    def test_errclass_table(self):
        import socket
        import subprocess

        cases = [
            (TimeoutError("t"), "timeout"),
            (socket.timeout("t"), "timeout"),
            (subprocess.TimeoutExpired("c", 1), "timeout"),
            (PermissionError("p"), "permission"),
            (FileNotFoundError("f"), "notfound"),
            (json.JSONDecodeError("m", "d", 0), "json"),
            (ModuleNotFoundError("m"), "import"),
            (ImportError("i"), "import"),
            (subprocess.CalledProcessError(1, "c"), "subprocess"),
            (OSError("o"), "oserror"),
            (ValueError("v"), "value"),
            (KeyError("k"), "key"),
            (TypeError("t"), "type"),
            (AttributeError("a"), "attribute"),
            (RuntimeError("r"), "runtime"),
            (Exception("e"), "other"),
        ]
        for exc, want in cases:
            self.assertEqual(atlas_faults.errclass(exc), want, repr(exc))

    def test_record_counts_component_before_first_dot(self):
        self.assertEqual(
            self._record("worker_report_gate.finish_member", ValueError("secret /home/u/proj")),
            [["fault.worker_report_gate.value"]],
        )

    def test_component_with_other_chars_is_dropped(self):
        for hook in ("Bad-Name.x", "has space", "/home/u/proj", ""):
            self.assertEqual(self._record(hook, ValueError("v")), [], hook)

    def test_counter_failure_never_raises(self):
        hot = mock.MagicMock()
        hot.record.side_effect = RuntimeError("boom")
        with tempfile.TemporaryDirectory() as home, mock.patch.dict(
            sys.modules, {"atlas_analytics_hot": hot}
        ), mock.patch.dict(os.environ, {"ATLAS_HOME": home}):
            atlas_faults.record("h", ValueError("v"), "/x")
            self.assertEqual(len(atlas_faults.load(0)), 1)  # the local log is still written
        hot.record.assert_called_once()

    def test_hot_writer_lands_a_line_when_enabled(self):
        with tempfile.TemporaryDirectory() as home:
            env = {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}
            with mock.patch.dict(os.environ, env):
                atlas_faults.record("event_dispatch.run", KeyError("k"), "/x")
            lines = open(os.path.join(home, "analytics", "events.jsonl")).read().splitlines()
        self.assertEqual([json.loads(x)["k"] for x in lines], ["fault.event_dispatch.key"])


if __name__ == "__main__":
    unittest.main()
