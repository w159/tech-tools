import os, sys, json, subprocess, tempfile, types, unittest, uuid
from unittest import mock
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import _test_isolation  # noqa: F401
HOOK = os.path.join(HERE, "delegation_prewarn.py")


def run(path, sid, tp="/x/session.jsonl", env=None, tool="Edit"):
    p = {"session_id": sid, "tool_name": tool, "transcript_path": tp, "tool_input": {"file_path": path}}
    r = subprocess.run([sys.executable, HOOK], input=json.dumps(p), capture_output=True, text=True,
                       env={**os.environ, **(env or {})})
    return r.stdout


class T(unittest.TestCase):
    def test_warn_once(self):
        sid = uuid.uuid4().hex
        self.assertIn("(m) delegation mandate", run("plugins/a.py", sid))
        self.assertEqual(run("plugins/b.py", sid), "")

    def test_exempt_and_docs(self):
        sid = uuid.uuid4().hex
        self.assertEqual(run("/r/docs/x.md", sid), "")
        self.assertEqual(run("/r/README.md", sid), "")

    def test_worker_and_off(self):
        self.assertEqual(run("plugins/a.py", uuid.uuid4().hex, tp="/s/subagents/agent-1.jsonl"), "")
        self.assertEqual(run("plugins/a.py", uuid.uuid4().hex, env={"ATLAS_GATE": "off"}), "")
        self.assertEqual(run("plugins/a.py", uuid.uuid4().hex, tool="Read"), "")


sys.path.insert(0, HERE)
import delegation_prewarn as dp  # noqa: E402


def _fake_gate(solo=False, exempt=((), ()), uri=False, code=True):
    return types.SimpleNamespace(
        _solo_mode=lambda: solo,
        _delegation_exempt=lambda: exempt,
        is_uri_path=lambda p: uri,
        _is_delegation_code=lambda p, *e: code,
    )


class ShouldWarnTest(unittest.TestCase):
    def sw(self, payload, **gate):
        with mock.patch.dict(sys.modules, {"completion_gate": _fake_gate(**gate)}):
            return dp.should_warn(payload)

    EDIT = {"tool_name": "Edit", "tool_input": {"file_path": "plugins/a.py"}}

    def test_true_only_for_code_edit(self):
        self.assertIs(self.sw(self.EDIT), True)

    def test_rejects_return_false_not_none(self):
        self.assertIs(self.sw({**self.EDIT, "agent_id": "x"}), False)
        self.assertIs(self.sw(self.EDIT, solo=True), False)
        self.assertIs(self.sw(self.EDIT, code=False), False)

    def test_empty_path_unknown_exempt_and_uri_each_reject(self):
        self.assertIs(self.sw({"tool_name": "Edit", "tool_input": {"file_path": ""}}), False)
        self.assertIs(self.sw({"tool_name": "Edit", "tool_input": None}), False)
        self.assertIs(self.sw(self.EDIT, exempt=None), False)
        self.assertIs(self.sw(self.EDIT, uri=True), False)


class CheapRejectTest(unittest.TestCase):
    def test_gate_off_is_case_insensitive_and_returns_true(self):
        with mock.patch.dict(os.environ, {"ATLAS_GATE": "OFF"}):
            self.assertIs(dp._cheap_reject({"tool_name": "Edit"}), True)

    def test_subagent_markers_return_true(self):
        with mock.patch.dict(os.environ, {"ATLAS_GATE": ""}):
            self.assertIs(dp._cheap_reject({"tool_name": "Edit", "agent_id": "a"}), True)
            self.assertIs(dp._cheap_reject({"tool_name": "Edit", "transcript_path": "C:\\s\\subagents\\a.jsonl"}), True)
            self.assertIs(dp._cheap_reject({"tool_name": "Edit", "transcript_path": "/s/main.jsonl"}), False)
            self.assertIs(dp._cheap_reject({"tool_name": "Bash"}), True)


class MarkerTest(unittest.TestCase):
    def test_session_id_sanitised_and_truncated_to_80(self):
        with mock.patch.dict(os.environ, {"TMPDIR": "/tmp/x-prewarn"}):
            self.assertEqual(dp._marker("a" * 100).name, "atlas-delegation-prewarn-" + "a" * 80)
            self.assertEqual(dp._marker("a/b c").name, "atlas-delegation-prewarn-abc")
            self.assertEqual(dp._marker("///").name, "atlas-delegation-prewarn-nosession")

    def test_temp_root_env_order_and_fallback(self):
        env = {"TMPDIR": "", "TEMP": "/tmp/t-temp", "TMP": "/tmp/t-tmp"}
        with mock.patch.dict(os.environ, env):
            self.assertEqual(dp._temp_root(), "/tmp/t-temp")
            os.environ["TMPDIR"] = "/tmp/t-dir"
            self.assertEqual(dp._temp_root(), "/tmp/t-dir")
        with mock.patch.dict(os.environ, {"TMPDIR": "", "TEMP": "", "TMP": ""}):
            self.assertEqual(dp._temp_root(), "/tmp")

    def test_non_posix_uses_tempfile_gettempdir(self):
        fake = types.SimpleNamespace(gettempdir=lambda: "/fake-tmp")
        with mock.patch.dict(sys.modules, {"tempfile": fake}), mock.patch.object(dp.os, "name", "nt"):
            self.assertEqual(dp._temp_root(), "/fake-tmp")


class MainTest(unittest.TestCase):
    def test_main_exit_code_and_lenient_json(self):
        sid = uuid.uuid4().hex
        # raw newline inside a JSON string: only strict=False parses it; must still warn
        raw = '{"session_id": "%s", "tool_name": "Edit", "tool_input": {"file_path": "plugins/a\n.py"}}' % sid
        with tempfile.TemporaryDirectory() as td:
            r = subprocess.run([sys.executable, HOOK], input=raw, capture_output=True, text=True,
                               env={**os.environ, "TMPDIR": td})
            self.assertEqual(r.returncode, 0)
            self.assertIn("(m) delegation mandate", r.stdout)
            self.assertTrue(os.path.exists(os.path.join(td, "atlas-delegation-prewarn-" + sid)))

    def test_main_returns_zero_on_each_path(self):
        class In:
            def __init__(self, t):
                self.t = t

            def read(self):
                return self.t

        def call(text, **gate):
            with mock.patch.object(sys, "stdin", In(text)), mock.patch.dict(
                sys.modules, {"completion_gate": _fake_gate(**gate)}
            ):
                return dp.main()

        sid = uuid.uuid4().hex
        edit = json.dumps({"session_id": sid, "tool_name": "Edit", "tool_input": {"file_path": "p/a.py"}})
        with tempfile.TemporaryDirectory() as td, mock.patch.dict(os.environ, {"TMPDIR": td, "ATLAS_GATE": ""}):
            self.assertEqual(call("not json"), 0)
            self.assertEqual(call(json.dumps({"tool_name": "Read"})), 0)
            self.assertEqual(call(edit, solo=True), 0)
            self.assertFalse(os.path.exists(os.path.join(td, "atlas-delegation-prewarn-" + sid)))
            self.assertEqual(call(edit), 0)
            self.assertTrue(os.path.exists(os.path.join(td, "atlas-delegation-prewarn-" + sid)))
            self.assertEqual(call(edit), 0)  # marker present: early exit


if __name__ == "__main__":
    unittest.main()
