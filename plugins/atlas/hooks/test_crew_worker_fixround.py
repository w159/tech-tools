#!/usr/bin/env python3
"""crew_worker: a DONE older than the supervisor's fix message must not end the worker; stop() DONE carries the digest."""

import contextlib
import io
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import _test_isolation  # noqa: F401,E402
import atlas_irc  # noqa: E402
import crew_worker  # noqa: E402


def _run(fn, *a):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*a)
    return buf.getvalue()


class FixRoundTest(unittest.TestCase):
    def _setup(self, root, check):
        d = os.path.join(root, "irc")
        atlas_irc.init_bus(d, "#t", ["a", "b"])
        open(os.path.join(root, "a.py"), "w").write("x = 1\n")
        env = dict(ATLAS_IRC_DIR=d, ATLAS_IRC_NICK="a", ATLAS_CREW_ROOT=root, ATLAS_CREW_OWNS='["a.py"]',
                   ATLAS_CREW_CHECK=check, ATLAS_CREW_WORKER="a")
        return d, env

    def test_stale_done_does_not_end_fix_round(self):
        with tempfile.TemporaryDirectory() as root:
            d, env = self._setup(root, "false")
            with mock.patch.dict(os.environ, env):
                atlas_irc._announce_done(d, "a", "check passes")
                for r in atlas_irc.history(d):
                    atlas_irc.set_cursor(d, "a", r["seq"])
                atlas_irc.post(d, "lead", "a", "Global check fails (fix round 1).", kind="fix")
                payload = {"tool_name": "Bash", "tool_input": {"command": "pytest -q"}}
                out = _run(crew_worker.post_tool_use, payload)
                out2 = _run(crew_worker.post_tool_use, payload)
                self.assertNotIn('"continue": false', out + out2)
                stop_out = _run(crew_worker.stop, {})
                self.assertIn('"decision": "block"', stop_out)

    def test_fresh_done_after_fix_counts(self):
        with tempfile.TemporaryDirectory() as root:
            d, env = self._setup(root, "true")
            with mock.patch.dict(os.environ, env):
                atlas_irc.post(d, "lead", "a", "fix round 1", kind="fix")
                atlas_irc._announce_done(d, "a", "check passes")
                self.assertTrue(crew_worker._early_exit({"tool_name": "Bash"}, d, "a"))

    def test_stop_done_carries_digest(self):
        with tempfile.TemporaryDirectory() as root:
            d, env = self._setup(root, "true")
            with mock.patch.dict(os.environ, env):
                _run(crew_worker.stop, {})
                self.assertTrue(atlas_irc.done_current(d, "a"))
                rec = atlas_irc.latest_done_record(d, "a")
                self.assertIn("test_digest", rec)
                self.assertEqual(rec["test_digest"], atlas_irc.test_inputs_digest(root, os.environ.get("ATLAS_CREW_UNIT_CHECK") or ""))


if __name__ == "__main__":
    unittest.main()
