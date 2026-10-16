"""Guard: a test run must never touch the user's default tmux server."""

import os  # noqa: I001
import pathlib
import unittest

import _test_isolation  # noqa: F401,E402  (imported for its env side effects before any atlas module)

REAL_DEFAULT = f"/private/tmp/tmux-{os.getuid()}"


class TmuxIsolationTest(unittest.TestCase):
    def test_tmux_tmpdir_is_private(self):
        d = os.environ.get("TMUX_TMPDIR", "")
        self.assertTrue(d and os.path.isdir(d), "TMUX_TMPDIR unset: tmux would use the user's default socket")
        self.assertEqual(d, _test_isolation.TMUX_TMPDIR)
        self.assertFalse(os.path.realpath(d).startswith(os.path.realpath(REAL_DEFAULT)))
        self.assertNotIn("TMUX", os.environ)

    def test_mux_kills_use_exact_session_match(self):
        src = pathlib.Path(__file__).with_name("atlas_mux.py").read_text()
        self.assertNotIn('"kill-session", "-t", session', src)  # bare -t prefix-matches other sessions


if __name__ == "__main__":
    unittest.main()
