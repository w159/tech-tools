"""Tripwire operating-contract fixes: per-prompt inline-op window, lean-ctx read-only
unwrap, and stable (unresolved) plugin paths in deny/guidance text."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HOOKS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HOOKS)
sys.path.insert(0, os.path.join(HOOKS, "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_db  # noqa: E402
import dispatch_tripwire as dt  # noqa: E402


class PromptWindowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        pid = atlas_db.register_project(self.conn, "/repo/x")
        self.rid = atlas_db.start_run(self.conn, pid, "sess-1")

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _ops(self, n):
        for _ in range(n):
            atlas_db.log_event(self.conn, self.rid, "Bash", "main", 1)

    def _counts(self):
        return (
            atlas_db.inline_ops_since_last_dispatch(self.conn, self.rid),
            atlas_db.unsanctioned_inline_ops_since_last_dispatch(self.conn, self.rid),
        )

    def test_ops_before_a_prompt_do_not_count_after_it(self):
        self._ops(5)
        self.assertEqual(self._counts(), (5, 5))
        atlas_db.mark_prompt_boundary(self.conn, "sess-1")
        self.assertEqual(self._counts(), (0, 0))

    def test_ops_after_a_prompt_count(self):
        self._ops(5)
        atlas_db.mark_prompt_boundary(self.conn, "sess-1")
        self._ops(2)
        self.assertEqual(self._counts(), (2, 2))

    def test_no_run_is_a_noop(self):
        self.assertIsNone(atlas_db.mark_prompt_boundary(self.conn, "no-such-session"))


class LeanCtxUnwrapTest(unittest.TestCase):
    CASES = (
        ("lean-ctx -c 'git status'", True),
        ('lean-ctx -c "git status"', True),
        ("lean-ctx -c git status", True),
        ("/usr/local/bin/lean-ctx -c 'git log --oneline -5'", True),
        ("lean-ctx -c 'cat \"a b.txt\"'", True),  # nested quotes
        ("lean-ctx -c 'rm -rf x'", False),
        ('lean-ctx -c "rm -rf x"', False),
        ("lean-ctx -c rm -rf x", False),
        ("lean-ctx -c 'git status && rm x'", False),
        ("lean-ctx -c 'git status' && rm x", False),
        ("lean-ctx -c 'git status'; rm x", False),
        ("lean-ctx -c 'git commit -m \"x\"'", False),
        ("lean-ctx -c 'echo hi > f'", False),
        ("lean-ctx -c 'echo \"unterminated'", False),
        ("lean-ctx -c", False),
    )

    def test_classification(self):
        for command, read_only in self.CASES:
            self.assertIs(dt._is_read_only_bash(command), read_only, command)


class StablePluginPathTest(unittest.TestCase):
    def test_deny_text_names_unresolved_plugin_root(self):
        tmp = tempfile.mkdtemp()
        try:
            real = os.path.join(tmp, "real", "atlas")
            os.makedirs(os.path.join(real, "scripts"))
            link = os.path.join(tmp, "cache-link")
            os.symlink(real, link)
            code = (
                "import sys; sys.path.insert(0, %r); import dispatch_tripwire as d; "
                "print(d.SCRIPTS_DIR); print(d.RESOLVE_CMD); print(d.SPAWN_TEAM_CMD)"
                % HOOKS
            )
            env = dict(os.environ, CLAUDE_PLUGIN_ROOT=link)
            out = subprocess.run(
                [sys.executable, "-c", code],
                env=env,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.splitlines()
            self.assertEqual(out[0], os.path.join(link, "scripts"))
            self.assertIn(os.path.join(link, "scripts"), out[1])
            self.assertIn(os.path.join(link, "scripts"), out[2])
            self.assertNotIn(os.path.realpath(real), "\n".join(out))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
