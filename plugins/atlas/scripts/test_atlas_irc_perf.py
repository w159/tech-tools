#!/usr/bin/env python3
"""atlas_irc hot paths: history(after) reads the log tail, not the whole log."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_irc


def _write_log(d: Path, n: int, pad: int = 300) -> None:
    with open(d / "log.jsonl", "w", encoding="utf-8") as fh:
        for i in range(1, n + 1):
            fh.write(json.dumps({"seq": i, "from": "a", "to": "#t", "text": "y" * pad}) + "\n")


class HistoryTailTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.d = Path(self._tmp.name)

    def test_history_after_parses_only_the_tail(self):
        _write_log(self.d, 20000)
        real = json.loads
        calls = []
        with mock.patch.object(atlas_irc.json, "loads", lambda s, *a, **k: (calls.append(1), real(s, *a, **k))[1]):
            recs = atlas_irc.history(self.d, 19998)
        self.assertEqual([r["seq"] for r in recs], [19999, 20000])
        self.assertLess(len(calls), 500)

    def test_history_after_matches_full_scan(self):
        _write_log(self.d, 700, pad=900)  # several 64k blocks
        full = atlas_irc.history(self.d)
        for after in (0, 1, 69, 70, 350, 699, 700, 900):
            self.assertEqual(atlas_irc.history(self.d, after), [r for r in full if r["seq"] > after], after)

    def test_history_after_tolerates_torn_line(self):
        _write_log(self.d, 50)
        with open(self.d / "log.jsonl", "a", encoding="utf-8") as fh:
            fh.write('{"seq": 51, "te')
        self.assertEqual([r["seq"] for r in atlas_irc.history(self.d, 48)], [49, 50])


if __name__ == "__main__":
    unittest.main()
