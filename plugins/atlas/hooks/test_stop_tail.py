"""stop_tail runs the four Stop tail hooks in one process with isolated failures."""

import io
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import stop_tail  # noqa: E402


class _Hook:
    def __init__(self, name, log, behavior=None):
        self.name, self.log, self.behavior = name, log, behavior

    def main(self):
        self.log.append((self.name, sys.stdin.read()))
        if self.behavior:
            raise self.behavior


class StopTailTest(unittest.TestCase):
    def _run(self, behaviors):
        log = []
        mods = {n: _Hook(n, log, behaviors.get(n)) for n in stop_tail.TAIL}
        with (
            mock.patch("sys.stdin", io.StringIO('{"session_id": "s"}')),
            mock.patch.object(
                stop_tail, "__import__", create=True, side_effect=mods.__getitem__
            ),
        ):
            self.assertEqual(stop_tail.main(), 0)
        return log

    def test_every_hook_gets_the_same_payload_in_order(self):
        log = self._run({})
        self.assertEqual([n for n, _ in log], list(stop_tail.TAIL))
        self.assertEqual({p for _, p in log}, {'{"session_id": "s"}'})

    def test_exit_and_exception_do_not_stop_later_hooks(self):
        log = self._run(
            {"ingest_session": SystemExit(0), "chronicle_facet": RuntimeError("boom")}
        )
        self.assertEqual([n for n, _ in log], list(stop_tail.TAIL))

    def test_stdin_is_restored(self):
        before = sys.stdin
        self._run({})
        self.assertIs(sys.stdin, before)


if __name__ == "__main__":
    unittest.main()
