#!/usr/bin/env python3
"""crew_worker.long_sleep: only an actual `sleep N` command word is denied."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import crew_worker  # noqa: E402


class LongSleepCommandWordTest(unittest.TestCase):
    def test_real_sleep_commands_denied(self):
        for cmd in (
            "sleep 10",
            "cmd && sleep 5",
            "x; sleep 10s; y",
            "a | sleep 3",
            "echo hi\nsleep 4",
            "(sleep 5)",
            "time sleep 5",
            "bash -c 'sleep 10'",
        ):
            self.assertIsNotNone(crew_worker.long_sleep(cmd), cmd)

    def test_quoted_or_argument_text_passes(self):
        for cmd in (
            "grep 'sleep 10' log.txt",
            'echo "sleep 5"',
            "grep -n sleep 10 log.txt",
            "git log --grep='sleep 30'",
            "sleep 1",
        ):
            self.assertIsNone(crew_worker.long_sleep(cmd), cmd)

    def test_returns_the_sleep_text_as_written(self):
        self.assertEqual(crew_worker.long_sleep("a && sleep 45 && b"), "sleep 45")


class _IrcEnvCase(unittest.TestCase):
    """A real irc bus in a tempdir; env restored after each test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.d = Path(self._tmp.name) / "bus"
        crew_worker.atlas_irc.init_bus(self.d, "#team", ["w1"])
        env = {"ATLAS_IRC_DIR": str(self.d), "ATLAS_IRC_NICK": "w1", "ATLAS_CREW_ROOT": self._tmp.name}
        p = mock.patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)
        for k in ("ATLAS_CREW_CHECK", "ATLAS_CREW_MAX_BLOCKS"):
            os.environ.pop(k, None)

    def state(self):
        return json.loads((self.d / "stop" / "w1.json").read_text())


class EnvJsonTest(unittest.TestCase):
    def test_unset_or_invalid_returns_default_and_valid_parses(self):
        sentinel = {"d": 1}
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ATLAS_T_ENV_JSON", None)
            self.assertIs(crew_worker._env_json("ATLAS_T_ENV_JSON", sentinel), sentinel)
            os.environ["ATLAS_T_ENV_JSON"] = "{not json"
            self.assertIs(crew_worker._env_json("ATLAS_T_ENV_JSON", sentinel), sentinel)
            os.environ["ATLAS_T_ENV_JSON"] = '["a"]'
            self.assertEqual(crew_worker._env_json("ATLAS_T_ENV_JSON", sentinel), ["a"])


class StatePathTest(unittest.TestCase):
    def test_requires_both_dir_and_nick(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            for k in ("ATLAS_IRC_DIR", "ATLAS_IRC_NICK"):
                os.environ.pop(k, None)
            self.assertIsNone(crew_worker._state_path())
            os.environ["ATLAS_IRC_DIR"] = "/x"
            self.assertIsNone(crew_worker._state_path())
            del os.environ["ATLAS_IRC_DIR"]
            os.environ["ATLAS_IRC_NICK"] = "w1"
            self.assertIsNone(crew_worker._state_path())
            os.environ["ATLAS_IRC_DIR"] = "/x"
            self.assertEqual(crew_worker._state_path(), Path("/x/stop/w1.json"))


class SetBlocksTest(_IrcEnvCase):
    def test_creates_missing_parents_and_tolerates_existing_dir(self):
        d = Path(self._tmp.name) / "deep" / "er"  # neither level exists: parents=True needed
        with mock.patch.dict(os.environ, {"ATLAS_IRC_DIR": str(d)}):
            crew_worker._set_blocks(1)
            crew_worker._set_blocks(2, passed=True)  # stop/ exists now: exist_ok=True needed
            self.assertEqual(json.loads((d / "stop" / "w1.json").read_text()), {"blocks": 2, "passed": True})
            self.assertEqual(crew_worker._blocks(), 2)


class StopCheckVerdictTest(_IrcEnvCase):
    def test_passing_check_records_passed_true(self):
        os.environ["ATLAS_CREW_CHECK"] = "true"
        crew_worker.stop({})
        self.assertIs(self.state()["passed"], True)

    def test_failing_check_past_cap_records_passed_false(self):
        os.environ["ATLAS_CREW_CHECK"] = "false"
        os.environ["ATLAS_CREW_MAX_BLOCKS"] = "1"
        crew_worker._set_blocks(1)
        crew_worker.stop({})
        self.assertIs(self.state()["passed"], False)


class MainExitCodeTest(unittest.TestCase):
    def test_main_returns_zero_for_unknown_event_and_empty_stdin(self):
        with mock.patch.object(sys, "argv", ["crew_worker.py", "Nope"]), mock.patch.object(
            sys, "stdin", mock.Mock(read=lambda: "")
        ):
            self.assertEqual(crew_worker.main(), 0)


class RunCheckTest(unittest.TestCase):
    def test_captures_stdout_and_stderr_with_exit_code(self):
        with tempfile.TemporaryDirectory() as td:
            code, out = crew_worker.run_check("echo hi; echo err >&2; exit 3", td)
        self.assertEqual(code, 3)
        self.assertEqual(out, "hi\nerr\n")


class EarlyExitTest(_IrcEnvCase):
    def test_false_unless_bash_with_check_and_done(self):
        os.environ["ATLAS_CREW_CHECK"] = "true"
        self.assertIs(crew_worker._early_exit({"tool_name": "Bash"}, str(self.d), "w1"), False)  # no DONE yet
        crew_worker.atlas_irc.post(str(self.d), "w1", "#team", "DONE w1", kind="done")
        self.assertIs(crew_worker._early_exit({"tool_name": "Read"}, str(self.d), "w1"), False)
        del os.environ["ATLAS_CREW_CHECK"]
        self.assertIs(crew_worker._early_exit({"tool_name": "Bash"}, str(self.d), "w1"), False)


class MainDispatchTest(unittest.TestCase):
    def run_main(self, argv):
        with mock.patch.object(sys, "argv", argv), mock.patch.object(
            sys, "stdin", mock.Mock(read=lambda: "{}")
        ), mock.patch.object(crew_worker, "stop") as stop:
            self.assertEqual(crew_worker.main(), 0)
        return stop

    def test_event_argument_selects_handler(self):
        self.run_main(["crew_worker.py", "Stop"]).assert_called_once_with({})
        self.run_main(["crew_worker.py"]).assert_not_called()


if __name__ == "__main__":
    unittest.main()
