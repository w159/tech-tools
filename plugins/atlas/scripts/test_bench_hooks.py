"""Tests for bench_hooks.py: payload set, matcher/argv helpers, p90, timing wrapper and main() report.

The subprocess calls (hook processes, git init) are mocked; only the report/decision logic runs."""

import _test_isolation  # noqa: F401  (must be first)

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bench_hooks as bh  # noqa: E402


class PayloadTests(unittest.TestCase):
    def test_payload_events_and_tools(self):
        ps = bh.payloads("/w")
        keys = [(ev, tool) for ev, tool, _ in ps]
        self.assertEqual(
            keys,
            [
                ("SessionStart", None), ("UserPromptSubmit", None), ("PreToolUse", "Bash"),
                ("PreToolUse", "Read"), ("PreToolUse", "Edit"), ("PreToolUse", "Agent"),
                ("PostToolUse", "Edit"), ("PostToolUse", "Read"), ("PostToolUse", "Bash"), ("Stop", None),
            ],
        )

    def test_payload_contents(self):
        for ev, tool, pl in bh.payloads("/w"):
            self.assertEqual(pl["hook_event_name"], ev)
            self.assertEqual(pl["cwd"], "/w")
            self.assertEqual(pl["session_id"], "bench")
            self.assertEqual(pl["transcript_path"], "/w/t.jsonl")
            if tool:
                self.assertEqual(pl["tool_name"], tool)
                self.assertEqual(pl["tool_response"], {"success": True})
        by = {(e, t): p for e, t, p in bh.payloads("/w")}
        self.assertEqual(by[("PreToolUse", "Read")]["tool_input"], {"file_path": "/w/a.py"})
        self.assertEqual(by[("PreToolUse", "Bash")]["tool_input"], {"command": "ls -la"})
        self.assertEqual(by[("SessionStart", None)]["source"], "startup")
        self.assertEqual(by[("UserPromptSubmit", None)]["prompt"], "fix the bug")
        self.assertIs(by[("Stop", None)]["stop_hook_active"], False)
        self.assertNotIn("tool_name", by[("Stop", None)])


class HelperTests(unittest.TestCase):
    def test_matches(self):
        self.assertTrue(bh.matches(None, "Bash"))
        self.assertTrue(bh.matches("", None))
        self.assertTrue(bh.matches("*", "Anything"))
        self.assertTrue(bh.matches("Edit|Write", "Edit"))
        self.assertTrue(bh.matches("Edit|Write", "Write"))

    def test_matches_requires_full_match_and_a_tool(self):
        self.assertFalse(bh.matches("Edit", "EditNotebook"))
        self.assertFalse(bh.matches("Edit", "MultiEdit"))
        self.assertFalse(bh.matches("Edit", None))
        self.assertFalse(bh.matches("Bash", "Read"))

    def test_to_argv_expands_root_and_splits_quotes(self):
        argv = bh.to_argv('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/x y.py" --flag', "/r o")
        self.assertEqual(argv, ["python3", "/r o/hooks/x y.py", "--flag"])

    def test_to_argv_expands_every_occurrence(self):
        self.assertEqual(bh.to_argv("a ${CLAUDE_PLUGIN_ROOT}/b ${CLAUDE_PLUGIN_ROOT}/c", "/R"), ["a", "/R/b", "/R/c"])

    def test_p90(self):
        self.assertEqual(bh.p90([5]), 5)
        self.assertEqual(bh.p90(list(range(1, 11))), 10)  # int(10*0.9)=9 -> sorted[9]
        self.assertEqual(bh.p90([10, 1, 5, 3, 2, 4, 9, 8, 7, 6]), 10)
        self.assertEqual(bh.p90([3, 1, 2]), 3)  # int(2.7)=2
        self.assertEqual(bh.p90(list(range(1, 21))), 19)  # int(18.0)=18 -> 19

    def test_run_returns_ms_and_passes_payload_env_cwd(self):
        with mock.patch.object(bh.subprocess, "run") as sr, mock.patch.object(
            bh.time, "perf_counter", side_effect=[1.0, 1.25]
        ):
            ms = bh.run(["x", "y"], {"k": 1}, {"E": "1"}, "/cwd")
        self.assertAlmostEqual(ms, 250.0)
        args, kw = sr.call_args
        self.assertEqual(args[0], ["x", "y"])
        self.assertEqual(json.loads(kw["input"]), {"k": 1})
        self.assertEqual(kw["env"], {"E": "1"})
        self.assertEqual(kw["cwd"], "/cwd")
        self.assertEqual(kw["timeout"], 60)
        self.assertTrue(kw["capture_output"] and kw["text"])

    def test_run_splits_string_commands(self):
        with mock.patch.object(bh.subprocess, "run") as sr:
            bh.run("echo 'a b'", {}, {}, "/")
        self.assertEqual(sr.call_args[0][0], ["echo", "a b"])


def _hooks_json(root, hooks):
    (Path(root) / "hooks").mkdir(parents=True, exist_ok=True)
    (Path(root) / "hooks" / "hooks.json").write_text(json.dumps({"hooks": hooks}))


class MainTests(unittest.TestCase):
    def _run_main(self, hooks, n=2, timings=None):
        """Run main() with all process spawning mocked. timings maps basename -> ms."""
        timings = timings or {}
        calls = []
        with tempfile.TemporaryDirectory() as root:
            _hooks_json(root, hooks)

            def fake_run(cmd, payload, env, cwd):
                calls.append((cmd, payload))
                return float(timings.get(Path(cmd[-1]).name, 10))

            buf = io.StringIO()
            argv = ["bench_hooks.py", "-n", str(n), "--root", root]
            with mock.patch.object(sys, "argv", argv), mock.patch.object(bh, "run", fake_run), mock.patch.object(
                bh.subprocess, "run"
            ) as git, contextlib.redirect_stdout(buf):
                rc = bh.main()
        return rc, buf.getvalue(), calls, git

    def _cmd(self, name):
        return {"command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/" + name}

    def test_report_aggregates_per_event_and_tool(self):
        hooks = {
            "PreToolUse": [
                {"matcher": "Read", "hooks": [self._cmd("a.py")]},
                {"matcher": "Bash|Read", "hooks": [self._cmd("b.py"), {**self._cmd("c.py"), "async": True}]},
            ],
            "PostToolUse": [{"matcher": "*", "hooks": [self._cmd("d.py")]}],
        }
        rc, out, calls, git = self._run_main(hooks, n=3, timings={"a.py": 10, "b.py": 20, "c.py": 40, "d.py": 5})
        self.assertIsNone(rc)
        self.assertIn("python3 floor: median 10 ms", out)
        lines = {l.split("  ")[0].strip(): l for l in out.splitlines() if l.startswith(("PreToolUse", "PostToolUse"))}
        read = lines["PreToolUse Read"]
        # three hooks match Read: total 70, wall (slowest) 40, block excludes the async one = 30
        self.assertRegex(read, r"PreToolUse Read\s+3\s+70\s+70\s+40\s+30\s+a=10 b=20 c=40")
        bash = lines["PreToolUse Bash"]
        self.assertRegex(bash, r"PreToolUse Bash\s+2\s+60\s+60\s+40\s+20\s+b=20 c=40")
        edit = lines["PreToolUse Edit"]
        self.assertRegex(edit, r"PreToolUse Edit\s+0\s+0\s+0\s+0\s+0")
        self.assertRegex(lines["PostToolUse Read"], r"PostToolUse Read\s+1\s+5\s+5\s+5\s+5\s+d=5")
        self.assertIn("Read     total    75 ms   block    35 ms", out)
        self.assertIn("Bash     total    65 ms   block    25 ms", out)
        self.assertIn("Edit     total     5 ms   block     5 ms", out)
        git.assert_called_once()
        self.assertEqual(git.call_args[0][0][:3], ["git", "init", "-q"])

    def test_n_controls_number_of_runs_and_payload_routing(self):
        hooks = {"SessionStart": [{"hooks": [self._cmd("s.py")]}]}
        rc, out, calls, _ = self._run_main(hooks, n=4)
        starts = [p for c, p in calls if c[-1].endswith("s.py")]
        self.assertEqual(len(starts), 4)
        self.assertTrue(all(p["hook_event_name"] == "SessionStart" for p in starts))
        floor = [c for c, _ in calls if c[:1] == ["python3"] and c[1:] == ["-c", "pass"]]
        self.assertEqual(len(floor), 4)
        self.assertRegex(out, r"SessionStart\s+1\s+10\s+10\s+10\s+10\s+s=10")

    def test_empty_hooks_file_reports_zero_everywhere(self):
        rc, out, calls, _ = self._run_main({}, n=2)
        self.assertIn("Read     total     0 ms   block     0 ms", out)
        self.assertEqual(len([c for c, _ in calls if c[1:] == ["-c", "pass"]]), 2)

    def test_default_root_is_the_plugin_dir(self):
        src = Path(bh.__file__).resolve().parent.parent
        self.assertTrue((src / "hooks" / "hooks.json").is_file())
        with mock.patch.object(sys, "argv", ["bench_hooks.py"]), mock.patch.object(
            bh.json, "load", side_effect=RuntimeError("stop")
        ), mock.patch("builtins.open", mock.mock_open()) as op:
            with self.assertRaises(RuntimeError):
                bh.main()
        self.assertEqual(op.call_args[0][0], str(src / "hooks" / "hooks.json"))


if __name__ == "__main__":
    unittest.main()
