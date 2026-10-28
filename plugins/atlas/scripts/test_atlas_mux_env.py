#!/usr/bin/env python3
"""atlas_mux.clean_env: what a tmux pane and its worker inherit from the lead."""

import unittest

import _test_isolation  # noqa: F401
import atlas_mux


class CleanEnvTests(unittest.TestCase):
    def test_worker_does_not_inherit_the_leads_session_identity(self):
        # live 2026-10-28: every spawn-team worker ran under the lead's CLAUDE_CODE_SESSION_ID
        env = atlas_mux.clean_env(
            {
                "CLAUDE_CODE_SESSION_ID": "lead-sid",
                "CLAUDE_CODE_REMOTE_SESSION_ID": "lead-sid",
                "TMUX": "/tmp/x",
                "CMUX_SOCKET": "s",
                "KEEP": "1",
            }
        )
        self.assertEqual(env, {"KEEP": "1"})


if __name__ == "__main__":
    unittest.main()
