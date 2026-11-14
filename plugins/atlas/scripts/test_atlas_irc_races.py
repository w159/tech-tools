#!/usr/bin/env python3
"""atlas_irc: drain must not skip a message posted mid-drain; a re-edited, re-passed worker posts a fresh DONE."""

import argparse
import os
import tempfile
import unittest
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_irc


class DrainRaceTests(unittest.TestCase):
    def test_message_posted_between_reads_is_not_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            atlas_irc.init_bus(d, "#t", ["a", "b"])
            atlas_irc.post(d, "a", "#t", "hello from a")  # nothing visible to a
            real = atlas_irc.history
            calls = {"n": 0}

            def racy(dd, after=0):
                out = real(dd, after)
                calls["n"] += 1
                if calls["n"] == 1:
                    atlas_irc.post(d, "b", "a", "question for a")
                return out

            with mock.patch.object(atlas_irc, "history", racy):
                self.assertEqual(atlas_irc.drain(d, "a"), [])
            got = atlas_irc.drain(d, "a")
            self.assertEqual([r["text"] for r in got], ["question for a"])


class ReannounceDoneTests(unittest.TestCase):
    def test_second_pass_after_edit_posts_fresh_digest(self):
        with tempfile.TemporaryDirectory() as root:
            d = os.path.join(root, "irc")
            atlas_irc.init_bus(d, "#t", ["a"])
            open(os.path.join(root, "a.py"), "w").write("x = 1\n")
            env = dict(ATLAS_IRC_DIR=d, ATLAS_IRC_NICK="a", ATLAS_CREW_ROOT=root,
                       ATLAS_CREW_OWNS='["a.py"]', ATLAS_CREW_UNIT_CHECK="true")
            ns = argparse.Namespace(dir=d, as_="a", timeout=5)
            with mock.patch.dict(os.environ, env):
                self.assertEqual(atlas_irc.cmd_check(ns), 0)
                open(os.path.join(root, "a.py"), "w").write("x = 2\n")
                self.assertFalse(atlas_irc.done_current(d, "a"))
                self.assertEqual(atlas_irc.cmd_check(ns), 0)
                self.assertTrue(atlas_irc.done_current(d, "a"))
                self.assertEqual(len([r for r in atlas_irc.history(d) if r.get("kind") == "done"]), 2)
                self.assertEqual(atlas_irc.cmd_check(ns), 0)  # unchanged: no third DONE
                self.assertEqual(len([r for r in atlas_irc.history(d) if r.get("kind") == "done"]), 2)


if __name__ == "__main__":
    unittest.main()
