import os, sys, json, subprocess, unittest, uuid
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
        self.assertEqual(run("/r/a.py", uuid.uuid4().hex, tp="/s/subagents/agent-1.jsonl"), "")
        self.assertEqual(run("/r/a.py", uuid.uuid4().hex, env={"ATLAS_GATE": "off"}), "")


if __name__ == "__main__":
    unittest.main()
