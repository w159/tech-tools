"""17.28.0 (A): a simple task (resolved scope with one working seat or effort low, no team this run) is the
lead's own inline work: no inline-edit deny, no op-count deny, no STOP nudge. Larger scopes, no resolved
scope and ATLAS_INLINE_SIMPLE=off keep the old gates."""

import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
sys.path.insert(0, _HERE)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

os.environ.setdefault("ATLAS_CHANNELS", "off")

import tempfile  # noqa: E402
import unittest  # noqa: E402

import test_dispatch_tripwire as T  # noqa: E402


def setUpModule():
    T.setUpModule()


def tearDownModule():
    T.tearDownModule()


class SimpleInlineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # docs/ makes find_root() resolve the temp project, so the session's resolved scope is read there.
        os.makedirs(os.path.join(self.tmp, "docs"))
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            ATLAS_GATES="always",
            ATLAS_TRIPWIRE="on",
        )
        for k in ("ATLAS_TRIPWIRE_THRESHOLD", "ATLAS_WORKER_NAME", "ATLAS_INLINE_SIMPLE"):
            self.env.pop(k, None)
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-1")
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    def _scope(self, cls, effort, seats):
        d = os.path.join(self.tmp, ".atlas", ".run", "atlas-scope")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "sess-1.json"), "w") as fh:
            json.dump({"task_class": cls, "effort": effort, "working_seats": seats}, fh)

    def _p(self, event, tool, tinput):
        return {
            "session_id": "sess-1",
            "cwd": self.tmp,
            "hook_event_name": event,
            "tool_name": tool,
            "tool_input": tinput,
        }

    def _edit(self, env=None):
        return T.run_hook(self._p("PreToolUse", "Edit", {"file_path": "src/app.py"}), env or self.env)

    def _shell_burst(self, n, env=None):
        """n inline shell calls (Pre then Post each); returns the 10th Pre and the last Post output."""
        pre = post = None
        for _ in range(n):
            pre = T.run_hook(self._p("PreToolUse", "Bash", {"command": "touch a.txt"}), env or self.env)
            post = T.run_hook(self._p("PostToolUse", "Bash", {"command": "touch a.txt"}), env or self.env)
        return pre, post

    def test_simple_scope_allows_inline_edit_and_shell_burst(self):
        self._scope("fix", "low", 1)
        r = self._edit()
        self.assertNotIn('"permissionDecision": "deny"', r.stdout)
        self.assertNotIn("never edit target code inline", r.stdout)
        pre, post = self._shell_burst(10)
        self.assertNotIn('"permissionDecision": "deny"', pre.stdout)
        self.assertNotIn("STOP", post.stdout)
        # Post of an Edit to target code: no STOP nudge either.
        r = T.run_hook(self._p("PostToolUse", "Edit", {"file_path": "src/app.py"}), self.env)
        self.assertNotIn("STOP", r.stdout)

    def test_one_seat_medium_scope_is_simple(self):
        self._scope("audit", "medium", 1)
        self.assertNotIn('"permissionDecision": "deny"', self._edit().stdout)

    def test_medium_two_seat_scope_still_denies(self):
        self._scope("fix", "medium", 2)
        r = self._edit()
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("never edit target code inline", r.stdout)
        pre, post = self._shell_burst(10)
        self.assertIn('"permissionDecision": "deny"', pre.stdout)
        self.assertIn("inline ops since your last dispatch", pre.stdout)
        self.assertIn("STOP", post.stdout)

    def test_no_resolved_scope_behaves_as_before(self):
        r = self._edit()
        self.assertIn("never edit target code inline", r.stdout)
        pre, post = self._shell_burst(10)
        self.assertIn("inline ops since your last dispatch", pre.stdout)
        self.assertIn("STOP", post.stdout)

    def test_env_switch_restores_the_deny(self):
        self._scope("fix", "low", 1)
        env = dict(self.env, ATLAS_INLINE_SIMPLE="off")
        self.assertIn("never edit target code inline", self._edit(env).stdout)
        pre, post = self._shell_burst(10, env)
        self.assertIn("inline ops since your last dispatch", pre.stdout)
        self.assertIn("STOP", post.stdout)

    def test_team_launch_this_run_ends_simple(self):
        self._scope("fix", "low", 1)
        cmd = 'python3 "/opt/plug/atlas/scripts/atlas_mux.py" spawn-team --class fix --effort low --paths a'
        T.run_hook(self._p("PostToolUse", "Bash", {"command": cmd}), self.env)
        self.assertIn("never edit target code inline", self._edit().stdout)


if __name__ == "__main__":
    unittest.main()
