#!/usr/bin/env python3
"""atlas_analytics_hot: key charset (counter keys such as crew.rounds.3+ and team.size.9+ must be accepted)."""

import json
import os
import sys
import tempfile
import unittest
from unittest import mock

import _test_isolation  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_analytics_hot as hot  # noqa: E402


class KeyCharsTest(unittest.TestCase):
    def test_plus_keys_are_written_and_bad_chars_are_not(self):
        with tempfile.TemporaryDirectory() as home:
            with mock.patch.dict(os.environ, {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}):
                hot.record(["crew.rounds.3+", "team.size.9+", "bad key", "a/b", "x;y"])
            path = os.path.join(home, "analytics", "events.jsonl")
            keys = [json.loads(x)["k"] for x in open(path).read().splitlines()]
        self.assertEqual(keys, ["crew.rounds.3+", "team.size.9+"])


if __name__ == "__main__":
    unittest.main()
