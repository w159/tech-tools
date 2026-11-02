#!/usr/bin/env python3
"""crew_worker.long_sleep: only an actual `sleep N` command word is denied."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

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


if __name__ == "__main__":
    unittest.main()
