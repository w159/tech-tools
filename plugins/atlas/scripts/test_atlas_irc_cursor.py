#!/usr/bin/env python3
"""atlas_irc set_cursor: concurrent writers must not crash or leave temp files."""

import tempfile
import threading
import unittest
from pathlib import Path

import _test_isolation  # noqa: F401
import atlas_irc


class SetCursorRaceTests(unittest.TestCase):
    def test_concurrent_writers_do_not_crash_or_tear(self):
        with tempfile.TemporaryDirectory() as tmp:
            errors = []

            def work(base):
                try:
                    for i in range(300):
                        atlas_irc.set_cursor(tmp, "n", base + i)
                except Exception as e:  # noqa: BLE001
                    errors.append(repr(e))

            ts = [threading.Thread(target=work, args=(k * 1000,)) for k in range(4)]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
            self.assertEqual(errors, [])
            self.assertGreaterEqual(atlas_irc.cursor(tmp, "n"), 0)
            self.assertFalse(list((Path(tmp) / "cursor").glob("*.tmp")))


if __name__ == "__main__":
    unittest.main()
