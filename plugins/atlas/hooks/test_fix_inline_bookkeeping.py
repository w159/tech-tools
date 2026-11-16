import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
sys.path.insert(0, _HERE)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

os.environ.setdefault("ATLAS_CHANNELS", "off")

import tempfile  # noqa: E402
import unittest  # noqa: E402

import dispatch_tripwire_core as core  # noqa: E402
import test_dispatch_tripwire as T  # noqa: E402

TODO = 'python3 "/x/plugins/atlas/17.26.0/scripts/atlas_todo.py" complete --id t5bb2c6fc --session s1 --evidence "pytest ok"'


def setUpModule():
    T.setUpModule()


def tearDownModule():
    T.tearDownModule()


def bk(command, tool="Bash"):
    return core._is_bookkeeping_call(tool, {"command": command})


class PredicateTest(unittest.TestCase):
    def test_positive(self):
        for cmd in (
            TODO,
            "python3 /a/scripts/atlas_finding.py add --kind verified --summary 'x; y'",
            "python3 /a/scripts/atlas_resolve.py implement medium",
            "cd /repo && python3 /a/scripts/atlas_todo.py list",
            "python3 /a/scripts/atlas_todo.py list | head -20",
            "python3 /a/scripts/atlas_todo.py list | tail -5",
            "python3 /a/scripts/atlas_todo.py list --json | python3 -c 'import json,sys; print(json.load(sys.stdin))'",
            "/usr/bin/python3.12 /a/scripts/atlas_todo.py list 2>/dev/null",
        ):
            self.assertTrue(bk(cmd), cmd)
        self.assertTrue(bk(TODO, tool="mcp__lean-ctx__ctx_shell"))
        self.assertTrue(bk("lean-ctx -c '" + "python3 /a/scripts/atlas_todo.py list" + "'"))

    def test_negative(self):
        for cmd in (
            "python3 /a/scripts/atlas_todo.py list && rm -rf x",
            "rm -rf x; python3 /a/scripts/atlas_todo.py list",
            "python3 /a/scripts/atlas_todo.py list > out.txt",
            "cat <<EOF > f.py\nprint(1)\nEOF\npython3 /a/scripts/atlas_todo.py list",
            "python3 /a/scripts/atlas_todo.py list && python3 -c 'open(\"f\",\"w\")'",
            "python3 /a/scripts/other.py list",
            "python3 /a/scripts/atlas_todo.py list $(rm x)",
            "touch a.txt",
        ):
            self.assertFalse(bk(cmd), cmd)
        self.assertFalse(core._is_bookkeeping_call("Edit", {"command": TODO}))


class DenyPathTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            ATLAS_GATES="always",
            ATLAS_TRIPWIRE="on",
        )
        for k in ("ATLAS_TRIPWIRE_THRESHOLD", "ATLAS_WORKER_NAME"):
            self.env.pop(k, None)
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        self.run_id = atlas_db.start_run(conn, pid, "sess-1")
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    def _p(self, event, command):
        return {
            "session_id": "sess-1",
            "cwd": self.tmp,
            "hook_event_name": event,
            "tool_name": "Bash",
            "tool_input": T._named({"command": command}),
        }

    def _count(self):
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        try:
            return atlas_db.unsanctioned_inline_ops_since_last_dispatch(
                conn, atlas_db.current_or_last_run_id(conn, "sess-1")
            )
        finally:
            conn.close()

    def test_bookkeeping_past_threshold_is_not_denied_logged_or_reset(self):
        for _ in range(8):
            T.run_hook(self._p("PostToolUse", "touch a.txt"), self.env)
        before = self._count()
        self.assertGreaterEqual(before, core.DENY_THRESHOLD)
        r = T.run_hook(self._p("PreToolUse", TODO), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"permissionDecision": "deny"', r.stdout)
        T.run_hook(self._p("PostToolUse", TODO), self.env)
        self.assertEqual(self._count(), before)  # neither logged nor a reset
        mixed = "python3 /a/scripts/atlas_todo.py list && rm -rf x"
        r = T.run_hook(self._p("PreToolUse", mixed), self.env)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("inline ops since your last dispatch", r.stdout)


if __name__ == "__main__":
    unittest.main()
