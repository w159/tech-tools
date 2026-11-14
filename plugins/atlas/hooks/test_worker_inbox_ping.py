#!/usr/bin/env python3
"""worker_inbox._is_ping: bare acknowledgements are filtered; an ack word followed by an instruction is delivered."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import _test_isolation  # noqa: F401,E402
import worker_inbox  # noqa: E402


class IsPingTest(unittest.TestCase):
    def test_bare_acks_filtered(self):
        for t in ("ok", "done", "working on it", "starting", "ok, on it", "joined", "Done.", "in progress 45%"):
            self.assertTrue(worker_inbox._is_ping({"text": t}), t)

    def test_ack_with_instruction_delivered(self):
        for t in (
            "ok, also update the README before you finish",
            "done with auth; switch to the cache module next",
            "working on it - do not touch kit/b.py, I own it now",
            "starting: use sha256 not md5",
            "ok 请停止",
            "ok, остановись",
            "started: 请回滚",
            "ok check tests",
            "ok, check the tests",
            "done check the channel",
        ):
            self.assertFalse(worker_inbox._is_ping({"text": t}), t)


if __name__ == "__main__":
    unittest.main()
