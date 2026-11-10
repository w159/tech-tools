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

    def test_worker_env_drops_ambient_secrets_and_keeps_runtime_basics(self):
        env = atlas_mux.worker_env(
            {
                "PATH": "/usr/bin",
                "HOME": "/tmp/home",
                "LANG": "en_US.UTF-8",
                "AWS_SECRET_ACCESS_KEY": "aws-secret",
                "GITHUB_TOKEN": "gh-secret",
                "NPM_TOKEN": "npm-secret",
                "VENDOR_API_KEY": "vendor-secret",
                "ATLAS_DB": "/tmp/atlas.db",
            }
        )
        self.assertEqual("/usr/bin", env["PATH"])
        self.assertEqual("/tmp/home", env["HOME"])
        self.assertEqual("en_US.UTF-8", env["LANG"])
        self.assertEqual("/tmp/atlas.db", env["ATLAS_DB"])
        for name in (
            "AWS_SECRET_ACCESS_KEY",
            "GITHUB_TOKEN",
            "NPM_TOKEN",
            "VENDOR_API_KEY",
        ):
            self.assertNotIn(name, env)

    def test_worker_env_forwards_only_explicit_extra_names(self):
        env = atlas_mux.worker_env(
            {
                "PATH": "/usr/bin",
                "ATLAS_WORKER_FORWARD_ENV": "OPENAI_API_KEY,EXTRA_TOKEN",
                "OPENAI_API_KEY": "openai-secret",
                "EXTRA_TOKEN": "extra-secret",
                "OTHER_TOKEN": "other-secret",
            }
        )
        self.assertEqual("openai-secret", env["OPENAI_API_KEY"])
        self.assertEqual("extra-secret", env["EXTRA_TOKEN"])
        self.assertNotIn("OTHER_TOKEN", env)


if __name__ == "__main__":
    unittest.main()
